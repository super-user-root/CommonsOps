import type { Cycle, ProposalLink } from "@commonsops/domain";
import { parseDecimal } from "@commonsops/domain";
import type {
  ExpectedNativePayment,
  PaymentState,
  VerifiedPayment,
} from "@commonsops/near";
import {
  pinnedSputnikProfiles,
  verifyNativeSputnikPayment,
} from "@commonsops/near";
import { deriveContributorCycleView } from "../contributor/contributor.ts";

export const MAX_PROPOSAL_DESCRIPTION_BYTES = 512;
const MAX_FIXTURE_LABEL_BYTES = 200;
const MAX_SAFE_PROPOSAL_ID = 9_007_199_254_740_991n;

export interface PinnedSputnikProfileInput {
  readonly version: string;
  readonly codeHash: string;
}

export interface SputnikPolicySnapshot {
  readonly proposal_bond: string;
}

export interface NativeTransferProposalPreview {
  readonly description: string;
  readonly kind: {
    readonly Transfer: {
      readonly token_id: "";
      readonly receiver_id: string;
      readonly amount: string;
      readonly msg: null;
    };
  };
}

export interface ReviewerTransactionIntent {
  readonly receiverId: string;
  readonly method: "add_proposal" | "link_proposal";
  readonly args: Readonly<Record<string, unknown>>;
  readonly attachedDepositYocto: string;
  readonly network: "TESTNET";
  readonly signingEnabled: false;
  readonly disabledReason: string;
}

export type ProposalLinkPreviewStatus =
  "AWAITING_PROPOSAL_ID" | "PREVIEW_READY" | "LINKED_IMMUTABLE";

export interface ProposalLinkPreview {
  readonly status: ProposalLinkPreviewStatus;
  readonly proposalId: string | null;
  readonly existingLink: ProposalLink | null;
  readonly intent: ReviewerTransactionIntent | null;
  readonly reason: string;
}

export type ReviewerObservation =
  | { readonly kind: "ABSENT" }
  | {
      readonly kind: "PENDING";
      readonly fixtureLabel: string;
      readonly proposal: unknown | null;
    }
  | {
      readonly kind: "FIXTURE";
      readonly fixtureLabel: string;
      readonly proposal: unknown;
      readonly receiptResponse: unknown;
    };

export type ReviewerPaymentState =
  | "NOT_LINKED"
  | "PREPARED"
  | "PENDING_GOVERNANCE"
  | "PENDING_PAYMENT_EVIDENCE"
  | "REJECTED"
  | PaymentState;

export interface ReviewerPaymentDisplay {
  readonly state: ReviewerPaymentState;
  readonly reason: string;
  readonly conflictReason: string | null;
  readonly proposalStatus: string | null;
  readonly adapterState: PaymentState | null;
  readonly transactionHash: string | null;
  readonly actionReceiptId: string | null;
  readonly payoutReceiptId: string | null;
  readonly evidenceKey: string | null;
  readonly blockHash: string | null;
}

export type ReviewerRequestState =
  | { readonly status: "IDLE" }
  | {
      readonly status: "PENDING";
      readonly method: ReviewerTransactionIntent["method"];
    }
  | {
      readonly status: "SUCCESS";
      readonly method: ReviewerTransactionIntent["method"];
      readonly transactionHash: string;
    }
  | {
      readonly status: "ERROR";
      readonly method: ReviewerTransactionIntent["method"];
      readonly message: string;
    };

export interface ReviewerModelInput {
  readonly cycle: Cycle;
  readonly profile: PinnedSputnikProfileInput;
  readonly policy: SputnikPolicySnapshot;
  readonly reviewedRegistryAccountId: string | null;
  readonly proposalIdForLink: string | null;
  readonly observation: ReviewerObservation;
}

export interface ReviewerModel {
  readonly cycle: Cycle;
  readonly profile: PinnedSputnikProfileInput;
  readonly profileSupported: boolean;
  readonly policy: SputnikPolicySnapshot;
  readonly proposal: NativeTransferProposalPreview;
  readonly addProposalIntent: ReviewerTransactionIntent;
  readonly link: ProposalLinkPreview;
  readonly payment: ReviewerPaymentDisplay;
  readonly fixtureNotice: string;
}

