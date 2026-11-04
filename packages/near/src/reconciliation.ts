import {
  verifyNativeSputnikPayment,
  type ExpectedNativePayment,
  type PaymentState,
} from "./index.ts";

// The near package cannot depend on packages/domain without a manifest and
// lockfile change, and this package is bundled into apps/web, so this module
// stays platform-pure: no node built-ins are imported and SHA-256 is
// implemented locally. The canonical JSON algorithm, the schema version, and
// the record capacity mirror packages/domain/src/index.ts exactly; the
// focused tests import the domain module relatively and prove byte equality.
const RECONCILIATION_SCHEMA_VERSION = 1;
const RECONCILIATION_MAX_PROVENANCE_BYTES = 200;
const RECONCILIATION_MAX_PROFILE_VERSION_BYTES = 64;

export const RECONCILIATION_TX_STATUS_RPC_ID = "commonsops:tx_status";
export const RECONCILIATION_MAX_RECORDS = 2_000;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const MAX_JSON_ARRAY_LENGTH = 300_000;
const MAX_JSON_STRING_BYTES = 64 * 1024;

export interface ReconciliationTxStatusRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: typeof RECONCILIATION_TX_STATUS_RPC_ID;
  readonly method: "EXPERIMENTAL_tx_status";
  readonly params: {
    readonly tx_hash: string;
    readonly sender_account_id: string;
  };
}

export type ReconciliationRpcTransport = (
  request: ReconciliationTxStatusRpcRequest,
) => Promise<unknown>;

export interface ReconciliationProfileExpectation {
  readonly version: string;
  readonly codeHash: string;
}

export interface ReconciliationCycleExpectation {
  readonly network: "TESTNET";
  readonly daoAccountId: string;
  readonly proposalId: string;
  readonly claimantId: string;
  readonly recipientId: string;
  readonly amountYocto: string;
  readonly profile: ReconciliationProfileExpectation;
  readonly cycle: {
    readonly templateId: string;
    readonly periodIndex: string;
  };
}

export interface ReconciliationCandidateTransaction {
  readonly transactionHash: string;
  readonly signerId: string;
}

export interface ReconciliationRecord {
  readonly schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  readonly network: "TESTNET" | "MAINNET";
  readonly daoAccountId: string;
  readonly proposalId: string;
  readonly actionReceiptId: string;
  readonly payoutReceiptId: string;
  readonly cycle: {
    readonly templateId: string;
    readonly periodIndex: string;
  };
  readonly expectedRecipientId: string;
  readonly expectedAmountYocto: string;
  readonly profileVersion: string;
  readonly profileCodeHash: string;
  readonly transactionHash: string;
  readonly payoutBlockHash: string;
  readonly provenance: string;
}

export type ReconciliationStatus =
  "APPLIED" | "IDEMPOTENT" | "CONFLICT" | "NOT_APPLIED";

export interface ReconciliationResult {
  readonly status: ReconciliationStatus;
  readonly reason: string;
  readonly adapterState: PaymentState;
  readonly record: ReconciliationRecord | null;
}

export interface ReconciliationSnapshot {
  readonly schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  readonly fingerprint: string;
  readonly records: readonly ReconciliationRecord[];
}

export interface ReconciliationStore {
  apply(record: ReconciliationRecord): ReconciliationResult;
  size(): number;
  getByProposal(
    network: "TESTNET" | "MAINNET",
    daoAccountId: string,
    proposalId: string,
  ): ReconciliationRecord | null;
  getByPayoutReceipt(
    network: "TESTNET" | "MAINNET",
    payoutReceiptId: string,
  ): ReconciliationRecord | null;
  listRecords(): readonly ReconciliationRecord[];
  exportSnapshot(): ReconciliationSnapshot;
  exportCanonicalBytes(): Uint8Array;
  fingerprint(): string;
  importSnapshot(snapshot: unknown): void;
}

export interface ReconcilePaymentInput {
  readonly expectation: ReconciliationCycleExpectation;
  readonly candidate: ReconciliationCandidateTransaction;
  readonly transport: ReconciliationRpcTransport;
  readonly provenance: string;
  readonly store: ReconciliationStore;
}

