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

export const RECONCILIATION_SCHEMA_VERSION = 1;

export const canonicalJsonBounds = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
});

export const reconciliationBounds = Object.freeze({
  schemaVersion: RECONCILIATION_SCHEMA_VERSION,
  maxRecords: registryBounds.maxCycles,
  maxProvenanceBytes: 200,
  maxProfileVersionBytes: 64,
});

const accountIdPattern = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isCanonicalDecimal(value: unknown, bits: 64 | 128): boolean {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return false;
  }
  try {
    parseDecimal(value, bits);
    return true;
  } catch {
    return false;
  }
}

export function canonicalDecimalString(
  value: unknown,
  bits: 64 | 128,
  positive = false,
): DecimalString {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    (positive && value === "0")
  ) {
    throw new Error("ERR_INVALID_DECIMAL");
  }
  parseDecimal(value, bits);
  return value;
}

export function parseAccountId(value: unknown): AccountId {
  if (typeof value !== "string" || !accountIdPattern.test(value)) {
    throw new Error("ERR_INVALID_ACCOUNT_ID");
  }
  return value;
}

function base58Encode(bytes: Uint8Array): string {
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = base58Alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return "1".repeat(leadingZeroes) + encoded;
}

export function parseCryptoHash(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 64) {
    throw new Error("ERR_INVALID_CRYPTO_HASH");
  }
  let decoded = 0n;
  for (const character of value) {
    const digit = base58Alphabet.indexOf(character);
    if (digit < 0) {
      throw new Error("ERR_INVALID_CRYPTO_HASH");
    }
    decoded = decoded * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded % 256n));
    decoded /= 256n;
  }
  bytes.reverse();
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes += 1;
  }
  const restored = Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...bytes,
  ]);
  if (restored.length !== 32 || base58Encode(restored) !== value) {
    throw new Error("ERR_INVALID_CRYPTO_HASH");
  }
  return value;
}

export interface ReconciliationEvidenceKeyParts {
  readonly network: Network;
  readonly daoAccountId: AccountId;
  readonly proposalId: DecimalString;
  readonly actionReceiptId: string;
  readonly payoutReceiptId: string;
}

export interface ReconciliationCycleKey {
  readonly templateId: DecimalString;
  readonly periodIndex: DecimalString;
}

export interface ReconciliationRecord {
  readonly schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  readonly network: Network;
  readonly daoAccountId: AccountId;
  readonly proposalId: DecimalString;
  readonly actionReceiptId: string;
  readonly payoutReceiptId: string;
  readonly cycle: ReconciliationCycleKey;
  readonly expectedRecipientId: AccountId;
  readonly expectedAmountYocto: DecimalString;
  readonly profileVersion: string;
  readonly profileCodeHash: string;
  readonly transactionHash: string;
  readonly payoutBlockHash: string;
  readonly provenance: string;
}

export function reconciliationEvidenceKey(
  parts: ReconciliationEvidenceKeyParts,
): string {
  if (typeof parts !== "object" || parts === null) {
    throw new Error("ERR_INVALID_EVIDENCE_KEY_PARTS");
  }
  if (parts.network !== "TESTNET" && parts.network !== "MAINNET") {
    throw new Error("ERR_INVALID_NETWORK");
  }
  const daoAccountId = parseAccountId(parts.daoAccountId);
  if (!isCanonicalDecimal(parts.proposalId, 64)) {
    throw new Error("ERR_INVALID_DECIMAL");
  }
  const actionReceiptId = parseCryptoHash(parts.actionReceiptId);
  const payoutReceiptId = parseCryptoHash(parts.payoutReceiptId);
  return [
    parts.network.toLowerCase(),
    daoAccountId,
    parts.proposalId,
    actionReceiptId,
    payoutReceiptId,
  ].join(":");
}

export type CanonicalJsonValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

interface CanonicalJsonState {
  nodes: number;
  readonly seen: Set<object>;
}

function canonicalJsonData(
  value: object,
  field: string,
): Record<PropertyKey, PropertyDescriptor> {
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== "string" || !descriptor?.enumerable) {
      throw new Error(`ERR_NOT_JSON_SAFE (${field})`);
    }
    if (!("value" in descriptor)) {
      throw new Error(`ERR_NOT_JSON_SAFE (${field})`);
    }
  }
  return descriptors;
}

function canonicalJsonText(
  value: CanonicalJsonValue,
  field: string,
  state: CanonicalJsonState,
  depth: number,
): string {
  state.nodes += 1;
  if (
    state.nodes > canonicalJsonBounds.maxNodes ||
    depth > canonicalJsonBounds.maxDepth
  ) {
    throw new Error(`ERR_CANONICAL_JSON_LIMITS (${field})`);
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`ERR_NOT_JSON_SAFE (${field})`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error(`ERR_NOT_JSON_SAFE (${field})`);
  }
  if (state.seen.has(value)) {
    throw new Error(`ERR_CANONICAL_JSON_CYCLE (${field})`);
  }
  state.seen.add(value);
  let text: string;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`ERR_NOT_PLAIN_JSON (${field})`);
    }
    const own = Object.getOwnPropertyDescriptors(value as object) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
    const length = value.length;
    if (length > canonicalJsonBounds.maxNodes) {
      throw new Error(`ERR_CANONICAL_JSON_LIMITS (${field})`);
    }
    const expected = new Set<PropertyKey>(["length"]);
    for (let index = 0; index < length; index += 1) {
      expected.add(String(index));
    }
    const ownKeys = Reflect.ownKeys(own);
    if (
      ownKeys.length !== expected.size ||
      ownKeys.some((key) => !expected.has(key))
    ) {
      throw new Error(`ERR_NOT_PLAIN_JSON (${field})`);
    }
    const lengthDescriptor = own.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      throw new Error(`ERR_NOT_PLAIN_JSON (${field})`);
    }
    const items: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = own[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error(`ERR_NOT_PLAIN_JSON (${field})`);
      }
      items.push(
        canonicalJsonText(
          descriptor.value as CanonicalJsonValue,
          `${field}[${index}]`,
          state,
          depth + 1,
        ),
      );
    }
    text = `[${items.join(",")}]`;
  } else {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error(`ERR_NOT_PLAIN_JSON (${field})`);
    }
    const descriptors = canonicalJsonData(value, field);
    const keys = Object.keys(descriptors).sort();
    const members = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJsonText(
          descriptors[key]?.value as CanonicalJsonValue,
          `${field}.${key}`,
          state,
          depth + 1,
        )}`,
    );
    text = `{${members.join(",")}}`;
  }
  state.seen.delete(value);
  return text;
}

export function canonicalJsonString(value: CanonicalJsonValue): string {
  try {
    structuredClone(value);
  } catch {
    throw new Error("ERR_NOT_JSON_SAFE (proxies and non-cloneable data)");
  }
  return canonicalJsonText(value, "value", { nodes: 0, seen: new Set() }, 0);
}

export function canonicalJsonBytes(value: CanonicalJsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalJsonString(value));
}
