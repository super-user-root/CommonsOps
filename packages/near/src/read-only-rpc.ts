// Platform-neutral, bounded NEAR testnet read transport shared by browser and
// CLI. No wallet, Node built-ins, domain models or signing/broadcast methods.
import { parseBoundedJson, BoundedJsonError } from "./bounded-json.ts";

export class LiveRpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LiveRpcError";
    this.code = code;
  }
}
function rpcError(code: string, message: string): LiveRpcError {
  return new LiveRpcError(code, message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
function isU64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value) &&
    value.length <= 20 &&
    BigInt(value) <= (1n << 64n) - 1n
  );
}

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
export type ReadLimits = { readonly [K in keyof typeof RPC_LIMITS]: number };
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

// Consume the real stream; never unrestricted text()/json(). A chunk exceeding
// the budget is cancelled before retention/full decode. Invalid UTF-8 is a
// deterministic parse failure, not an invitation to try another provider.
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
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw rpcError(
        "ERR_RPC_INVALID_RESPONSE",
        "RPC response is not valid UTF-8.",
      );
    }
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
  "ERR_RPC_TRANSACTION_UNAVAILABLE",
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
  readonly now?: () => number;
  readonly limits?: Partial<ReadLimits>;
}
export interface RpcAttempt {
  readonly endpoint: string;
  readonly method: string;
  readonly elapsedMs: number;
  readonly httpStatus: number | null;
  readonly outcome: "VALIDATED" | "FAILED";
  readonly code: string | null;
}
export interface RpcRunProvenance {
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly attemptedEndpoints: readonly string[];
  readonly validatedEndpoints: readonly string[];
  readonly attempts: readonly RpcAttempt[];
}
function abortError(signal: AbortSignal): LiveRpcError {
  return signal.reason instanceof LiveRpcError
    ? signal.reason
    : rpcError("ERR_RPC_CANCELLED", "Live read cancelled.");
}
// Also settles non-cooperative mocks/readers; underlying rejections remain observed.
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

