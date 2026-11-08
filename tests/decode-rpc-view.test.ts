import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decodeRpcView, decodeStdin } from "./decode-rpc-view.ts";

const envelope = (value: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: "test",
    result: {
      result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
    },
  });

test("checked view decoder returns object/string/null JSON, not a raw byte array", async () => {
  for (const value of [
    { status: "OPEN", label: "café", claim: null },
    "foundation: no business behavior",
    null,
  ]) {
    assert.deepEqual(decodeRpcView(envelope(value)), value);
    assert.equal(
      await decodeStdin(
        (async function* () {
          yield Buffer.from(envelope(value));
        })(),
      ),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }
});

test("checked view decoder rejects RPC errors, ambiguity, invalid bytes/UTF-8/JSON and duplicates", () => {
  for (const raw of [
    '{"error":{"code":-32600,"message":"invalid"}}',
    '{"error":{},"result":{"result":[110,117,108,108]}}',
    '{"result":{"result":[-1]}}',
    '{"result":{"result":[256]}}',
    '{"result":{"result":[1.5]}}',
    '{"result":{"result":["110"]}}',
    '{"result":{"result":[195,40]}}',
    '{"result":{"result":[123]}}',
    '{"result":null}',
    '{"result":{"result":null}}',
    "not JSON",
    '{"result":{},"result":{}}',
    JSON.stringify({
      result: { result: Array.from(Buffer.from('{"a":1,"a":2}')) },
    }),
  ])
    assert.throws(() => decodeRpcView(raw), raw);
});

test("decoder process succeeds with decoded JSON and fails nonzero with no success stdout", async () => {
  const helper = new URL("decode-rpc-view.ts", import.meta.url);
  for (const value of [{ claim: null }, "marker", null]) {
    const result = spawnSync(process.execPath, [fileURLToPath(helper)], {
      input: envelope(value),
      encoding: "utf8",
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), value);
  }
  const failed = spawnSync(process.execPath, [fileURLToPath(helper)], {
    input: '{"error":{"name":"CONTRACT_EXECUTION_ERROR"}}',
    encoding: "utf8",
    shell: false,
  });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.equal(JSON.parse(failed.stderr).status, "FAILED");
  await assert.rejects(
    decodeStdin(
      (async function* () {
        yield new Uint8Array(2_097_153);
      })(),
    ),
    /ERR_RPC_RESPONSE_LIMIT/,
  );
  await assert.rejects(
    decodeStdin(
      (async function* () {
        yield new Uint8Array([195, 40]);
      })(),
    ),
  );
});