interface SnapshotState {
  nodes: number;
  readonly seen: Set<object>;
}

const reconciliationStores = new WeakSet<object>();

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

function decimal(
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

function network(value: unknown, field: string): "TESTNET" | "MAINNET" {
  if (value !== "TESTNET" && value !== "MAINNET") {
    throw new Error(`${field}: TESTNET or MAINNET network required`);
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

function cryptoHash(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field}: string required`);
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
  const restored = Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...bytes,
  ]);
  if (restored.length !== 32 || base58Encode(restored) !== value) {
    throw new Error(`${field}: canonical base58 encoding of 32 bytes required`);
  }
  return value;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).length > maximum
  ) {
    throw new Error(`${field}: bounded text required`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(message: Uint8Array): Uint8Array {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const padded = new Uint8Array(((message.length + 9 + 63) >> 6) << 6);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const words = new Uint32Array(64);
  const rotr = (value: number, count: number): number =>
    (value >>> count) | (value << (32 - count));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const before = words[index - 15]!;
      const after = words[index - 2]!;
      const s0 = rotr(before, 7) ^ rotr(before, 18) ^ (before >>> 3);
      const s1 = rotr(after, 17) ^ rotr(after, 19) ^ (after >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + maj) >>> 0;
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 =
        (h + bigS1 + choose + SHA256_K[index]! + words[index]!) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, state[index]!);
  }
  return digest;
}

function sha256Hex(message: Uint8Array): string {
  let hex = "";
  for (const byte of sha256(message)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

interface CanonicalJsonState {
  nodes: number;
  readonly seen: Set<object>;
}

function canonicalJsonData(
  value: object,
  field: string,
): {
  readonly keys: string[];
  readonly values: Readonly<Record<string, unknown>>;
} {
  const own = descriptors(value, field);
  const keys: string[] = [];
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(own)) {
    const descriptor = own[key];
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(`${field}: plain JSON data properties required`);
    }
    keys.push(key);
    values[key] = descriptor.value;
  }
  return { keys, values };
}

function canonicalJsonText(
  value: unknown,
  field: string,
  state: CanonicalJsonState,
  depth: number,
): string {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new Error(`${field}: JSON is too large or deeply nested`);
  }
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${field}: finite JSON number required`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error(`${field}: plain JSON data required`);
  }
  if (state.seen.has(value)) {
    throw new Error(`${field}: cyclic JSON is not allowed`);
  }
  state.seen.add(value);
  let text: string;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`${field}: plain JSON array required`);
    }
    const own = descriptors(value, field);
    const length = value.length;
    const expected = new Set<PropertyKey>(["length"]);
    for (let index = 0; index < length; index += 1) {
      expected.add(String(index));
    }
    const ownKeys = Reflect.ownKeys(own);
    if (
      ownKeys.length !== expected.size ||
      ownKeys.some((key) => !expected.has(key))
    ) {
      throw new Error(
        `${field}: dense JSON array without extra properties required`,
      );
    }
    const lengthDescriptor = own.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      throw new Error(`${field}.length: data property required`);
    }
    const items: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = own[String(index)];
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new Error(`${field}[${index}]: data property required`);
      }
      items.push(
        canonicalJsonText(
          descriptor.value,
          `${field}[${index}]`,
          state,
          depth + 1,
        ),
      );
    }
    text = `[${items.join(",")}]`;
  } else {
    plainPrototype(value, field);
    const { keys, values } = canonicalJsonData(value, field);
    keys.sort();
    const members = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJsonText(
          values[key],
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

function canonicalJsonString(value: unknown): string {
  return canonicalJsonText(
    value,
    "canonical json",
    { nodes: 0, seen: new Set() },
    0,
  );
}

function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonString(value));
}

function proposalKeyString(
  networkValue: string,
  daoAccountId: string,
  proposalId: string,
): string {
  return `${networkValue}|${daoAccountId}|${proposalId}`;
}

function payoutKeyString(
  networkValue: string,
  payoutReceiptId: string,
): string {
  return `${networkValue}|${payoutReceiptId}`;
}

