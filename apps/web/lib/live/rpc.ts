// Hardened NEAR JSON-RPC read client for the live registry surface.
// Parsing follows the same fail-closed patterns as packages/near/src
// (validate every field, name every error, never invent fallback data).
// This module performs read-only `query` calls; it never signs anything.

import type { Cycle, Template } from "@commonsops/domain";
import { isCanonicalDecimal } from "@commonsops/domain";

export class LiveRpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LiveRpcError";
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isObject(body) && isObject(body.error)) {
      const info = body.error.info ?? body.error.cause ?? body.error;
      const detail =
        (isObject(info) && typeof info.error_message === "string"
          ? info.error_message
          : typeof body.error.message === "string"
            ? body.error.message
            : null) ?? "unspecified RPC error";
      return detail;
    }
  } catch {
    /* fall through to status-only message */
  }
  return `HTTP ${response.status}`;
}

export async function rpcCall(
  nodeUrl: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(nodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "commonsops-live",
        method,
        params,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new LiveRpcError(
      "ERR_RPC_UNREACHABLE",
      error instanceof Error ? error.message : "request failed",
    );
  }
  if (!response.ok) {
    throw new LiveRpcError(
      "ERR_RPC_HTTP_STATUS",
      await readErrorMessage(response),
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LiveRpcError("ERR_RPC_INVALID_RESPONSE", "body is not JSON");
  }
  if (!isObject(payload)) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "payload is not an object",
    );
  }
  if (isObject(payload.error)) {
    const error = payload.error;
    const cause = isObject(error.cause) ? error.cause : {};
    const causeName =
      typeof cause.name === "string"
        ? cause.name
        : typeof error.code === "number"
          ? `code ${error.code}`
          : "unknown";
    const detail =
      typeof error.message === "string"
        ? error.message
        : typeof error.data === "string"
          ? error.data
          : "unspecified";
    throw new LiveRpcError(`ERR_RPC_${causeName}`, detail);
  }
  if (!("result" in payload)) {
    throw new LiveRpcError("ERR_RPC_INVALID_RESPONSE", "result field missing");
  }
  return payload.result;
}

export function encodeViewArgs(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    throw new LiveRpcError(
      "ERR_VIEW_ARGS",
      "arguments are not JSON-serializable",
    );
  }
  return bytesToBase64(textEncoder.encode(json));
}

// Decodes a `query / call_function` result: an array of byte values holding
// the UTF-8 JSON of the contract's return value ("null" for Option::None).
export function decodeCallFunctionResult(payload: unknown): unknown {
  if (!isObject(payload) || !Array.isArray(payload.result)) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result payload missing",
    );
  }
  const bytes = payload.result;
  if (
    !bytes.every((byte) => typeof byte === "number" && byte >= 0 && byte <= 255)
  ) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result is not a byte array",
    );
  }
  const text = textDecoder.decode(Uint8Array.from(bytes));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "result is not valid JSON",
    );
  }
}

export async function callViewFunction(
  nodeUrl: string,
  accountId: string,
  methodName: string,
  args: unknown,
): Promise<unknown> {
  const payload = await rpcCall(nodeUrl, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: encodeViewArgs(args),
  });
  return decodeCallFunctionResult(payload);
}

export interface FinalBlockHeader {
  readonly height: string;
  readonly timestampNs: string;
  readonly hash: string;
}

// The RPC sends header.height and header.timestamp as JSON numbers; a u64
// nanosecond timestamp exceeds 2^53, so JSON.parse would silently round it.
// The digits are therefore read back from the raw response text so the
// displayed and derived values are the exact onchain numbers.
export async function fetchFinalBlockHeader(
  nodeUrl: string,
): Promise<FinalBlockHeader> {
  let response: Response;
  try {
    response = await fetch(nodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "commonsops-live",
        method: "block",
        params: { finality: "final" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new LiveRpcError(
      "ERR_RPC_UNREACHABLE",
      error instanceof Error ? error.message : "request failed",
    );
  }
  if (!response.ok) {
    throw new LiveRpcError(
      "ERR_RPC_HTTP_STATUS",
      await readErrorMessage(response),
    );
  }
  let raw: string;
  let payload: unknown;
  try {
    raw = await response.text();
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new LiveRpcError("ERR_RPC_INVALID_RESPONSE", "body is not JSON");
  }
  if (!isObject(payload) || !isObject(payload.result)) {
    throw new LiveRpcError("ERR_RPC_INVALID_RESPONSE", "block payload missing");
  }
  if (isObject(payload.error)) {
    throw new LiveRpcError(
      "ERR_RPC_BLOCK_QUERY",
      "block query returned an error",
    );
  }
  const header = isObject(payload.result.header) ? payload.result.header : null;
  const hash = header?.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "block header hash is missing",
    );
  }
  const heightDigits = /"height":\s*(\d+)/.exec(raw)?.[1];
  const timestampDigits = /"timestamp":\s*(\d+)/.exec(raw)?.[1];
  if (
    !heightDigits ||
    !timestampDigits ||
    !isCanonicalDecimal(heightDigits, 64) ||
    !isCanonicalDecimal(timestampDigits, 64)
  ) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "block header height or timestamp digits are missing or malformed",
    );
  }
  return Object.freeze({
    height: heightDigits,
    timestampNs: timestampDigits,
    hash,
  });
}