interface ValidatedAbsentObservation {
  readonly kind: "ABSENT";
}

interface ValidatedPendingObservation {
  readonly kind: "PENDING";
  readonly fixtureLabel: string;
  readonly proposal: Readonly<Record<string, unknown>> | null;
}

interface ValidatedFixtureObservation {
  readonly kind: "FIXTURE";
  readonly fixtureLabel: string;
  readonly proposal: unknown;
  readonly receiptResponse: unknown;
}

type ValidatedReviewerObservation =
  | ValidatedAbsentObservation
  | ValidatedPendingObservation
  | ValidatedFixtureObservation;

interface CompleteProposal {
  readonly id: number;
  readonly status: string;
  readonly transfer: {
    readonly token_id: string;
    readonly receiver_id: string;
    readonly amount: string;
    readonly msg: unknown;
  };
}

function canonicalDecimal(
  value: string,
  field: string,
  bits: 64 | 128,
  positive: boolean,
): bigint {
  try {
    const parsed = parseDecimal(value, bits);
    if (positive && parsed === 0n) throw new Error("zero");
    return parsed;
  } catch {
    const zero = positive ? "positive " : "";
    throw new Error(`${field}: canonical ${zero}u${bits} decimal required`);
  }
}

function accountId(value: string, field: string): string {
  if (!/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value)) {
    throw new Error(`${field}: valid NEAR account required`);
  }
  return value;
}