function evidenceKeyString(record: ReconciliationRecord): string {
  return [
    record.network.toLowerCase(),
    record.daoAccountId,
    record.proposalId,
    record.actionReceiptId,
    record.payoutReceiptId,
  ].join(":");
}

const RECORD_KEYS = [
  "schemaVersion",
  "network",
  "daoAccountId",
  "proposalId",
  "actionReceiptId",
  "payoutReceiptId",
  "cycle",
  "expectedRecipientId",
  "expectedAmountYocto",
  "profileVersion",
  "profileCodeHash",
  "transactionHash",
  "payoutBlockHash",
  "provenance",
] as const;

function parseRecord(value: unknown): ReconciliationRecord {
  const snapshot = snapshotJson(value, "reconciliation record");
  const captured = captureOwnData(
    snapshot,
    [[...RECORD_KEYS]],
    "reconciliation record",
  );
  if (captured.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) {
    throw new Error("reconciliation record.schemaVersion: 1 required");
  }
  const networkValue = network(
    captured.network,
    "reconciliation record.network",
  );
  const daoAccountId = accountId(
    captured.daoAccountId,
    "reconciliation record.daoAccountId",
  );
  const proposalId = decimal(
    captured.proposalId,
    "reconciliation record.proposalId",
    U64_MAX,
  );
  const actionReceiptId = cryptoHash(
    captured.actionReceiptId,
    "reconciliation record.actionReceiptId",
  );
  const payoutReceiptId = cryptoHash(
    captured.payoutReceiptId,
    "reconciliation record.payoutReceiptId",
  );
  const cycle = captureOwnData(
    captured.cycle,
    [["templateId", "periodIndex"]],
    "reconciliation record.cycle",
  );
  const templateId = decimal(
    cycle.templateId,
    "reconciliation record.cycle.templateId",
    U64_MAX,
  );
  const periodIndex = decimal(
    cycle.periodIndex,
    "reconciliation record.cycle.periodIndex",
    U64_MAX,
  );
  const expectedRecipientId = accountId(
    captured.expectedRecipientId,
    "reconciliation record.expectedRecipientId",
  );
  const expectedAmountYocto = decimal(
    captured.expectedAmountYocto,
    "reconciliation record.expectedAmountYocto",
    U128_MAX,
    true,
  );
  const profileVersion = boundedText(
    captured.profileVersion,
    "reconciliation record.profileVersion",
    RECONCILIATION_MAX_PROFILE_VERSION_BYTES,
  );
  const profileCodeHash = cryptoHash(
    captured.profileCodeHash,
    "reconciliation record.profileCodeHash",
  );
  const transactionHash = cryptoHash(
    captured.transactionHash,
    "reconciliation record.transactionHash",
  );
  const payoutBlockHash = cryptoHash(
    captured.payoutBlockHash,
    "reconciliation record.payoutBlockHash",
  );
  const provenance = boundedText(
    captured.provenance,
    "reconciliation record.provenance",
    RECONCILIATION_MAX_PROVENANCE_BYTES,
  );
  return deepFreeze({
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    network: networkValue,
    daoAccountId,
    proposalId,
    actionReceiptId,
    payoutReceiptId,
    cycle: { templateId, periodIndex },
    expectedRecipientId,
    expectedAmountYocto,
    profileVersion,
    profileCodeHash,
    transactionHash,
    payoutBlockHash,
    provenance,
  }) as ReconciliationRecord;
}

interface StoreState {
  records: Map<string, ReconciliationRecord>;
  byProposal: Map<string, string>;
  byPayout: Map<string, string>;
}

function sortedRecords(state: StoreState): readonly ReconciliationRecord[] {
  return [...state.records.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, record]) => record);
}

function resultOf(result: ReconciliationResult): ReconciliationResult {
  return Object.freeze(result);
}

