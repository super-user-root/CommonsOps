import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeCallFunctionResult,
  encodeViewArgs,
  fetchFinalBlockHeader,
  parseCycle,
  parseFoundationStatus,
  parseTemplate,
  rpcCall,
  RpcContext,
  RPC_ENDPOINTS,
  RPC_LIMITS,
  callViewFunction,
  parseFinalBlockHeader,
  type RpcOptions,
  LiveRpcError,
} from "./rpc.ts";

// The onchain get_template 0 response captured from
// https://rpc.testnet.near.org (public data; see tests/e2e/registry-views.json
// for the full recorded views this mirrors).
const recordedTemplateBytes = [123, 34, 105, 100, 34, 58, 34, 48, 34, 125]; // {"id":"0"}
const recordedCycle = {
  key: { template_id: "0", period_index: "0" },
  status: "SUBMITTED",
  opens_at_ns: "1793910183011867400",
  deadline_at_ns: "1794342183011867400",
  dao_account_id: "commonsops-dao.sputnikv2.testnet",
  amount_yocto: "500000000000000000000000",
  claim: {
    claimant_id: "commonsops.testnet",
    payout_recipient_id: "commonsops.testnet",
    expires_at_ns: "1794083472509596599",
  },
  evidence: {
    repository_owner: "super-user-root",
    repository_name: "CommonsOps",
    pull_request_number: "17",
    url: "https://github.com/super-user-root/commonsops/pull/17",
    commit_sha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
    digest_sha256:
      "09936627b4a19b8a0f9d0a4bd88e7b8f28ee4d4b3b8bfcda32e1f4a63d55a5cb",
  },
  submitted_at_ns: "1793910689442132732",
  proposal_link: {
    key: {
      network: "TESTNET",
      dao_account_id: "commonsops-dao.sputnikv2.testnet",
      proposal_id: "0",
    },
    linked_at_ns: "1793910838179857287",
  },
};

test("encodeViewArgs matches the NEAR RPC args_base64 encoding", () => {
  assert.equal(
    encodeViewArgs({ template_id: "0" }),
    Buffer.from('{"template_id":"0"}', "utf8").toString("base64"),
  );
  assert.equal(
    encodeViewArgs({
      cycle_key: { template_id: "0", period_index: "1" },
    }),
    Buffer.from(
      '{"cycle_key":{"template_id":"0","period_index":"1"}}',
      "utf8",
    ).toString("base64"),
  );
});

test("decodeCallFunctionResult decodes byte arrays and passes Option::None through", () => {
  const decoded = decodeCallFunctionResult({
    result: recordedTemplateBytes,
    logs: [],
  });
  assert.deepEqual(decoded, { id: "0" });
  // get_cycle for a non-materialized period returns the JSON bytes "null".
  const none = decodeCallFunctionResult({
    result: [110, 117, 108, 108],
  });
  assert.equal(none, null);
  assert.throws(
    () => decodeCallFunctionResult({}),
    (error: unknown) =>
      error instanceof LiveRpcError &&
      error.code === "ERR_RPC_INVALID_RESPONSE",
  );
  assert.throws(
    () => decodeCallFunctionResult({ result: [123, 999] }),
    (error: unknown) =>
      error instanceof LiveRpcError &&
      error.code === "ERR_RPC_INVALID_RESPONSE",
  );
  assert.throws(
    () => decodeCallFunctionResult({ result: [123] /* truncated JSON */ }),
    (error: unknown) =>
      error instanceof LiveRpcError &&
      error.code === "ERR_RPC_INVALID_RESPONSE",
  );
});

