import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HistoricalRpcContext,
  LiveRpcError,
  RPC_ENDPOINTS,
  RPC_LIMITS,
  RpcContext,
  decodeCallFunctionResult,
  parseRpcEnvelope,
  rpcCall,
  validateQueryBlock,
  type HistoricalRead,
  type RpcOptions,
} from "./read-only-rpc.ts";
import {
  createReconciliationStore,
  reconcilePayment,
} from "./reconciliation.ts";

const TX = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
const ACCOUNT = "commonsops.testnet";
const HASH = "5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6";
const block = { hash: HASH, height: "276385914" };
const txRead: HistoricalRead = {
  method: "EXPERIMENTAL_tx_status",
  params: { tx_hash: TX, sender_account_id: ACCOUNT },
};
const queryRead: HistoricalRead = {
  method: "query",
  params: { request_type: "view_account", account_id: ACCOUNT, block_id: HASH },
  block,
};
const fixtureUrl = new URL(
  "../../../tests/fixtures/sputnik/dao-proposal-0-231-paid.json",
  import.meta.url,
);
const code = (expected: string) => (error: unknown) =>
  error instanceof LiveRpcError && error.code === expected;
const txResult = () => ({
  final_execution_status: "FINAL",
  transaction: { hash: TX, signer_id: ACCOUNT },
});
const envelope = (result: unknown) =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id: "original-response-id", result }),
  );
function context(
  fetcher: typeof fetch,
  reads: readonly HistoricalRead[] = [txRead],
  limits: RpcOptions["limits"] = {},
) {
  return new HistoricalRpcContext({
    reads,
    fetch: fetcher,
    limits: { backoffMs: 0, ...limits },
  });
}

test("historical capability refuses empty/invalid scopes, nonofficial endpoints, mutation methods and unpinned reads before HTTP", async () => {
  for (const reads of [
    [],
    [{ ...txRead, method: "broadcast_tx_commit" }],
    [{ ...queryRead, block: undefined }],
    [
      {
        ...txRead,
        params: { ...txRead.params, sender_account_id: "alice.near" },
      },
    ],
    [{ ...txRead, params: { ...txRead.params, wait_until: "EXECUTED" } }],
  ])
    assert.throws(
      () => new HistoricalRpcContext({ reads: reads as HistoricalRead[] }),
      code("ERR_RPC_CONFIG"),
    );
  let calls = 0;
  const shared = context(async () => {
    calls++;
    return envelope(txResult());
  });
  const browser = new RpcContext({
    fetch: async () => {
      calls++;
      return envelope(null);
    },
  });
  try {
    for (const method of [
      "EXPERIMENTAL_tx_status",
      "broadcast_tx_commit",
      "broadcast_tx_async",
      "send_tx",
      "sign_transaction",
      "tx",
    ])
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], method, txRead.params, browser),
        code("ERR_RPC_METHOD"),
      );
    for (const method of [
      "broadcast_tx_commit",
      "broadcast_tx_async",
      "send_tx",
      "sign_transaction",
      "block",
      "tx",
    ])
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], method, txRead.params, shared),
        code("ERR_RPC_METHOD"),
      );
    for (const endpoint of [
      "",
      "https://rpc.mainnet.near.org",
      "https://rpc.testnet.near.org.evil.invalid",
      `${RPC_ENDPOINTS[0]}/redirect`,
    ])
      await assert.rejects(
        rpcCall(endpoint, txRead.method, txRead.params, shared),
        code("ERR_RPC_ENDPOINT"),
      );
    await assert.rejects(
      rpcCall(
        RPC_ENDPOINTS[0],
        txRead.method,
        { ...txRead.params, tx_hash: HASH },
        shared,
      ),
      code("ERR_RPC_SCOPE"),
    );
    await assert.rejects(
      rpcCall(
        RPC_ENDPOINTS[0],
        "query",
        {
          request_type: "view_account",
          account_id: ACCOUNT,
          finality: "final",
        },
        shared,
      ),
      code("ERR_RPC_SCOPE"),
    );
    assert.equal(calls, 0);
  } finally {
    shared.dispose();
    browser.dispose();
  }
});

