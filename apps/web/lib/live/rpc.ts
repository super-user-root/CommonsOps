// Hardened NEAR JSON-RPC read client for the live registry surface.
// Parsing follows the same fail-closed patterns as packages/near/src
// (validate every field, name every error, never invent fallback data).
// This module performs read-only `query` calls; it never signs anything.

import type { Cycle, Template } from "@commonsops/domain";
import { isCanonicalDecimal } from "@commonsops/domain";
import { parseBoundedJson, BoundedJsonError } from "./bounded-json.ts";

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

// Official testnet-only read transport. A snapshot owns one context: deadline,
// cancellation, endpoint preference, HTTP pool and attempt budget are shared.
export const RPC_ENDPOINTS = Object.freeze([
  "https://rpc.testnet.near.org",
  "https://archival-rpc.testnet.near.org",
] as const);
export const RPC_LIMITS = Object.freeze({
  concurrency: 4,
  attemptsPerEndpoint: 2,
  maxAttempts: 96,
  timeoutMs: 6_000,
  deadlineMs: 40_000,
  backoffMs: 250,
  maxResponseBytes: 2_097_152,
  maxContractBytes: 65_536,
  maxJsonDepth: 64,
  maxJsonNodes: 300_000,
  maxJsonWork: 4_194_304,
});
type ReadLimits = { readonly [K in keyof typeof RPC_LIMITS]: number };
function parseJson(
  raw: string,
  limits: ReadLimits = RPC_LIMITS,
  lossless = false,
): unknown {
  try {
    return parseBoundedJson(raw, limits, lossless);
  } catch (error) {
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      error instanceof BoundedJsonError
        ? error.message
        : "Invalid bounded JSON.",
    );
  }
}

