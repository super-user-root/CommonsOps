import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Cycle } from "@commonsops/domain";
import {
  buildReviewerModel,
  deriveReviewerPaymentState,
  reviewerRequestDetail,
  type ReviewerModelInput,
  type ReviewerObservation,
} from "./reviewer.ts";

const U64_MAX = "18446744073709551615";
const U128_MAX = "340282366920938463463374607431768211455";
const dao = "marmaj.sputnikv2.testnet";
const recipient = "chloe.testnet";
const amount63 = "81900000000000000000000000";
const amount62 = "378000000000000000000000000";
const bond = "19000000000000000000000";
const profile = {
  version: "2.0.0",
  codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq",
};
const fixtures = path.resolve(
  import.meta.dirname,
  "../../../../../tests/fixtures/sputnik",
);

const evidence = {
  repository_owner: "example",
  repository_name: "docs",
  pull_request_number: "42",
  url: "https://github.com/example/docs/pull/42",
  commit_sha: "ab".repeat(20),
  digest_sha256:
    "03970fbdf3f5f23e4be7a57548214c1a85ba8ecafac0cc3a34d9f52881e94773",
};

function submittedCycle(
  proposalId: string | null = null,
  overrides: Partial<Cycle> = {},
): Cycle {
  return {
    key: { template_id: "7", period_index: "3" },
    status: "SUBMITTED",
    opens_at_ns: "100",
    deadline_at_ns: "600",
    dao_account_id: dao,
    amount_yocto: amount63,
    claim: {
      claimant_id: recipient,
      payout_recipient_id: recipient,
      expires_at_ns: "500",
    },
    evidence: { ...evidence },
    submitted_at_ns: "400",
    proposal_link:
      proposalId === null
        ? null
        : {
            key: {
              network: "TESTNET",
              dao_account_id: dao,
              proposal_id: proposalId,
            },
            linked_at_ns: "450",
          },
    ...overrides,
  };
}

function proposal(
  id = 63,
  status = "Approved",
  transferOverrides: Record<string, unknown> = {},
) {
  return {
    id,
    status,
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: recipient,
        amount: amount63,
        msg: null,
        ...transferOverrides,
      },
    },
  };
}

function input(
  overrides: Partial<ReviewerModelInput> = {},
): ReviewerModelInput {
  return {
    cycle: submittedCycle(),
    profile,
    policy: { proposal_bond: bond },
    reviewedRegistryAccountId: "registry.testnet",
    proposalIdForLink: "63",
    observation: { kind: "ABSENT" },
    ...overrides,
  };
}

async function fixture(name: string) {
  return JSON.parse(await readFile(path.join(fixtures, name), "utf8"));
}

function pending(
  proposalRecord: unknown,
  label = "explicit reviewer fixture",
): ReviewerObservation {
  return {
    kind: "PENDING",
    fixtureLabel: label,
    proposal: proposalRecord,
  };
}

test("builds the exact native Transfer and unsigned add_proposal preview", async () => {
  const model = await buildReviewerModel(input());
  assert.deepEqual(model.proposal, {
    description: `CommonsOps cycle 7:3; evidence ${evidence.url}; commit ${evidence.commit_sha}`,
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: recipient,
        amount: amount63,
        msg: null,
      },
    },
  });
  assert.deepEqual(model.addProposalIntent, {
    receiverId: dao,
    method: "add_proposal",
    args: { proposal: model.proposal },
    attachedDepositYocto: bond,
    network: "TESTNET",
    signingEnabled: false,
    disabledReason:
      "Unsigned preview only: no wallet connector is configured, this is not executable or authorized, and P3-T02 owns live transaction construction and signing.",
  });
  assert.equal("paid" in model, false);
  assert.equal("sign" in model.addProposalIntent, false);
});

test("freezes the accepted cycle snapshot against later caller mutation", async () => {
  const supplied = submittedCycle();
  const originalEvidenceUrl = supplied.evidence!.url;
  const model = await buildReviewerModel(input({ cycle: supplied }));
  Object.assign(supplied.claim!, {
    payout_recipient_id: "mallory.testnet",
  });
  Object.assign(supplied.evidence!, {
    url: "https://github.com/mallory/replaced/pull/1",
  });
  assert.equal(model.cycle.claim?.payout_recipient_id, recipient);
  assert.equal(model.proposal.kind.Transfer.receiver_id, recipient);
  assert.equal(model.cycle.evidence?.url, originalEvidenceUrl);
  assert.match(model.proposal.description, /example\/docs\/pull\/42/);
});