test("HTTP 408 primary to archival keeps exact tx then pinned block, with scoped provenance and no response-body disclosure", async () => {
  const requests: Array<{ endpoint: string; method: string; params: unknown }> =
    [];
  const shared = context(
    async (input, init) => {
      const endpoint = String(input);
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: unknown;
      };
      requests.push({ endpoint, ...request });
      assert.equal(init?.redirect, "error");
      if (endpoint === RPC_ENDPOINTS[0])
        return new Response("upstream private body", { status: 408 });
      return envelope(
        request.method === "query"
          ? { block_hash: HASH, block_height: Number(block.height) }
          : txResult(),
      );
    },
    [txRead, queryRead],
    { maxAttempts: 8 },
  );
  try {
    await rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared);
    await rpcCall(RPC_ENDPOINTS[0], queryRead.method, queryRead.params, shared);
    assert.deepEqual(
      requests.map((request) => request.endpoint),
      [RPC_ENDPOINTS[0], RPC_ENDPOINTS[0], RPC_ENDPOINTS[1], RPC_ENDPOINTS[1]],
    );
    assert.ok(
      requests
        .slice(0, 3)
        .every(
          (request) =>
            JSON.stringify(request.params) === JSON.stringify(txRead.params),
        ),
    );
    assert.deepEqual(requests[3]?.params, queryRead.params);
    const provenance = shared.provenance();
    assert.deepEqual(provenance.attemptedEndpoints, RPC_ENDPOINTS);
    assert.deepEqual(provenance.validatedEndpoints, [RPC_ENDPOINTS[1]]);
    assert.deepEqual(
      provenance.attempts.map((attempt) => attempt.httpStatus),
      [408, 408, 200, 200],
    );
    assert.equal(provenance.attempts[0]?.code, "ERR_RPC_TIMEOUT");
    assert.ok(provenance.elapsedMs >= 0);
    assert.doesNotMatch(JSON.stringify(provenance), /private body/);
  } finally {
    shared.dispose();
  }
});

test("only historical lookups retry explicit transaction unavailable/not-observed RPC200 and HTTP408", async () => {
  const bodies = [
    ...["NOT_OBSERVED", "UNKNOWN_TRANSACTION", "TRANSACTION_UNAVAILABLE"].map(
      (name) => JSON.stringify({ error: { cause: { name } } }),
    ),
    JSON.stringify({ result: { final_execution_status: "NOT_OBSERVED" } }),
    JSON.stringify({ error: { name: "UNKNOWN_TRANSACTION" } }),
    JSON.stringify({ error: { code: -32603 } }),
  ];
  for (const body of bodies) {
    let calls = 0;
    const shared = context(async (url) => {
      calls++;
      return String(url) === RPC_ENDPOINTS[0]
        ? new Response(body)
        : envelope(txResult());
    });
    try {
      await rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared);
      assert.equal(calls, 3);
    } finally {
      shared.dispose();
    }
  }
  for (const status of [200, 408]) {
    let calls = 0;
    const browser = new RpcContext({
      fetch: async () => {
        calls++;
        return new Response(bodies[0], { status });
      },
      limits: { backoffMs: 0 },
    });
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], "query", {}, browser),
        code(status === 408 ? "ERR_RPC_HTTP_STATUS" : "ERR_RPC_REQUEST"),
      );
      assert.equal(calls, 1);
    } finally {
      browser.dispose();
    }
  }
  const query = context(async () => new Response(bodies[0]), [queryRead]);
  try {
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], "query", queryRead.params, query),
      code("ERR_RPC_REQUEST"),
    );
    assert.equal(query.provenance().attempts.length, 1);
  } finally {
    query.dispose();
  }
});

test("HTTP403, malformed/duplicate/invalid UTF8, wrong provenance and nonfinal responses never retry", async () => {
  const responses = [
    () =>
      new Response(
        new ReadableStream({ pull: () => new Promise<void>(() => {}) }),
        { status: 403 },
      ),
    () => new Response("not JSON"),
    () => new Response('{"result":null,"re\\u0073ult":{}}'),
    () => new Response(new Uint8Array([0xff])),
    () =>
      envelope({
        ...txResult(),
        transaction: { hash: HASH, signer_id: ACCOUNT },
      }),
    () =>
      envelope({
        ...txResult(),
        transaction: { hash: TX, signer_id: "other.testnet" },
      }),
    () => envelope({ ...txResult(), final_execution_status: "EXECUTED" }),
    () => envelope(null),
    ...["CONTRACT_EXECUTION_ERROR", "PARSE_ERROR", "METHOD_NOT_FOUND"].map(
      (name) => () =>
        new Response(
          JSON.stringify({ error: { code: -32603, cause: { name } } }),
        ),
    ),
    () =>
      new Response(
        JSON.stringify({
          error: { cause: { name: "CONTRACT_EXECUTION_ERROR" } },
        }),
      ),
  ];
  for (const response of responses) {
    let calls = 0;
    const shared = context(async () => {
      calls++;
      return response();
    });
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared),
      );
      assert.equal(calls, 1);
      assert.deepEqual(shared.endpoints(), []);
    } finally {
      shared.dispose();
    }
  }
  const shared = context(
    async () =>
      envelope({ block_hash: HASH, block_height: Number(block.height) + 1 }),
    [queryRead],
  );
  try {
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], "query", queryRead.params, shared),
      code("ERR_RPC_BLOCK_MISMATCH"),
    );
    assert.equal(shared.provenance().attempts.length, 1);
    assert.deepEqual(shared.endpoints(), []);
  } finally {
    shared.dispose();
  }
});

