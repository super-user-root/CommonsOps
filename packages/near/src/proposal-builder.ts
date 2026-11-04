const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const MAX_POLICY_RESULT_BYTES = 256 * 1024;
const MAX_POLICY_BASE64_CHARS = 4 * Math.ceil(MAX_POLICY_RESULT_BYTES / 3);
const MAX_POLICY_LOGS = 100;
const MAX_POLICY_LOG_BYTES = 4 * 1024;
const MAX_PROVENANCE_LABEL_BYTES = 200;
const MAX_RPC_ERROR_MESSAGE_BYTES = 1024;
const MAX_RPC_ERROR_DATA_BYTES = 4 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_ARRAY_LENGTH = 300_000;
const MAX_JSON_STRING_BYTES = MAX_POLICY_BASE64_CHARS;
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const MAX_SPUTNIK_PROPOSAL_DESCRIPTION_BYTES = 512;
export const SPUTNIK_POLICY_RPC_ID = "commonsops:get_policy";

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

export interface SputnikProfileInput {
  readonly version: string;
  readonly codeHash: string;
}

export interface SupportedSputnikProfile {
  readonly version: "2.0.0";
  readonly codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq";
}

export interface SputnikPolicyRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: typeof SPUTNIK_POLICY_RPC_ID;
  readonly method: "query";
  readonly params: {
    readonly request_type: "call_function";
    readonly finality: "final";
    readonly account_id: string;
    readonly method_name: "get_policy";
    readonly args_base64: "e30=";
  };
}

export type SputnikPolicyRpcTransport = (
  request: SputnikPolicyRpcRequest,
) => Promise<unknown>;

export type SputnikPolicyBlockProvenance =
  | {
      readonly availability: "AVAILABLE";
      readonly finality: "final";
      readonly hash: string;
      readonly height: string;
    }
  | {
      readonly availability: "UNAVAILABLE";
      readonly finality: null;
      readonly hash: null;
      readonly height: null;
    };

export type SputnikPolicySource =
  | {
      readonly kind: "RPC";
      readonly requestId: typeof SPUTNIK_POLICY_RPC_ID;
      readonly label: "Injected TESTNET RPC get_policy response";
    }
  | {
      readonly kind: "FIXTURE";
      readonly requestId: null;
      readonly label: string;
    }
  | {
      readonly kind: "FIXTURE_UNAVAILABLE_PROVENANCE";
      readonly requestId: null;
      readonly label: string;
    };

declare const validatedPolicySnapshotBrand: unique symbol;

export interface ValidatedSputnikPolicySnapshot {
  readonly [validatedPolicySnapshotBrand]: true;
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: Readonly<SputnikProfileInput>;
  readonly proposal_bond: string;
  readonly block: SputnikPolicyBlockProvenance;
  readonly source: SputnikPolicySource;
}

export interface QuerySputnikPolicyInput {
  readonly transport: SputnikPolicyRpcTransport;
  readonly daoAccountId: string;
  readonly profile: SputnikProfileInput;
}

export interface SputnikPolicyFixtureInput {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: SputnikProfileInput;
  readonly proposalBondYocto: string;
  readonly blockHash: string;
  readonly blockHeight: string;
  readonly provenanceLabel: string;
}

export interface SputnikPolicyFixtureWithoutBlockInput {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: SputnikProfileInput;
  readonly proposalBondYocto: string;
  readonly provenanceLabel: string;
}

export interface NativeTransferProposalReference {
  readonly templateId: string;
  readonly periodIndex: string;
  readonly evidenceUrl: string;
  readonly commitSha: string;
}

export interface NativeTransferProposalExpectation {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly claimantId: string;
  readonly recipientId: string;
  readonly amountYocto: string;
  readonly cycle: NativeTransferProposalReference;
}

export interface NativeSputnikTransferProposalExpectation extends NativeTransferProposalExpectation {
  readonly profile: SputnikProfileInput;
}