test("requires a supplied SUBMITTED cycle", async () => {
  await assert.rejects(
    buildReviewerModel(
      input({
        cycle: {
          ...submittedCycle(),
          status: "CLAIMED",
          evidence: null,
          submitted_at_ns: null,
        },
      }),
    ),
    /immutable SUBMITTED record required/,
  );
});

test("builds exact zero-deposit link_proposal ABI only for a positive U64 ID", async () => {
  const model = await buildReviewerModel(input());
  assert.equal(model.link.status, "PREVIEW_READY");
  assert.deepEqual(model.link.intent, {
    receiverId: "registry.testnet",
    method: "link_proposal",
    args: {
      cycle_key: { template_id: "7", period_index: "3" },
      proposal_id: "63",
    },
    attachedDepositYocto: "0",
    network: "TESTNET",
    signingEnabled: false,
    disabledReason:
      "Unsigned preview only: no wallet connector is configured, this is not executable or authorized, and P3-T02 owns live transaction construction and signing.",
  });

  const absent = await buildReviewerModel(input({ proposalIdForLink: null }));
  assert.equal(absent.link.status, "AWAITING_PROPOSAL_ID");
  assert.equal(absent.link.intent, null);

  for (const invalid of ["0", "00", "01", "-1", "1.5", `${U64_MAX}0`]) {
    await assert.rejects(
      buildReviewerModel(input({ proposalIdForLink: invalid })),
      /proposalIdForLink/,
    );
  }
  const maximum = await buildReviewerModel(
    input({ proposalIdForLink: U64_MAX }),
  );
  assert.equal(maximum.link.intent?.args.proposal_id, U64_MAX);
});

test("accepts exact zero, positive, and maximum policy bond and rejects malformed u128", async () => {
  for (const value of ["0", "1", U128_MAX]) {
    const model = await buildReviewerModel(
      input({ policy: { proposal_bond: value } }),
    );
    assert.equal(model.addProposalIntent.attachedDepositYocto, value);
  }
  for (const invalid of ["00", "01", "-1", "1.5", `${U128_MAX}0`]) {
    await assert.rejects(
      buildReviewerModel(input({ policy: { proposal_bond: invalid } })),
      /policy.proposal_bond/,
    );
  }
});

test("fails closed on noncanonical cycle values and immutable recipient or evidence changes", async () => {
  await assert.rejects(
    buildReviewerModel(
      input({
        cycle: submittedCycle(null, {
          claim: {
            claimant_id: recipient,
            payout_recipient_id: "mallory.testnet",
            expires_at_ns: "500",
          },
        }),
      }),
    ),
    /claimant must equal payout recipient/,
  );
  await assert.rejects(
    buildReviewerModel(
      input({
        cycle: submittedCycle(null, {
          evidence: { ...evidence, digest_sha256: "0".repeat(64) },
        }),
      }),
    ),
    /canonical contract evidence/,
  );
  for (const cycle of [
    submittedCycle(null, {
      key: { template_id: "01", period_index: "3" },
    }),
    submittedCycle(null, { amount_yocto: "01" }),
    submittedCycle(null, { amount_yocto: `${U128_MAX}0` }),
  ]) {
    await assert.rejects(buildReviewerModel(input({ cycle })));
  }
  await assert.rejects(
    buildReviewerModel(
      input({
        cycle: submittedCycle("63", {
          proposal_link: {
            key: {
              network: "TESTNET",
              dao_account_id: "other.sputnikv2.testnet",
              proposal_id: "63",
            },
            linked_at_ns: "450",
          },
        }),
      }),
    ),
    /DAO mismatch/,
  );
});