// Consume bounded bytes from the real stream, never unrestricted text().
// A chunk exceeding the budget is cancelled before it is retained/decoded.
async function readBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
  check: () => void,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    void response.body?.cancel().catch(() => {});
    throw rpcError(
      "ERR_RPC_RESPONSE_LIMIT",
      "RPC response byte limit exceeded.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw rpcError("ERR_RPC_INVALID_RESPONSE", "RPC response stream missing.");
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  let complete = false;
  try {
    while (true) {
      check();
      const chunk = await abortable(reader.read(), signal);
      check();
      if (chunk.done) {
        complete = true;
        break;
      }
      if (chunk.value.byteLength > limit - length)
        throw rpcError(
          "ERR_RPC_RESPONSE_LIMIT",
          "RPC response byte limit exceeded.",
        );
      length += chunk.value.byteLength;
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    check();
    return text;
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    try {
      reader.releaseLock();
    } catch {
      /* cancelled read may still settle */
    }
  }
}

const TRANSIENT_CODES = new Set([
  "ERR_RPC_UNREACHABLE",
  "ERR_RPC_TIMEOUT",
  "ERR_RPC_RATE_LIMITED",
  "ERR_RPC_SERVER",
  "ERR_RPC_TRANSIENT",
  "ERR_RPC_BLOCK_UNAVAILABLE",
]);
export function isTransientRpcCode(code: string): boolean {
  return TRANSIENT_CODES.has(code);
}
export function isInfrastructureError(error: unknown): boolean {
  return (
    error instanceof LiveRpcError &&
    error.code.startsWith("ERR_RPC_") &&
    error.code !== "ERR_RPC_CONTRACT"
  );
}

export interface RpcOptions {
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly now?: () => number; // Scoped monotonic clock injection for tests.
  readonly limits?: Partial<{
    readonly [K in keyof typeof RPC_LIMITS]: number;
  }>;
}

function rpcError(code: string, message: string): LiveRpcError {
  return new LiveRpcError(code, message);
}
function abortError(signal: AbortSignal): LiveRpcError {
  return signal.reason instanceof LiveRpcError
    ? signal.reason
    : rpcError("ERR_RPC_CANCELLED", "Live read cancelled.");
}
// Unlike relying on fetch's signal alone, this also settles non-cooperative
// mocks/body readers. Rejections of the underlying operation remain observed.
export function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError(signal));
    };
    if (signal.aborted) {
      operation.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class RpcContext {
  readonly signal: AbortSignal;
  readonly limits: ReadLimits;
  private readonly now: () => number;
  private readonly deadline: number;
  private readonly validatedEndpoints = new Set<string>();
  endpoints(): readonly string[] {
    return Object.freeze([...this.validatedEndpoints]);
  }
  private readonly controller = new AbortController();
  private readonly fetcher: typeof fetch;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly detach: () => void;
  private active = 0;
  private attempts = 0;
  private readonly queue: Array<() => void> = [];
  private preferred: string | null = null;

  constructor(options: RpcOptions = {}) {
    const limits = { ...RPC_LIMITS, ...options.limits };
    for (const key of Object.keys(limits) as Array<keyof typeof limits>) {
      const value = limits[key];
      if (
        !Number.isInteger(value) ||
        value < (key === "backoffMs" ? 0 : 1) ||
        value > RPC_LIMITS[key]
      ) {
        throw rpcError(
          "ERR_RPC_CONFIG",
          "Read limits must be finite and no larger than production bounds.",
        );
      }
    }
    this.limits = Object.freeze(limits);
    this.now = options.now ?? (() => performance.now());
    this.deadline = this.now() + limits.deadlineMs;
    this.signal = this.controller.signal;
    this.fetcher = options.fetch ?? globalThis.fetch;
    const abort = () => this.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.detach = () => options.signal?.removeEventListener("abort", abort);
    this.timer = setTimeout(
      () =>
        this.controller.abort(
          rpcError(
            "ERR_RPC_DEADLINE",
            "Live read exceeded its overall deadline.",
          ),
        ),
      limits.deadlineMs,
    );
    if (options.signal?.aborted) this.cancel();
  }
  cancel(): void {
    this.controller.abort(
      rpcError("ERR_RPC_CANCELLED", "Live read cancelled."),
    );
  }
  dispose(): void {
    clearTimeout(this.timer);
    this.detach();
    this.cancel();
  }
  check(): void {
    if (this.now() >= this.deadline && !this.signal.aborted)
      this.controller.abort(
        rpcError(
          "ERR_RPC_DEADLINE",
          "Live read exceeded its overall deadline.",
        ),
      );
    if (this.signal.aborted) throw abortError(this.signal);
  }
  private async acquire(): Promise<void> {
    this.check();
    if (this.active < this.limits.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        this.signal.removeEventListener("abort", abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        const index = this.queue.indexOf(grant);
        if (index >= 0) this.queue.splice(index, 1);
        reject(abortError(this.signal));
      };
      this.queue.push(grant);
      this.signal.addEventListener("abort", abort, { once: true });
    });
  }
  private release(): void {
    this.active--;
    if (!this.signal.aborted) this.queue.shift()?.();
  }

  async call<T>(
    primary: string,
    method: string,
    params: unknown,
    validate: (result: unknown, raw: string) => T,
  ): Promise<T> {
    if (!RPC_ENDPOINTS.some((endpoint) => endpoint === primary)) {
      throw rpcError(
        "ERR_RPC_ENDPOINT",
        "Only official NEAR testnet RPC endpoints are allowed.",
      );
    }
    if (method !== "block" && method !== "query") {
      throw rpcError(
        "ERR_RPC_METHOD",
        "Only read-only block and query methods are allowed.",
      );
    }
    const endpoints = [
      ...new Set([this.preferred ?? primary, primary, ...RPC_ENDPOINTS]),
    ];
    let last: unknown = rpcError(
      "ERR_RPC_UNREACHABLE",
      "Official testnet endpoints unavailable.",
    );
    for (const endpoint of endpoints) {
      for (
        let attempt = 0;
        attempt < this.limits.attemptsPerEndpoint;
        attempt++
      ) {
        try {
          await this.acquire();
          try {
            this.check();
            if (this.attempts >= this.limits.maxAttempts) {
              this.controller.abort(
                rpcError(
                  "ERR_RPC_BUDGET",
                  "Live read exhausted its request budget.",
                ),
              );
              this.check();
            }
            this.attempts++;
            const attemptController = new AbortController();
            const attemptDeadline = this.now() + this.limits.timeoutMs;
            const checkAttempt = () => {
              this.check();
              if (
                this.now() >= attemptDeadline &&
                !attemptController.signal.aborted
              )
                attemptController.abort(
                  rpcError(
                    "ERR_RPC_TIMEOUT",
                    "RPC fetch, body or validation timed out.",
                  ),
                );
              if (attemptController.signal.aborted)
                throw abortError(attemptController.signal);
            };
            const abort = () =>
              attemptController.abort(abortError(this.signal));
            this.signal.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(
              () =>
                attemptController.abort(
                  rpcError(
                    "ERR_RPC_TIMEOUT",
                    "RPC fetch or response body timed out.",
                  ),
                ),
              this.limits.timeoutMs,
            );
            try {
              let response: Response;
              let raw: string;
              try {
                response = await abortable(
                  Promise.resolve().then(() =>
                    this.fetcher(endpoint, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: "commonsops-live",
                        method,
                        params,
                      }),
                      signal: attemptController.signal,
                    }),
                  ),
                  attemptController.signal,
                );
                checkAttempt();
                if (!response.ok) {
                  void response.body?.cancel().catch(() => {});
                  if (response.status === 429)
                    throw rpcError(
                      "ERR_RPC_RATE_LIMITED",
                      "RPC rate limited the read.",
                    );
                  if (response.status >= 500 && response.status <= 599)
                    throw rpcError(
                      "ERR_RPC_SERVER",
                      "RPC server temporarily unavailable.",
                    );
                  throw rpcError(
                    "ERR_RPC_HTTP_STATUS",
                    "RPC refused the read request.",
                  );
                }
                raw = await readBody(
                  response,
                  this.limits.maxResponseBytes,
                  attemptController.signal,
                  checkAttempt,
                );
                checkAttempt();
              } catch (error) {
                if (attemptController.signal.aborted)
                  throw abortError(attemptController.signal);
                if (error instanceof LiveRpcError) throw error;
                throw rpcError(
                  "ERR_RPC_UNREACHABLE",
                  "RPC transport or response body failed.",
                );
              }
              const result = parseEnvelope(raw, this.limits);
              checkAttempt();
              const validated = validate(result, raw);
              checkAttempt();
              this.validatedEndpoints.add(endpoint);
              this.preferred = endpoint; // Only a schema/metadata-valid answer wins.
              return validated;
            } finally {
              clearTimeout(timer);
              this.signal.removeEventListener("abort", abort);
              attemptController.abort();
            }
          } finally {
            this.release();
          }
        } catch (error) {
          this.check();
          if (
            !(error instanceof LiveRpcError) ||
            !isTransientRpcCode(error.code)
          )
            throw error;
          last = error;
          if (attempt + 1 < this.limits.attemptsPerEndpoint)
            await wait(this.limits.backoffMs, this.signal);
        }
      }
    }
    throw last;
  }
}