type ResponseGuard = (result: unknown, raw: string) => void;
export class RpcContext {
  readonly signal: AbortSignal;
  readonly limits: ReadLimits;
  private readonly now: () => number;
  private readonly started: number;
  private readonly startedAt = new Date().toISOString();
  private readonly deadline: number;
  private readonly validatedEndpoints = new Set<string>();
  private readonly observations: RpcAttempt[] = [];
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
      )
        throw rpcError(
          "ERR_RPC_CONFIG",
          "Read limits must be finite and no larger than production bounds.",
        );
    }
    this.limits = Object.freeze(limits);
    this.now = options.now ?? (() => performance.now());
    this.started = this.now();
    this.deadline = this.started + limits.deadlineMs;
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
  endpoints(): readonly string[] {
    return Object.freeze([...this.validatedEndpoints]);
  }
  provenance(): RpcRunProvenance {
    return Object.freeze({
      startedAt: this.startedAt,
      elapsedMs: Math.max(0, Math.round(this.now() - this.started)),
      attemptedEndpoints: Object.freeze([
        ...new Set(this.observations.map((attempt) => attempt.endpoint)),
      ]),
      validatedEndpoints: this.endpoints(),
      attempts: Object.freeze([...this.observations]),
    });
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
  protected historical(): boolean {
    return false;
  }
  protected guard(method: string, _params: unknown): ResponseGuard {
    if (method !== "block" && method !== "query")
      throw rpcError(
        "ERR_RPC_METHOD",
        "Only read-only block and query methods are allowed.",
      );
    return () => {};
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

  // Validators are synchronous so all parsing/validation stays inside both
  // absolute deadlines. The original wire text is available for lossless
  // metadata checks or an envelope-preserving adapter (numbers stay numbers).
  async call<T>(
    primary: string,
    method: string,
    params: unknown,
    validate: (result: unknown, raw: string) => T,
  ): Promise<T> {
    if (!RPC_ENDPOINTS.some((endpoint) => endpoint === primary))
      throw rpcError(
        "ERR_RPC_ENDPOINT",
        "Only official NEAR testnet RPC endpoints are allowed.",
      );
    const guard = this.guard(method, params);
    // Capture once, before any await: retries cannot change tx/block identity.
    const requestBody = JSON.stringify({
      jsonrpc: "2.0",
      id: "commonsops-live",
      method,
      params,
    });
    const historicalTx =
      this.historical() && method === "EXPERIMENTAL_tx_status";
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
            const started = this.now();
            let httpStatus: number | null = null;
            let outcome: RpcAttempt["outcome"] = "FAILED";
            let code: string | null = null;
            const attemptController = new AbortController();
            const attemptDeadline = started + this.limits.timeoutMs;
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
                      body: requestBody,
                      signal: attemptController.signal,
                      redirect: "error",
                    }),
                  ),
                  attemptController.signal,
                );
                httpStatus = response.status;
                checkAttempt();
                if (!response.ok) {
                  void response.body?.cancel().catch(() => {});
                  if (response.status === 408 && this.historical())
                    throw rpcError(
                      "ERR_RPC_TIMEOUT",
                      "RPC HTTP 408: historical read timed out.",
                    );
                  if (response.status === 429)
                    throw rpcError(
                      "ERR_RPC_RATE_LIMITED",
                      "RPC HTTP 429: read rate limited.",
                    );
                  if (response.status >= 500 && response.status <= 599)
                    throw rpcError(
                      "ERR_RPC_SERVER",
                      `RPC HTTP ${response.status}: server temporarily unavailable.`,
                    );
                  throw rpcError(
                    "ERR_RPC_HTTP_STATUS",
                    `RPC HTTP ${response.status}: read request refused.`,
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
              const result = parseRpcEnvelope(
                raw,
                this.limits,
                historicalTx,
              ).result;
              checkAttempt();
              guard(result, raw);
              checkAttempt();
              const validated = validate(result, raw);
              checkAttempt();
              this.validatedEndpoints.add(endpoint);
              this.preferred = endpoint;
              outcome = "VALIDATED";
              return validated;
            } catch (error) {
              code =
                error instanceof LiveRpcError
                  ? error.code
                  : "ERR_RPC_VALIDATION";
              throw error;
            } finally {
              this.observations.push(
                Object.freeze({
                  endpoint,
                  method,
                  elapsedMs: Math.max(0, Math.round(this.now() - started)),
                  httpStatus,
                  outcome,
                  code,
                }),
              );
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

// Returns the ORIGINAL envelope structure (not a reconstructed {result} and
// not the lossless-string representation). Reconciliation expects JSON numbers
// in protocol fields; only block metadata needs a separate lossless parse.
export function parseRpcEnvelope(
  raw: string,
  limits: ReadLimits = RPC_LIMITS,
  historicalTx = false,
): Record<string, unknown> {
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
    if (
      historicalTx &&
      [
        "NOT_OBSERVED",
        "UNKNOWN_TRANSACTION",
        "TRANSACTION_UNAVAILABLE",
      ].includes(String(name))
    )
      throw rpcError(
        "ERR_RPC_TRANSACTION_UNAVAILABLE",
        "Historical transaction unavailable on this endpoint.",
      );
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
      (name === undefined && error.code === -32603)
    )
      throw rpcError(
        "ERR_RPC_TRANSIENT",
        "RPC temporarily cannot serve the read.",
      );
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
  if ("jsonrpc" in payload && payload.jsonrpc !== "2.0")
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "RPC JSON-RPC version mismatch.",
    );
  if (
    historicalTx &&
    isObject(payload.result) &&
    payload.result.final_execution_status === "NOT_OBSERVED"
  )
    throw rpcError(
      "ERR_RPC_TRANSACTION_UNAVAILABLE",
      "Historical transaction not observed on this endpoint.",
    );
  return payload;
}

export interface RpcBlockIdentity {
  readonly hash: string;
  readonly height: string;
}
export interface FinalBlockHeader extends RpcBlockIdentity {
  readonly timestampNs: string;
}
export function validateQueryBlock(
  raw: string,
  block: RpcBlockIdentity,
  limits: ReadLimits = RPC_LIMITS,
): void {
  const lossless = parseJson(raw, limits, true);
  const result =
    isObject(lossless) && isObject(lossless.result) ? lossless.result : null;
  if (
    !HASH.test(block.hash) ||
    !isU64(block.height) ||
    !result ||
    result.block_hash !== block.hash ||
    result.block_height !== block.height
  )
    throw rpcError(
      "ERR_RPC_BLOCK_MISMATCH",
      "View response does not match the selected finalized block.",
    );
}