test("existing immutable link ignores every supplied replacement without parsing", async () => {
  for (const candidate of [
    null,
    "63",
    "64",
    "0",
    "01",
    "malformed",
    `${U64_MAX}0`,
    63 as unknown as string,
    { injected: true } as unknown as string,
  ]) {
    const model = await buildReviewerModel(
      input({
        cycle: submittedCycle("63"),
        proposalIdForLink: candidate,
      }),
    );
    assert.equal(model.link.status, "LINKED_IMMUTABLE");
    assert.equal(model.link.proposalId, "63");
    assert.equal(model.link.intent, null);
    assert.match(model.link.reason, /replacement and replay are not allowed/);
    assert.match(model.link.reason, /candidate was ignored without parsing/);
  }
});

test("unsupported profile is UNKNOWN before every linked observation mapping", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const observations: readonly ReviewerObservation[] = [
    pending(null, "pending null"),
    pending(proposal(63, "InProgress"), "pending governance"),
    pending(proposal(), "approved without receipts"),
    pending(proposal(63, "Rejected"), "rejected without receipts"),
    pending({ id: 63, status: "Approved" }, "malformed proposal"),
    {
      kind: "FIXTURE",
      fixtureLabel: "authentic paid fixture",
      proposal: proposal(),
      receiptResponse: paid,
    },
  ];
  for (const unsupported of [
    { version: "9.9.9", codeHash: profile.codeHash },
    { version: profile.version, codeHash: "unsupported" },
  ]) {
    for (const observation of observations) {
      const result = await deriveReviewerPaymentState(
        submittedCycle("63"),
        unsupported,
        null,
        observation,
      );
      assert.equal(result.state, "UNKNOWN");
      assert.equal(result.adapterState, null);
      assert.equal(result.proposalStatus, null);
      assert.match(result.reason, /Unsupported Sputnik deployment profile/);
      assert.equal(result.transactionHash, null);
    }
  }
});

test("maps absent, prepared, governance, approved-only and rejected proposal states truthfully", async () => {
  const absent = await deriveReviewerPaymentState(
    submittedCycle(),
    profile,
    null,
    { kind: "ABSENT" },
  );
  assert.equal(absent.state, "NOT_LINKED");

  const prepared = await deriveReviewerPaymentState(
    submittedCycle(),
    profile,
    "63",
    { kind: "ABSENT" },
  );
  assert.equal(prepared.state, "PREPARED");

  const awaiting = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    pending(null),
  );
  assert.equal(awaiting.state, "PENDING_GOVERNANCE");

  const inProgress = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    pending(proposal(63, "InProgress")),
  );
  assert.equal(inProgress.state, "PENDING_GOVERNANCE");

  const approvedOnly = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    pending(proposal()),
  );
  assert.equal(approvedOnly.state, "PENDING_PAYMENT_EVIDENCE");
  assert.notEqual(approvedOnly.state, "PAID");
  assert.match(approvedOnly.reason, /Approved alone is not payment proof/);

  for (const status of ["Rejected", "Removed", "Expired"]) {
    const rejected = await deriveReviewerPaymentState(
      submittedCycle("63"),
      profile,
      null,
      pending(proposal(63, status)),
    );
    assert.equal(rejected.state, "REJECTED");
    assert.equal(rejected.proposalStatus, status);
    assert.equal(rejected.adapterState, null);
    assert.equal(rejected.transactionHash, null);
  }
});

test("derives PAID with full provenance only from the authentic causal receipt graph", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const result = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    {
      kind: "FIXTURE",
      fixtureLabel: "P3-T01 authentic proposal-63 paid fixture",
      proposal: proposal(),
      receiptResponse: paid,
    },
  );
  assert.deepEqual(result, {
    state: "PAID",
    reason: "Verified one successful causal native NEAR payout",
    conflictReason: null,
    proposalStatus: "Approved",
    adapterState: "PAID",
    transactionHash: "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm",
    actionReceiptId: "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
    payoutReceiptId: "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
    evidenceKey:
      "testnet:marmaj.sputnikv2.testnet:63:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
    blockHash: "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy",
  });
});

