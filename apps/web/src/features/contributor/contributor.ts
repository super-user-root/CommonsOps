import type { Cycle, CycleKey, Evidence } from "@commonsops/domain";
import {
  canonicalEvidenceBytes,
  parseDecimal,
  registryBounds,
} from "@commonsops/domain";

export type ContributorMethod =
  "claim_cycle" | "release_claim" | "expire_cycle_or_claim" | "submit_evidence";

export type ContributorRequestState =
  | { readonly status: "IDLE" }
  | { readonly status: "PENDING"; readonly method: ContributorMethod }
  | {
      readonly status: "SUCCESS";
      readonly method: ContributorMethod;
      readonly transactionHash: string;
    }
  | {
      readonly status: "ERROR";
      readonly method: ContributorMethod;
      readonly message: string;
    };

export interface GithubEvidenceDraft {
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly pullRequestNumber: string;
  readonly commitSha: string;
}

export interface ActionAvailability {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export type ContributorLifecycle =
  | "OPEN"
  | "CLAIMED"
  | "STALE_CLAIM"
  | "STALE_CYCLE"
  | "SUBMITTED"
  | "EXPIRED"
  | "CANCELLED";

export interface ContributorCycleView {
  readonly cycle: Cycle;
  readonly key: CycleKey;
  readonly registryStatus: Cycle["status"];
  readonly lifecycle: ContributorLifecycle;
  readonly observedBlockTimestampNs: string;
  readonly workWindowLive: boolean;
  readonly activeClaimLive: boolean;
  readonly payoutRecipientId: string | null;
  readonly actions: Readonly<Record<ContributorMethod, ActionAvailability>>;
}

export interface ContributorTransactionIntent {
  readonly receiverId: string;
  readonly method: ContributorMethod;
  readonly args: Readonly<Record<string, unknown>>;
  readonly attachedDepositYocto: "0";
  readonly network: "TESTNET";
  readonly actionAllowed: boolean;
  readonly signingEnabled: false;
  readonly disabledReason: string;
}

export interface EvidenceSubmissionPreview {
  readonly evidence: Evidence;
  readonly intent: ContributorTransactionIntent;
}

const YOCTO_PER_NEAR = 10n ** 24n;

function canonicalInteger(
  value: string,
  field: string,
  bits: 64 | 128,
  positive = false,
): bigint {
  try {
    const parsed = parseDecimal(value, bits);
    if (positive && parsed === 0n) throw new Error("zero");
    return parsed;
  } catch {
    const requirement = positive ? "positive decimal string" : "decimal string";
    throw new Error(`${field}: ${requirement} within u${bits} required`);
  }
}

function canonicalCycleKey(key: CycleKey): CycleKey {
  canonicalInteger(key.template_id, "cycle_key.template_id", 64);
  canonicalInteger(key.period_index, "cycle_key.period_index", 64);
  return {
    template_id: key.template_id,
    period_index: key.period_index,
  };
}

function unavailable(reason: string): ActionAvailability {
  return { allowed: false, reason };
}

function available(): ActionAvailability {
  return { allowed: true, reason: null };
}

function callerAvailability(
  connectedAccountId: string | null,
  unavailableReason: string,
): ActionAvailability {
  return connectedAccountId ? available() : unavailable(unavailableReason);
}

async function sha256Hex(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("ERR_SHA256_UNAVAILABLE");
  }
  const canonicalBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    canonicalBytes.buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function validateEvidenceRecord(evidence: Evidence) {
  const canonicalBytes = canonicalEvidenceBytes(
    evidence.repository_owner,
    evidence.repository_name,
    evidence.pull_request_number,
    evidence.commit_sha,
  );
  const owner = evidence.repository_owner.toLowerCase();
  const repository = evidence.repository_name.toLowerCase();
  const commit = evidence.commit_sha.toLowerCase();
  const url = `https://github.com/${owner}/${repository}/pull/${evidence.pull_request_number}`;
  if (
    evidence.repository_owner !== owner ||
    evidence.repository_name !== repository ||
    evidence.commit_sha !== commit ||
    evidence.url !== url ||
    !/^[a-f0-9]{64}$/.test(evidence.digest_sha256) ||
    evidence.digest_sha256 !== (await sha256Hex(canonicalBytes))
  ) {
    throw new Error("cycle.evidence: canonical contract evidence required");
  }
  if (
    new TextEncoder().encode(url).length > registryBounds.maxEvidenceUrlBytes
  ) {
    throw new Error("cycle.evidence.url: maximum byte length exceeded");
  }
}

async function validateCycle(cycle: Cycle): Promise<CycleKey> {
  const key = canonicalCycleKey(cycle.key);
  const opensAt = canonicalInteger(cycle.opens_at_ns, "cycle.opens_at_ns", 64);
  const deadline = canonicalInteger(
    cycle.deadline_at_ns,
    "cycle.deadline_at_ns",
    64,
  );
  canonicalInteger(cycle.amount_yocto, "cycle.amount_yocto", 128, true);
  if (opensAt >= deadline) {
    throw new Error("cycle: opening must precede deadline");
  }

  if (cycle.claim) {
    const expiresAt = canonicalInteger(
      cycle.claim.expires_at_ns,
      "cycle.claim.expires_at_ns",
      64,
    );
    if (
      !cycle.claim.claimant_id ||
      cycle.claim.claimant_id !== cycle.claim.payout_recipient_id
    ) {
      throw new Error("cycle.claim: claimant must equal payout recipient");
    }
    if (expiresAt <= opensAt || expiresAt > deadline) {
      throw new Error("cycle.claim: invalid expiry window");
    }
  }

  if (cycle.submitted_at_ns !== null) {
    canonicalInteger(cycle.submitted_at_ns, "cycle.submitted_at_ns", 64);
  }
  if (cycle.proposal_link) {
    canonicalInteger(
      cycle.proposal_link.key.proposal_id,
      "cycle.proposal_link.key.proposal_id",
      64,
    );
    canonicalInteger(
      cycle.proposal_link.linked_at_ns,
      "cycle.proposal_link.linked_at_ns",
      64,
    );
    if (cycle.proposal_link.key.dao_account_id !== cycle.dao_account_id) {
      throw new Error("cycle.proposal_link: DAO mismatch");
    }
  }

  switch (cycle.status) {
    case "OPEN":
    case "EXPIRED":
    case "CANCELLED":
      if (
        cycle.claim ||
        cycle.evidence ||
        cycle.submitted_at_ns !== null ||
        cycle.proposal_link
      ) {
        throw new Error(`cycle: invalid ${cycle.status} record`);
      }
      break;
    case "CLAIMED":
      if (
        !cycle.claim ||
        cycle.evidence ||
        cycle.submitted_at_ns !== null ||
        cycle.proposal_link
      ) {
        throw new Error("cycle: invalid CLAIMED record");
      }
      break;
    case "SUBMITTED": {
      if (!cycle.claim || !cycle.evidence || cycle.submitted_at_ns === null) {
        throw new Error("cycle: invalid SUBMITTED record");
      }
      await validateEvidenceRecord(cycle.evidence);
      const submittedAt = canonicalInteger(
        cycle.submitted_at_ns,
        "cycle.submitted_at_ns",
        64,
      );
      const claimExpiry = canonicalInteger(
        cycle.claim.expires_at_ns,
        "cycle.claim.expires_at_ns",
        64,
      );
      if (
        submittedAt < opensAt ||
        submittedAt >= deadline ||
        submittedAt >= claimExpiry
      ) {
        throw new Error(
          "cycle: submission was outside the active claim window",
        );
      }
      if (
        cycle.proposal_link &&
        canonicalInteger(
          cycle.proposal_link.linked_at_ns,
          "cycle.proposal_link.linked_at_ns",
          64,
        ) < submittedAt
      ) {
        throw new Error("cycle.proposal_link: linked before submission");
      }
      break;
    }
    default:
      throw new Error("cycle.status: unsupported value");
  }
  return key;
}

export async function deriveContributorCycleView(
  cycle: Cycle,
  observedBlockTimestampNs: string,
  connectedAccountId: string | null,
): Promise<ContributorCycleView> {
  const key = await validateCycle(cycle);
  const now = canonicalInteger(
    observedBlockTimestampNs,
    "observedBlockTimestampNs",
    64,
  );
  const opensAt = canonicalInteger(cycle.opens_at_ns, "cycle.opens_at_ns", 64);
  const deadline = canonicalInteger(
    cycle.deadline_at_ns,
    "cycle.deadline_at_ns",
    64,
  );
  const workWindowLive = now >= opensAt && now < deadline;
  const claimExpiry = cycle.claim
    ? canonicalInteger(
        cycle.claim.expires_at_ns,
        "cycle.claim.expires_at_ns",
        64,
      )
    : null;
  const activeClaimLive =
    cycle.status === "CLAIMED" &&
    workWindowLive &&
    claimExpiry !== null &&
    now < claimExpiry;

  let lifecycle: ContributorLifecycle;
  if (cycle.status === "OPEN") {
    lifecycle = now >= deadline ? "STALE_CYCLE" : "OPEN";
  } else if (cycle.status === "CLAIMED") {
    lifecycle =
      now >= deadline
        ? "STALE_CYCLE"
        : claimExpiry !== null && now >= claimExpiry
          ? "STALE_CLAIM"
          : "CLAIMED";
  } else {
    lifecycle = cycle.status;
  }

  let claim = unavailable("Only an open, live cycle can be claimed.");
  let release = unavailable(
    "Only the active claimant can release a live claim.",
  );
  let expire = unavailable("Neither the claim nor work deadline has elapsed.");
  let submit = unavailable(
    "Only the active claimant can submit during the live claim and work window.",
  );

  if (cycle.status === "OPEN") {
    if (now < opensAt) {
      claim = unavailable("The cycle is not open at the observed block time.");
    } else if (now >= deadline) {
      claim = unavailable("The work deadline has elapsed.");
      expire = callerAvailability(
        connectedAccountId,
        "Connect the direct caller to settle the elapsed work deadline.",
      );
    } else {
      claim = callerAvailability(
        connectedAccountId,
        "Connect the account that will become claimant and payout recipient.",
      );
    }
  } else if (cycle.status === "CLAIMED" && cycle.claim) {
    if (activeClaimLive) {
      const isClaimant = connectedAccountId === cycle.claim.claimant_id;
      if (!connectedAccountId) {
        const reason = "Connect the active claimant account.";
        release = unavailable(reason);
        submit = unavailable(reason);
      } else if (!isClaimant) {
        const reason = "The connected account is not the active claimant.";
        release = unavailable(reason);
        submit = unavailable(reason);
      } else {
        release = available();
        submit = available();
      }
    } else {
      const reason =
        now >= deadline
          ? "The work deadline has elapsed."
          : "The claim has expired at the observed block time.";
      release = unavailable(reason);
      submit = unavailable(reason);
      expire = callerAvailability(
        connectedAccountId,
        "Connect a direct caller to settle the stale claim or cycle.",
      );
    }
  }

  const actions = Object.freeze({
    claim_cycle: claim,
    release_claim: release,
    expire_cycle_or_claim: expire,
    submit_evidence: submit,
  });

  return Object.freeze({
    cycle,
    key,
    registryStatus: cycle.status,
    lifecycle,
    observedBlockTimestampNs,
    workWindowLive,
    activeClaimLive,
    payoutRecipientId: cycle.claim?.payout_recipient_id ?? null,
    actions,
  });
}

function signingDisabledReason(reviewedRegistryAccountId: string | null) {
  return reviewedRegistryAccountId
    ? "Recorded preview — signing disabled here; use live registry above."
    : "No reviewed testnet registry deployment is configured. Recorded preview — signing disabled here; use live registry above.";
}

function transactionIntent(
  reviewedRegistryAccountId: string | null,
  method: ContributorMethod,
  args: Readonly<Record<string, unknown>>,
  availability: ActionAvailability,
): ContributorTransactionIntent {
  const signingReason = signingDisabledReason(reviewedRegistryAccountId);
  return Object.freeze({
    receiverId: reviewedRegistryAccountId ?? "",
    method,
    args,
    attachedDepositYocto: "0",
    network: "TESTNET",
    actionAllowed: availability.allowed,
    signingEnabled: false,
    disabledReason: availability.reason
      ? `${availability.reason} ${signingReason}`
      : signingReason,
  });
}

export async function contributorCycleIntent(
  reviewedRegistryAccountId: string | null,
  method: Exclude<ContributorMethod, "submit_evidence">,
  cycle: Cycle,
  observedBlockTimestampNs: string,
  connectedAccountId: string | null,
): Promise<ContributorTransactionIntent> {
  const view = await deriveContributorCycleView(
    cycle,
    observedBlockTimestampNs,
    connectedAccountId,
  );
  return transactionIntent(
    reviewedRegistryAccountId,
    method,
    { cycle_key: view.key },
    view.actions[method],
  );
}

export async function normalizeGithubEvidence(
  draft: GithubEvidenceDraft,
): Promise<Evidence> {
  const bytes = canonicalEvidenceBytes(
    draft.repositoryOwner,
    draft.repositoryName,
    draft.pullRequestNumber,
    draft.commitSha,
  );
  const owner = draft.repositoryOwner.toLowerCase();
  const repository = draft.repositoryName.toLowerCase();
  const commitSha = draft.commitSha.toLowerCase();
  const url = `https://github.com/${owner}/${repository}/pull/${draft.pullRequestNumber}`;
  if (
    new TextEncoder().encode(url).length > registryBounds.maxEvidenceUrlBytes
  ) {
    throw new Error("ERR_EVIDENCE_URL_TOO_LONG");
  }
  const digestSha256 = await sha256Hex(bytes);
  return Object.freeze({
    repository_owner: owner,
    repository_name: repository,
    pull_request_number: draft.pullRequestNumber,
    url,
    commit_sha: commitSha,
    digest_sha256: digestSha256,
  });
}

export async function evidenceSubmissionPreview(
  reviewedRegistryAccountId: string | null,
  cycle: Cycle,
  observedBlockTimestampNs: string,
  connectedAccountId: string | null,
  draft: GithubEvidenceDraft,
): Promise<EvidenceSubmissionPreview> {
  const view = await deriveContributorCycleView(
    cycle,
    observedBlockTimestampNs,
    connectedAccountId,
  );
  const evidence = await normalizeGithubEvidence(draft);
  const intent = transactionIntent(
    reviewedRegistryAccountId,
    "submit_evidence",
    {
      cycle_key: view.key,
      repository_owner: evidence.repository_owner,
      repository_name: evidence.repository_name,
      pull_request_number: evidence.pull_request_number,
      commit_sha: evidence.commit_sha,
    },
    view.actions.submit_evidence,
  );
  return Object.freeze({ evidence, intent });
}

export function formatYoctoNearExact(value: string) {
  const amount = canonicalInteger(value, "amountYocto", 128);
  const whole = amount / YOCTO_PER_NEAR;
  const fraction = (amount % YOCTO_PER_NEAR).toString().padStart(24, "0");
  return `${whole}.${fraction} NEAR`;
}

export function contributorRequestDetail(state: ContributorRequestState) {
  switch (state.status) {
    case "IDLE":
      return "No transaction request has been made.";
    case "PENDING":
      return `Request pending for ${state.method}.`;
    case "SUCCESS":
      return `${state.method} succeeded in transaction ${state.transactionHash}.`;
    case "ERROR":
      return `${state.method} failed: ${state.message}`;
  }
}