test("all endpoints unavailable and empty envelopes end finitely; per-run attempts and deadlines remain bounded", async () => {
  for (const kind of ["408", "unobserved", "empty", "hanging"]) {
    const shared = context(
      async () => {
        if (kind === "hanging")
          return new Response(
            new ReadableStream({ pull: () => new Promise<void>(() => {}) }),
          );
        if (kind === "408") return new Response("unavailable", { status: 408 });
        return new Response(
          kind === "empty" ? "" : '{"error":{"cause":{"name":"NOT_OBSERVED"}}}',
        );
      },
      [txRead],
      { timeoutMs: 15, deadlineMs: 500, maxAttempts: 4 },
    );
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared),
      );
      assert.equal(
        shared.provenance().attempts.length,
        kind === "empty" ? 1 : 4,
      );
      assert.deepEqual(shared.endpoints(), []);
    } finally {
      shared.dispose();
    }
  }
  for (const maxAttempts of [1, 3]) {
    const shared = context(
      async () => new Response("unavailable", { status: 408 }),
      [txRead],
      { maxAttempts },
    );
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared),
        code("ERR_RPC_BUDGET"),
      );
      assert.equal(shared.provenance().attempts.length, maxAttempts);
    } finally {
      shared.dispose();
    }
  }
});

test("deadline/abort are checked after validation and before return; late results never gain provenance", async () => {
  let now = 0;
  const shared = new HistoricalRpcContext({
    reads: [txRead],
    fetch: async () => envelope(txResult()),
    now: () => now,
    limits: { deadlineMs: 10, timeoutMs: 10, backoffMs: 0 },
  });
  try {
    await assert.rejects(
      shared.call(RPC_ENDPOINTS[0], txRead.method, txRead.params, () => {
        now = 11;
        return "late";
      }),
      code("ERR_RPC_DEADLINE"),
    );
    assert.deepEqual(shared.endpoints(), []);
  } finally {
    shared.dispose();
  }
  const cancelled = context(async () => envelope(txResult()));
  try {
    await assert.rejects(
      cancelled.call(RPC_ENDPOINTS[0], txRead.method, txRead.params, () => {
        cancelled.cancel();
        return "late";
      }),
      code("ERR_RPC_CANCELLED"),
    );
    assert.deepEqual(cancelled.endpoints(), []);
  } finally {
    cancelled.dispose();
  }
});

test("view_code uses the 2MiB envelope bound, not the 64KiB contract JSON result bound", async () => {
  const read: HistoricalRead = {
    ...queryRead,
    params: { ...queryRead.params, request_type: "view_code" },
  };
  const bytes = Buffer.alloc(261_226, 1);
  const shared = context(
    async () =>
      envelope({
        block_hash: HASH,
        block_height: Number(block.height),
        code_base64: bytes.toString("base64"),
      }),
    [read],
  );
  try {
    const result = (await rpcCall(
      RPC_ENDPOINTS[0],
      "query",
      read.params,
      shared,
    )) as { code_base64: string };
    assert.equal(Buffer.from(result.code_base64, "base64").length, 261_226);
    assert.throws(
      () => decodeCallFunctionResult({ result: new Array(65_537).fill(32) }),
      code("ERR_RPC_RESPONSE_LIMIT"),
    );
  } finally {
    shared.dispose();
  }
  assert.throws(
    () =>
      validateQueryBlock(
        `{"result":{"block_hash":"${HASH}","block_height":9007199254740993}}`,
        { hash: HASH, height: "9007199254740992" },
      ),
    code("ERR_RPC_BLOCK_MISMATCH"),
  );
  validateQueryBlock(
    `{"result":{"block_hash":"${HASH}","block_height":9007199254740993}}`,
    { hash: HASH, height: "9007199254740993" },
  );
  assert.equal(RPC_LIMITS.maxResponseBytes, 2_097_152);
});

