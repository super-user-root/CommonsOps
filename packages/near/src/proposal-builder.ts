const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const MAX_POLICY_RESULT_BYTES = 256 * 1024;
const MAX_POLICY_LOGS = 100;
const MAX_POLICY_LOG_BYTES = 4 * 1024;
const MAX_PROVENANCE_LABEL_BYTES = 200;
const BASE58_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
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

export interface SputnikPolicyBlockProvenance {
  readonly finality: "final";
  readonly hash: string;
  readonly height: string;
}

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

export interface SputnikRequestAuthorization {
  readonly required: "WALLET_OR_FULL_ACCESS_KEY";
  readonly functionCallKeyAccepted: false;
  readonly functionCallKeyCanAttachNear: false;
  readonly allowanceControlsAssetSpending: false;
  readonly notice: string;
}

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

const validatedPolicySnapshots = new WeakSet<object>();
const validatedProposalContexts = new WeakMap<object, ProposalContext>();

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

function cryptoHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !BASE58_HASH.test(value)) {
    throw new Error(`${field}: base58 NEAR hash required`);
  }
  return value;
}

function profileInput(
  value: unknown,
  field = "profile",
): Readonly<SputnikProfileInput> {
  if (!isObject(value) || !hasExactKeys(value, ["version", "codeHash"])) {
    throw new Error(`${field}: exact version and codeHash required`);
  }
  if (
    typeof value.version !== "string" ||
    !value.version.trim() ||
    typeof value.codeHash !== "string" ||
    !value.codeHash.trim()
  ) {
    throw new Error(`${field}: nonempty version and codeHash strings required`);
  }
  return Object.freeze({
    version: value.version,
    codeHash: value.codeHash,
  });
}