test("rpcCall surfaces RPC error payloads as named failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "x",
        error: {
          name: "REQUEST_VALIDATION_ERROR",
          code: -32700,
          message: "Parse error",
          data: "Bad request",
          cause: { name: "PARSE_ERROR", info: {} },
        },
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    await assert.rejects(
      rpcCall("https://rpc.testnet.near.org", "query", {}),
      (error: unknown) => {
        assert.ok(error instanceof LiveRpcError);
        assert.equal(error.code, "ERR_RPC_PARSE_ERROR");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rpcCall reports HTTP failures and unreachable nodes without inventing data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("upstream unavailable", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(
      rpcCall("https://rpc.testnet.near.org", "block", {}),
      (error: unknown) => {
        assert.ok(error instanceof LiveRpcError);
        assert.equal(error.code, "ERR_RPC_SERVER");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    await assert.rejects(
      rpcCall("https://rpc.testnet.near.org", "block", {}),
      (error: unknown) => {
        assert.ok(error instanceof LiveRpcError);
        assert.equal(error.code, "ERR_RPC_UNREACHABLE");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchFinalBlockHeader preserves exact u64 digits despite JSON number rounding", async () => {
  const originalFetch = globalThis.fetch;
  // Shape mirrors the real RPC response: height and timestamp are JSON
  // numbers, and this timestamp exceeds 2^53 so JSON.parse would round it.
  const rawBody = JSON.stringify({
    jsonrpc: "2.0",
    result: {
      author: "node2",
      header: {
        height: 276677160,
        timestamp: 1794081836177342700,
        hash: "DBoPADQwvnnzNHzU5BFpZxAbBAE7CDV1FDoBjgfErct4",
      },
    },
  });
  globalThis.fetch = (async () =>
    new Response(rawBody, { status: 200 })) as typeof fetch;
  try {
    const header = await fetchFinalBlockHeader("https://rpc.testnet.near.org");
    assert.equal(header.height, "276677160");
    // The exact digit sequence from the wire text, not the rounded double.
    assert.equal(header.timestampNs, "1794081836177342700");
    assert.equal(header.hash, "DBoPADQwvnnzNHzU5BFpZxAbBAE7CDV1FDoBjgfErct4");
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ result: { header: { height: 1 } } }), {
      status: 200,
    })) as typeof fetch;
  try {
    await assert.rejects(
      fetchFinalBlockHeader("https://rpc.testnet.near.org"),
      (error: unknown) => {
        assert.ok(error instanceof LiveRpcError);
        assert.equal(error.code, "ERR_RPC_INVALID_RESPONSE");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function testContext(fetcher: typeof fetch, limits: RpcOptions["limits"] = {}) {
  return new RpcContext({
    fetch: fetcher,
    limits: { backoffMs: 0, timeoutMs: 30, deadlineMs: 500, ...limits },
  });
}
const BLOCK_HASH = "DBoPADQwvnnzNHzU5BFpZxAbBAE7CDV1FDoBjgfErct4";
const HEADER = {
  height: "276677160",
  timestampNs: "1794081836177342701",
  hash: BLOCK_HASH,
};
const rawHeader = `{ "height": 999, "timestamp": 888, "result": { "other": {"timestamp":1}, "header" : { "height" : 276677160, "timestamp" : 1794081836177342701, "hash": "${BLOCK_HASH}" } } }`;
function envelope(result: unknown) {
  return new Response(JSON.stringify({ result }));
}
function hasCode(code: string) {
  return (error: unknown) =>
    error instanceof LiveRpcError && error.code === code;
}

test("whole-body transport failures retry, timeout settles non-cooperative fetch/body, and diagnostics omit content", async () => {
  for (const phase of ["stream", "fetch", "body"]) {
    let calls = 0;
    const context = testContext(async () => {
      calls++;
      if (phase === "fetch") return new Promise<Response>(() => {});
      const response = new Response("ignored");
      response.text = () =>
        phase === "body"
          ? new Promise<string>(() => {})
          : Promise.reject(new Error("secret upstream detail"));
      return response;
    });
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
        hasCode(phase === "stream" ? "ERR_RPC_UNREACHABLE" : "ERR_RPC_TIMEOUT"),
      );
      assert.equal(calls, 4);
    } finally {
      context.dispose();
    }
  }
});

test("deterministic HTTP refusal ignores even a hanging/error body and schema errors never retry", async () => {
  let calls = 0;
  const refusal = testContext(async () => {
    calls++;
    const response = new Response("ignored", { status: 403 });
    response.text = () => new Promise<string>(() => {});
    return response;
  });
  try {
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], "query", {}, refusal),
      hasCode("ERR_RPC_HTTP_STATUS"),
    );
    assert.equal(calls, 1);
  } finally {
    refusal.dispose();
  }
  for (const body of ["not-json", "{}", '{"result":{"header":{"height":1}}}']) {
    calls = 0;
    const invalid = testContext(async () => {
      calls++;
      return new Response(body);
    });
    try {
      await assert.rejects(
        fetchFinalBlockHeader(RPC_ENDPOINTS[0], invalid),
        hasCode("ERR_RPC_INVALID_RESPONSE"),
      );
      assert.equal(calls, 1);
    } finally {
      invalid.dispose();
    }
  }
});

test("archival metadata mismatch after primary failure never switches to a newer final block", async () => {
  const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
  const context = testContext(async (url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    seen.push(request);
    if (request.method === "block") return new Response(rawHeader);
    if (String(url) === RPC_ENDPOINTS[0])
      return new Response("unavailable", { status: 503 });
    return envelope({
      block_hash: BLOCK_HASH,
      block_height: Number(HEADER.height) + 1,
      result: [110, 117, 108, 108],
    });
  });
  try {
    const block = await fetchFinalBlockHeader(RPC_ENDPOINTS[0], context);
    await assert.rejects(
      callViewFunction(
        RPC_ENDPOINTS[0],
        "commonsops.testnet",
        "get_cycle",
        {},
        block,
        context,
      ),
      hasCode("ERR_RPC_BLOCK_MISMATCH"),
    );
    assert.equal(seen.filter((read) => read.method === "block").length, 1);
    assert.ok(
      seen
        .filter((read) => read.method === "query")
        .every((read) => read.params.block_id === BLOCK_HASH),
    );
  } finally {
    context.dispose();
  }
});

test("HTTP and RPC transient failures retry across endpoints; deterministic failures do not", async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    let calls = 0;
    const context = testContext(async () => {
      calls++;
      return new Response("<secret>", { status });
    });
    try {
      await assert.rejects(
        rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
        (error: unknown) => {
          assert.ok(error instanceof LiveRpcError);
          assert.doesNotMatch(error.message, /secret/);
          return true;
        },
      );
      assert.equal(calls, status === 429 || status >= 500 ? 4 : 1);
    } finally {
      context.dispose();
    }
  }
  for (const name of [
    "INTERNAL_ERROR",
    "TIMEOUT_ERROR",
    "UNKNOWN_BLOCK",
    "CONTRACT_EXECUTION_ERROR",
    "METHOD_NOT_FOUND",
    "PARSE_ERROR",
  ]) {
    let calls = 0;
    const context = testContext(async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { message: "secret", cause: { name } } }),
      );
    });
    try {
      await assert.rejects(rpcCall(RPC_ENDPOINTS[0], "query", {}, context));
      assert.equal(
        calls,
        ["INTERNAL_ERROR", "TIMEOUT_ERROR", "UNKNOWN_BLOCK"].includes(name)
          ? 4
          : 1,
      );
    } finally {
      context.dispose();
    }
  }
});