test("historical scope and serialized requests stay fixed across caller mutation and concurrent runs", async () => {
  const params = { tx_hash: TX, sender_account_id: ACCOUNT };
  const read = { method: "EXPERIMENTAL_tx_status" as const, params };
  const seen: unknown[] = [];
  let release!: (response: Response) => void;
  const paused = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const shared = context(
    async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)).params);
      return seen.length === 1 ? paused : envelope(txResult());
    },
    [read],
  );
  const other = context(async () => envelope(txResult()));
  try {
    const pending = rpcCall(RPC_ENDPOINTS[0], txRead.method, params, shared);
    params.tx_hash = HASH;
    read.params.sender_account_id = "other.testnet";
    release(new Response("retry", { status: 408 }));
    await pending;
    assert.deepEqual(seen, [txRead.params, txRead.params]);
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], txRead.method, params, shared),
      code("ERR_RPC_SCOPE"),
    );
    await rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, other);
    assert.equal(other.provenance().attempts.length, 1);
    assert.equal(shared.provenance().attempts.length, 2);
  } finally {
    shared.dispose();
    other.dispose();
  }
});

test("historical scope shares max-four HTTP/body slots and a single aggregate deadline", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const shared = context(async (_url, init) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    init?.signal?.addEventListener(
      "abort",
      () => {
        active--;
      },
      { once: true },
    );
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify({ result: txResult() })),
            );
            controller.close();
          }, 5);
        },
      }),
    );
  });
  try {
    await Promise.all(
      Array.from({ length: 12 }, () =>
        rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared),
      ),
    );
    assert.equal(calls, 12);
    assert.ok(peak <= 4);
    assert.equal(active, 0);
  } finally {
    shared.dispose();
  }
  const deadline = context(
    async () => new Promise<Response>(() => {}),
    [txRead],
    { deadlineMs: 20, timeoutMs: 100 },
  );
  try {
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, deadline),
      code("ERR_RPC_DEADLINE"),
    );
    assert.equal(deadline.provenance().attempts.length, 1);
  } finally {
    deadline.dispose();
  }
});

test("historical transport retains stream/depth bounds and cancels overlarge bodies before returning", async () => {
  for (const phase of ["stream", "depth"]) {
    let cancelled = false;
    const shared = context(
      async () =>
        phase === "depth"
          ? new Response(
              '{"result":' + "[".repeat(65) + "null" + "]".repeat(65) + "}",
            )
          : new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array(65));
                },
                cancel() {
                  cancelled = true;
                },
              }),
            ),
      [txRead],
      phase === "stream" ? { maxResponseBytes: 64 } : {},
    );
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], txRead.method, txRead.params, shared),
        code(
          phase === "stream"
            ? "ERR_RPC_RESPONSE_LIMIT"
            : "ERR_RPC_INVALID_RESPONSE",
        ),
      );
      assert.equal(shared.provenance().attempts.length, 1);
      assert.deepEqual(shared.endpoints(), []);
      if (phase === "stream") assert.equal(cancelled, true);
    } finally {
      shared.dispose();
    }
  }
});

test("original recorded numeric envelope through HTTP408/archival preserves production attribution and fingerprint", async () => {
  const raw = await readFile(fixtureUrl, "utf8");
  const parsed = JSON.parse(raw) as {
    result: { transaction: { nonce: number }; receipts: unknown[] };
  };
  assert.equal(typeof parsed.result.transaction.nonce, "number");
  const shared = context(async (url) =>
    String(url) === RPC_ENDPOINTS[0]
      ? new Response("timeout", { status: 408 })
      : new Response(raw),
  );
  const store = createReconciliationStore();
  try {
    const result = await reconcilePayment({
      expectation: {
        network: "TESTNET",
        daoAccountId: "commonsops-dao.sputnikv2.testnet",
        proposalId: "0",
        claimantId: ACCOUNT,
        recipientId: ACCOUNT,
        amountYocto: "500000000000000000000000",
        profile: {
          version: "2.3.1",
          codeHash: "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH",
        },
        cycle: { templateId: "0", periodIndex: "0" },
      },
      candidate: { transactionHash: TX, signerId: ACCOUNT },
      provenance:
        "CommonsOps live testnet journey: act_proposal VoteApprove on proposal 0 of commonsops-dao.sputnikv2.testnet",
      store,
      transport: (request) =>
        shared.call(
          RPC_ENDPOINTS[0],
          request.method,
          request.params,
          (_result, body) => {
            const original = parseRpcEnvelope(body, shared.limits);
            assert.deepEqual(original, parsed);
            return original;
          },
        ),
    });
    shared.check();
    assert.equal(result.status, "APPLIED");
    assert.equal(result.adapterState, "PAID");
    assert.equal(
      store.exportSnapshot().fingerprint,
      "f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965",
    );
    assert.deepEqual(shared.endpoints(), [RPC_ENDPOINTS[1]]);
  } finally {
    shared.dispose();
  }
});
