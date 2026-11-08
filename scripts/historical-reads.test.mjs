import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  RPC_URL,
  rpcCall,
  verificationFailure,
  writeJsonAtomic,
} from "./deployment-lib.mjs";
import { RPC_ENDPOINTS } from "../packages/near/src/read-only-rpc.ts";
import {
  main as smoke,
  parseArgs as smokeArgs,
  verifySmoke,
} from "./smoke-testnet.mjs";
import {
  main as reconcile,
  parseArgs as reconcileArgs,
  verifyReconciliation,
} from "./reconcile-live.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = JSON.parse(
  await readFile(
    path.join(ROOT, "deployments/testnet/prepared-deployment.json"),
    "utf8",
  ),
);
const SMOKE = JSON.parse(
  await readFile(
    path.join(ROOT, "deployments/testnet/smoke-result.json"),
    "utf8",
  ),
);
const RAW_PAYOUT = await readFile(
  path.join(ROOT, "tests/fixtures/sputnik/dao-proposal-0-231-paid.json"),
  "utf8",
);
const FINGERPRINT =
  "f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965";
const PROVENANCE =
  "CommonsOps live testnet journey: act_proposal VoteApprove on proposal 0 of commonsops-dao.sputnikv2.testnet";
const envelope = (result) =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id: "fixture-response", result }),
  );

// Synthetic tx protocol fixture derived from the public manifest. The actual
// reviewed built WASM is checked by view_code below, not synthetic zero bytes.
function deploymentTransaction() {
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash: MANIFEST.transactionHash,
      signer_id: MANIFEST.contractAccountId,
      receiver_id: MANIFEST.contractAccountId,
      public_key: MANIFEST.signerPublicKey,
      nonce: MANIFEST.nonce,
      actions: [
        { DeployContract: { code: Buffer.alloc(32, 1).toString("base64") } },
        {
          FunctionCall: {
            method_name: "new",
            args: Buffer.from(JSON.stringify(MANIFEST.initArgs)).toString(
              "base64",
            ),
            gas: Number(MANIFEST.prepaidGas),
            deposit: MANIFEST.attachedDeposit,
          },
        },
      ],
    },
    transaction_outcome: {
      block_hash: MANIFEST.broadcast.transactionBlockHash,
      outcome: { status: { SuccessReceiptId: MANIFEST.receipts[0] } },
    },
    receipts_outcome: MANIFEST.receipts.map((id, index) => ({
      id,
      block_hash: MANIFEST.postDeployment.blockHash,
      outcome: {
        logs:
          index === 0 ? ['EVENT_JSON:{"event":"registry_initialized"}'] : [],
        status: { SuccessValue: "" },
      },
    })),
  };
}

async function smokeTransport({
  failover = false,
  mutate = (_method, value) => value,
} = {}) {
  const bytes = await readFile(
    path.join(
      ROOT,
      "contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
    ),
  );
  const calls = [];
  const signals = [];
  const attempts = new Map();
  return {
    calls,
    signals,
    fetch: async (url, init) => {
      signals.push(init.signal);
      const request = JSON.parse(init.body);
      const method =
        request.method === "query"
          ? request.params.request_type
          : request.method;
      calls.push({ endpoint: String(url), ...request });
      const count = (attempts.get(method) ?? 0) + 1;
      attempts.set(method, count);
      if (failover && count <= 3)
        return new Response("temporary", { status: 408 });
      const meta = {
        block_hash: MANIFEST.postDeployment.blockHash,
        block_height: MANIFEST.postDeployment.blockHeight,
      };
      const result =
        method === "EXPERIMENTAL_tx_status"
          ? deploymentTransaction()
          : method === "view_account"
            ? {
                ...meta,
                code_hash: SMOKE.postCodeHash,
                storage_usage: SMOKE.storageUsage,
                amount: SMOKE.amount,
                locked: SMOKE.locked,
              }
            : method === "view_code"
              ? {
                  ...meta,
                  hash: SMOKE.postCodeHash,
                  code_base64: bytes.toString("base64"),
                }
              : {
                  ...meta,
                  result: Array.from(
                    Buffer.from(JSON.stringify(SMOKE.foundationStatus)),
                  ),
                };
      return envelope(mutate(method, result));
    },
  };
}

async function scratch(t) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "commonsops-history-with-spaces-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "deployments/testnet");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "prepared-deployment.json"),
    JSON.stringify(MANIFEST),
  );
  for (const file of [
    "smoke-result.json",
    "reconciliation-snapshot.json",
    "replay-record.json",
  ])
    await writeFile(
      path.join(dir, file),
      `previous successful artifact: ${file}\n`,
    );
  const artifacts = async () => {
    const files = (await readdir(dir)).sort();
    return Promise.all(
      files.map(async (file) => [
        file,
        await readFile(path.join(dir, file), "utf8"),
      ]),
    );
  };
  return { root, dir, artifacts };
}