function boundedLabel(value: string, field: string): string {
  const size = new TextEncoder().encode(value).length;
  if (!value.trim() || size > MAX_FIXTURE_LABEL_BYTES) {
    throw new Error(
      `${field}: 1–${MAX_FIXTURE_LABEL_BYTES} UTF-8 bytes required`,
    );
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function cloneFixtureValue(value: unknown, field: string): unknown {
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${field}: structured clone required`);
  }
}

function validateObservation(value: unknown): ValidatedReviewerObservation {
  if (!isObject(value) || typeof value.kind !== "string") {
    throw new Error("observation: exact discriminated object required");
  }
  switch (value.kind) {
    case "ABSENT":
      if (!hasExactKeys(value, ["kind"])) {
        throw new Error("observation.ABSENT: unexpected or missing fields");
      }
      return Object.freeze({ kind: "ABSENT" as const });
    case "PENDING": {
      if (!hasExactKeys(value, ["kind", "fixtureLabel", "proposal"])) {
        throw new Error("observation.PENDING: unexpected or missing fields");
      }
      if (typeof value.fixtureLabel !== "string") {
        throw new Error("observation.PENDING.fixtureLabel: string required");
      }
      const fixtureLabel = boundedLabel(
        value.fixtureLabel,
        "observation.PENDING.fixtureLabel",
      );
      if (value.proposal !== null && !isObject(value.proposal)) {
        throw new Error(
          "observation.PENDING.proposal: object or null required",
        );
      }
      const proposal =
        value.proposal === null
          ? null
          : (cloneFixtureValue(
              value.proposal,
              "observation.PENDING.proposal",
            ) as Record<string, unknown>);
      return Object.freeze({
        kind: "PENDING" as const,
        fixtureLabel,
        proposal: proposal ? Object.freeze(proposal) : null,
      });
    }
    case "FIXTURE": {
      if (
        !hasExactKeys(value, [
          "kind",
          "fixtureLabel",
          "proposal",
          "receiptResponse",
        ])
      ) {
        throw new Error("observation.FIXTURE: unexpected or missing fields");
      }
      if (typeof value.fixtureLabel !== "string") {
        throw new Error("observation.FIXTURE.fixtureLabel: string required");
      }
      const fixtureLabel = boundedLabel(
        value.fixtureLabel,
        "observation.FIXTURE.fixtureLabel",
      );
      return Object.freeze({
        kind: "FIXTURE" as const,
        fixtureLabel,
        proposal: cloneFixtureValue(
          value.proposal,
          "observation.FIXTURE.proposal",
        ),
        receiptResponse: cloneFixtureValue(
          value.receiptResponse,
          "observation.FIXTURE.receiptResponse",
        ),
      });
    }
    default:
      throw new Error("observation.kind: unsupported value");
  }
}

function snapshotProfile(value: unknown): PinnedSputnikProfileInput {
  if (!isObject(value) || !hasExactKeys(value, ["version", "codeHash"])) {
    throw new Error("profile: exact version and codeHash required");
  }
  if (
    typeof value.version !== "string" ||
    !value.version.trim() ||
    typeof value.codeHash !== "string" ||
    !value.codeHash.trim()
  ) {
    throw new Error("profile: nonempty version and codeHash strings required");
  }
  return Object.freeze({
    version: value.version,
    codeHash: value.codeHash,
  });
}

function profileSupported(profile: PinnedSputnikProfileInput): boolean {
  return Object.entries(pinnedSputnikProfiles).some(
    ([version, pinned]) =>
      version === profile.version &&
      pinned.codeHash !== null &&
      pinned.codeHash === profile.codeHash,
  );
}

function freezeCycle(cycle: Cycle): Cycle {
  const key = Object.freeze({ ...cycle.key });
  const claim = cycle.claim ? Object.freeze({ ...cycle.claim }) : null;
  const evidence = cycle.evidence ? Object.freeze({ ...cycle.evidence }) : null;
  const proposalLink = cycle.proposal_link
    ? Object.freeze({
        key: Object.freeze({ ...cycle.proposal_link.key }),
        linked_at_ns: cycle.proposal_link.linked_at_ns,
      })
    : null;
  return Object.freeze({
    ...cycle,
    key,
    claim,
    evidence,
    proposal_link: proposalLink,
  });
}

async function submittedCycleSnapshot(cycle: Cycle): Promise<Cycle> {
  const snapshot = freezeCycle(cycle);
  if (snapshot.status !== "SUBMITTED") {
    throw new Error("cycle: immutable SUBMITTED record required");
  }
  await deriveContributorCycleView(
    snapshot,
    snapshot.submitted_at_ns ?? "0",
    null,
  );
  if (
    snapshot.status !== "SUBMITTED" ||
    !snapshot.claim ||
    !snapshot.evidence ||
    snapshot.submitted_at_ns === null
  ) {
    throw new Error("cycle: immutable SUBMITTED record required");
  }
  accountId(snapshot.dao_account_id, "cycle.dao_account_id");
  accountId(snapshot.claim.claimant_id, "cycle.claim.claimant_id");
  accountId(
    snapshot.claim.payout_recipient_id,
    "cycle.claim.payout_recipient_id",
  );
  if (snapshot.claim.claimant_id !== snapshot.claim.payout_recipient_id) {
    throw new Error("cycle.claim: claimant must equal payout recipient");
  }
  if (snapshot.proposal_link) {
    if (snapshot.proposal_link.key.network !== "TESTNET") {
      throw new Error("cycle.proposal_link: TESTNET link required");
    }
    if (snapshot.proposal_link.key.dao_account_id !== snapshot.dao_account_id) {
      throw new Error("cycle.proposal_link: DAO mismatch");
    }
    canonicalDecimal(
      snapshot.proposal_link.key.proposal_id,
      "cycle.proposal_link.key.proposal_id",
      64,
      true,
    );
  }
  return snapshot;
}

function nativeProposal(cycle: Cycle): NativeTransferProposalPreview {
  const claim = cycle.claim;
  const evidence = cycle.evidence;
  if (!claim || !evidence) {
    throw new Error("cycle: immutable claim and evidence required");
  }
  const cycleId = `${cycle.key.template_id}:${cycle.key.period_index}`;
  const description = `CommonsOps cycle ${cycleId}; evidence ${evidence.url}; commit ${evidence.commit_sha}`;
  if (
    !description ||
    new TextEncoder().encode(description).length >
      MAX_PROPOSAL_DESCRIPTION_BYTES
  ) {
    throw new Error("proposal.description: bounded plain text required");
  }
  return Object.freeze({
    description,
    kind: Object.freeze({
      Transfer: Object.freeze({
        token_id: "" as const,
        receiver_id: claim.payout_recipient_id,
        amount: cycle.amount_yocto,
        msg: null,
      }),
    }),
  });
}

function signingReason(
  operation: "proposal" | "link",
  reviewedRegistryAccountId: string | null,
  supported: boolean,
): string {
  const profileReason = supported
    ? ""
    : "The supplied Sputnik profile/code hash is unsupported. ";
  const registryReason =
    operation === "link" && !reviewedRegistryAccountId
      ? "No reviewed testnet registry account is configured. "
      : "";
  return `${profileReason}${registryReason}Unsigned preview only: no wallet connector is configured, this is not executable or authorized, and P3-T02 owns live transaction construction and signing.`;
}

function addProposalIntent(
  cycle: Cycle,
  proposal: NativeTransferProposalPreview,
  bond: string,
  supported: boolean,
): ReviewerTransactionIntent {
  return Object.freeze({
    receiverId: cycle.dao_account_id,
    method: "add_proposal" as const,
    args: Object.freeze({ proposal }),
    attachedDepositYocto: bond,
    network: "TESTNET" as const,
    signingEnabled: false as const,
    disabledReason: signingReason("proposal", null, supported),
  });
}

function linkPreview(
  cycle: Cycle,
  reviewedRegistryAccountId: string | null,
  proposalIdForLink: unknown,
  supported: boolean,
): ProposalLinkPreview {
  if (reviewedRegistryAccountId !== null) {
    accountId(reviewedRegistryAccountId, "reviewedRegistryAccountId");
  }
  if (cycle.proposal_link) {
    const reason =
      "The registry proposal link is immutable and globally one-time; replacement and replay are not allowed. The supplied replacement candidate was ignored without parsing.";
    return Object.freeze({
      status: "LINKED_IMMUTABLE" as const,
      proposalId: cycle.proposal_link.key.proposal_id,
      existingLink: cycle.proposal_link,
      intent: null,
      reason,
    });
  }

  const candidate =
    proposalIdForLink === null
      ? null
      : typeof proposalIdForLink === "string"
        ? (canonicalDecimal(proposalIdForLink, "proposalIdForLink", 64, true),
          proposalIdForLink)
        : (() => {
            throw new Error("proposalIdForLink: string or null required");
          })();

  if (candidate === null) {
    return Object.freeze({
      status: "AWAITING_PROPOSAL_ID" as const,
      proposalId: null,
      existingLink: null,
      intent: null,
      reason:
        "A canonical positive U64 proposal ID is required before a link_proposal preview can be constructed. No browser state is changed.",
    });
  }

  const reason = signingReason("link", reviewedRegistryAccountId, supported);
  const intent = Object.freeze({
    receiverId: reviewedRegistryAccountId ?? "",
    method: "link_proposal" as const,
    args: Object.freeze({
      cycle_key: Object.freeze({ ...cycle.key }),
      proposal_id: candidate,
    }),
    attachedDepositYocto: "0",
    network: "TESTNET" as const,
    signingEnabled: false as const,
    disabledReason: reason,
  });
  return Object.freeze({
    status: "PREVIEW_READY" as const,
    proposalId: candidate,
    existingLink: null,
    intent,
    reason,
  });
}

function display(
  state: ReviewerPaymentState,
  reason: string,
  proposalStatus: string | null = null,
): ReviewerPaymentDisplay {
  return Object.freeze({
    state,
    reason,
    conflictReason: null,
    proposalStatus,
    adapterState: null,
    transactionHash: null,
    actionReceiptId: null,
    payoutReceiptId: null,
    evidenceKey: null,
    blockHash: null,
  });
}

function adapterDisplay(
  verified: VerifiedPayment,
  proposalStatus: string,
  state: ReviewerPaymentState = verified.state,
  conflictReason: string | null = null,
): ReviewerPaymentDisplay {
  return Object.freeze({
    state,
    reason: verified.reason,
    conflictReason,
    proposalStatus,
    adapterState: verified.state,
    transactionHash: verified.transactionHash,
    actionReceiptId: verified.actionReceiptId,
    payoutReceiptId: verified.payoutReceiptId,
    evidenceKey: verified.evidenceKey,
    blockHash: verified.blockHash,
  });
}

function completeProposal(proposal: unknown): CompleteProposal | null {
  if (
    !isObject(proposal) ||
    !Number.isSafeInteger(proposal.id) ||
    (proposal.id as number) < 0 ||
    typeof proposal.status !== "string" ||
    !proposal.status ||
    !isObject(proposal.kind) ||
    !isObject(proposal.kind.Transfer)
  ) {
    return null;
  }
  const transfer = proposal.kind.Transfer;
  if (
    typeof transfer.token_id !== "string" ||
    typeof transfer.receiver_id !== "string" ||
    typeof transfer.amount !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(transfer.amount) ||
    !Object.hasOwn(transfer, "msg")
  ) {
    return null;
  }
  return {
    id: proposal.id as number,
    status: proposal.status,
    transfer: {
      token_id: transfer.token_id,
      receiver_id: transfer.receiver_id,
      amount: transfer.amount,
      msg: transfer.msg,
    },
  };
}

function proposalMatchesCycle(
  proposal: CompleteProposal,
  cycle: Cycle,
): boolean {
  const link = cycle.proposal_link;
  const claim = cycle.claim;
  return Boolean(
    link &&
    claim &&
    BigInt(proposal.id) === BigInt(link.key.proposal_id) &&
    proposal.transfer.token_id === "" &&
    proposal.transfer.receiver_id === claim.payout_recipient_id &&
    proposal.transfer.amount === cycle.amount_yocto &&
    proposal.transfer.msg === null,
  );
}

function fixtureNotice(observation: ValidatedReviewerObservation): string {
  switch (observation.kind) {
    case "ABSENT":
      return "No proposal or receipt fixture was supplied; absence is explicit.";
    case "PENDING":
      return `Fixture-derived pending input: ${observation.fixtureLabel}`;
    case "FIXTURE":
      return `Fixture-derived proposal and receipt input: ${observation.fixtureLabel}`;
  }
}

function expectedPayment(
  cycle: Cycle,
  profile: PinnedSputnikProfileInput,
): ExpectedNativePayment {
  const link = cycle.proposal_link;
  const claim = cycle.claim;
  if (!link || !claim)
    throw new Error("cycle: immutable payment link required");
  return {
    network: "testnet",
    daoAccountId: cycle.dao_account_id,
    proposalId: link.key.proposal_id,
    recipientId: claim.payout_recipient_id,
    amountYocto: cycle.amount_yocto,
    version: profile.version as ExpectedNativePayment["version"],
    codeHash: profile.codeHash,
  };
}

function derivePaymentFromSnapshot(
  cycle: Cycle,
  profile: PinnedSputnikProfileInput,
  proposalIdForLink: string | null,
  observation: ValidatedReviewerObservation,
): ReviewerPaymentDisplay {
  const linked = cycle.proposal_link;
  if (!linked) {
    return proposalIdForLink === null
      ? display(
          "NOT_LINKED",
          "No immutable registry proposal link exists; this cycle is not paid.",
        )
      : display(
          "PREPARED",
          "A proposal/link preview is prepared, but no immutable registry link exists and no payment can be attributed.",
        );
  }

  if (!profileSupported(profile)) {
    return display("UNKNOWN", "Unsupported Sputnik deployment profile");
  }

  if (observation.kind === "ABSENT") {
    return display(
      "UNKNOWN",
      "No proposal or execution fixture is available for the immutable link.",
    );
  }

  const complete = completeProposal(observation.proposal);
  if (!complete) {
    return observation.kind === "PENDING" && observation.proposal === null
      ? display(
          "PENDING_GOVERNANCE",
          "The linked proposal fixture is pending; no execution evidence exists.",
        )
      : display(
          "UNKNOWN",
          "The supplied proposal fixture is malformed or incomplete.",
        );
  }

  if (BigInt(linked.key.proposal_id) > MAX_SAFE_PROPOSAL_ID) {
    return display(
      "UNKNOWN",
      "The linked U64 proposal ID cannot be represented safely by the pinned adapter proposal shape.",
      complete.status,
    );
  }

  if (observation.kind === "PENDING") {
    if (!proposalMatchesCycle(complete, cycle)) {
      return display(
        "INVALID",
        "The pending proposal does not match the immutable link, recipient, native asset, or amount.",
        complete.status,
      );
    }
    if (["Rejected", "Removed", "Expired"].includes(complete.status)) {
      return display(
        "REJECTED",
        `Sputnik proposal status is ${complete.status}; no execution evidence exists and the cycle is not paid.`,
        complete.status,
      );
    }
    if (complete.status === "Failed") {
      return display(
        "FAILED",
        "Sputnik reports proposal execution as Failed; no verified payout evidence exists.",
        complete.status,
      );
    }
    if (complete.status === "Approved") {
      return display(
        "PENDING_PAYMENT_EVIDENCE",
        "Approved alone is not payment proof; a finalized causal receipt graph is still required.",
        complete.status,
      );
    }
    if (complete.status === "InProgress") {
      return display(
        "PENDING_GOVERNANCE",
        "The exact linked proposal remains in governance and is not paid.",
        complete.status,
      );
    }
    return display(
      "UNKNOWN",
      "The supplied proposal status is unsupported.",
      complete.status,
    );
  }

  const verified = verifyNativeSputnikPayment(
    expectedPayment(cycle, profile),
    observation.proposal,
    observation.receiptResponse,
  );
  if (verified.state === "PAID" && complete.status !== "Approved") {
    return adapterDisplay(
      verified,
      complete.status,
      "INVALID",
      "Verified payout evidence conflicts with the supplied proposal status.",
    );
  }
  return adapterDisplay(verified, complete.status);
}

export async function deriveReviewerPaymentState(
  cycle: Cycle,
  profile: PinnedSputnikProfileInput,
  proposalIdForLink: string | null,
  observation: ReviewerObservation,
): Promise<ReviewerPaymentDisplay> {
  const profileSnapshot = snapshotProfile(profile);
  const proposalIdSnapshot = proposalIdForLink;
  const validatedObservation = validateObservation(observation);
  const snapshot = await submittedCycleSnapshot(cycle);
  if (snapshot.proposal_link === null && proposalIdSnapshot !== null) {
    if (typeof proposalIdSnapshot !== "string") {
      throw new Error("proposalIdForLink: string or null required");
    }
    canonicalDecimal(proposalIdSnapshot, "proposalIdForLink", 64, true);
  }
  fixtureNotice(validatedObservation);
  return derivePaymentFromSnapshot(
    snapshot,
    profileSnapshot,
    proposalIdSnapshot,
    validatedObservation,
  );
}

export async function buildReviewerModel(
  input: ReviewerModelInput,
): Promise<ReviewerModel> {
  const cycleInput = input.cycle;
  const profile = snapshotProfile(input.profile);
  const policyInput = input.policy;
  if (!isObject(policyInput) || !hasExactKeys(policyInput, ["proposal_bond"])) {
    throw new Error("policy: exact proposal_bond required");
  }
  const bond = policyInput.proposal_bond;
  if (typeof bond !== "string") {
    throw new Error("policy.proposal_bond: string required");
  }
  canonicalDecimal(bond, "policy.proposal_bond", 128, false);
  const reviewedRegistryAccountId = input.reviewedRegistryAccountId;
  const proposalIdForLink = input.proposalIdForLink;
  const observation = validateObservation(input.observation);
  const cycle = await submittedCycleSnapshot(cycleInput);
  const supported = profileSupported(profile);
  const proposal = nativeProposal(cycle);
  const link = linkPreview(
    cycle,
    reviewedRegistryAccountId,
    proposalIdForLink,
    supported,
  );
  const notice = fixtureNotice(observation);
  const payment = derivePaymentFromSnapshot(
    cycle,
    profile,
    proposalIdForLink,
    observation,
  );
  return Object.freeze({
    cycle,
    profile,
    profileSupported: supported,
    policy: Object.freeze({ proposal_bond: bond }),
    proposal,
    addProposalIntent: addProposalIntent(cycle, proposal, bond, supported),
    link,
    payment,
    fixtureNotice: notice,
  });
}

export function reviewerRequestDetail(state: ReviewerRequestState): string {
  switch (state.status) {
    case "IDLE":
      return "No signing request has been supplied.";
    case "PENDING":
      return `Future integration reports ${state.method} as pending.`;
    case "SUCCESS":
      return `Future integration reports ${state.method} in transaction ${state.transactionHash}.`;
    case "ERROR":
      return `Future integration reports ${state.method} failed: ${state.message}`;
  }
}