function applyRecord(state: StoreState, value: unknown): ReconciliationResult {
  const record = parseRecord(value);
  const evidenceKey = evidenceKeyString(record);
  const proposalKey = proposalKeyString(
    record.network,
    record.daoAccountId,
    record.proposalId,
  );
  const payoutKey = payoutKeyString(record.network, record.payoutReceiptId);
  const existing = state.records.get(evidenceKey);
  if (existing) {
    if (canonicalJsonString(existing) === canonicalJsonString(record)) {
      return resultOf({
        status: "IDEMPOTENT",
        reason: "the identical attribution is already recorded",
        adapterState: "PAID",
        record: existing,
      });
    }
    return resultOf({
      status: "CONFLICT",
      reason:
        "the same attribution is already recorded with different payment metadata",
      adapterState: "PAID",
      record: null,
    });
  }
  if (state.byProposal.has(proposalKey)) {
    return resultOf({
      status: "CONFLICT",
      reason:
        "the proposal key is already bound to a different payout attribution",
      adapterState: "PAID",
      record: null,
    });
  }
  if (state.byPayout.has(payoutKey)) {
    return resultOf({
      status: "CONFLICT",
      reason:
        "the payout receipt is already bound to a different proposal attribution",
      adapterState: "PAID",
      record: null,
    });
  }
  if (state.records.size >= RECONCILIATION_MAX_RECORDS) {
    throw new Error("reconciliation store: record capacity is exhausted");
  }
  state.records.set(evidenceKey, record);
  state.byProposal.set(proposalKey, evidenceKey);
  state.byPayout.set(payoutKey, proposalKey);
  return resultOf({
    status: "APPLIED",
    reason: "verified attribution recorded",
    adapterState: "PAID",
    record,
  });
}

function snapshotPayload(state: StoreState): unknown {
  return {
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    records: sortedRecords(state),
  };
}

function storeFingerprint(state: StoreState): string {
  return sha256Hex(canonicalJsonBytes(snapshotPayload(state)));
}

function importSnapshot(state: StoreState, value: unknown): void {
  const snapshot = snapshotJson(value, "reconciliation snapshot");
  const captured = captureOwnData(
    snapshot,
    [["fingerprint", "records", "schemaVersion"]],
    "reconciliation snapshot",
  );
  if (captured.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) {
    throw new Error("reconciliation snapshot.schemaVersion: 1 required");
  }
  const fingerprint = captured.fingerprint;
  if (typeof fingerprint !== "string" || !HEX_64.test(fingerprint)) {
    throw new Error(
      "reconciliation snapshot.fingerprint: hex SHA-256 required",
    );
  }
  const recordsValue = captured.records;
  if (
    !Array.isArray(recordsValue) ||
    recordsValue.length > RECONCILIATION_MAX_RECORDS
  ) {
    throw new Error(
      "reconciliation snapshot.records: bounded record array required",
    );
  }
  const records = recordsValue.map((record) => parseRecord(record));
  const evidenceKeys = new Set<string>();
  const proposalKeys = new Set<string>();
  const payoutKeys = new Set<string>();
  for (const record of records) {
    const evidenceKey = evidenceKeyString(record);
    const proposalKey = proposalKeyString(
      record.network,
      record.daoAccountId,
      record.proposalId,
    );
    const payoutKey = payoutKeyString(record.network, record.payoutReceiptId);
    if (evidenceKeys.has(evidenceKey)) {
      throw new Error(
        "reconciliation snapshot: duplicate evidence key is not allowed",
      );
    }
    if (proposalKeys.has(proposalKey)) {
      throw new Error(
        "reconciliation snapshot: duplicate proposal key is not allowed",
      );
    }
    if (payoutKeys.has(payoutKey)) {
      throw new Error(
        "reconciliation snapshot: duplicate payout receipt key is not allowed",
      );
    }
    evidenceKeys.add(evidenceKey);
    proposalKeys.add(proposalKey);
    payoutKeys.add(payoutKey);
  }
  for (let index = 1; index < records.length; index += 1) {
    const previous = evidenceKeyString(records[index - 1]!);
    const current = evidenceKeyString(records[index]!);
    if (previous >= current) {
      throw new Error(
        "reconciliation snapshot.records: canonical evidence-key order required",
      );
    }
  }
  const rebuilt = canonicalJsonBytes({
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    records,
  });
  if (sha256Hex(rebuilt) !== fingerprint) {
    throw new Error("reconciliation snapshot: fingerprint mismatch");
  }
  const nextRecords = new Map<string, ReconciliationRecord>();
  const nextByProposal = new Map<string, string>();
  const nextByPayout = new Map<string, string>();
  for (const record of records) {
    const evidenceKey = evidenceKeyString(record);
    const proposalKey = proposalKeyString(
      record.network,
      record.daoAccountId,
      record.proposalId,
    );
    nextRecords.set(evidenceKey, record);
    nextByProposal.set(proposalKey, evidenceKey);
    nextByPayout.set(
      payoutKeyString(record.network, record.payoutReceiptId),
      proposalKey,
    );
  }
  state.records = nextRecords;
  state.byProposal = nextByProposal;
  state.byPayout = nextByPayout;
}