test("derives FAILED from the authentic proposal-62 failed action fixture", async () => {
  const failed = await fixture("proposal-62-failed.json");
  const cycle = submittedCycle("62", { amount_yocto: amount62 });
  const result = await deriveReviewerPaymentState(cycle, profile, null, {
    kind: "FIXTURE",
    fixtureLabel: "P3-T01 authentic proposal-62 failed fixture",
    proposal: proposal(62, "InProgress", { amount: amount62 }),
    receiptResponse: failed,
  });
  assert.equal(result.state, "FAILED");
  assert.equal(result.adapterState, "FAILED");
  assert.match(result.reason, /action receipt failed/);
  assert.equal(result.payoutReceiptId, null);
});

test("preserves adapter UNKNOWN, INVALID and AMBIGUOUS as distinct states", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const unsupported = await deriveReviewerPaymentState(
    submittedCycle("63"),
    { ...profile, codeHash: "unsupported" },
    null,
    {
      kind: "FIXTURE",
      fixtureLabel: "unsupported profile fixture input",
      proposal: proposal(),
      receiptResponse: paid,
    },
  );
  assert.equal(unsupported.state, "UNKNOWN");
  assert.match(unsupported.reason, /Unsupported Sputnik/);

  const malformed = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    {
      kind: "FIXTURE",
      fixtureLabel: "incomplete receipt response",
      proposal: proposal(),
      receiptResponse: {},
    },
  );
  assert.equal(malformed.state, "UNKNOWN");

  for (const wrongProposal of [
    proposal(62),
    proposal(63, "Approved", { receiver_id: "other.testnet" }),
    proposal(63, "Approved", { amount: bond }),
  ]) {
    const invalid = await deriveReviewerPaymentState(
      submittedCycle("63"),
      profile,
      null,
      {
        kind: "FIXTURE",
        fixtureLabel: "mismatched proposal fixture",
        proposal: wrongProposal,
        receiptResponse: paid,
      },
    );
    assert.equal(invalid.state, "INVALID");
  }

  const paidWithRejectedStatus = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    {
      kind: "FIXTURE",
      fixtureLabel: "inconsistent rejected status with paid graph",
      proposal: proposal(63, "Rejected"),
      receiptResponse: paid,
    },
  );
  assert.equal(paidWithRejectedStatus.state, "INVALID");
  assert.equal(paidWithRejectedStatus.adapterState, "PAID");
  assert.equal(
    paidWithRejectedStatus.reason,
    "Verified one successful causal native NEAR payout",
  );
  assert.equal(
    paidWithRejectedStatus.conflictReason,
    "Verified payout evidence conflicts with the supplied proposal status.",
  );
  assert.equal(
    paidWithRejectedStatus.transactionHash,
    "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm",
  );
  assert.equal(
    paidWithRejectedStatus.actionReceiptId,
    "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
  );
  assert.equal(
    paidWithRejectedStatus.payoutReceiptId,
    "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  );
  assert.equal(
    paidWithRejectedStatus.evidenceKey,
    "testnet:marmaj.sputnikv2.testnet:63:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  );
  assert.equal(
    paidWithRejectedStatus.blockHash,
    "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy",
  );

  const ambiguousResponse = structuredClone(paid);
  const payoutId = "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ";
  const payout = ambiguousResponse.result.receipts.find(
    (receipt: { receipt_id: string }) => receipt.receipt_id === payoutId,
  );
  const payoutOutcome = ambiguousResponse.result.receipts_outcome.find(
    (outcome: { id: string }) => outcome.id === payoutId,
  );
  const actionOutcome = ambiguousResponse.result.receipts_outcome.find(
    (outcome: { id: string }) =>
      outcome.id === "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
  );
  assert(payout && payoutOutcome && actionOutcome);
  const duplicateId = "9".repeat(44);
  ambiguousResponse.result.receipts.push({
    ...structuredClone(payout),
    receipt_id: duplicateId,
  });
  ambiguousResponse.result.receipts_outcome.push({
    ...structuredClone(payoutOutcome),
    id: duplicateId,
  });
  actionOutcome.outcome.receipt_ids.push(duplicateId);
  const ambiguous = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    {
      kind: "FIXTURE",
      fixtureLabel: "ambiguous causal payout fixture mutation",
      proposal: proposal(),
      receiptResponse: ambiguousResponse,
    },
  );
  assert.equal(ambiguous.state, "AMBIGUOUS");
  assert.equal(ambiguous.adapterState, "AMBIGUOUS");
});