function supportedProfile(
  value: unknown,
  field = "profile",
): SupportedSputnikProfile {
  if (!isObject(value) || !hasExactKeys(value, ["version", "codeHash"])) {
    throw new Error(`${field}: exact version and codeHash required`);
  }
  if (
    value.version !== "2.0.0" ||
    value.codeHash !== pinnedSputnikProfiles["2.0.0"].codeHash
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
  return isObject(value) && validatedPolicySnapshots.has(value);
}

function base64Bytes(value: string): Uint8Array {
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

function decodePolicy(value: unknown): string {
  const bytes = resultBytes(value);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("policy result: valid UTF-8 required");
  }
  let policy: unknown;
  try {
    policy = JSON.parse(text);
  } catch {
    throw new Error("policy result: valid JSON required");
  }
  if (!isObject(policy) || Object.getPrototypeOf(policy) !== Object.prototype) {
    throw new Error("policy result: plain policy object required");
  }
  return canonicalDecimal(
    policy.proposal_bond,
    "policy.proposal_bond",
    U128_MAX,
  );
}

function blockHeight(value: unknown): string {
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

function policySnapshot(
  daoAccountId: string,
  profile: Readonly<SputnikProfileInput>,
  proposalBondYocto: string,
  blockHash: string,
  height: string,
  source: SputnikPolicySource,
): ValidatedSputnikPolicySnapshot {
  const snapshot = Object.freeze({
    network: "TESTNET" as const,
    daoAccountId,
    profile,
    proposal_bond: proposalBondYocto,
    block: Object.freeze({
      finality: "final" as const,
      hash: blockHash,
      height,
    }),
    source: Object.freeze(source),
  }) as ValidatedSputnikPolicySnapshot;
  validatedPolicySnapshots.add(snapshot);
  return snapshot;
}

export async function querySputnikPolicy(
  input: QuerySputnikPolicyInput,
): Promise<ValidatedSputnikPolicySnapshot> {
  if (
    !isObject(input) ||
    !hasExactKeys(input, ["transport", "daoAccountId", "profile"])
  ) {
    throw new Error("query input: exact transport, DAO, and profile required");
  }
  if (typeof input.transport !== "function") {
    throw new Error("transport: injected RPC function required");
  }
  const transport = input.transport;
  const daoAccountId = accountId(input.daoAccountId, "daoAccountId");
  const profile = profileInput(input.profile);
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

  const response = await transport(request);
  if (!isObject(response) || response.jsonrpc !== "2.0") {
    throw new Error("RPC response: JSON-RPC 2.0 object required");
  }
  if (response.id !== SPUTNIK_POLICY_RPC_ID) {
    throw new Error("RPC response.id: request ID mismatch");
  }
  const hasResult = Object.hasOwn(response, "result");
  const hasError = Object.hasOwn(response, "error");
  if (hasResult === hasError) {
    throw new Error("RPC response: exactly one result or error required");
  }
  if (hasError) {
    const error = response.error;
    if (
      !isObject(error) ||
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== "string" ||
      !error.message
    ) {
      throw new Error("RPC response.error: valid code and message required");
    }
    throw new Error(
      `RPC get_policy error ${String(error.code)}: ${error.message}`,
    );
  }
  const result = response.result;
  if (!isObject(result)) {
    throw new Error(
      "RPC response.result: call_function result object required",
    );
  }
  validateLogs(result.logs);
  const hash = cryptoHash(result.block_hash, "RPC result.block_hash");
  const height = blockHeight(result.block_height);
  const proposalBondYocto = decodePolicy(result.result);
  return policySnapshot(
    daoAccountId,
    profile,
    proposalBondYocto,
    hash,
    height,
    {
      kind: "RPC",
      requestId: SPUTNIK_POLICY_RPC_ID,
      label: "Injected TESTNET RPC get_policy response",
    },
  );
}

export function parseSputnikPolicyFixture(
  input: SputnikPolicyFixtureInput,
): ValidatedSputnikPolicySnapshot {
  if (
    !isObject(input) ||
    !hasExactKeys(input, [
      "network",
      "daoAccountId",
      "profile",
      "proposalBondYocto",
      "blockHash",
      "blockHeight",
      "provenanceLabel",
    ])
  ) {
    throw new Error("policy fixture: exact bounded input required");
  }
  if (input.network !== "TESTNET") {
    throw new Error("policy fixture.network: TESTNET required");
  }
  const daoAccountId = accountId(
    input.daoAccountId,
    "policy fixture.daoAccountId",
  );
  const profile = profileInput(input.profile, "policy fixture.profile");
  const proposalBondYocto = canonicalDecimal(
    input.proposalBondYocto,
    "policy fixture.proposalBondYocto",
    U128_MAX,
  );
  const hash = cryptoHash(input.blockHash, "policy fixture.blockHash");
  const height = canonicalDecimal(
    input.blockHeight,
    "policy fixture.blockHeight",
    U64_MAX,
  );
  if (
    typeof input.provenanceLabel !== "string" ||
    !input.provenanceLabel.trim() ||
    new TextEncoder().encode(input.provenanceLabel).length >
      MAX_PROVENANCE_LABEL_BYTES
  ) {
    throw new Error("policy fixture.provenanceLabel: bounded label required");
  }
  return policySnapshot(
    daoAccountId,
    profile,
    proposalBondYocto,
    hash,
    height,
    {
      kind: "FIXTURE",
      requestId: null,
      label: input.provenanceLabel,
    },
  );
}

function validateReference(
  value: unknown,
): Readonly<NativeTransferProposalReference> {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "templateId",
      "periodIndex",
      "evidenceUrl",
      "commitSha",
    ])
  ) {
    throw new Error("cycle: exact canonical reference required");
  }
  const templateId = canonicalDecimal(
    value.templateId,
    "cycle.templateId",
    U64_MAX,
  );
  const periodIndex = canonicalDecimal(
    value.periodIndex,
    "cycle.periodIndex",
    U64_MAX,
  );
  if (
    typeof value.evidenceUrl !== "string" ||
    value.evidenceUrl !== value.evidenceUrl.toLowerCase()
  ) {
    throw new Error(
      "cycle.evidenceUrl: canonical GitHub pull request URL required",
    );
  }
  const match =
    /^https:\/\/github\.com\/([a-z0-9_-]{1,100})\/([a-z0-9_.-]{1,100})\/pull\/((?:0|[1-9][0-9]*))$/.exec(
      value.evidenceUrl,
    );
  if (
    !match ||
    match[2] === "." ||
    match[2] === ".." ||
    new TextEncoder().encode(value.evidenceUrl).length > 320
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
  if (
    typeof value.commitSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.commitSha)
  ) {
    throw new Error("cycle.commitSha: canonical 40-character SHA required");
  }
  return Object.freeze({
    templateId,
    periodIndex,
    evidenceUrl: value.evidenceUrl,
    commitSha: value.commitSha,
  });
}