function parseEnvelope(raw: string, limits: ReadLimits = RPC_LIMITS): unknown {
  const payload = parseJson(raw, limits);
  if (!isObject(payload))
    throw rpcError("ERR_RPC_INVALID_RESPONSE", "RPC envelope is missing.");
  if ("result" in payload && "error" in payload)
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "Ambiguous RPC result/error envelope.",
    );
  if (isObject(payload.error)) {
    const error = payload.error;
    const cause = isObject(error.cause) ? error.cause : {};
    const name = typeof cause.name === "string" ? cause.name : error.name;
    if (name === "UNKNOWN_BLOCK")
      throw rpcError(
        "ERR_RPC_BLOCK_UNAVAILABLE",
        "Pinned block unavailable on this endpoint.",
      );
    if (
      [
        "INTERNAL_ERROR",
        "TIMEOUT_ERROR",
        "NOT_SYNCED_YET",
        "NO_SYNCED_BLOCKS",
        "TOO_MANY_REQUESTS",
      ].includes(String(name)) ||
      error.code === -32603
    ) {
      throw rpcError(
        "ERR_RPC_TRANSIENT",
        "RPC temporarily cannot serve the read.",
      );
    }
    if (name === "CONTRACT_EXECUTION_ERROR")
      throw rpcError("ERR_RPC_CONTRACT", "Contract view execution failed.");
    if (name === "PARSE_ERROR")
      throw rpcError(
        "ERR_RPC_PARSE_ERROR",
        "RPC rejected malformed arguments.",
      );
    throw rpcError(
      "ERR_RPC_REQUEST",
      "RPC rejected the view method, account or arguments.",
    );
  }
  if (!("result" in payload))
    throw rpcError("ERR_RPC_INVALID_RESPONSE", "RPC result field missing.");
  return payload.result;
}

