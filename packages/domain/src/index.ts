export interface FoundationMetadata {
  readonly name: "CommonsOps";
  readonly stage: "foundation";
  readonly businessBehaviorImplemented: false;
}

export const foundationMetadata: FoundationMetadata = Object.freeze({
  name: "CommonsOps",
  stage: "foundation",
  businessBehaviorImplemented: false,
});

export type DecimalString = string;
export type AccountId = string;
export type Network = "TESTNET" | "MAINNET";
export type CycleStatus =
  "OPEN" | "CLAIMED" | "SUBMITTED" | "EXPIRED" | "CANCELLED";

export interface CycleKey {
  readonly template_id: DecimalString;
  readonly period_index: DecimalString;
}

export interface ProposalKey {
  readonly network: Network;
  readonly dao_account_id: AccountId;
  readonly proposal_id: DecimalString;
}

export interface TemplateInput {
  readonly dao_account_id: AccountId;
  readonly title: string;
  readonly description: string;
  readonly start_at_ns: DecimalString;
  readonly interval_ns: DecimalString;
  readonly work_window_ns: DecimalString;
  readonly claim_duration_ns: DecimalString;
  readonly amount_yocto: DecimalString;
}

export interface Template {
  readonly id: DecimalString;
  readonly manager_id: AccountId;
  readonly input: TemplateInput;
  readonly active: boolean;
  readonly next_period_index: DecimalString;
  readonly created_at_ns: DecimalString;
}

export interface Claim {
  readonly claimant_id: AccountId;
  readonly payout_recipient_id: AccountId;
  readonly expires_at_ns: DecimalString;
}

export interface Evidence {
  readonly repository_owner: string;
  readonly repository_name: string;
  readonly pull_request_number: DecimalString;
  readonly url: string;
  readonly commit_sha: string;
  readonly digest_sha256: string;
}

export interface ProposalLink {
  readonly key: ProposalKey;
  readonly linked_at_ns: DecimalString;
}

export interface Cycle {
  readonly key: CycleKey;
  readonly status: CycleStatus;
  readonly opens_at_ns: DecimalString;
  readonly deadline_at_ns: DecimalString;
  readonly dao_account_id: AccountId;
  readonly amount_yocto: DecimalString;
  readonly claim: Claim | null;
  readonly evidence: Evidence | null;
  readonly submitted_at_ns: DecimalString | null;
  readonly proposal_link: ProposalLink | null;
}

export interface RegistryInitialized {
  readonly manager_id: AccountId;
  readonly network: Network;
  readonly schema_version: 1;
}

export const registryBounds = Object.freeze({
  schemaVersion: 1,
  maxTemplates: 100,
  maxCycles: 2_000,
  maxTitleBytes: 120,
  maxDescriptionBytes: 1_024,
  maxGithubNameBytes: 100,
  maxEvidenceUrlBytes: 320,
  maxPageSize: 50,
  maxSkipCount: 100,
  templateReserveBytes: 4_096,
  cycleReserveBytes: 16_384,
});

const u64Max = (1n << 64n) - 1n;
const u128Max = (1n << 128n) - 1n;

export function parseDecimal(value: string, bits: 64 | 128): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("ERR_INVALID_DECIMAL");
  }
  const parsed = BigInt(value);
  if (parsed > (bits === 64 ? u64Max : u128Max)) {
    throw new Error("ERR_INTEGER_OVERFLOW");
  }
  return parsed;
}

export function canonicalEvidenceBytes(
  owner: string,
  repository: string,
  pullRequestNumber: DecimalString,
  commitSha: string,
): Uint8Array {
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(repository) ||
    repository === "." ||
    repository === ".."
  ) {
    throw new Error("ERR_INVALID_GITHUB_NAME");
  }
  if (parseDecimal(pullRequestNumber, 64) === 0n) {
    throw new Error("ERR_INVALID_PR_NUMBER");
  }
  if (!/^[a-fA-F0-9]{40}$/.test(commitSha)) {
    throw new Error("ERR_INVALID_COMMIT_SHA");
  }
  return new TextEncoder().encode(
    JSON.stringify([
      registryBounds.schemaVersion,
      owner.toLowerCase(),
      repository.toLowerCase(),
      pullRequestNumber,
      commitSha.toLowerCase(),
    ]),
  );
}
