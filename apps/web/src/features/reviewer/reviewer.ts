import type { Cycle, ProposalLink } from "@commonsops/domain";
import { parseDecimal } from "@commonsops/domain";
import type {
  ExpectedNativePayment,
  NativeTransferProposal,
  PaymentState,
  SputnikProfileInput,
  UnsignedAddProposalRequest,
  UnavailableUnsignedAddProposalPreview,
  ValidatedSputnikPolicySnapshot,
  VerifiedPayment,
} from "@commonsops/near";
import {
  buildNativeSputnikTransferProposal,
  buildNativeTransferProposalPreview,
  buildUnavailableAddProposalPreview,
  isSupportedSputnikProfile,
  isValidatedSputnikPolicySnapshot,
  parseSputnikPolicyFixture,
  parseSputnikPolicyFixtureWithoutBlock,
  prepareUnsignedAddProposalRequest,
  verifyNativeSputnikPayment,
} from "@commonsops/near";
import { deriveContributorCycleView } from "../contributor/contributor.ts";

export const MAX_PROPOSAL_DESCRIPTION_BYTES = 512;
const MAX_FIXTURE_LABEL_BYTES = 200;
const MAX_SAFE_PROPOSAL_ID = 9_007_199_254_740_991n;
const MAX_REVIEWER_DATA_DEPTH = 64;
const MAX_REVIEWER_DATA_NODES = 100_000;
const MAX_REVIEWER_ARRAY_LENGTH = 100_000;
const MAX_REVIEWER_STRING_BYTES = 512 * 1024;

export type PinnedSputnikProfileInput = SputnikProfileInput;
export type SputnikPolicySnapshot = ValidatedSputnikPolicySnapshot;
export type ReviewerPolicyInput =
  SputnikPolicySnapshot | { readonly proposal_bond: string };
export type NativeTransferProposalPreview = NativeTransferProposal;

export interface ReviewerTransactionIntent {
  readonly receiverId: string;
  readonly method: "add_proposal" | "link_proposal";
  readonly args: Readonly<Record<string, unknown>>;
  readonly attachedDepositYocto: string;
  readonly network: "TESTNET";
  readonly signingEnabled: false;
  readonly disabledReason: string;
  readonly gas?: string | null;
  readonly gasParameter?: UnsignedAddProposalRequest["gasParameter"];
  readonly executable?: false;
  readonly authorization?: UnsignedAddProposalRequest["authorization"];
  readonly policySnapshot?: ValidatedSputnikPolicySnapshot;
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
  readonly policy: ReviewerPolicyInput;
  readonly reviewedRegistryAccountId: string | null;
  readonly proposalIdForLink: string | null;
  readonly addProposalGas?: string | null;
  readonly observation: ReviewerObservation;
}