export async function rpcCall(
  nodeUrl: string,
  method: string,
  params: unknown,
  context?: RpcContext,
): Promise<unknown> {
  const owned = context ?? new RpcContext();
  try {
    return await owned.call(nodeUrl, method, params, (result) => result);
  } finally {
    if (!context) owned.dispose();
  }
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
export function decodeCallFunctionResult(
  payload: unknown,
  limits: ReadLimits = RPC_LIMITS,
): unknown {
  if (!isObject(payload) || !Array.isArray(payload.result)) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result payload missing",
    );
  }
  const bytes = payload.result;
  if (bytes.length > limits.maxContractBytes)
    throw rpcError(
      "ERR_RPC_RESPONSE_LIMIT",
      "Contract result byte limit exceeded.",
    );
  if (
    !bytes.every(
      (byte) =>
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  ) {
    throw new LiveRpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result is not a byte array",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "Contract result is not valid UTF-8.",
    );
  }
  return parseJson(text, limits);
}

export async function callViewFunction(
  nodeUrl: string,
  accountId: string,
  methodName: string,
  args: unknown,
  block: FinalBlockHeader,
  context: RpcContext,
): Promise<unknown> {
  return context.call(
    nodeUrl,
    "query",
    {
      request_type: "call_function",
      block_id: block.hash,
      account_id: accountId,
      method_name: methodName,
      args_base64: encodeViewArgs(args),
    },
    (payload, raw) => {
      const lossless = parseJson(raw, context.limits, true);
      const result =
        isObject(lossless) && isObject(lossless.result)
          ? lossless.result
          : null;
      if (
        !result ||
        result.block_hash !== block.hash ||
        result.block_height !== block.height
      ) {
        throw rpcError(
          "ERR_RPC_BLOCK_MISMATCH",
          "View response does not match the selected finalized block.",
        );
      }
      return decodeCallFunctionResult(payload, context.limits);
    },
  );
}

export interface FinalBlockHeader {
  readonly height: string;
  readonly timestampNs: string;
  readonly hash: string;
}

export function parseFinalBlockHeader(
  raw: string,
  limits: ReadLimits = RPC_LIMITS,
): FinalBlockHeader {
  parseEnvelope(raw, limits);
  const payload = parseJson(raw, limits, true);
  const header =
    isObject(payload) &&
    isObject(payload.result) &&
    isObject(payload.result.header)
      ? payload.result.header
      : null;
  if (
    !header ||
    typeof header.hash !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(header.hash) ||
    typeof header.height !== "string" ||
    !isCanonicalDecimal(header.height, 64) ||
    typeof header.timestamp !== "string" ||
    !isCanonicalDecimal(header.timestamp, 64)
  ) {
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "Final block header identity or exact U64 fields are invalid.",
    );
  }
  return Object.freeze({
    height: header.height,
    timestampNs: header.timestamp,
    hash: header.hash,
  });
}

export async function fetchFinalBlockHeader(
  nodeUrl: string,
  context?: RpcContext,
): Promise<FinalBlockHeader> {
  const owned = context ?? new RpcContext();
  try {
    return await owned.call(
      nodeUrl,
      "block",
      { finality: "final" },
      (_result, raw) => parseFinalBlockHeader(raw, owned.limits),
    );
  } finally {
    if (!context) owned.dispose();
  }
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