test("strict CLI options permit only the documented account/stdout-only flag and reject bad flags before I/O", async () => {
  for (const args of [
    ["commonsops.testnet"],
    ["commonsops.testnet", "--stdout-only"],
    ["--stdout-only", "commonsops.testnet"],
    ["--", "commonsops.testnet", "--stdout-only"],
  ]) {
    assert.equal(smokeArgs(args).accountId, "commonsops.testnet");
    assert.equal(smokeArgs(args).stdoutOnly, args.includes("--stdout-only"));
  }
  assert.equal(reconcileArgs([]).stdoutOnly, false);
  assert.equal(reconcileArgs(["--stdout-only"]).stdoutOnly, true);
  for (const args of [
    [],
    ["alice.near"],
    ["x..testnet"],
    ["commonsops.testnet", "unexpected"],
    ["commonsops.testnet", "--bad"],
    ["commonsops.testnet", "--stdout-only", "--stdout-only"],
    ["--stdout-only=true", "commonsops.testnet"],
  ])
    assert.throws(() => smokeArgs(args));
  for (const args of [
    ["commonsops.testnet"],
    ["--bad"],
    ["--stdout-only", "--stdout-only"],
    ["--stdout-only=false"],
    ["--", "--"],
  ])
    assert.throws(() => reconcileArgs(args));
  for (const run of [smoke, reconcile]) {
    await assert.rejects(
      run(["--bad"], {
        root: "a path that must never be read",
        rpc: { fetch: async () => assert.fail("no HTTP expected") },
      }),
      /Usage/,
    );
  }
});

test("smoke verifies four logical reads at exact post-init block with full 16-attempt budget and reviewed WASM", async () => {
  const probe = await smokeTransport({ failover: true });
  const result = await verifySmoke(MANIFEST, "commonsops.testnet", {
    fetch: probe.fetch,
    limits: { backoffMs: 0 },
  });
  assert.equal(probe.calls.length, 16);
  assert.equal(result.runProvenance.attempts.length, 16);
  assert.ok(probe.signals.every((signal) => signal.aborted));
  assert.deepEqual(result.runProvenance.attemptedEndpoints, RPC_ENDPOINTS);
  for (const request of probe.calls) {
    if (request.method === "EXPERIMENTAL_tx_status")
      assert.deepEqual(request.params, {
        tx_hash: MANIFEST.transactionHash,
        sender_account_id: "commonsops.testnet",
        wait_until: "FINAL",
      });
    else {
      assert.equal(request.params.block_id, MANIFEST.postDeployment.blockHash);
      assert.equal(request.params.account_id, "commonsops.testnet");
      assert.equal(request.params.finality, undefined);
    }
  }
  const { runProvenance, ...compatible } = result;
  assert.deepEqual(compatible, SMOKE);
  assert.equal(result.wasmBytes, 261_226);
  assert.equal(result.wasmSha256, MANIFEST.wasmSha256);
});

test("smoke schema, receipt, identity, query metadata, WASM and foundation mismatches fail without retry", async () => {
  const mutations = [
    [
      "EXPERIMENTAL_tx_status",
      (value) => ({ ...value, final_execution_status: "EXECUTED" }),
    ],
    [
      "EXPERIMENTAL_tx_status",
      (value) => ({
        ...value,
        transaction: {
          ...value.transaction,
          hash: MANIFEST.postDeployment.blockHash,
        },
      }),
    ],
    [
      "EXPERIMENTAL_tx_status",
      (value) => ({
        ...value,
        receipts_outcome: value.receipts_outcome.slice(0, 1),
      }),
    ],
    [
      "EXPERIMENTAL_tx_status",
      (value) => ({
        ...value,
        receipts_outcome: value.receipts_outcome.map((entry) => ({
          ...entry,
          block_hash: MANIFEST.recentBlockHash,
        })),
      }),
    ],
    [
      "view_account",
      (value) => ({ ...value, block_height: value.block_height + 1 }),
    ],
    [
      "view_account",
      (value) => ({ ...value, block_hash: MANIFEST.recentBlockHash }),
    ],
    [
      "view_code",
      (value) => ({ ...value, block_hash: MANIFEST.recentBlockHash }),
    ],
    [
      "view_code",
      (value) => ({
        ...value,
        code_base64: Buffer.alloc(261_226, 1).toString("base64"),
      }),
    ],
    [
      "call_function",
      (value) => ({ ...value, block_height: value.block_height + 1 }),
    ],
    ["call_function", (value) => ({ ...value, result: [255] })],
    [
      "call_function",
      (value) => ({ ...value, result: Array.from(Buffer.from('"wrong"')) }),
    ],
  ];
  for (const [target, change] of mutations) {
    const probe = await smokeTransport({
      mutate: (method, value) => (method === target ? change(value) : value),
    });
    await assert.rejects(
      verifySmoke(MANIFEST, "commonsops.testnet", {
        fetch: probe.fetch,
        limits: { backoffMs: 0 },
      }),
    );
    assert.equal(
      probe.calls.filter(
        (call) => (call.params.request_type ?? call.method) === target,
      ).length,
      1,
      target,
    );
    assert.ok(probe.signals.every((signal) => signal.aborted));
  }
});

