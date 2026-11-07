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
        assert.equal(error.code, "ERR_RPC_HTTP_STATUS");
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