export interface NativeTransferProposal {
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

declare const validatedProposalBrand: unique symbol;

export interface ValidatedNativeSputnikTransferProposal extends NativeTransferProposal {
  readonly [validatedProposalBrand]: true;
}

export interface SputnikRequestGasParameter {
  readonly status: "REQUIRED" | "REVIEWED_PARAMETER";
  readonly value: string | null;
  readonly basis: "CALLER_REVIEWED_REQUEST_PARAMETER_NOT_MEASURED";
  readonly notice: string;
}

export type SputnikRequestAuthorization =
  | {
      readonly bondCapability: "POSITIVE_BOND_REQUIRES_ATTACHED_NEAR";
      readonly required: "WALLET_OR_FULL_ACCESS_KEY";
      readonly commonsOpsFlow: "WALLET_ONLY";
      readonly functionCallKeyProtocolCompatible: false;
      readonly functionCallKeyIntegrationSupported: false;
      readonly functionCallKeyCanAttachNear: false;
      readonly allowanceControlsAssetSpending: false;
      readonly notice: string;
    }
  | {
      readonly bondCapability: "ZERO_BOND_REQUIRES_NO_ATTACHED_NEAR";
      readonly required: "COMMONSOPS_WALLET_FLOW_ONLY";
      readonly commonsOpsFlow: "WALLET_ONLY";
      readonly functionCallKeyProtocolCompatible: true;
      readonly functionCallKeyIntegrationSupported: false;
      readonly functionCallKeyCanAttachNear: false;
      readonly allowanceControlsAssetSpending: false;
      readonly notice: string;
    };

export interface UnsignedAddProposalRequest {
  readonly receiverId: string;
  readonly method: "add_proposal";
  readonly args: {
    readonly proposal: ValidatedNativeSputnikTransferProposal;
  };
  readonly attachedDepositYocto: string;
  readonly gas: string | null;
  readonly gasParameter: SputnikRequestGasParameter;
  readonly network: "TESTNET";
  readonly signingEnabled: false;
  readonly executable: false;
  readonly authorization: SputnikRequestAuthorization;
  readonly policySnapshot: ValidatedSputnikPolicySnapshot;
  readonly disabledReason: string;
}

export interface CompleteUnsignedAddProposalRequest extends UnsignedAddProposalRequest {
  readonly gas: string;
  readonly gasParameter: SputnikRequestGasParameter & {
    readonly status: "REVIEWED_PARAMETER";
    readonly value: string;
  };
}

export interface UnavailableUnsignedAddProposalPreview {
  readonly receiverId: string;
  readonly method: "add_proposal";
  readonly args: { readonly proposal: NativeTransferProposal };
  readonly attachedDepositYocto: string;
  readonly gas: null;
  readonly gasParameter: SputnikRequestGasParameter & {
    readonly status: "REQUIRED";
    readonly value: null;
  };
  readonly network: "TESTNET";
  readonly signingEnabled: false;
  readonly executable: false;
  readonly availability: "UNSUPPORTED_PROFILE" | "POLICY_CONTEXT_MISMATCH";
  readonly authorization: SputnikRequestAuthorization;
  readonly policySnapshot: ValidatedSputnikPolicySnapshot;
  readonly disabledReason: string;
}

export interface PrepareUnsignedAddProposalRequestInput {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: SputnikProfileInput;
  readonly policy: ValidatedSputnikPolicySnapshot;
  readonly proposal: ValidatedNativeSputnikTransferProposal;
  readonly gas: string | null;
}

export interface BuildUnsignedAddProposalRequestInput extends Omit<
  PrepareUnsignedAddProposalRequestInput,
  "gas"
> {
  readonly gas: string;
}

interface ProposalContext {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: SupportedSputnikProfile;
}

interface SnapshotState {
  nodes: number;
  readonly seen: Set<object>;
}

const validatedPolicySnapshots = new WeakSet<object>();
const validatedProposalContexts = new WeakMap<object, ProposalContext>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function descriptors(
  value: object,
  field: string,
): Record<PropertyKey, PropertyDescriptor> {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error(`${field}: inspectable own data properties required`);
  }
}

function plainPrototype(value: object, field: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new Error(`${field}: plain object required`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field}: plain object with no custom prototype required`);
  }
}

function captureOwnData(
  value: unknown,
  expectedKeySets: readonly (readonly string[])[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isObject(value))
    throw new Error(`${field}: exact plain object required`);
  plainPrototype(value, field);
  const own = descriptors(value, field);
  const keys = Reflect.ownKeys(own);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${field}: symbol properties are not allowed`);
  }
  const stringKeys = keys as string[];
  const matches = expectedKeySets.some(
    (expected) =>
      expected.length === stringKeys.length &&
      expected.every((key) => stringKeys.includes(key)),
  );
  if (!matches) throw new Error(`${field}: unexpected or missing fields`);

  const captured: Record<string, unknown> = {};
  for (const key of stringKeys) {
    const descriptor = own[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${field}.${key}: own enumerable data property required`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function cloneJsonNode(
  value: unknown,
  field: string,
  state: SnapshotState,
  depth: number,
): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new Error(`${field}: JSON structure is too large or deeply nested`);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      new TextEncoder().encode(value).length > MAX_JSON_STRING_BYTES
    ) {
      throw new Error(`${field}: JSON string exceeds the byte limit`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${field}: finite JSON number required`);
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error(`${field}: plain cloneable JSON data required`);
  }
  if (state.seen.has(value))
    throw new Error(`${field}: cyclic JSON is not allowed`);
  state.seen.add(value);

  if (Array.isArray(value)) {
    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(value);
    } catch {
      throw new Error(`${field}: plain JSON array required`);
    }
    if (prototype !== Array.prototype || value.length > MAX_JSON_ARRAY_LENGTH) {
      throw new Error(`${field}: bounded plain JSON array required`);
    }
    const own = descriptors(value, field);
    const keys = Reflect.ownKeys(own);
    const expected = new Set<PropertyKey>(["length"]);
    for (let index = 0; index < value.length; index += 1)
      expected.add(String(index));
    if (
      keys.length !== expected.size ||
      keys.some((key) => !expected.has(key))
    ) {
      throw new Error(
        `${field}: dense JSON array without extra properties required`,
      );
    }
    const lengthDescriptor = own.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      throw new Error(`${field}.length: data property required`);
    }
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = own[String(index)];
      if (!item?.enumerable || !("value" in item)) {
        throw new Error(
          `${field}[${index}]: own enumerable data property required`,
        );
      }
      clone.push(
        cloneJsonNode(item.value, `${field}[${index}]`, state, depth + 1),
      );
    }
    state.seen.delete(value);
    return clone;
  }

  plainPrototype(value, field);
  const own = descriptors(value, field);
  const keys = Reflect.ownKeys(own);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${field}: symbol properties are not allowed`);
  }
  const clone = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = own[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new Error(`${field}.${key}: own enumerable data property required`);
    }
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneJsonNode(
        descriptor.value,
        `${field}.${key}`,
        state,
        depth + 1,
      ),
    });
  }
  state.seen.delete(value);
  return clone;
}

function snapshotJson(value: unknown, field: string): unknown {
  const clone = cloneJsonNode(value, field, { nodes: 0, seen: new Set() }, 0);
  try {
    structuredClone(value);
  } catch {
    throw new Error(`${field}: proxies and non-cloneable data are not allowed`);
  }
  return clone;
}

function captureCloneableBoundary(
  value: unknown,
  expectedKeySets: readonly (readonly string[])[],
  field: string,
): Readonly<Record<string, unknown>> {
  const captured = captureOwnData(value, expectedKeySets, field);
  for (const [key, child] of Object.entries(captured)) {
    if (typeof child === "object" && child !== null) {
      try {
        structuredClone(child);
      } catch {
        throw new Error(
          `${field}.${key}: proxies and non-cloneable data are not allowed`,
        );
      }
    }
  }
  return captured;
}

function canonicalDecimal(
  value: unknown,
  field: string,
  maximum: bigint,
  positive = false,
): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field}: canonical decimal required`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (positive && parsed === 0n)) {
    throw new Error(
      `${field}: canonical ${positive ? "positive " : ""}decimal is out of range`,
    );
  }
  return value;
}