test("reconcile uses original numeric RPC envelope, exact production expectation and immutable fingerprint", async () => {
  const requests = [];
  const { record, snapshot } = await verifyReconciliation({
    limits: { backoffMs: 0 },
    fetch: async (url, init) => {
      requests.push({ url: String(url), ...JSON.parse(init.body) });
      return String(url) === RPC_URL
        ? new Response("timeout", { status: 408 })
        : new Response(RAW_PAYOUT);
    },
  });
  assert.equal(requests.length, 3);
  assert.ok(
    requests.every(
      (request) =>
        request.method === "EXPERIMENTAL_tx_status" &&
        request.params.tx_hash === record.candidateTransactionHash,
    ),
  );
  assert.equal(record.reconciliationStatus, "APPLIED");
  assert.equal(record.adapterState, "PAID");
  assert.equal(record.recordCount, 1);
  assert.equal(record.record.provenance, PROVENANCE);
  assert.equal(snapshot.fingerprint, FINGERPRINT);
  assert.equal(record.snapshotFingerprint, FINGERPRINT);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "fingerprint",
    "records",
    "schemaVersion",
  ]);
  assert.equal("runProvenance" in snapshot.records[0], false);
  assert.deepEqual(record.runProvenance.validatedEndpoints, [RPC_ENDPOINTS[1]]);
});

test("reconcile rejects deterministic causal payment failures and provenance mismatches without retry", async () => {
  for (const mutate of [
    (fixture) => {
      fixture.result.transaction.hash = MANIFEST.transactionHash;
    },
    (fixture) => {
      fixture.result.final_execution_status = "EXECUTED";
    },
    (fixture) => {
      fixture.result.receipts = [];
    },
    (fixture) => {
      fixture.result.receipts_outcome = [];
    },
  ]) {
    let calls = 0;
    const fixture = JSON.parse(RAW_PAYOUT);
    mutate(fixture);
    await assert.rejects(
      verifyReconciliation({
        fetch: async () => {
          calls++;
          return new Response(JSON.stringify(fixture));
        },
        limits: { backoffMs: 0 },
      }),
    );
    assert.equal(calls, 1);
  }
});

test("stdout-only prints compatible successful records and never changes tracked or untracked artifact files", async (t) => {
  const { root, artifacts } = await scratch(t);
  const before = await artifacts();
  const probe = await smokeTransport();
  const smokeText = [];
  const smokeResult = await smoke(["commonsops.testnet", "--stdout-only"], {
    root,
    rpc: { fetch: probe.fetch },
    stdout: (text) => smokeText.push(text),
  });
  assert.equal(smokeText.length, 1);
  assert.deepEqual(JSON.parse(smokeText[0]), smokeResult);
  const replayText = [];
  const record = await reconcile(["--stdout-only"], {
    root,
    rpc: { fetch: async () => new Response(RAW_PAYOUT) },
    stdout: (text) => replayText.push(text),
  });
  assert.deepEqual(JSON.parse(replayText[0]), record);
  assert.equal(record.snapshotFingerprint, FINGERPRINT);
  assert.deepEqual(await artifacts(), before);
});

