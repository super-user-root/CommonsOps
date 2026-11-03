export interface AdapterFoundationMetadata {
  readonly stage: "foundation";
  readonly networkConfigured: false;
  readonly walletConnected: false;
  readonly liveReadsEnabled: false;
  readonly transactionsEnabled: false;
}

export const adapterFoundationMetadata: AdapterFoundationMetadata =
  Object.freeze({
    stage: "foundation",
    networkConfigured: false,
    walletConnected: false,
    liveReadsEnabled: false,
    transactionsEnabled: false,
  });

export const pinnedSputnikProfiles = Object.freeze({
  "2.0.0": Object.freeze({
    codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq",
    payoutGraph: "DIRECT_CHILD_NO_CALLBACK" as const,
  }),
  "3.0.0": Object.freeze({
    codeHash: null,
    payoutGraph: "CALLBACK_REQUIRED" as const,
  }),
});

export type PaymentState =
  "PAID" | "FAILED" | "INVALID" | "UNKNOWN" | "AMBIGUOUS";

export interface SputnikNativeProposal {
  readonly id: number;
  readonly status: string;
  readonly kind: {
    readonly Transfer: {
      readonly token_id: string;
      readonly receiver_id: string;
      readonly amount: string;
      readonly msg: null;
    };
  };
}

export interface ExpectedNativePayment {
  readonly network: "testnet";
  readonly daoAccountId: string;
  readonly proposalId: string;
  readonly recipientId: string;
  readonly amountYocto: string;
  readonly version: keyof typeof pinnedSputnikProfiles;
  readonly codeHash: string;
}

export interface VerifiedPayment {
  readonly state: PaymentState;
  readonly reason: string;
  readonly transactionHash: string | null;
  readonly actionReceiptId: string | null;
  readonly payoutReceiptId: string | null;
  readonly evidenceKey: string | null;
  readonly blockHash: string | null;
}

interface RpcAction {
  readonly FunctionCall?: {
    readonly method_name?: unknown;
    readonly args?: unknown;
    readonly deposit?: unknown;
  };
  readonly Transfer?: { readonly deposit?: unknown };
}

interface RpcReceipt {
  readonly receipt_id?: unknown;
  readonly predecessor_id?: unknown;
  readonly receiver_id?: unknown;
  readonly receipt?: { readonly Action?: { readonly actions?: unknown } };
}

interface RpcOutcome {
  readonly id?: unknown;
  readonly block_hash?: unknown;
  readonly outcome?: {
    readonly status?: unknown;
    readonly receipt_ids?: unknown;
  };
}

interface RpcTransactionStatus {
  readonly final_execution_status?: unknown;
  readonly transaction?: {
    readonly hash?: unknown;
    readonly receiver_id?: unknown;
    readonly actions?: unknown;
  };
  readonly transaction_outcome?: RpcOutcome;
  readonly receipts?: unknown;
  readonly receipts_outcome?: unknown;
}

function result(state: PaymentState, reason: string, values = {}) {
  return {
    state,
    reason,
    transactionHash: null,
    actionReceiptId: null,
    payoutReceiptId: null,
    evidenceKey: null,
    blockHash: null,
    ...values,
  } satisfies VerifiedPayment;
}

function decimal(value: unknown): string | null {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function successStatus(status: unknown): boolean {
  return (
    typeof status === "object" &&
    status !== null &&
    (Object.hasOwn(status, "SuccessValue") ||
      Object.hasOwn(status, "SuccessReceiptId"))
  );
}

function failureStatus(status: unknown): boolean {
  return (
    typeof status === "object" &&
    status !== null &&
    Object.hasOwn(status, "Failure")
  );
}

function actions(value: unknown): readonly RpcAction[] | null {
  return Array.isArray(value) ? (value as RpcAction[]) : null;
}

function decodeProposalAction(action: RpcAction): number | null {
  const call = action.FunctionCall;
  if (call?.method_name !== "act_proposal" || typeof call.args !== "string") {
    return null;
  }
  if (decimal(call.deposit) !== "0") return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(call.args, "base64").toString("utf8"),
    );
    const id = parsed?.id;
    return Number.isSafeInteger(id) &&
      id >= 0 &&
      parsed?.action === "VoteApprove"
      ? id
      : null;
  } catch {
    return null;
  }
}