function lookupProposal(
  state: StoreState,
  networkValue: unknown,
  daoAccountId: unknown,
  proposalId: unknown,
): ReconciliationRecord | null {
  const checked = network(networkValue, "proposal lookup.network");
  const dao = accountId(daoAccountId, "proposal lookup.daoAccountId");
  const proposal = decimal(proposalId, "proposal lookup.proposalId", U64_MAX);
  const evidenceKey = state.byProposal.get(
    proposalKeyString(checked, dao, proposal),
  );
  return evidenceKey ? (state.records.get(evidenceKey) ?? null) : null;
}

function lookupPayout(
  state: StoreState,
  networkValue: unknown,
  payoutReceiptId: unknown,
): ReconciliationRecord | null {
  const checked = network(networkValue, "payout lookup.network");
  const payout = cryptoHash(payoutReceiptId, "payout lookup.payoutReceiptId");
  const proposalKey = state.byPayout.get(payoutKeyString(checked, payout));
  if (!proposalKey) return null;
  const evidenceKey = state.byProposal.get(proposalKey);
  return evidenceKey ? (state.records.get(evidenceKey) ?? null) : null;
}

export function isReconciliationStore(
  value: unknown,
): value is ReconciliationStore {
  return (
    typeof value === "object" &&
    value !== null &&
    reconciliationStores.has(value)
  );
}

export function createReconciliationStore(): ReconciliationStore {
  const state: StoreState = {
    records: new Map(),
    byProposal: new Map(),
    byPayout: new Map(),
  };
  const store: ReconciliationStore = {
    apply: (record) => applyRecord(state, record),
    size: () => state.records.size,
    getByProposal: (networkValue, daoAccountId, proposalId) =>
      lookupProposal(state, networkValue, daoAccountId, proposalId),
    getByPayoutReceipt: (networkValue, payoutReceiptId) =>
      lookupPayout(state, networkValue, payoutReceiptId),
    listRecords: () =>
      Object.freeze([
        ...sortedRecords(state),
      ]) as readonly ReconciliationRecord[],
    exportSnapshot: () =>
      deepFreeze({
        schemaVersion: RECONCILIATION_SCHEMA_VERSION,
        fingerprint: storeFingerprint(state),
        records: sortedRecords(state),
      }) as ReconciliationSnapshot,
    exportCanonicalBytes: () => canonicalJsonBytes(snapshotPayload(state)),
    fingerprint: () => storeFingerprint(state),
    importSnapshot: (snapshot) => importSnapshot(state, snapshot),
  };
  reconciliationStores.add(store);
  return Object.freeze(store);
}