function proposalExpectation(
  value: unknown,
): Readonly<NativeTransferProposalExpectation> {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "network",
      "daoAccountId",
      "claimantId",
      "recipientId",
      "amountYocto",
      "cycle",
    ])
  ) {
    throw new Error("proposal expectation: exact immutable payout required");
  }
  if (value.network !== "TESTNET") {
    throw new Error("proposal expectation.network: TESTNET required");
  }
  const daoAccountId = accountId(
    value.daoAccountId,
    "proposal expectation.daoAccountId",
  );
  const claimantId = accountId(
    value.claimantId,
    "proposal expectation.claimantId",
  );
  const recipientId = accountId(
    value.recipientId,
    "proposal expectation.recipientId",
  );
  if (claimantId !== recipientId) {
    throw new Error(
      "proposal expectation: claimant must equal payout recipient",
    );
  }
  const amountYocto = canonicalDecimal(
    value.amountYocto,
    "proposal expectation.amountYocto",
    U128_MAX,
    true,
  );
  const cycle = validateReference(value.cycle);
  return Object.freeze({
    network: "TESTNET" as const,
    daoAccountId,
    claimantId,
    recipientId,
    amountYocto,
    cycle,
  });
}

export function buildNativeTransferProposalPreview(
  input: NativeTransferProposalExpectation,
): NativeTransferProposal {
  const expected = proposalExpectation(input);
  const description = `CommonsOps cycle ${expected.cycle.templateId}:${expected.cycle.periodIndex}; evidence ${expected.cycle.evidenceUrl}; commit ${expected.cycle.commitSha}`;
  if (
    new TextEncoder().encode(description).length >
      MAX_SPUTNIK_PROPOSAL_DESCRIPTION_BYTES ||
    /[\u0000-\u001f\u007f<>]/.test(description)
  ) {
    throw new Error("proposal.description: bounded plain text required");
  }
  return Object.freeze({
    description,
    kind: Object.freeze({
      Transfer: Object.freeze({
        token_id: "" as const,
        receiver_id: expected.recipientId,
        amount: expected.amountYocto,
        msg: null,
      }),
    }),
  });
}

export function buildNativeSputnikTransferProposal(
  input: NativeSputnikTransferProposalExpectation,
): ValidatedNativeSputnikTransferProposal {
  if (
    !isObject(input) ||
    !hasExactKeys(input, [
      "network",
      "daoAccountId",
      "claimantId",
      "recipientId",
      "amountYocto",
      "cycle",
      "profile",
    ])
  ) {
    throw new Error(
      "Sputnik proposal expectation: exact profile and payout required",
    );
  }
  const profile = supportedProfile(input.profile);
  const proposal = buildNativeTransferProposalPreview({
    network: input.network,
    daoAccountId: input.daoAccountId,
    claimantId: input.claimantId,
    recipientId: input.recipientId,
    amountYocto: input.amountYocto,
    cycle: input.cycle,
  }) as ValidatedNativeSputnikTransferProposal;
  validatedProposalContexts.set(
    proposal,
    Object.freeze({
      network: "TESTNET" as const,
      daoAccountId: accountId(input.daoAccountId, "daoAccountId"),
      profile,
    }),
  );
  return proposal;
}

function authorization(): SputnikRequestAuthorization {
  return Object.freeze({
    required: "WALLET_OR_FULL_ACCESS_KEY" as const,
    functionCallKeyAccepted: false as const,
    functionCallKeyCanAttachNear: false as const,
    allowanceControlsAssetSpending: false as const,
    notice:
      "Wallet/full-access authorization is required. Function-call keys cannot attach NEAR; their allowance controls gas only, not asset spending. A zero current bond is valid, but this audited descriptor still does not authorize a function-call-key flow.",
  });
}

