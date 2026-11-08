import assert from "node:assert/strict";
import test from "node:test";
import { parseBoundedJson } from "./bounded-json.ts";
import {
  RpcContext,
  RPC_LIMITS,
  RPC_ENDPOINTS,
  LiveRpcError,
  rpcCall,
  parseFinalBlockHeader,
  decodeCallFunctionResult,
  callViewFunction,
} from "./rpc.ts";
import { fetchLiveRegistrySnapshot } from "./registry-reads.ts";
import { assertTestnet } from "./network.ts";
import { LatestTask } from "./latest-task.ts";
const HASH = "DBoPADQwvnnzNHzU5BFpZxAbBAE7CDV1FDoBjgfErct4";
const block = { hash: HASH, height: "1", timestampNs: "1794081836177342701" };
const header = `{"result":{"header":{"hash":"${HASH}","height":1,"timestamp":1794081836177342701}}}`;
const invalid = (error: unknown) =>
  error instanceof LiveRpcError && error.code === "ERR_RPC_INVALID_RESPONSE";
function ctx(fetcher: typeof fetch, limits = {}) {
  return new RpcContext({
    fetch: fetcher,
    limits: { backoffMs: 0, ...limits },
  });
}
test("duplicate decoded keys are refused in headers, envelopes, query metadata and encoded records", async () => {
  for (const replacement of [
    `"hash":"wrong","hash":"${HASH}"`,
    `"ha\\u0073h":"wrong","hash":"${HASH}"`,
  ])
    assert.throws(
      () =>
        parseFinalBlockHeader(header.replace(`"hash":"${HASH}"`, replacement)),
      invalid,
    );
  assert.throws(
    () =>
      parseFinalBlockHeader(
        header.replace('"timestamp":', '"timestamp":1,"time\\u0073tamp":'),
      ),
    invalid,
  );
  for (const raw of [
    '{"result":{},"result":null}',
    '{"re\\u0073ult":{},"result":null}',
    '{"result":null,"error":null}',
    '{"result":null,"error":{"cause":{"name":"INTERNAL_ERROR"}}}',
  ]) {
    const context = ctx(async () => new Response(raw));
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
        invalid,
      );
    } finally {
      context.dispose();
    }
  }
  const context = ctx(
    async () =>
      new Response(
        `{"result":{"block_hash":"wrong","block_ha\\u0073h":"${HASH}","block_height":1,"result":[110,117,108,108]}}`,
      ),
  );
  try {
    await assert.rejects(
      callViewFunction(
        RPC_ENDPOINTS[0],
        "commonsops.testnet",
        "get_cycle",
        {},
        block,
        context,
      ),
      invalid,
    );
  } finally {
    context.dispose();
  }
  for (const raw of [
    '{"result":{},"result":null}',
    '{"id":"0","\\u0069d":"1"}',
    '{"cycle":{"status":"OPEN","status":"CLAIMED"}}',
  ]) {
    assert.throws(
      () =>
        decodeCallFunctionResult({
          result: Array.from(new TextEncoder().encode(raw)),
        }),
      invalid,
    );
  }
});
test("stream limit cancels before full text allocation and content-length cannot bypass bounds", async () => {
  for (const declared of [undefined, "1", "99999"]) {
    let cancelled = false;
    const context = ctx(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(32));
              controller.enqueue(new Uint8Array(100));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: declared ? { "content-length": declared } : {} },
        ),
      { maxResponseBytes: 64 },
    );
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
        (error: unknown) =>
          error instanceof LiveRpcError &&
          error.code === "ERR_RPC_RESPONSE_LIMIT",
      );
      assert.equal(cancelled, true);
    } finally {
      context.dispose();
    }
  }
});
test("contract bytes, JSON depth, nodes, work and UTF-8 are bounded with smaller scoped limits", () => {
  assert.throws(
    () =>
      decodeCallFunctionResult({
        result: new Array(RPC_LIMITS.maxContractBytes + 1).fill(32),
      }),
    LiveRpcError,
  );
  assert.throws(() => decodeCallFunctionResult({ result: [255] }), invalid);
  assert.throws(() =>
    parseBoundedJson("[".repeat(65) + "null" + "]".repeat(65), RPC_LIMITS),
  );
  assert.throws(() =>
    parseBoundedJson("[0,0,0]", { ...RPC_LIMITS, maxJsonNodes: 3 }),
  );
  assert.throws(() =>
    parseBoundedJson('"abcdefgh"', { ...RPC_LIMITS, maxJsonWork: 5 }),
  );
  for (const raw of ['{"a":1,}', "[1,]", '{"a" 1}', "[true false]"])
    assert.throws(() => parseBoundedJson(raw, RPC_LIMITS));
  assert.deepEqual(
    parseBoundedJson('{"a":[null,true,1],"b":"escaped\\\""}', RPC_LIMITS),
    { a: [null, true, 1], b: 'escaped"' },
  );
});
test("monotonic elapsed deadlines reject validation and publication even before timers can fire", async () => {
  for (const phase of ["attempt", "refresh"]) {
    let now = 0;
    const context = new RpcContext({
      fetch: async () => new Response('{"result":null}'),
      now: () => now,
      limits: {
        timeoutMs: 10,
        deadlineMs: phase === "refresh" ? 10 : 1000,
        backoffMs: 0,
      },
    });
    const task = new LatestTask<string>();
    await task.run("registry", async () => "old");
    await task.run("registry", async () => {
      try {
        await context.call(RPC_ENDPOINTS[0], "query", {}, () => {
          now += 11;
          return "late";
        });
        return "late";
      } finally {
        context.dispose();
      }
    });
    assert.equal(task.getSnapshot().status, "ERROR");
    assert.equal(task.getSnapshot().data, "old");
  }
  const task = new LatestTask<string>();
  await task.run("registry", async () => "old");
  await task.run(
    "registry",
    async () => "too-late",
    true,
    () => {
      throw new LiveRpcError("ERR_RPC_DEADLINE", "late publication");
    },
  );
  assert.equal(task.getSnapshot().status, "ERROR");
  assert.equal(task.getSnapshot().data, "old");
});
test("snapshot provenance lists actual validated archival responses on the same pinned block", async () => {
  const seen: Record<string, unknown>[] = [];
  const snapshot = await fetchLiveRegistrySnapshot(
    assertTestnet("testnet"),
    "commonsops.testnet",
    {
      limits: { backoffMs: 0 },
      fetch: async (url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          method: string;
          params: Record<string, unknown>;
        };
        if (String(url) === RPC_ENDPOINTS[0])
          return new Response("unavailable", { status: 503 });
        if (request.method === "block") return new Response(header);
        seen.push(request.params);
        const value =
          request.params.method_name === "foundation_status"
            ? "foundation"
            : null;
        return new Response(
          JSON.stringify({
            result: {
              block_hash: HASH,
              block_height: 1,
              result: Array.from(
                new TextEncoder().encode(JSON.stringify(value)),
              ),
            },
          }),
        );
      },
    },
  );
  assert.deepEqual(snapshot.endpoints, [RPC_ENDPOINTS[1]]);
  assert.ok(seen.every((params) => params.block_id === HASH));
  assert.equal(snapshot.block.timestampNs, block.timestampNs);
});