function parseExpectation(
  value: unknown,
): Readonly<ReconciliationCycleExpectation> {
  const snapshot = snapshotJson(value, "reconciliation expectation");
  const captured = captureOwnData(
    snapshot,
    [
      [
        "network",
        "daoAccountId",
        "proposalId",
        "claimantId",
        "recipientId",
        "amountYocto",
        "profile",
        "cycle",
      ],
    ],
    "reconciliation expectation",
  );
  if (captured.network !== "TESTNET") {
    throw new Error("reconciliation expectation.network: TESTNET required");
  }
  const daoAccountId = accountId(
    captured.daoAccountId,
    "reconciliation expectation.daoAccountId",
  );
  const claimantId = accountId(
    captured.claimantId,
    "reconciliation expectation.claimantId",
  );
  const recipientId = accountId(
    captured.recipientId,
    "reconciliation expectation.recipientId",
  );
  if (claimantId !== recipientId) {
    throw new Error(
      "reconciliation expectation: claimant must equal payout recipient",
    );
  }
  const proposalId = decimal(
    captured.proposalId,
    "reconciliation expectation.proposalId",
    U64_MAX,
  );
  const amountYocto = decimal(
    captured.amountYocto,
    "reconciliation expectation.amountYocto",
    U128_MAX,
    true,
  );
  const profile = captureOwnData(
    captured.profile,
    [["version", "codeHash"]],
    "reconciliation expectation.profile",
  );
  const profileVersion = boundedText(
    profile.version,
    "reconciliation expectation.profile.version",
    RECONCILIATION_MAX_PROFILE_VERSION_BYTES,
  );
  const profileCodeHash = cryptoHash(
    profile.codeHash,
    "reconciliation expectation.profile.codeHash",
  );
  const cycle = captureOwnData(
    captured.cycle,
    [["templateId", "periodIndex"]],
    "reconciliation expectation.cycle",
  );
  const templateId = decimal(
    cycle.templateId,
    "reconciliation expectation.cycle.templateId",
    U64_MAX,
  );
  const periodIndex = decimal(
    cycle.periodIndex,
    "reconciliation expectation.cycle.periodIndex",
    U64_MAX,
  );
  return Object.freeze({
    network: "TESTNET" as const,
    daoAccountId,
    proposalId,
    claimantId,
    recipientId,
    amountYocto,
    profile: Object.freeze({
      version: profileVersion,
      codeHash: profileCodeHash,
    }),
    cycle: Object.freeze({ templateId, periodIndex }),
  });
}

function parseCandidate(value: unknown): {
  readonly transactionHash: string;
  readonly signerId: string;
} {
  const snapshot = snapshotJson(value, "candidate transaction");
  const captured = captureOwnData(
    snapshot,
    [["transactionHash", "signerId"]],
    "candidate transaction",
  );
  return Object.freeze({
    transactionHash: cryptoHash(
      captured.transactionHash,
      "candidate transaction.transactionHash",
    ),
    signerId: accountId(captured.signerId, "candidate transaction.signerId"),
  });
}

function parseTxStatusEnvelope(
  value: unknown,
  candidateTransactionHash: string,
): unknown {
  const snapshot = snapshotJson(value, "tx_status response");
  if (!isObject(snapshot)) {
    throw new Error("tx_status response: JSON object required");
  }
  const keys = Reflect.ownKeys(snapshot);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("tx_status response: symbol properties are not allowed");
  }
  const stringKeys = keys as string[];
  if (
    stringKeys.some(
      (key) => !["jsonrpc", "id", "result", "error"].includes(key),
    )
  ) {
    throw new Error("tx_status response: unexpected or missing fields");
  }
  if (Object.hasOwn(snapshot, "error")) {
    throw new Error("tx_status response: RPC error reported");
  }
  if (!stringKeys.includes("result")) {
    throw new Error("tx_status response: result required");
  }
  if (Object.hasOwn(snapshot, "jsonrpc") && snapshot.jsonrpc !== "2.0") {
    throw new Error("tx_status response: JSON-RPC version mismatch");
  }
  // Replayed evidence snapshots may carry the request id of their original
  // capture, so the response is bound to the candidate by the transaction
  // hash correlation below instead of an id equality check.
  const result = snapshot.result;
  if (!isObject(result)) {
    throw new Error("tx_status response.result: JSON object required");
  }
  plainPrototype(result, "tx_status response.result");
  if (typeof result.final_execution_status !== "string") {
    throw new Error(
      "tx_status response.result.final_execution_status: string required",
    );
  }
  const transaction = result.transaction;
  if (!isObject(transaction)) {
    throw new Error("tx_status response.result.transaction: object required");
  }
  const transactionHash = cryptoHash(
    transaction.hash,
    "tx_status response.result.transaction.hash",
  );
  if (transactionHash !== candidateTransactionHash) {
    throw new Error(
      "tx_status response.transaction.hash: does not match the candidate",
    );
  }
  return snapshot;
}