export function prepareUnsignedAddProposalRequest(
  input: PrepareUnsignedAddProposalRequestInput,
): UnsignedAddProposalRequest {
  if (
    !isObject(input) ||
    !hasExactKeys(input, [
      "network",
      "daoAccountId",
      "profile",
      "policy",
      "proposal",
      "gas",
    ])
  ) {
    throw new Error("add_proposal request: exact reviewed input required");
  }
  if (input.network !== "TESTNET") {
    throw new Error("add_proposal request.network: TESTNET required");
  }
  const daoAccountId = accountId(
    input.daoAccountId,
    "add_proposal request.daoAccountId",
  );
  const profile = profileInput(input.profile, "add_proposal request.profile");
  if (!isValidatedSputnikPolicySnapshot(input.policy)) {
    throw new Error(
      "add_proposal request.policy: validated policy snapshot required",
    );
  }
  const proposalContext = isObject(input.proposal)
    ? validatedProposalContexts.get(input.proposal)
    : undefined;
  if (!proposalContext) {
    throw new Error(
      "add_proposal request.proposal: validated proposal required",
    );
  }
  if (
    input.policy.network !== "TESTNET" ||
    input.policy.daoAccountId !== daoAccountId ||
    input.policy.profile.version !== profile.version ||
    input.policy.profile.codeHash !== profile.codeHash ||
    proposalContext.network !== "TESTNET" ||
    proposalContext.daoAccountId !== daoAccountId ||
    proposalContext.profile.version !== profile.version ||
    proposalContext.profile.codeHash !== profile.codeHash
  ) {
    throw new Error(
      "add_proposal request: policy, proposal, DAO, network, and profile must match",
    );
  }
  const gas =
    input.gas === null
      ? null
      : canonicalDecimal(input.gas, "add_proposal request.gas", U64_MAX, true);
  const gasParameter = Object.freeze(
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
  const authorizationMetadata = authorization();
  const sourceNotice =
    input.policy.source.kind === "FIXTURE"
      ? `Policy provenance is fixture-only (${input.policy.source.label}); no live policy query is claimed. `
      : "Policy bond came from the validated injected final RPC snapshot. ";
  const gasNotice =
    gas === null
      ? "A reviewed positive U64 gas request parameter is still required. "
      : "";

  // Sputnik accepts at least the bond. CommonsOps deliberately attaches exactly
  // the final policy snapshot value so no override, padding, or rounding occurs.
  return Object.freeze({
    receiverId: daoAccountId,
    method: "add_proposal" as const,
    args: Object.freeze({ proposal: input.proposal }),
    attachedDepositYocto: input.policy.proposal_bond,
    gas,
    gasParameter,
    network: "TESTNET" as const,
    signingEnabled: false as const,
    executable: false as const,
    authorization: authorizationMetadata,
    policySnapshot: input.policy,
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
  if (
    !isObject(input) ||
    !hasExactKeys(input, [
      "network",
      "daoAccountId",
      "profile",
      "policy",
      "proposal",
    ])
  ) {
    throw new Error("add_proposal preview: exact unsupported input required");
  }
  if (input.network !== "TESTNET") {
    throw new Error("add_proposal preview.network: TESTNET required");
  }
  const daoAccountId = accountId(
    input.daoAccountId,
    "add_proposal preview.daoAccountId",
  );
  const profile = profileInput(input.profile, "add_proposal preview.profile");
  if (!isValidatedSputnikPolicySnapshot(input.policy)) {
    throw new Error(
      "add_proposal preview.policy: validated policy snapshot required",
    );
  }
  const contextMatches =
    input.policy.network === "TESTNET" &&
    input.policy.daoAccountId === daoAccountId &&
    input.policy.profile.version === profile.version &&
    input.policy.profile.codeHash === profile.codeHash;
  if (isSupportedSputnikProfile(profile) && contextMatches) {
    throw new Error(
      "add_proposal preview: supported profile requires audited builder",
    );
  }
  const availability = contextMatches
    ? ("UNSUPPORTED_PROFILE" as const)
    : ("POLICY_CONTEXT_MISMATCH" as const);
  const expectedProposalKeys = ["description", "kind"] as const;
  if (
    !isObject(input.proposal) ||
    !hasExactKeys(input.proposal, expectedProposalKeys)
  ) {
    throw new Error("add_proposal preview.proposal: exact proposal required");
  }
  const proposal = structuredClone(input.proposal) as NativeTransferProposal;
  const gasParameter = Object.freeze({
    status: "REQUIRED" as const,
    value: null,
    basis: "CALLER_REVIEWED_REQUEST_PARAMETER_NOT_MEASURED" as const,
    notice:
      "A caller-reviewed positive U64 gas request parameter is required; no measured or default add_proposal gas is claimed.",
  });
  const authorizationMetadata = authorization();
  const contextNotice = contextMatches
    ? "The supplied Sputnik profile/code hash is unsupported"
    : "The policy snapshot does not match the supplied Sputnik profile/code hash";
  return Object.freeze({
    receiverId: daoAccountId,
    method: "add_proposal" as const,
    args: Object.freeze({ proposal: Object.freeze(proposal) }),
    attachedDepositYocto: input.policy.proposal_bond,
    gas: null,
    gasParameter,
    network: "TESTNET" as const,
    signingEnabled: false as const,
    executable: false as const,
    availability,
    authorization: authorizationMetadata,
    policySnapshot: input.policy,
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