export interface ReviewerModel {
  readonly cycle: Cycle;
  readonly profile: PinnedSputnikProfileInput;
  readonly profileSupported: boolean;
  readonly policy: SputnikPolicySnapshot;
  readonly proposal: NativeTransferProposalPreview;
  readonly addProposalIntent:
    UnsignedAddProposalRequest | UnavailableUnsignedAddProposalPreview;
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

function ownDataSnapshotOneOf(
  value: unknown,
  expectedSets: readonly (readonly string[])[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) throw new Error(`${field}: exact object required`);
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${field}: inspectable plain object required`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field}: plain object required`);
  }
  const keys = Reflect.ownKeys(descriptors);
  const expected = expectedSets.find(
    (candidate) =>
      keys.length === candidate.length &&
      keys.every((key) => typeof key === "string" && candidate.includes(key)),
  );
  if (!expected) throw new Error(`${field}: unexpected or missing fields`);
  const snapshot: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${field}.${key}: own enumerable data property required`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function ownDataSnapshot(
  value: unknown,
  expected: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  const snapshot = ownDataSnapshotOneOf(value, [expected], field);
  cloneFixtureValue(value, field);
  return snapshot;
}

function ownDataSnapshotRequired(
  value: unknown,
  required: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isObject(value)) throw new Error(`${field}: exact object required`);
  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${field}: inspectable plain object required`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field}: plain object required`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    required.some((key) => !keys.includes(key))
  ) {
    throw new Error(`${field}: required own fields are missing`);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${field}.${key}: own enumerable data property required`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function assertDataTree(value: unknown, field: string): void {
  const active = new Set<object>();
  const stack: Array<
    | {
        readonly kind: "ENTER";
        readonly value: unknown;
        readonly depth: number;
      }
    | { readonly kind: "EXIT"; readonly value: object }
  > = [{ kind: "ENTER", value, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if (entry.kind === "EXIT") {
      active.delete(entry.value);
      continue;
    }
    nodes += 1;
    if (
      nodes > MAX_REVIEWER_DATA_NODES ||
      entry.depth > MAX_REVIEWER_DATA_DEPTH
    ) {
      throw new Error(`${field}: data depth or node limit exceeded`);
    }
    const current = entry.value;
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "undefined"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new Error(`${field}: finite data number required`);
      }
      continue;
    }
    if (typeof current === "string") {
      if (
        new TextEncoder().encode(current).length > MAX_REVIEWER_STRING_BYTES
      ) {
        throw new Error(`${field}: data string byte limit exceeded`);
      }
      continue;
    }
    if (typeof current !== "object") {
      throw new Error(`${field}: data-only value required`);
    }
    if (active.has(current)) {
      throw new Error(`${field}: cyclic data is not allowed`);
    }
    const isArray = Array.isArray(current);
    let prototype: object | null;
    let descriptors: Record<PropertyKey, PropertyDescriptor>;
    try {
      prototype = Object.getPrototypeOf(current);
      descriptors = Object.getOwnPropertyDescriptors(current);
    } catch {
      throw new Error(`${field}: inspectable plain data required`);
    }
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      throw new Error(`${field}: plain data required`);
    }
    if (isArray && current.length > MAX_REVIEWER_ARRAY_LENGTH) {
      throw new Error(`${field}: data array length limit exceeded`);
    }
    active.add(current);
    stack.push({ kind: "EXIT", value: current });
    const children: unknown[] = [];
    for (const key of Reflect.ownKeys(descriptors)) {
      if (key === "length" && isArray) continue;
      const descriptor = descriptors[key];
      if (
        typeof key !== "string" ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      ) {
        throw new Error(
          `${field}.${String(key)}: own enumerable data property required`,
        );
      }
      children.push(descriptor.value);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        kind: "ENTER",
        value: children[index],
        depth: entry.depth + 1,
      });
    }
  }
}