test("no-flag behavior writes successful artifacts atomically, preserving snapshot shape and stdout results", async (t) => {
  const { root, dir } = await scratch(t);
  const probe = await smokeTransport();
  const smokeResult = await smoke(["commonsops.testnet"], {
    root,
    rpc: { fetch: probe.fetch },
    stdout: () => {},
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, "smoke-result.json"), "utf8")),
    smokeResult,
  );
  const record = await reconcile([], {
    root,
    rpc: { fetch: async () => new Response(RAW_PAYOUT) },
    stdout: () => {},
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, "replay-record.json"), "utf8")),
    record,
  );
  const snapshot = JSON.parse(
    await readFile(path.join(dir, "reconciliation-snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.fingerprint, FINGERPRINT);
  assert.equal(snapshot.records[0].provenance, PROVENANCE);
  assert.equal("runProvenance" in snapshot, false);
  assert.ok((await readdir(dir)).every((file) => !file.endsWith(".tmp")));
});

test("failures never overwrite successful artifacts, produce no stdout success, and report actual attempts", async (t) => {
  const { root, artifacts } = await scratch(t);
  const before = await artifacts();
  for (const [run, args] of [
    [smoke, ["commonsops.testnet"]],
    [reconcile, []],
  ]) {
    for (const flags of [[], ["--stdout-only"]]) {
      let printed = false;
      let captured;
      try {
        await run([...args, ...flags], {
          root,
          rpc: {
            fetch: async () => new Response("private body", { status: 408 }),
            limits: { backoffMs: 0 },
          },
          stdout: () => {
            printed = true;
          },
        });
      } catch (error) {
        captured = error;
      }
      assert.ok(captured);
      const failure = verificationFailure(captured);
      assert.equal(failure.status, "FAILED");
      assert.equal(failure.error.code, "ERR_RPC_TIMEOUT");
      assert.equal(failure.runProvenance.attempts.length, 4);
      assert.deepEqual(failure.runProvenance.validatedEndpoints, []);
      assert.deepEqual(failure.runProvenance.attemptedEndpoints, RPC_ENDPOINTS);
      assert.doesNotMatch(JSON.stringify(failure), /private body/);
      assert.equal(printed, false);
      assert.deepEqual(await artifacts(), before);
    }
  }
});

test("atomic write failure leaves the previous file intact and cleans its temporary file", async (t) => {
  const { dir } = await scratch(t);
  const file = path.join(dir, "smoke-result.json");
  const before = await readFile(file, "utf8");
  const circular = {};
  circular.self = circular;
  await assert.rejects(writeJsonAtomic(file, circular));
  assert.equal(await readFile(file, "utf8"), before);
  assert.ok((await readdir(dir)).every((name) => !name.endsWith(".tmp")));
});

test("direct CLI bad flags produce truthful stderr JSON and nonzero exit without success output or RPC", () => {
  for (const script of ["smoke-testnet.mjs", "reconcile-live.mjs"]) {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", script), "--bad"],
      { cwd: os.tmpdir(), encoding: "utf8", shell: false },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.status, "FAILED");
    assert.match(failure.error.message, /Usage:/);
    assert.equal(failure.runProvenance, null);
  }
});

test("direct CLI transport failure has nonzero exit and native bounded diagnostics without fixture success", () => {
  for (const [script, args] of [
    ["smoke-testnet.mjs", ["commonsops.testnet", "--stdout-only"]],
    ["reconcile-live.mjs", ["--stdout-only"]],
  ]) {
    const target = path.join(ROOT, "scripts", script);
    const source = `globalThis.fetch = async () => new Response("not authorized", {status:403}); process.argv = [process.execPath, ${JSON.stringify(target)}, ...${JSON.stringify(args)}]; await import(${JSON.stringify(pathToFileURL(target).href)});`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", source],
      { cwd: os.tmpdir(), encoding: "utf8", shell: false },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.status, "FAILED");
    assert.equal(failure.error.code, "ERR_RPC_HTTP_STATUS");
    assert.equal(failure.runProvenance.attempts.length, 1);
    assert.equal(failure.runProvenance.attempts[0].httpStatus, 403);
    assert.deepEqual(failure.runProvenance.validatedEndpoints, []);
  }
});

test("unsigned preparer rpcCall compatibility preserves result numbers without granting transaction capability", async () => {
  const expected = {
    block_height: 123,
    keys: [
      { access_key: { nonce: 276384918000000, permission: "FullAccess" } },
    ],
  };
  let calls = 0;
  const fetch = async (url, init) => {
    calls++;
    assert.equal(url, RPC_URL);
    assert.equal(
      JSON.parse(init.body).params.request_type,
      "view_access_key_list",
    );
    return envelope(expected);
  };
  assert.deepEqual(
    await rpcCall(
      "query",
      {
        request_type: "view_access_key_list",
        finality: "final",
        account_id: "commonsops.testnet",
      },
      fetch,
    ),
    expected,
  );
  await assert.rejects(
    rpcCall("EXPERIMENTAL_tx_status", {}, fetch),
    /ERR_RPC_METHOD/,
  );
  assert.equal(calls, 1);
});