test("runtime observation validator rejects every non-exact shape before payment derivation", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const malformed = [
    {},
    { kind: "UNRECOGNIZED", proposal: proposal(), receiptResponse: paid },
    { kind: "ABSENT", fixtureLabel: "injected" },
    {
      kind: "PENDING",
      fixtureLabel: "pending with receipt",
      proposal: proposal(),
      receiptResponse: paid,
    },
    { kind: "PENDING", fixtureLabel: "missing proposal" },
    {
      kind: "FIXTURE",
      fixtureLabel: "missing receipt response",
      proposal: proposal(),
    },
    {
      kind: "FIXTURE",
      fixtureLabel: "missing proposal",
      receiptResponse: paid,
    },
    {
      kind: "FIXTURE",
      fixtureLabel: "injected field",
      proposal: proposal(),
      receiptResponse: paid,
      paid: true,
    },
  ];
  for (const observation of malformed) {
    await assert.rejects(
      deriveReviewerPaymentState(
        submittedCycle("63"),
        profile,
        null,
        JSON.parse(JSON.stringify(observation)) as ReviewerObservation,
      ),
      /observation/,
    );
  }
});

test("validated observation snapshot prevents caller mutation races", async () => {
  const paid = await fixture("proposal-63-paid.json");
  const observation = {
    kind: "FIXTURE",
    fixtureLabel: "mutable caller fixture",
    proposal: proposal(),
    receiptResponse: paid,
  } as const;
  const pendingResult = deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    observation,
  );
  Object.assign(observation.proposal.kind.Transfer, {
    receiver_id: "mallory.testnet",
  });
  Object.assign(observation.receiptResponse, { result: null });
  const result = await pendingResult;
  assert.equal(result.state, "PAID");
  assert.equal(
    result.payoutReceiptId,
    "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  );
});

test("keeps malformed proposal inputs unknown and unsafe large adapter IDs fail closed", async () => {
  const malformed = await deriveReviewerPaymentState(
    submittedCycle("63"),
    profile,
    null,
    pending({ id: 63, status: "Approved" }),
  );
  assert.equal(malformed.state, "UNKNOWN");

  const large = await deriveReviewerPaymentState(
    submittedCycle(U64_MAX),
    profile,
    null,
    pending(proposal()),
  );
  assert.equal(large.state, "UNKNOWN");
  assert.match(large.reason, /represented safely/);
});

test("ignores caller-controlled paid-like properties and never optimistically succeeds", async () => {
  const hostile = {
    ...input({
      cycle: submittedCycle("63"),
      proposalIdForLink: null,
      observation: pending(proposal()),
    }),
    paid: true,
    paymentState: "PAID",
  } as ReviewerModelInput & {
    readonly paid: boolean;
    readonly paymentState: string;
  };
  const model = await buildReviewerModel(hostile);
  assert.equal(model.payment.state, "PENDING_PAYMENT_EVIDENCE");
  assert.notEqual(model.payment.state, hostile.paymentState);
  assert.equal("paid" in model, false);
});

test("labels fixture provenance and models future request status without changing payment", async () => {
  const model = await buildReviewerModel(
    input({
      cycle: submittedCycle("63"),
      proposalIdForLink: null,
      observation: pending(proposal(63, "InProgress"), "demo fixture A"),
    }),
  );
  assert.equal(
    model.fixtureNotice,
    "Fixture-derived pending input: demo fixture A",
  );
  assert.match(reviewerRequestDetail({ status: "IDLE" }), /No signing/);
  assert.match(
    reviewerRequestDetail({ status: "PENDING", method: "add_proposal" }),
    /pending/,
  );
  assert.match(
    reviewerRequestDetail({
      status: "SUCCESS",
      method: "link_proposal",
      transactionHash: "future-tx",
    }),
    /future-tx/,
  );
  assert.match(
    reviewerRequestDetail({
      status: "ERROR",
      method: "add_proposal",
      message: "wallet rejected",
    }),
    /wallet rejected/,
  );
  assert.equal(model.payment.state, "PENDING_GOVERNANCE");
});