export function verifyNativeSputnikPayment(
  expected: ExpectedNativePayment,
  proposal: unknown,
  response: unknown,
): VerifiedPayment {
  const profile = pinnedSputnikProfiles[expected.version];
  if (!profile || profile.codeHash !== expected.codeHash) {
    return result("UNKNOWN", "Unsupported Sputnik deployment profile");
  }
  if (!/^(0|[1-9][0-9]*)$/.test(expected.proposalId)) {
    return result("INVALID", "Expected proposal ID is not canonical decimal");
  }
  if (!decimal(expected.amountYocto) || expected.amountYocto === "0") {
    return result("INVALID", "Expected payment amount is invalid");
  }
  const proposalRecord = proposal as Partial<SputnikNativeProposal> | null;
  const transfer = proposalRecord?.kind?.Transfer;
  if (
    proposalRecord?.id !== Number(expected.proposalId) ||
    !transfer ||
    transfer.token_id !== "" ||
    transfer.receiver_id !== expected.recipientId ||
    decimal(transfer.amount) !== expected.amountYocto ||
    transfer.msg !== null
  ) {
    return result("INVALID", "Proposal does not match expected native payout");
  }
  const payload = (response as { result?: unknown })?.result ?? response;
  if (typeof payload !== "object" || payload === null) {
    return result("UNKNOWN", "Transaction response is missing");
  }
  const rpc = payload as RpcTransactionStatus;
  const transactionHash = stringValue(rpc.transaction?.hash);
  if (
    rpc.final_execution_status !== "FINAL" ||
    !transactionHash ||
    rpc.transaction?.receiver_id !== expected.daoAccountId
  ) {
    return result(
      "UNKNOWN",
      "Transaction is not final or targets another DAO",
      {
        transactionHash,
      },
    );
  }
  const transactionActions = actions(rpc.transaction.actions);
  if (!transactionActions || transactionActions.length !== 1) {
    return result(
      "INVALID",
      "Transaction does not contain one proposal action",
      {
        transactionHash,
      },
    );
  }
  const onlyTransactionAction = transactionActions[0];
  if (!onlyTransactionAction) {
    return result("UNKNOWN", "Transaction action is missing", {
      transactionHash,
    });
  }
  const proposalId = decodeProposalAction(onlyTransactionAction);
  if (String(proposalId) !== expected.proposalId) {
    return result("INVALID", "Proposal action does not match linked proposal", {
      transactionHash,
    });
  }
  const txStatus = rpc.transaction_outcome?.outcome?.status;
  if (!successStatus(txStatus)) {
    return result(
      failureStatus(txStatus) ? "FAILED" : "UNKNOWN",
      "Proposal transaction outcome is not successful",
      { transactionHash },
    );
  }
  const rootReceiptId =
    typeof txStatus === "object" && txStatus !== null
      ? stringValue(
          (txStatus as { SuccessReceiptId?: unknown }).SuccessReceiptId,
        )
      : null;
  const receipts = Array.isArray(rpc.receipts)
    ? (rpc.receipts as RpcReceipt[])
    : null;
  const outcomes = Array.isArray(rpc.receipts_outcome)
    ? (rpc.receipts_outcome as RpcOutcome[])
    : null;
  if (!rootReceiptId || !receipts || !outcomes) {
    return result("UNKNOWN", "Receipt graph is incomplete", {
      transactionHash,
    });
  }
  const actionReceipt = receipts.find(
    (receipt) => receipt.receipt_id === rootReceiptId,
  );
  const actionOutcome = outcomes.find(
    (outcome) => outcome.id === rootReceiptId,
  );
  if (!actionReceipt || !actionOutcome) {
    return result("UNKNOWN", "Proposal action receipt is missing", {
      transactionHash,
    });
  }
  const actionStatus = actionOutcome.outcome?.status;
  if (!successStatus(actionStatus)) {
    return result(
      failureStatus(actionStatus) ? "FAILED" : "UNKNOWN",
      "Proposal action receipt did not succeed",
      { transactionHash, actionReceiptId: rootReceiptId },
    );
  }
  const childIds = Array.isArray(actionOutcome.outcome?.receipt_ids)
    ? (actionOutcome.outcome.receipt_ids as unknown[]).filter(
        (value): value is string => typeof value === "string",
      )
    : null;
  if (!childIds) {
    return result("UNKNOWN", "Proposal action child receipts are missing", {
      transactionHash,
      actionReceiptId: rootReceiptId,
    });
  }
  const matches = childIds.flatMap((receiptId) => {
    const receipt = receipts.find(
      (candidate) => candidate.receipt_id === receiptId,
    );
    const outcome = outcomes.find((candidate) => candidate.id === receiptId);
    const receiptActions = actions(receipt?.receipt?.Action?.actions);
    const onlyReceiptAction = receiptActions?.[0];
    if (
      !receipt ||
      !outcome ||
      receipt.predecessor_id !== expected.daoAccountId ||
      receipt.receiver_id !== expected.recipientId ||
      !receiptActions ||
      receiptActions.length !== 1 ||
      !onlyReceiptAction ||
      decimal(onlyReceiptAction.Transfer?.deposit) !== expected.amountYocto
    ) {
      return [];
    }
    if (!successStatus(outcome.outcome?.status)) return [];
    return [{ receiptId, blockHash: stringValue(outcome.block_hash) }];
  });
  if (matches.length === 0) {
    return result("FAILED", "No successful causal payout receipt matches", {
      transactionHash,
      actionReceiptId: rootReceiptId,
    });
  }
  const match = matches[0];
  if (matches.length !== 1 || !match?.blockHash) {
    return result("AMBIGUOUS", "Payout receipt attribution is ambiguous", {
      transactionHash,
      actionReceiptId: rootReceiptId,
    });
  }
  const evidenceKey = [
    expected.network,
    expected.daoAccountId,
    expected.proposalId,
    rootReceiptId,
    match.receiptId,
  ].join(":");
  return result("PAID", "Verified one successful causal native NEAR payout", {
    transactionHash,
    actionReceiptId: rootReceiptId,
    payoutReceiptId: match.receiptId,
    evidenceKey,
    blockHash: match.blockHash,
  });
}
