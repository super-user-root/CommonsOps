import assert from "node:assert/strict";
import test from "node:test";
import { LatestTask } from "./latest-task.ts";
import { TransactionEvidence, settleWalletRequest } from "./transactions.ts";
import { RpcContext, rpcCall, RPC_ENDPOINTS } from "./rpc.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test("out-of-order refresh never overwrites newest data; stale state is retained but not current", async () => {
  const task = new LatestTask<string>();
  await task.run("registry", async () => "verified-old");
  const first = deferred<string>();
  const second = deferred<string>();
  let firstSignal!: AbortSignal;
  const a = task.run("registry", (signal) => {
    firstSignal = signal;
    return first.promise;
  });
  assert.equal(task.getSnapshot().data, "verified-old");
  assert.equal(task.current("registry"), null);
  assert.equal(
    await task.run("registry", async () => "duplicate", false),
    false,
  );
  const b = task.run("registry", () => second.promise);
  assert.equal(firstSignal.aborted, true);
  second.resolve("newest");
  await b;
  first.resolve("obsolete");
  await a;
  assert.equal(task.current("registry"), "newest");
  await task.run("registry", async () => {
    throw new Error("down");
  });
  assert.equal(task.getSnapshot().data, "newest");
  assert.equal(task.current("registry"), null);
});
test("account/evidence key changes invalidate intents immediately, latest derivation clears errors", async () => {
  const task = new LatestTask<string>();
  await task.run("account-A/evidence-1", async () => "old-intent");
  assert.equal(task.current("account-B/evidence-1"), null);
  const first = deferred<string>();
  const a = task.run("account-B/evidence-1", () => first.promise);
  await task.run("account-B/evidence-2", async () => {
    throw new Error("invalid");
  });
  first.resolve("wrong-input");
  await a;
  assert.equal(task.current("account-B/evidence-2"), null);
  await task.run("account-B/evidence-2", async () => "valid-intent");
  assert.equal(task.getSnapshot().error, null);
  assert.equal(task.current("account-B/evidence-2"), "valid-intent");
});
test("unmount cancellation prevents late completion and notifications", async () => {
  const task = new LatestTask<string>();
  const pending = deferred<string>();
  let count = 0;
  const unsubscribe = task.subscribe(() => count++);
  const run = task.run("registry", () => pending.promise);
  task.cancel();
  unsubscribe();
  pending.resolve("late");
  await run;
  assert.equal(count, 1);
  assert.equal(task.current("registry"), null);
});
test("deadline and budget abort outstanding responses; late results cannot make stale data READY", async () => {
  for (const phase of ["deadline", "budget"]) {
    const task = new LatestTask<string>();
    await task.run("registry", async () => "previous-verified");
    const pending = deferred<Response>();
    const context = new RpcContext({
      fetch: () => pending.promise,
      limits: {
        deadlineMs: 20,
        timeoutMs: 100,
        maxAttempts: phase === "budget" ? 1 : 4,
        backoffMs: 0,
      },
    });
    await task.run("registry", async () => {
      try {
        const reads = await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            rpcCall(RPC_ENDPOINTS[0], "query", {}, context),
          ),
        );
        const rejected = reads.find((read) => read.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        return "unexpected";
      } finally {
        context.dispose();
      }
    });
    assert.equal(context.signal.aborted, true);
    assert.equal(task.getSnapshot().status, "ERROR");
    pending.resolve(new Response('{"result":"late"}'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(task.getSnapshot().status, "ERROR");
    assert.equal(task.getSnapshot().data, "previous-verified");
    assert.equal(task.current("registry"), null);
  }
});

test("transaction evidence outlives removed/remounted refresh groups and subsequent failures", async () => {
  const evidence = new TransactionEvidence();
  evidence.set("cycle2:0/claim", {
    status: "SUCCESS",
    method: "claim_cycle",
    transactionHash: "hash",
    explorerUrl: "https://explorer.testnet.near.org/transactions/hash",
  });
  const refresh = new LatestTask<string[]>();
  await refresh.run("registry", async () => ["2"]);
  await refresh.run("registry", async () => []);
  await refresh.run("registry", async () => {
    throw new Error("offline");
  });
  evidence.set("cycle2:0/claim", {
    status: "ERROR",
    method: "claim_cycle",
    message: "later failed",
  });
  assert.equal(evidence.records().length, 1);
  assert.match(evidence.records()[0]!.explorerUrl, /testnet/);
  const outcome = await settleWalletRequest(async () => {
    throw new Error("wallet init failed");
  });
  assert.equal(outcome.kind, "ERROR");
});