function cloneFixtureValue(value: unknown, field: string): unknown {
  assertDataTree(value, field);
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${field}: structured clone required`);
  }
}

function validateObservation(value: unknown): ValidatedReviewerObservation {
  const snapshot = ownDataSnapshotOneOf(
    value,
    [
      ["kind"],
      ["kind", "fixtureLabel", "proposal"],
      ["kind", "fixtureLabel", "proposal", "receiptResponse"],
    ],
    "observation",
  );
  const kind = snapshot.kind;
  if (typeof kind !== "string") {
    throw new Error("observation: exact discriminated object required");
  }
  switch (kind) {
    case "ABSENT": {
      if (Reflect.ownKeys(snapshot).length !== 1) {
        throw new Error("observation.ABSENT: unexpected or missing fields");
      }
      return Object.freeze({ kind: "ABSENT" as const });
    }
    case "PENDING": {
      if (Reflect.ownKeys(snapshot).length !== 3) {
        throw new Error("observation.PENDING: unexpected or missing fields");
      }
      const fixtureLabelValue = snapshot.fixtureLabel;
      const proposalValue = snapshot.proposal;
      if (typeof fixtureLabelValue !== "string") {
        throw new Error("observation.PENDING.fixtureLabel: string required");
      }
      const fixtureLabel = boundedLabel(
        fixtureLabelValue,
        "observation.PENDING.fixtureLabel",
      );
      if (proposalValue !== null && !isObject(proposalValue)) {
        throw new Error(
          "observation.PENDING.proposal: object or null required",
        );
      }
      const proposal =
        proposalValue === null
          ? null
          : (cloneFixtureValue(
              proposalValue,
              "observation.PENDING.proposal",
            ) as Record<string, unknown>);
      return Object.freeze({
        kind: "PENDING" as const,
        fixtureLabel,
        proposal: proposal ? Object.freeze(proposal) : null,
      });
    }
    case "FIXTURE": {
      if (Reflect.ownKeys(snapshot).length !== 4) {
        throw new Error("observation.FIXTURE: unexpected or missing fields");
      }
      const fixtureLabelValue = snapshot.fixtureLabel;
      const proposalValue = snapshot.proposal;
      const receiptResponseValue = snapshot.receiptResponse;
      if (typeof fixtureLabelValue !== "string") {
        throw new Error("observation.FIXTURE.fixtureLabel: string required");
      }
      const fixtureLabel = boundedLabel(
        fixtureLabelValue,
        "observation.FIXTURE.fixtureLabel",
      );
      return Object.freeze({
        kind: "FIXTURE" as const,
        fixtureLabel,
        proposal: cloneFixtureValue(
          proposalValue,
          "observation.FIXTURE.proposal",
        ),
        receiptResponse: cloneFixtureValue(
          receiptResponseValue,
          "observation.FIXTURE.receiptResponse",
        ),
      });
    }
    default:
      throw new Error("observation.kind: unsupported value");
  }
}

function snapshotProfile(value: unknown): PinnedSputnikProfileInput {
  const snapshot = ownDataSnapshot(value, ["version", "codeHash"], "profile");
  const version = snapshot.version;
  const codeHash = snapshot.codeHash;
  if (
    typeof version !== "string" ||
    !version.trim() ||
    typeof codeHash !== "string" ||
    !codeHash.trim()
  ) {
    throw new Error("profile: nonempty version and codeHash strings required");
  }
  return Object.freeze({ version, codeHash });
}

function profileSupported(profile: PinnedSputnikProfileInput): boolean {
  return isSupportedSputnikProfile(profile);
}

function freezeCycle(cycle: Cycle): Cycle {
  const cloned = cloneFixtureValue(cycle, "cycle");
  if (!isObject(cloned)) throw new Error("cycle: plain object required");
  const snapshot = ownDataSnapshot(
    cloned,
    [
      "key",
      "status",
      "opens_at_ns",
      "deadline_at_ns",
      "dao_account_id",
      "amount_yocto",
      "claim",
      "evidence",
      "submitted_at_ns",
      "proposal_link",
    ],
    "cycle",
  );
  const key = Object.freeze({ ...(snapshot.key as Cycle["key"]) });
  const claim = snapshot.claim
    ? Object.freeze({ ...(snapshot.claim as NonNullable<Cycle["claim"]>) })
    : null;
  const evidence = snapshot.evidence
    ? Object.freeze({
        ...(snapshot.evidence as NonNullable<Cycle["evidence"]>),
      })
    : null;
  const rawLink = snapshot.proposal_link as Cycle["proposal_link"];
  const proposalLink = rawLink
    ? Object.freeze({
        key: Object.freeze({ ...rawLink.key }),
        linked_at_ns: rawLink.linked_at_ns,
      })
    : null;
  return Object.freeze({
    key,
    status: snapshot.status,
    opens_at_ns: snapshot.opens_at_ns,
    deadline_at_ns: snapshot.deadline_at_ns,
    dao_account_id: snapshot.dao_account_id,
    amount_yocto: snapshot.amount_yocto,
    claim,
    evidence,
    submitted_at_ns: snapshot.submitted_at_ns,
    proposal_link: proposalLink,
  } as Cycle);
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

function proposalExpectation(cycle: Cycle) {
  const claim = cycle.claim;
  const evidence = cycle.evidence;
  if (!claim || !evidence) {
    throw new Error("cycle: immutable claim and evidence required");
  }
  return {
    network: "TESTNET" as const,
    daoAccountId: cycle.dao_account_id,
    claimantId: claim.claimant_id,
    recipientId: claim.payout_recipient_id,
    amountYocto: cycle.amount_yocto,
    cycle: {
      templateId: cycle.key.template_id,
      periodIndex: cycle.key.period_index,
      evidenceUrl: evidence.url,
      commitSha: evidence.commit_sha,
    },
  };
}

function nativeProposal(
  cycle: Cycle,
  profile: PinnedSputnikProfileInput,
  supported: boolean,
): NativeTransferProposalPreview {
  const expected = proposalExpectation(cycle);
  return supported
    ? buildNativeSputnikTransferProposal({ ...expected, profile })
    : buildNativeTransferProposalPreview(expected);
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
  return `${profileReason}${registryReason}Unsigned preview only: no wallet connector is configured, this is not executable or authorized.`;
}

function addProposalIntent(
  cycle: Cycle,
  profile: PinnedSputnikProfileInput,
  policy: ValidatedSputnikPolicySnapshot,
  proposal: NativeTransferProposalPreview,
  gas: string | null,
  supported: boolean,
): UnsignedAddProposalRequest | UnavailableUnsignedAddProposalPreview {
  return supported
    ? prepareUnsignedAddProposalRequest({
        network: "TESTNET",
        daoAccountId: cycle.dao_account_id,
        profile,
        policy,
        proposal: proposal as Parameters<
          typeof prepareUnsignedAddProposalRequest
        >[0]["proposal"],
        gas,
      })
    : buildUnavailableAddProposalPreview({
        network: "TESTNET",
        daoAccountId: cycle.dao_account_id,
        profile,
        policy,
        proposal,
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
  const cycleReference = cycle;
  const profileReference = profile;
  const proposalIdSnapshot = proposalIdForLink;
  const observationReference = observation;
  const profileSnapshot = snapshotProfile(profileReference);
  const validatedObservation = validateObservation(observationReference);
  const snapshot = await submittedCycleSnapshot(cycleReference);
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
  const inputSnapshot = ownDataSnapshotRequired(
    input,
    [
      "cycle",
      "profile",
      "policy",
      "reviewedRegistryAccountId",
      "proposalIdForLink",
      "observation",
    ],
    "reviewer input",
  );
  const cycleInput = inputSnapshot.cycle as Cycle;
  const profileInput = inputSnapshot.profile;
  const policyReference = inputSnapshot.policy;
  const reviewedRegistryAccountId = inputSnapshot.reviewedRegistryAccountId as
    string | null;
  const proposalIdForLink = inputSnapshot.proposalIdForLink as string | null;
  const addProposalGasValue = Object.hasOwn(inputSnapshot, "addProposalGas")
    ? inputSnapshot.addProposalGas
    : null;
  const observationReference = inputSnapshot.observation;
  const profile = snapshotProfile(profileInput);
  const policyInput = isValidatedSputnikPolicySnapshot(policyReference)
    ? policyReference
    : (() => {
        const bare = ownDataSnapshot(
          policyReference,
          ["proposal_bond"],
          "policy",
        );
        if (typeof bare.proposal_bond !== "string") {
          throw new Error("policy.proposal_bond: string required");
        }
        return parseSputnikPolicyFixtureWithoutBlock({
          network: "TESTNET",
          daoAccountId: cycleInput.dao_account_id,
          profile,
          proposalBondYocto: bare.proposal_bond,
          provenanceLabel:
            "Legacy fixture-only policy input; block provenance was not supplied and no live query is claimed",
        });
      })();
  if (
    addProposalGasValue !== undefined &&
    addProposalGasValue !== null &&
    typeof addProposalGasValue !== "string"
  ) {
    throw new Error("addProposalGas: string, null, or omitted required");
  }
  const addProposalGas: string | null =
    typeof addProposalGasValue === "string" ? addProposalGasValue : null;
  const observation = validateObservation(observationReference);
  const cycle = await submittedCycleSnapshot(cycleInput);
  const supported = profileSupported(profile);
  const proposal = nativeProposal(cycle, profile, supported);
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
    policy: policyInput,
    proposal,
    addProposalIntent: addProposalIntent(
      cycle,
      profile,
      policyInput,
      proposal,
      addProposalGas,
      supported,
    ),
    link,
    payment,
    fixtureNotice: notice,
  });
}

export function reviewerFixturePolicySnapshot(input: {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: PinnedSputnikProfileInput;
  readonly proposalBondYocto: string;
  readonly blockHash: string;
  readonly blockHeight: string;
  readonly provenanceLabel: string;
}): SputnikPolicySnapshot {
  return parseSputnikPolicyFixture(input);
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