function proposalView(
  expectation: Readonly<ReconciliationCycleExpectation>,
): unknown {
  // The single-request replay path never re-reads the proposal body. The
  // registry link already binds the proposal ID to the immutable cycle
  // snapshot, and the adapter binds the onchain act_proposal args to the
  // exact proposal ID and the causal payout receipt to the exact expected
  // recipient and amount, so this value only restates the expectations.
  return deepFreeze({
    id: Number(expectation.proposalId),
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: expectation.recipientId,
        amount: expectation.amountYocto,
        msg: null,
      },
    },
  });
}

function adapterExpectation(
  expectation: Readonly<ReconciliationCycleExpectation>,
): ExpectedNativePayment {
  return {
    network: "testnet",
    daoAccountId: expectation.daoAccountId,
    proposalId: expectation.proposalId,
    recipientId: expectation.recipientId,
    amountYocto: expectation.amountYocto,
    version: expectation.profile.version as "2.0.0" | "3.0.0",
    codeHash: expectation.profile.codeHash,
  };
}

export async function reconcilePayment(
  input: ReconcilePaymentInput,
): Promise<ReconciliationResult> {
  const captured = captureOwnData(
    input,
    [["candidate", "expectation", "provenance", "store", "transport"]],
    "reconcile input",
  );
  const transport = captured.transport;
  if (typeof transport !== "function") {
    throw new Error(
      "reconcile input.transport: injected RPC function required",
    );
  }
  if (!isReconciliationStore(captured.store)) {
    throw new Error("reconcile input.store: reconciliation store required");
  }
  const store = captured.store as ReconciliationStore;
  const provenance = boundedText(
    captured.provenance,
    "reconcile input.provenance",
    RECONCILIATION_MAX_PROVENANCE_BYTES,
  );
  const expectation = parseExpectation(captured.expectation);
  const candidate = parseCandidate(captured.candidate);
  const request: ReconciliationTxStatusRpcRequest = Object.freeze({
    jsonrpc: "2.0" as const,
    id: RECONCILIATION_TX_STATUS_RPC_ID,
    method: "EXPERIMENTAL_tx_status" as const,
    params: Object.freeze({
      tx_hash: candidate.transactionHash,
      sender_account_id: candidate.signerId,
    }),
  });
  const response = await (transport as ReconciliationRpcTransport)(request);
  const envelope = parseTxStatusEnvelope(response, candidate.transactionHash);
  const verified = verifyNativeSputnikPayment(
    adapterExpectation(expectation),
    proposalView(expectation),
    envelope,
  );
  if (verified.state !== "PAID") {
    return resultOf({
      status: "NOT_APPLIED",
      reason: verified.reason,
      adapterState: verified.state,
      record: null,
    });
  }
  const transactionHash = cryptoHash(
    verified.transactionHash,
    "verified result.transactionHash",
  );
  const actionReceiptId = cryptoHash(
    verified.actionReceiptId,
    "verified result.actionReceiptId",
  );
  const payoutReceiptId = cryptoHash(
    verified.payoutReceiptId,
    "verified result.payoutReceiptId",
  );
  const payoutBlockHash = cryptoHash(
    verified.blockHash,
    "verified result.blockHash",
  );
  const evidenceKey = [
    expectation.network.toLowerCase(),
    expectation.daoAccountId,
    expectation.proposalId,
    actionReceiptId,
    payoutReceiptId,
  ].join(":");
  if (verified.evidenceKey !== evidenceKey) {
    return resultOf({
      status: "NOT_APPLIED",
      reason: "verified evidence key does not match the verified attribution",
      adapterState: "UNKNOWN",
      record: null,
    });
  }
  const record: ReconciliationRecord = deepFreeze({
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    network: "TESTNET" as const,
    daoAccountId: expectation.daoAccountId,
    proposalId: expectation.proposalId,
    actionReceiptId,
    payoutReceiptId,
    cycle: { ...expectation.cycle },
    expectedRecipientId: expectation.recipientId,
    expectedAmountYocto: expectation.amountYocto,
    profileVersion: expectation.profile.version,
    profileCodeHash: expectation.profile.codeHash,
    transactionHash,
    payoutBlockHash,
    provenance,
  });
  return store.apply(record);
}