test("deadline, shared attempt budget and pool bound many simultaneous reads", async () => {
  let active = 0;
  let peak = 0;
  let attempts = 0;
  const context = testContext(
    async () => {
      active++;
      attempts++;
      peak = Math.max(peak, active);
      const response = envelope("ok");
      response.text = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return '{"result":"ok"}';
      };
      return response;
    },
    { maxAttempts: 8 },
  );
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
      ),
    );
    assert.equal(attempts, 8);
    assert.ok(peak <= 4);
    assert.ok(
      results.some(
        (result) =>
          result.status === "rejected" &&
          hasCode("ERR_RPC_BUDGET")(result.reason),
      ),
    );
  } finally {
    context.dispose();
  }
  const deadline = testContext(async () => new Promise<Response>(() => {}), {
    deadlineMs: 10,
  });
  try {
    await assert.rejects(
      rpcCall(RPC_ENDPOINTS[0], "query", {}, deadline),
      hasCode("ERR_RPC_DEADLINE"),
    );
  } finally {
    deadline.dispose();
  }
  assert.equal(RPC_LIMITS.deadlineMs, 40_000);
});

test("abort cancels fetch/body, queued requests and backoff without extra attempts", async () => {
  for (const phase of ["fetch", "body", "backoff"]) {
    let attempts = 0;
    const context = testContext(
      async () => {
        attempts++;
        if (phase === "fetch") return new Promise<Response>(() => {});
        if (phase === "backoff") return new Response("bad", { status: 503 });
        const response = envelope(null);
        response.text = () => new Promise<string>(() => {});
        return response;
      },
      { backoffMs: phase === "backoff" ? 100 : 0, timeoutMs: 100 },
    );
    const reads = Array.from({ length: 8 }, () =>
      rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
    );
    setTimeout(() => context.cancel(), 5);
    const results = await Promise.allSettled(reads);
    assert.ok(
      results.every(
        (result) =>
          result.status === "rejected" &&
          hasCode("ERR_RPC_CANCELLED")(result.reason),
      ),
    );
    assert.equal(attempts, phase === "backoff" ? 8 : 4);
    context.dispose();
  }
});

test("block parser scopes lossless U64 tokens to header with JSON whitespace and escaped strings", () => {
  assert.deepEqual(parseFinalBlockHeader(rawHeader), HEADER);
  assert.equal(
    parseFinalBlockHeader(
      rawHeader.replace(
        '"other": {"timestamp":1}',
        '"other": "\\\"timestamp\\\": 123"',
      ),
    ).timestampNs,
    HEADER.timestampNs,
  );
  for (const timestamp of ["1.5", "1e18", "-1", "18446744073709551616"]) {
    assert.throws(
      () =>
        parseFinalBlockHeader(
          rawHeader.replace("1794081836177342701", timestamp),
        ),
      LiveRpcError,
    );
  }
});