function invalidField(field: string): never {
  throw new LiveRpcError(
    "ERR_LIVE_REGISTRY_DATA",
    `unexpected ${field} in live registry response`,
  );
}

function canonicalField(
  record: Record<string, unknown>,
  field: string,
  bits: 64 | 128,
): string {
  const value = record[field];
  if (typeof value !== "string" || !isCanonicalDecimal(value, bits)) {
    return invalidField(field);
  }
  return value;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    return invalidField(field);
  }
  return value;
}

const CYCLE_STATUSES = new Set([
  "OPEN",
  "CLAIMED",
  "SUBMITTED",
  "EXPIRED",
  "CANCELLED",
]);

// Structural guard for a live get_template response. Throws a named error on
// any deviation instead of rendering invented defaults.
export function parseTemplate(value: unknown): Template {
  if (!isObject(value)) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "template is not an object",
    );
  }
  const input = isObject(value.input) ? value.input : null;
  if (!input) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "template input is missing",
    );
  }
  if (typeof value.active !== "boolean") {
    return invalidField("active");
  }
  if (typeof input.description !== "string") {
    return invalidField("input.description");
  }
  return Object.freeze({
    id: canonicalField(value, "id", 64),
    manager_id: stringField(value, "manager_id"),
    active: value.active,
    next_period_index: canonicalField(value, "next_period_index", 64),
    created_at_ns: canonicalField(value, "created_at_ns", 64),
    input: Object.freeze({
      dao_account_id: stringField(input, "dao_account_id"),
      title: stringField(input, "title"),
      description: input.description,
      start_at_ns: canonicalField(input, "start_at_ns", 64),
      interval_ns: canonicalField(input, "interval_ns", 64),
      work_window_ns: canonicalField(input, "work_window_ns", 64),
      claim_duration_ns: canonicalField(input, "claim_duration_ns", 64),
      amount_yocto: canonicalField(input, "amount_yocto", 128),
    }),
  } satisfies Template);
}

function parseOptionalClaim(value: unknown): Cycle["claim"] {
  if (value === null) return null;
  if (!isObject(value)) {
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "claim is not an object");
  }
  return Object.freeze({
    claimant_id: stringField(value, "claimant_id"),
    payout_recipient_id: stringField(value, "payout_recipient_id"),
    expires_at_ns: canonicalField(value, "expires_at_ns", 64),
  });
}

function parseOptionalEvidence(value: unknown): Cycle["evidence"] {
  if (value === null) return null;
  if (!isObject(value)) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "evidence is not an object",
    );
  }
  return Object.freeze({
    repository_owner: stringField(value, "repository_owner"),
    repository_name: stringField(value, "repository_name"),
    pull_request_number: canonicalField(value, "pull_request_number", 64),
    url: stringField(value, "url"),
    commit_sha: stringField(value, "commit_sha"),
    digest_sha256: stringField(value, "digest_sha256"),
  });
}

function parseOptionalProposalLink(value: unknown): Cycle["proposal_link"] {
  if (value === null) return null;
  if (!isObject(value) || !isObject(value.key)) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "proposal link is not an object",
    );
  }
  const key = value.key;
  const network = key.network;
  if (network !== "TESTNET" && network !== "MAINNET") {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "proposal link network is invalid",
    );
  }
  return Object.freeze({
    key: Object.freeze({
      network,
      dao_account_id: stringField(key, "dao_account_id"),
      proposal_id: canonicalField(key, "proposal_id", 64),
    }),
    linked_at_ns: canonicalField(value, "linked_at_ns", 64),
  });
}

export function parseCycle(value: unknown): Cycle | null {
  if (value === null) return null;
  if (!isObject(value)) {
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle is not an object");
  }
  const key = isObject(value.key) ? value.key : null;
  if (!key) {
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle key is missing");
  }
  const status = value.status;
  if (typeof status !== "string" || !CYCLE_STATUSES.has(status)) {
    throw new LiveRpcError("ERR_LIVE_REGISTRY_DATA", "cycle status is invalid");
  }
  return Object.freeze({
    key: Object.freeze({
      template_id: canonicalField(key, "template_id", 64),
      period_index: canonicalField(key, "period_index", 64),
    }),
    status: status as Cycle["status"],
    opens_at_ns: canonicalField(value, "opens_at_ns", 64),
    deadline_at_ns: canonicalField(value, "deadline_at_ns", 64),
    dao_account_id: stringField(value, "dao_account_id"),
    amount_yocto: canonicalField(value, "amount_yocto", 128),
    claim: parseOptionalClaim(value.claim ?? null),
    evidence: parseOptionalEvidence(value.evidence ?? null),
    submitted_at_ns:
      value.submitted_at_ns === null || value.submitted_at_ns === undefined
        ? null
        : canonicalField(value, "submitted_at_ns", 64),
    proposal_link: parseOptionalProposalLink(value.proposal_link ?? null),
  } satisfies Cycle);
}

export function parseFoundationStatus(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LiveRpcError(
      "ERR_LIVE_REGISTRY_DATA",
      "foundation_status is not a string",
    );
  }
  return value;
}