// This explicit capability is separate from the browser's RpcContext. It
// authorizes a fixed, nonempty set of exact tx/account/block/method/args reads,
// never a general RPC method override. All queries require a pinned identity.
export interface HistoricalRead {
  readonly method: "EXPERIMENTAL_tx_status" | "query";
  readonly params: Readonly<Record<string, string>>;
  readonly block?: RpcBlockIdentity;
}
export interface HistoricalRpcOptions extends RpcOptions {
  readonly reads: readonly HistoricalRead[];
}
function readKey(method: string, params: unknown): string | null {
  if (
    !isObject(params) ||
    Object.values(params).some((value) => typeof value !== "string")
  )
    return null;
  return JSON.stringify([
    method,
    Object.keys(params)
      .sort()
      .map((key) => [key, params[key]]),
  ]);
}
function historicalReads(
  reads: readonly HistoricalRead[],
): readonly HistoricalRead[] {
  const fail = (): never => {
    throw rpcError(
      "ERR_RPC_CONFIG",
      "Historical reads require a bounded nonempty exact read scope.",
    );
  };
  if (
    !Array.isArray(reads) ||
    reads.length === 0 ||
    reads.length > RPC_LIMITS.maxAttempts
  )
    fail();
  return Object.freeze(
    reads.map((read) => {
      if (!isObject(read) || !readKey(read.method, read.params)) fail();
      const params = read.params;
      let keys: string[];
      if (read.method === "EXPERIMENTAL_tx_status") {
        keys = [
          "tx_hash",
          "sender_account_id",
          ...(params.wait_until === undefined ? [] : ["wait_until"]),
        ];
        if (
          !HASH.test(params.tx_hash ?? "") ||
          (params.wait_until !== undefined && params.wait_until !== "FINAL") ||
          read.block !== undefined
        )
          fail();
      } else if (read.method === "query") {
        keys = ["request_type", "account_id", "block_id"];
        if (params.request_type === "call_function") {
          keys.push("method_name", "args_base64");
          if (
            !params.method_name ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              params.args_base64 ?? "",
            )
          )
            fail();
        } else if (
          params.request_type !== "view_account" &&
          params.request_type !== "view_code"
        )
          fail();
        if (
          !read.block ||
          !HASH.test(read.block.hash) ||
          !isU64(read.block.height) ||
          params.block_id !== read.block.hash
        )
          fail();
      } else return fail();
      const account =
        read.method === "query" ? params.account_id : params.sender_account_id;
      if (
        typeof account !== "string" ||
        !/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(account)
      )
        fail();
      if (
        Object.keys(params).length !== keys.length ||
        keys.some((key) => !(key in params))
      )
        fail();
      return Object.freeze({
        method: read.method,
        params: Object.freeze({ ...params }),
        ...(read.block ? { block: Object.freeze({ ...read.block }) } : {}),
      });
    }),
  );
}
export class HistoricalRpcContext extends RpcContext {
  private readonly reads: readonly HistoricalRead[];
  constructor(options: HistoricalRpcOptions) {
    const reads = historicalReads(options.reads);
    super(options);
    this.reads = reads;
  }
  protected override historical(): boolean {
    return true;
  }
  protected override guard(method: string, params: unknown): ResponseGuard {
    if (method !== "query" && method !== "EXPERIMENTAL_tx_status")
      throw rpcError(
        "ERR_RPC_METHOD",
        "Historical capability permits only scoped read queries and EXPERIMENTAL_tx_status.",
      );
    const key = readKey(method, params);
    const read = this.reads.find(
      (entry) => readKey(entry.method, entry.params) === key,
    );
    if (!key || !read)
      throw rpcError(
        "ERR_RPC_SCOPE",
        "RPC request is outside the historical run's exact read scope.",
      );
    return (result, raw) => {
      if (read.block) {
        validateQueryBlock(raw, read.block, this.limits);
        return;
      }
      if (
        !isObject(result) ||
        !isObject(result.transaction) ||
        result.transaction.hash !== read.params.tx_hash ||
        result.transaction.signer_id !== read.params.sender_account_id
      )
        throw rpcError(
          "ERR_RPC_TRANSACTION_MISMATCH",
          "Historical transaction identity does not match the requested hash and signer.",
        );
      if (result.final_execution_status !== "FINAL")
        throw rpcError(
          "ERR_RPC_NOT_FINAL",
          "Historical transaction is not final.",
        );
    };
  }
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
    throw rpcError("ERR_VIEW_ARGS", "arguments are not JSON-serializable");
  }
  let binary = "";
  for (const byte of new TextEncoder().encode(json))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeCallFunctionResult(
  payload: unknown,
  limits: ReadLimits = RPC_LIMITS,
): unknown {
  if (!isObject(payload) || !Array.isArray(payload.result))
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result payload missing",
    );
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
  )
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "call_function result is not a byte array",
    );
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
      validateQueryBlock(raw, block, context.limits);
      return decodeCallFunctionResult(payload, context.limits);
    },
  );
}
export function parseFinalBlockHeader(
  raw: string,
  limits: ReadLimits = RPC_LIMITS,
): FinalBlockHeader {
  parseRpcEnvelope(raw, limits);
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
    !HASH.test(header.hash) ||
    !isU64(header.height) ||
    !isU64(header.timestamp)
  )
    throw rpcError(
      "ERR_RPC_INVALID_RESPONSE",
      "Final block header identity or exact U64 fields are invalid.",
    );
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
