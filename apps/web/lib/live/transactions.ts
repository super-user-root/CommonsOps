// Builds wallet-selector transactions from the EXACT reviewed contributor
// intent construction (apps/web/src/features/contributor/contributor.ts —
// the same builders the recorded journey previews render). Wire values match
// the executed testnet journey: 100 TeraGas prepaid gas, zero attached
// deposit (lib.rs assert_zero_deposit on every contributor method).

import type { Action } from "@near-wallet-selector/core";
import type { ContributorTransactionIntent } from "../../src/features/contributor/contributor.ts";
import { explorerTransactionUrl, isValidTransactionHash } from "./network.ts";

export interface WalletFunctionCallAction {
  readonly type: "FunctionCall";
  readonly params: {
    readonly methodName: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly gas: string;
    readonly deposit: string;
  };
}

export interface WalletTransaction {
  readonly receiverId: string;
  readonly actions: readonly WalletFunctionCallAction[];
}

// Exact prepaid gas of every recorded journey transaction (docs/testnet-journey.md).
export const CONTRIBUTOR_CALL_GAS_TGAS = "100";
const GAS_YOCTO = "100000000000000";

export function contributorWalletTransaction(
  intent: ContributorTransactionIntent,
  registryAccountId: string,
): WalletTransaction {
  if (intent.network !== "TESTNET") {
    throw new Error("ERR_INTENT_NETWORK: contributor intents are testnet-only");
  }
  if (!intent.actionAllowed) {
    throw new Error(
      `ERR_INTENT_NOT_ALLOWED: ${intent.method} is not available (${intent.disabledReason})`,
    );
  }
  if (intent.receiverId !== registryAccountId) {
    throw new Error(
      "ERR_INTENT_RECEIVER: intent receiver does not match the deployed registry",
    );
  }
  if (intent.attachedDepositYocto !== "0") {
    throw new Error(
      "ERR_INTENT_DEPOSIT: contributor methods require a zero attached deposit",
    );
  }
  return Object.freeze({
    receiverId: registryAccountId,
    actions: Object.freeze([
      Object.freeze({
        type: "FunctionCall" as const,
        params: Object.freeze({
          methodName: intent.method,
          args: Object.freeze({ ...intent.args }),
          gas: GAS_YOCTO,
          deposit: "0",
        }),
      }),
    ]),
  });
}

export interface WalletSelectorTransaction {
  readonly receiverId: string;
  readonly actions: Action[];
}

// Converts the reviewed internal action into the near-js action the wallet
// implementations require (my-near-wallet feeds actions straight into
// near-js createTransaction). The import stays dynamic so the wallet
// selector is only evaluated in the browser; the JSON-serialized args bytes
// are exactly the reviewed intent args.
export async function toWalletSelectorTransaction(
  transaction: WalletTransaction,
): Promise<WalletSelectorTransaction> {
  const core = await import("@near-wallet-selector/core");
  return {
    receiverId: transaction.receiverId,
    actions: transaction.actions.map((action) =>
      core.actionCreators.functionCall(
        action.params.methodName,
        action.params.args,
        BigInt(action.params.gas),
        BigInt(action.params.deposit),
      ),
    ),
  };
}

interface WalletOutcomeLike {
  readonly transaction_outcome?: { readonly id?: unknown };
  readonly transaction?: { readonly hash?: unknown };
}

export function extractTransactionHash(outcomes: readonly unknown[]): string {
  for (const outcome of outcomes) {
    if (
      outcome &&
      typeof outcome === "object" &&
      ("transaction_outcome" in outcome || "transaction" in outcome)
    ) {
      const candidate =
        (outcome as WalletOutcomeLike).transaction_outcome?.id ??
        (outcome as WalletOutcomeLike).transaction?.hash;
      if (isValidTransactionHash(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error(
    "ERR_TX_HASH_MISSING: the wallet returned no transaction hash; check the wallet for the actual outcome",
  );
}

export type SendOutcome =
  | {
      readonly kind: "SUCCESS";
      readonly transactionHash: string;
      readonly explorerUrl: string;
    }
  | { readonly kind: "REJECTED"; readonly detail: string }
  | { readonly kind: "ERROR"; readonly message: string };

function isDismissal(message: string): boolean {
  return /dismiss|cancel|reject|declined|closed/i.test(message);
}

// Sends one contributor intent through the connected wallet. The wallet is
// the only signer; this module transports nothing else. A wallet dismissal is
// reported honestly as REJECTED: no request was sent, nothing changed.
export async function sendContributorIntent(
  send: (transaction: WalletTransaction) => Promise<readonly unknown[]>,
  intent: ContributorTransactionIntent,
  registryAccountId: string,
): Promise<SendOutcome> {
  const transaction = contributorWalletTransaction(intent, registryAccountId);
  try {
    const outcomes = await send(transaction);
    const transactionHash = extractTransactionHash(outcomes);
    return Object.freeze({
      kind: "SUCCESS" as const,
      transactionHash,
      explorerUrl: explorerTransactionUrl(transactionHash),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    if (isDismissal(message)) {
      return Object.freeze({
        kind: "REJECTED" as const,
        detail:
          "The wallet request was dismissed. No transaction was sent and no onchain state changed.",
      });
    }
    return Object.freeze({ kind: "ERROR" as const, message });
  }
}

export type LiveRequestState =
  | { readonly status: "IDLE" }
  | { readonly status: "PENDING"; readonly method: string }
  | {
      readonly status: "SUCCESS";
      readonly method: string;
      readonly transactionHash: string;
      readonly explorerUrl: string;
    }
  | {
      readonly status: "REJECTED";
      readonly method: string;
      readonly detail: string;
    }
  | {
      readonly status: "ERROR";
      readonly method: string;
      readonly message: string;
    };

export function describeLiveRequest(state: LiveRequestState): string {
  switch (state.status) {
    case "IDLE":
      return "No transaction request has been made from this browser.";
    case "PENDING":
      return `Waiting for your wallet to sign ${state.method}. Nothing is sent until you approve it.`;
    case "SUCCESS":
      return `${state.method} was signed and sent by your wallet in transaction ${state.transactionHash}.`;
    case "REJECTED":
      return `${state.method}: no request sent. ${state.detail}`;
    case "ERROR":
      return `${state.method} failed: ${state.message}`;
  }
}