function accountId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) {
    throw new Error(`${field}: valid NEAR account required`);
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
    const remainder = Number(value % 58n);
    encoded = (BASE58_ALPHABET[remainder] ?? "") + encoded;
    value /= 58n;
  }
  return "1".repeat(leadingZeroes) + encoded;
}

function base58Decode(value: string, field: string): Uint8Array {
  if (!value || value.length > 64) {
    throw new Error(`${field}: bounded base58 value required`);
  }
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) throw new Error(`${field}: base58 value required`);
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
  return Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...bytes,
  ]);
}

function cryptoHash(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field}: string required`);
  const decoded = base58Decode(value, field);
  if (decoded.length !== 32 || base58Encode(decoded) !== value) {
    throw new Error(`${field}: canonical base58 encoding of 32 bytes required`);
  }
  return value;
}

function profileInput(
  value: unknown,
  field = "profile",
): Readonly<SputnikProfileInput> {
  const snapshot = snapshotJson(value, field);
  const captured = captureOwnData(snapshot, [["version", "codeHash"]], field);
  const version = captured.version;
  const codeHash = captured.codeHash;
  if (
    typeof version !== "string" ||
    !version.trim() ||
    typeof codeHash !== "string" ||
    !codeHash.trim()
  ) {
    throw new Error(`${field}: nonempty version and codeHash strings required`);
  }
  return Object.freeze({ version, codeHash });
}

function supportedProfile(
  value: unknown,
  field = "profile",
): SupportedSputnikProfile {
  const profile = profileInput(value, field);
  if (
    profile.version !== "2.0.0" ||
    profile.codeHash !== pinnedSputnikProfiles["2.0.0"].codeHash
  ) {
    throw new Error(`${field}: unsupported Sputnik deployment profile`);
  }
  return Object.freeze({
    version: "2.0.0" as const,
    codeHash: pinnedSputnikProfiles["2.0.0"].codeHash,
  });
}

export function isSupportedSputnikProfile(
  value: unknown,
): value is SupportedSputnikProfile {
  try {
    supportedProfile(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidatedSputnikPolicySnapshot(
  value: unknown,
): value is ValidatedSputnikPolicySnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    validatedPolicySnapshots.has(value)
  );
}

function base64Bytes(value: string): Uint8Array {
  if (value.length > MAX_POLICY_BASE64_CHARS) {
    throw new Error("policy result: encoded base64 length is out of bounds");
  }
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("policy result: canonical base64 required");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > MAX_POLICY_RESULT_BYTES) {
    throw new Error("policy result: decoded byte length is out of bounds");
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index] ?? "");
    const second = BASE64_ALPHABET.indexOf(value[index + 1] ?? "");
    const thirdCharacter = value[index + 2];
    const fourthCharacter = value[index + 3];
    const third =
      thirdCharacter === "="
        ? 0
        : BASE64_ALPHABET.indexOf(thirdCharacter ?? "");
    const fourth =
      fourthCharacter === "="
        ? 0
        : BASE64_ALPHABET.indexOf(fourthCharacter ?? "");
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error("policy result: canonical base64 required");
    }
    const finalQuartet = index + 4 === value.length;
    if (
      (!finalQuartet && (thirdCharacter === "=" || fourthCharacter === "=")) ||
      (thirdCharacter === "=" && fourthCharacter !== "=") ||
      (thirdCharacter === "=" && (second & 0x0f) !== 0) ||
      (fourthCharacter === "=" &&
        thirdCharacter !== "=" &&
        (third & 0x03) !== 0)
    ) {
      throw new Error("policy result: canonical base64 required");
    }
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (offset < output.length) output[offset++] = (combined >> 16) & 0xff;
    if (offset < output.length) output[offset++] = (combined >> 8) & 0xff;
    if (offset < output.length) output[offset++] = combined & 0xff;
  }
  return output;
}

function resultBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return base64Bytes(value);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("policy result: nonempty byte array or base64 required");
  }
  if (value.length > MAX_POLICY_RESULT_BYTES) {
    throw new Error("policy result: byte length is out of bounds");
  }
  const copy = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const byte = value[index];
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(
        "policy result: every byte must be an integer from 0 to 255",
      );
    }
    copy[index] = byte;
  }
  return copy;
}

function skipWhitespace(text: string, position: { index: number }): void {
  while (/\s/.test(text[position.index] ?? "")) position.index += 1;
}

function scanJsonString(text: string, position: { index: number }): string {
  const start = position.index;
  if (text[position.index] !== '"')
    throw new Error("policy result: valid JSON required");
  position.index += 1;
  while (position.index < text.length) {
    const character = text[position.index];
    if (character === "\\") {
      position.index += 2;
      continue;
    }
    position.index += 1;
    if (character === '"') {
      try {
        return JSON.parse(text.slice(start, position.index)) as string;
      } catch {
        throw new Error("policy result: valid JSON string required");
      }
    }
  }
  throw new Error("policy result: unterminated JSON string");
}

function scanJsonValue(
  text: string,
  position: { index: number },
  depth: number,
): void {
  if (depth > MAX_JSON_DEPTH)
    throw new Error("policy result: JSON is too deeply nested");
  skipWhitespace(text, position);
  const character = text[position.index];
  if (character === '"') {
    scanJsonString(text, position);
    return;
  }
  if (character === "{") {
    position.index += 1;
    skipWhitespace(text, position);
    const keys = new Set<string>();
    if (text[position.index] === "}") {
      position.index += 1;
      return;
    }
    while (position.index < text.length) {
      const key = scanJsonString(text, position);
      if (keys.has(key))
        throw new Error("policy result: duplicate JSON member");
      keys.add(key);
      skipWhitespace(text, position);
      if (text[position.index] !== ":")
        throw new Error("policy result: valid JSON required");
      position.index += 1;
      scanJsonValue(text, position, depth + 1);
      skipWhitespace(text, position);
      const delimiter = text[position.index];
      if (delimiter === "}") {
        position.index += 1;
        return;
      }
      if (delimiter !== ",")
        throw new Error("policy result: valid JSON required");
      position.index += 1;
      skipWhitespace(text, position);
    }
    throw new Error("policy result: unterminated JSON object");
  }
  if (character === "[") {
    position.index += 1;
    skipWhitespace(text, position);
    if (text[position.index] === "]") {
      position.index += 1;
      return;
    }
    while (position.index < text.length) {
      scanJsonValue(text, position, depth + 1);
      skipWhitespace(text, position);
      const delimiter = text[position.index];
      if (delimiter === "]") {
        position.index += 1;
        return;
      }
      if (delimiter !== ",")
        throw new Error("policy result: valid JSON required");
      position.index += 1;
    }
    throw new Error("policy result: unterminated JSON array");
  }
  const start = position.index;
  while (
    position.index < text.length &&
    !/[\s,}\]]/.test(text[position.index] ?? "")
  ) {
    position.index += 1;
  }
  if (position.index === start)
    throw new Error("policy result: valid JSON value required");
}

function assertNoDuplicateJsonMembers(text: string): void {
  const position = { index: 0 };
  scanJsonValue(text, position, 0);
  skipWhitespace(text, position);
  if (position.index !== text.length)
    throw new Error("policy result: valid JSON required");
}

function decodePolicy(value: unknown): string {
  const bytes = resultBytes(value);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("policy result: valid UTF-8 required");
  }
  assertNoDuplicateJsonMembers(text);
  let policy: unknown;
  try {
    policy = JSON.parse(text);
  } catch {
    throw new Error("policy result: valid JSON required");
  }
  if (!isObject(policy) || Object.getPrototypeOf(policy) !== Object.prototype) {
    throw new Error("policy result: plain policy object required");
  }
  const descriptor = Object.getOwnPropertyDescriptor(policy, "proposal_bond");
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    throw new Error("policy.proposal_bond: own data property required");
  }
  return canonicalDecimal(descriptor.value, "policy.proposal_bond", U128_MAX);
}

function rpcBlockHeight(value: unknown): string {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(
      "RPC result.block_height: safe nonnegative integer required",
    );
  }
  return String(value);
}

function validateLogs(value: unknown): void {
  if (!Array.isArray(value) || value.length > MAX_POLICY_LOGS) {
    throw new Error("RPC result.logs: bounded string array required");
  }
  for (const log of value) {
    if (
      typeof log !== "string" ||
      new TextEncoder().encode(log).length > MAX_POLICY_LOG_BYTES
    ) {
      throw new Error("RPC result.logs: bounded string array required");
    }
  }
}

function boundedLabel(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).length > MAX_PROVENANCE_LABEL_BYTES
  ) {
    throw new Error(`${field}: bounded label required`);
  }
  return value;
}

function policySnapshot(
  daoAccountId: string,
  profile: Readonly<SputnikProfileInput>,
  proposalBondYocto: string,
  block: SputnikPolicyBlockProvenance,
  source: SputnikPolicySource,
): ValidatedSputnikPolicySnapshot {
  const snapshot = Object.freeze({
    network: "TESTNET" as const,
    daoAccountId,
    profile: Object.freeze({ ...profile }),
    proposal_bond: proposalBondYocto,
    block: Object.freeze({ ...block }),
    source: Object.freeze({ ...source }),
  }) as ValidatedSputnikPolicySnapshot;
  validatedPolicySnapshots.add(snapshot);
  return snapshot;
}

function parseRpcResponse(
  response: unknown,
  daoAccountId: string,
  profile: Readonly<SputnikProfileInput>,
): ValidatedSputnikPolicySnapshot {
  const snapshot = snapshotJson(response, "RPC response");
  if (!isObject(snapshot))
    throw new Error("RPC response: JSON object required");
  const keys = Reflect.ownKeys(snapshot);
  const success = keys.includes("result");
  const failure = keys.includes("error");
  if (success === failure) {
    throw new Error("RPC response: exactly one result or error required");
  }
  const envelope = captureOwnData(
    snapshot,
    success ? [["jsonrpc", "id", "result"]] : [["jsonrpc", "id", "error"]],
    "RPC response",
  );
  if (envelope.jsonrpc !== "2.0" || envelope.id !== SPUTNIK_POLICY_RPC_ID) {
    throw new Error("RPC response: JSON-RPC version or request ID mismatch");
  }

  if (failure) {
    const error = captureOwnData(
      envelope.error,
      [
        ["code", "message"],
        ["code", "message", "data"],
      ],
      "RPC response.error",
    );
    const code = error.code;
    const message = error.message;
    if (
      !Number.isSafeInteger(code) ||
      typeof message !== "string" ||
      !message ||
      new TextEncoder().encode(message).length > MAX_RPC_ERROR_MESSAGE_BYTES
    ) {
      throw new Error("RPC response.error: bounded code and message required");
    }
    if (Object.hasOwn(error, "data")) {
      const encoded = JSON.stringify(error.data);
      if (new TextEncoder().encode(encoded).length > MAX_RPC_ERROR_DATA_BYTES) {
        throw new Error("RPC response.error.data: byte bound exceeded");
      }
    }
    throw new Error(`RPC get_policy error ${String(code)}: ${message}`);
  }

  const result = captureOwnData(
    envelope.result,
    [["block_hash", "block_height", "logs", "result"]],
    "RPC response.result",
  );
  validateLogs(result.logs);
  const hash = cryptoHash(result.block_hash, "RPC result.block_hash");
  const height = rpcBlockHeight(result.block_height);
  const proposalBondYocto = decodePolicy(result.result);
  return policySnapshot(
    daoAccountId,
    profile,
    proposalBondYocto,
    {
      availability: "AVAILABLE",
      finality: "final",
      hash,
      height,
    },
    {
      kind: "RPC",
      requestId: SPUTNIK_POLICY_RPC_ID,
      label: "Injected TESTNET RPC get_policy response",
    },
  );
}

export async function querySputnikPolicy(
  input: QuerySputnikPolicyInput,
): Promise<ValidatedSputnikPolicySnapshot> {
  const captured = captureOwnData(
    input,
    [["transport", "daoAccountId", "profile"]],
    "query input",
  );
  const transport = captured.transport;
  const daoAccountIdValue = captured.daoAccountId;
  const profileValue = captured.profile;
  if (typeof transport !== "function") {
    throw new Error("transport: injected RPC function required");
  }
  const daoAccountId = accountId(daoAccountIdValue, "daoAccountId");
  const profile = profileInput(profileValue);
  const request = Object.freeze({
    jsonrpc: "2.0" as const,
    id: SPUTNIK_POLICY_RPC_ID,
    method: "query" as const,
    params: Object.freeze({
      request_type: "call_function" as const,
      finality: "final" as const,
      account_id: daoAccountId,
      method_name: "get_policy" as const,
      args_base64: "e30=" as const,
    }),
  });
  const response = await (transport as SputnikPolicyRpcTransport)(request);
  return parseRpcResponse(response, daoAccountId, profile);
}

export function parseSputnikPolicyFixture(
  input: SputnikPolicyFixtureInput,
): ValidatedSputnikPolicySnapshot {
  const snapshot = snapshotJson(input, "policy fixture");
  const captured = captureOwnData(
    snapshot,
    [
      [
        "network",
        "daoAccountId",
        "profile",
        "proposalBondYocto",
        "blockHash",
        "blockHeight",
        "provenanceLabel",
      ],
    ],
    "policy fixture",
  );
  if (captured.network !== "TESTNET") {
    throw new Error("policy fixture.network: TESTNET required");
  }
  const daoAccountId = accountId(
    captured.daoAccountId,
    "policy fixture.daoAccountId",
  );
  const profile = profileInput(captured.profile, "policy fixture.profile");
  const proposalBondYocto = canonicalDecimal(
    captured.proposalBondYocto,
    "policy fixture.proposalBondYocto",
    U128_MAX,
  );
  const hash = cryptoHash(captured.blockHash, "policy fixture.blockHash");
  const height = canonicalDecimal(
    captured.blockHeight,
    "policy fixture.blockHeight",
    U64_MAX,
  );
  const label = boundedLabel(
    captured.provenanceLabel,
    "policy fixture.provenanceLabel",
  );
  return policySnapshot(
    daoAccountId,
    profile,
    proposalBondYocto,
    { availability: "AVAILABLE", finality: "final", hash, height },
    { kind: "FIXTURE", requestId: null, label },
  );
}

export function parseSputnikPolicyFixtureWithoutBlock(
  input: SputnikPolicyFixtureWithoutBlockInput,
): ValidatedSputnikPolicySnapshot {
  const snapshot = snapshotJson(input, "policy fixture");
  const captured = captureOwnData(
    snapshot,
    [
      [
        "network",
        "daoAccountId",
        "profile",
        "proposalBondYocto",
        "provenanceLabel",
      ],
    ],
    "policy fixture",
  );
  if (captured.network !== "TESTNET") {
    throw new Error("policy fixture.network: TESTNET required");
  }
  const daoAccountId = accountId(
    captured.daoAccountId,
    "policy fixture.daoAccountId",
  );
  const profile = profileInput(captured.profile, "policy fixture.profile");
  const proposalBondYocto = canonicalDecimal(
    captured.proposalBondYocto,
    "policy fixture.proposalBondYocto",
    U128_MAX,
  );
  const label = boundedLabel(
    captured.provenanceLabel,
    "policy fixture.provenanceLabel",
  );
  return policySnapshot(
    daoAccountId,
    profile,
    proposalBondYocto,
    { availability: "UNAVAILABLE", finality: null, hash: null, height: null },
    { kind: "FIXTURE_UNAVAILABLE_PROVENANCE", requestId: null, label },
  );
}

function proposalExpectation(
  input: unknown,
): Readonly<NativeTransferProposalExpectation> {
  const snapshot = snapshotJson(input, "proposal expectation");
  const captured = captureOwnData(
    snapshot,
    [
      [
        "network",
        "daoAccountId",
        "claimantId",
        "recipientId",
        "amountYocto",
        "cycle",
      ],
    ],
    "proposal expectation",
  );
  if (captured.network !== "TESTNET") {
    throw new Error("proposal expectation.network: TESTNET required");
  }
  const daoAccountId = accountId(
    captured.daoAccountId,
    "proposal expectation.daoAccountId",
  );
  const claimantId = accountId(
    captured.claimantId,
    "proposal expectation.claimantId",
  );
  const recipientId = accountId(
    captured.recipientId,
    "proposal expectation.recipientId",
  );
  if (claimantId !== recipientId) {
    throw new Error(
      "proposal expectation: claimant must equal payout recipient",
    );
  }
  const amountYocto = canonicalDecimal(
    captured.amountYocto,
    "proposal expectation.amountYocto",
    U128_MAX,
    true,
  );
  const cycle = captureOwnData(
    captured.cycle,
    [["templateId", "periodIndex", "evidenceUrl", "commitSha"]],
    "proposal expectation.cycle",
  );
  const templateId = canonicalDecimal(
    cycle.templateId,
    "cycle.templateId",
    U64_MAX,
  );
  const periodIndex = canonicalDecimal(
    cycle.periodIndex,
    "cycle.periodIndex",
    U64_MAX,
  );
  const evidenceUrl = cycle.evidenceUrl;
  if (
    typeof evidenceUrl !== "string" ||
    evidenceUrl !== evidenceUrl.toLowerCase()
  ) {
    throw new Error(
      "cycle.evidenceUrl: canonical GitHub pull request URL required",
    );
  }
  const match =
    /^https:\/\/github\.com\/([a-z0-9_-]{1,100})\/([a-z0-9_.-]{1,100})\/pull\/((?:0|[1-9][0-9]*))$/.exec(
      evidenceUrl,
    );
  if (
    !match ||
    match[2] === "." ||
    match[2] === ".." ||
    new TextEncoder().encode(evidenceUrl).length > 320
  ) {
    throw new Error(
      "cycle.evidenceUrl: canonical GitHub pull request URL required",
    );
  }
  canonicalDecimal(
    match[3],
    "cycle.evidenceUrl pull request number",
    U64_MAX,
    true,
  );
  const commitSha = cycle.commitSha;
  if (typeof commitSha !== "string" || !/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error("cycle.commitSha: canonical 40-character SHA required");
  }
  return Object.freeze({
    network: "TESTNET" as const,
    daoAccountId,
    claimantId,
    recipientId,
    amountYocto,
    cycle: Object.freeze({ templateId, periodIndex, evidenceUrl, commitSha }),
  });
}

function nativeProposal(
  expected: Readonly<NativeTransferProposalExpectation>,
): NativeTransferProposal {
  const description = `CommonsOps cycle ${expected.cycle.templateId}:${expected.cycle.periodIndex}; evidence ${expected.cycle.evidenceUrl}; commit ${expected.cycle.commitSha}`;
  if (
    new TextEncoder().encode(description).length >
      MAX_SPUTNIK_PROPOSAL_DESCRIPTION_BYTES ||
    /[\u0000-\u001f\u007f<>]/.test(description)
  ) {
    throw new Error("proposal.description: bounded plain text required");
  }
  const transfer = Object.freeze({
    token_id: "" as const,
    receiver_id: expected.recipientId,
    amount: expected.amountYocto,
    msg: null,
  });
  return Object.freeze({
    description,
    kind: Object.freeze({ Transfer: transfer }),
  });
}

export function buildNativeTransferProposalPreview(
  input: NativeTransferProposalExpectation,
): NativeTransferProposal {
  return nativeProposal(proposalExpectation(input));
}

export function buildNativeSputnikTransferProposal(
  input: NativeSputnikTransferProposalExpectation,
): ValidatedNativeSputnikTransferProposal {
  const snapshot = snapshotJson(input, "Sputnik proposal expectation");
  const captured = captureOwnData(
    snapshot,
    [
      [
        "network",
        "daoAccountId",
        "claimantId",
        "recipientId",
        "amountYocto",
        "cycle",
        "profile",
      ],
    ],
    "Sputnik proposal expectation",
  );
  const profile = supportedProfile(captured.profile);
  const expected = proposalExpectation({
    network: captured.network,
    daoAccountId: captured.daoAccountId,
    claimantId: captured.claimantId,
    recipientId: captured.recipientId,
    amountYocto: captured.amountYocto,
    cycle: captured.cycle,
  });
  const proposal = nativeProposal(
    expected,
  ) as ValidatedNativeSputnikTransferProposal;
  validatedProposalContexts.set(
    proposal,
    Object.freeze({
      network: "TESTNET" as const,
      daoAccountId: expected.daoAccountId,
      profile,
    }),
  );
  return proposal;
}

function validatedNativeProposal(
  value: unknown,
  field: string,
): NativeTransferProposal {
  const snapshot = snapshotJson(value, field);
  const proposal = captureOwnData(snapshot, [["description", "kind"]], field);
  const description = proposal.description;
  if (
    typeof description !== "string" ||
    !description ||
    new TextEncoder().encode(description).length >
      MAX_SPUTNIK_PROPOSAL_DESCRIPTION_BYTES ||
    /[\u0000-\u001f\u007f<>]/.test(description)
  ) {
    throw new Error(`${field}.description: bounded plain text required`);
  }
  const kind = captureOwnData(proposal.kind, [["Transfer"]], `${field}.kind`);
  const transfer = captureOwnData(
    kind.Transfer,
    [["token_id", "receiver_id", "amount", "msg"]],
    `${field}.kind.Transfer`,
  );
  if (transfer.token_id !== "" || transfer.msg !== null) {
    throw new Error(`${field}: exact native token and null message required`);
  }
  const receiverId = accountId(
    transfer.receiver_id,
    `${field}.kind.Transfer.receiver_id`,
  );
  const amount = canonicalDecimal(
    transfer.amount,
    `${field}.kind.Transfer.amount`,
    U128_MAX,
    true,
  );
  const frozenTransfer = Object.freeze({
    token_id: "" as const,
    receiver_id: receiverId,
    amount,
    msg: null,
  });
  return Object.freeze({
    description,
    kind: Object.freeze({ Transfer: frozenTransfer }),
  });
}

function authorization(proposalBondYocto: string): SputnikRequestAuthorization {
  if (proposalBondYocto === "0") {
    return Object.freeze({
      bondCapability: "ZERO_BOND_REQUIRES_NO_ATTACHED_NEAR" as const,
      required: "COMMONSOPS_WALLET_FLOW_ONLY" as const,
      commonsOpsFlow: "WALLET_ONLY" as const,
      functionCallKeyProtocolCompatible: true as const,
      functionCallKeyIntegrationSupported: false as const,
      functionCallKeyCanAttachNear: false as const,
      allowanceControlsAssetSpending: false as const,
      notice:
        "The zero policy bond requires no attached NEAR, so a correctly scoped function-call key may be protocol-compatible with sufficient allowance and DAO permission. CommonsOps does not implement or authorize that key flow; its current integration remains wallet-only. Function-call-key allowance controls gas, not asset spending.",
    });
  }
  return Object.freeze({
    bondCapability: "POSITIVE_BOND_REQUIRES_ATTACHED_NEAR" as const,
    required: "WALLET_OR_FULL_ACCESS_KEY" as const,
    commonsOpsFlow: "WALLET_ONLY" as const,
    functionCallKeyProtocolCompatible: false as const,
    functionCallKeyIntegrationSupported: false as const,
    functionCallKeyCanAttachNear: false as const,
    allowanceControlsAssetSpending: false as const,
    notice:
      "Wallet/full-access authorization is required because this positive policy bond attaches NEAR. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. CommonsOps does not implement or authorize a function-call-key flow.",
  });
}

function requestGas(value: unknown): {
  readonly gas: string | null;
  readonly parameter: SputnikRequestGasParameter;
} {
  const gas =
    value === null
      ? null
      : canonicalDecimal(value, "add_proposal request.gas", U64_MAX, true);
  const parameter = Object.freeze(
    gas === null
      ? {
          status: "REQUIRED" as const,
          value: null,
          basis: "CALLER_REVIEWED_REQUEST_PARAMETER_NOT_MEASURED" as const,
          notice:
            "A caller-reviewed positive U64 gas request parameter is required; no measured or default add_proposal gas is claimed.",
        }
      : {
          status: "REVIEWED_PARAMETER" as const,
          value: gas,
          basis: "CALLER_REVIEWED_REQUEST_PARAMETER_NOT_MEASURED" as const,
          notice:
            "Gas is a caller-reviewed request parameter, not a measured add_proposal requirement or spending allowance.",
        },
  );
  return Object.freeze({ gas, parameter });
}

export function prepareUnsignedAddProposalRequest(
  input: PrepareUnsignedAddProposalRequestInput,
): UnsignedAddProposalRequest {
  const captured = captureCloneableBoundary(
    input,
    [["network", "daoAccountId", "profile", "policy", "proposal", "gas"]],
    "add_proposal request",
  );
  const network = captured.network;
  const daoAccountValue = captured.daoAccountId;
  const profileValue = captured.profile;
  const policyReference = captured.policy;
  const proposalReference = captured.proposal;
  const gasValue = captured.gas;

  if (network !== "TESTNET") {
    throw new Error("add_proposal request.network: TESTNET required");
  }
  const daoAccountId = accountId(
    daoAccountValue,
    "add_proposal request.daoAccountId",
  );
  const profile = profileInput(profileValue, "add_proposal request.profile");
  const policyBranded =
    typeof policyReference === "object" &&
    policyReference !== null &&
    validatedPolicySnapshots.has(policyReference);
  const proposalContext =
    typeof proposalReference === "object" && proposalReference !== null
      ? validatedProposalContexts.get(proposalReference)
      : undefined;
  if (!policyBranded) {
    throw new Error(
      "add_proposal request.policy: validated policy snapshot required",
    );
  }
  if (!proposalContext) {
    throw new Error(
      "add_proposal request.proposal: validated proposal required",
    );
  }
  const policy = policyReference as ValidatedSputnikPolicySnapshot;
  const proposal = proposalReference as ValidatedNativeSputnikTransferProposal;
  const policyNetwork = policy.network;
  const policyDao = policy.daoAccountId;
  const policyProfile = policy.profile;
  const policyBond = policy.proposal_bond;
  const policySource = policy.source;
  if (
    policyNetwork !== "TESTNET" ||
    policyDao !== daoAccountId ||
    policyProfile.version !== profile.version ||
    policyProfile.codeHash !== profile.codeHash ||
    proposalContext.network !== "TESTNET" ||
    proposalContext.daoAccountId !== daoAccountId ||
    proposalContext.profile.version !== profile.version ||
    proposalContext.profile.codeHash !== profile.codeHash
  ) {
    throw new Error(
      "add_proposal request: policy, proposal, DAO, network, and profile must match",
    );
  }
  const { gas, parameter } = requestGas(gasValue);
  const authorizationMetadata = authorization(policyBond);
  const sourceNotice =
    policySource.kind === "RPC"
      ? "Policy bond came from the validated injected final RPC snapshot. "
      : policySource.kind === "FIXTURE"
        ? `Policy provenance is fixture-only (${policySource.label}); no live policy query is claimed. `
        : `Policy provenance is unavailable fixture data (${policySource.label}); no final block or live policy query is claimed. `;
  const gasNotice =
    gas === null
      ? "A reviewed positive U64 gas request parameter is still required. "
      : "";
  return Object.freeze({
    receiverId: daoAccountId,
    method: "add_proposal" as const,
    args: Object.freeze({ proposal }),
    attachedDepositYocto: policyBond,
    gas,
    gasParameter: parameter,
    network: "TESTNET" as const,
    signingEnabled: false as const,
    executable: false as const,
    authorization: authorizationMetadata,
    policySnapshot: policy,
    disabledReason: `${gasNotice}${sourceNotice}${authorizationMetadata.notice} This descriptor is unsigned and non-executable; it has no key, nonce, transaction block hash, signature, callback, transaction hash, or send method.`,
  });
}

export function buildUnavailableAddProposalPreview(input: {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly profile: SputnikProfileInput;
  readonly policy: ValidatedSputnikPolicySnapshot;
  readonly proposal: NativeTransferProposal;
}): UnavailableUnsignedAddProposalPreview {
  const captured = captureCloneableBoundary(
    input,
    [["network", "daoAccountId", "profile", "policy", "proposal"]],
    "add_proposal preview",
  );
  const network = captured.network;
  const daoAccountValue = captured.daoAccountId;
  const profileValue = captured.profile;
  const policyReference = captured.policy;
  const proposalValue = captured.proposal;
  if (network !== "TESTNET") {
    throw new Error("add_proposal preview.network: TESTNET required");
  }
  const daoAccountId = accountId(
    daoAccountValue,
    "add_proposal preview.daoAccountId",
  );
  const profile = profileInput(profileValue, "add_proposal preview.profile");
  const policyBranded =
    typeof policyReference === "object" &&
    policyReference !== null &&
    validatedPolicySnapshots.has(policyReference);
  if (!policyBranded) {
    throw new Error(
      "add_proposal preview.policy: validated policy snapshot required",
    );
  }
  const policy = policyReference as ValidatedSputnikPolicySnapshot;
  const proposal = validatedNativeProposal(
    proposalValue,
    "add_proposal preview.proposal",
  );
  const policyNetwork = policy.network;
  const policyDao = policy.daoAccountId;
  const policyProfile = policy.profile;
  const policyBond = policy.proposal_bond;
  const contextMatches =
    policyNetwork === "TESTNET" &&
    policyDao === daoAccountId &&
    policyProfile.version === profile.version &&
    policyProfile.codeHash === profile.codeHash;
  if (isSupportedSputnikProfile(profile) && contextMatches) {
    throw new Error(
      "add_proposal preview: supported profile requires audited builder",
    );
  }
  const availability = contextMatches
    ? ("UNSUPPORTED_PROFILE" as const)
    : ("POLICY_CONTEXT_MISMATCH" as const);
  const gasParameter = requestGas(null)
    .parameter as SputnikRequestGasParameter & {
    readonly status: "REQUIRED";
    readonly value: null;
  };
  const authorizationMetadata = authorization(policyBond);
  const contextNotice = contextMatches
    ? "The supplied Sputnik profile/code hash is unsupported"
    : "The policy snapshot does not match the supplied Sputnik profile/code hash";
  return Object.freeze({
    receiverId: daoAccountId,
    method: "add_proposal" as const,
    args: Object.freeze({ proposal }),
    attachedDepositYocto: policyBond,
    gas: null,
    gasParameter,
    network: "TESTNET" as const,
    signingEnabled: false as const,
    executable: false as const,
    availability,
    authorization: authorizationMetadata,
    policySnapshot: policy,
    disabledReason: `${contextNotice}, so this payload is display-only and was not produced by the audited pinned-profile proposal builder. A reviewed positive U64 gas request parameter is still required. ${authorizationMetadata.notice} This descriptor is unsigned and non-executable; it has no key, nonce, transaction block hash, signature, callback, transaction hash, or send method.`,
  });
}

export function buildUnsignedAddProposalRequest(
  input: BuildUnsignedAddProposalRequestInput,
): CompleteUnsignedAddProposalRequest {
  const request = prepareUnsignedAddProposalRequest(input);
  if (
    request.gas === null ||
    request.gasParameter.status !== "REVIEWED_PARAMETER" ||
    request.gasParameter.value === null
  ) {
    throw new Error("add_proposal request.gas: reviewed parameter required");
  }
  return request as CompleteUnsignedAddProposalRequest;
}