test("views pin the chosen hash across archival failover, verify metadata and never promote invalid response", async () => {
  const seen: Array<{
    url: string;
    method: string;
    params: Record<string, unknown>;
  }> = [];
  const context = testContext(async (input, init) => {
    const url = String(input);
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    seen.push({ url, ...request });
    if (request.method === "block") return new Response(rawHeader);
    if (url === RPC_ENDPOINTS[0])
      return new Response("temporary", { status: 503 });
    return envelope({
      block_hash: BLOCK_HASH,
      block_height: Number(HEADER.height),
      result: [110, 117, 108, 108],
    });
  });
  try {
    const block = await fetchFinalBlockHeader(RPC_ENDPOINTS[0], context);
    assert.equal(
      await callViewFunction(
        RPC_ENDPOINTS[0],
        "commonsops.testnet",
        "get_cycle",
        {},
        block,
        context,
      ),
      null,
    );
    assert.equal(
      await callViewFunction(
        RPC_ENDPOINTS[0],
        "commonsops.testnet",
        "get_cycle",
        {},
        block,
        context,
      ),
      null,
    );
    assert.equal(seen.filter((read) => read.method === "block").length, 1);
    assert.ok(
      seen
        .filter((read) => read.method === "query")
        .every(
          (read) =>
            read.params.block_id === BLOCK_HASH && !("finality" in read.params),
        ),
    );
    assert.equal(seen.at(-1)?.url, RPC_ENDPOINTS[1]);
  } finally {
    context.dispose();
  }
  const invalidSeen: string[] = [];
  const invalid = testContext(async (url) => {
    invalidSeen.push(String(url));
    return envelope({
      block_hash: "different",
      block_height: Number(HEADER.height),
      result: [110, 117, 108, 108],
    });
  });
  try {
    await assert.rejects(
      callViewFunction(
        RPC_ENDPOINTS[1],
        "commonsops.testnet",
        "get_cycle",
        {},
        HEADER,
        invalid,
      ),
      hasCode("ERR_RPC_BLOCK_MISMATCH"),
    );
    await rpcCall(RPC_ENDPOINTS[0], "query", {}, invalid);
    assert.deepEqual(invalidSeen, [RPC_ENDPOINTS[1], RPC_ENDPOINTS[0]]);
    await assert.rejects(
      rpcCall("https://rpc.mainnet.near.org", "query", {}, invalid),
      hasCode("ERR_RPC_ENDPOINT"),
    );
    assert.equal(invalidSeen.length, 2);
  } finally {
    invalid.dispose();
  }
});

test("parseTemplate rejects malformed live data instead of defaulting", () => {
  const template = parseTemplate({
    id: "0",
    manager_id: "commonsops.testnet",
    active: true,
    next_period_index: "1",
    created_at_ns: "1793910643118147928",
    input: {
      dao_account_id: "commonsops-dao.sputnikv2.testnet",
      title: "Public documentation maintenance",
      description: "",
      start_at_ns: "1793910183011867400",
      interval_ns: "604800000000000",
      work_window_ns: "432000000000000",
      claim_duration_ns: "172800000000000",
      amount_yocto: "500000000000000000000000",
    },
  });
  assert.equal(template.id, "0");
  assert.equal(template.next_period_index, "1");
  assert.equal(template.input.amount_yocto, "500000000000000000000000");

  for (const broken of [
    null,
    {},
    { ...template, active: "yes" },
    { ...template, input: { ...template.input, amount_yocto: "0x5" } },
  ]) {
    assert.throws(() => parseTemplate(broken), LiveRpcError);
  }
});

test("parseCycle validates the recorded live cycle and rejects malformed data", () => {
  const cycle = parseCycle(recordedCycle);
  assert.ok(cycle);
  assert.equal(cycle.status, "SUBMITTED");
  assert.equal(
    cycle.evidence?.commit_sha,
    "1032733c2115b9e9c038d50617f6e151ac8bd59d",
  );
  assert.equal(cycle.proposal_link?.key.proposal_id, "0");
  assert.equal(parseCycle(null), null);

  for (const broken of [
    {},
    { ...recordedCycle, status: "PENDING" },
    { ...recordedCycle, amount_yocto: 500000 },
    { ...recordedCycle, claim: { ...recordedCycle.claim, expires_at_ns: "x" } },
    {
      ...recordedCycle,
      proposal_link: {
        ...recordedCycle.proposal_link,
        key: { ...recordedCycle.proposal_link.key, network: "BETANET" },
      },
    },
  ]) {
    assert.throws(() => parseCycle(broken), LiveRpcError);
  }
});

test("parseFoundationStatus accepts only non-empty strings", () => {
  assert.equal(
    parseFoundationStatus("foundation: no business behavior"),
    "foundation: no business behavior",
  );
  assert.throws(() => parseFoundationStatus(null), LiveRpcError);
  assert.throws(() => parseFoundationStatus(""), LiveRpcError);
  assert.throws(() => parseFoundationStatus(42), LiveRpcError);
});
