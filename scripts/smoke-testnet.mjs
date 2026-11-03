#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const accountId = process.argv[2];
if (!accountId || !accountId.endsWith(".testnet")) {
  throw new Error(
    "Usage: node scripts/smoke-testnet.mjs <contract-account.testnet>",
  );
}
const manifestPath = path.join(
  root,
  "deployments",
  "testnet",
  "prepared-deployment.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.contractAccountId !== accountId) {
  throw new Error("Account differs from prepared deployment manifest");
}
const rpc = "https://rpc.testnet.near.org";
async function rpcCall(method, params) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "commonsops-smoke",
      method,
      params,
    }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}
const account = await rpcCall("query", {
  request_type: "view_account",
  finality: "final",
  account_id: accountId,
});
const view = await rpcCall("query", {
  request_type: "call_function",
  finality: "final",
  account_id: accountId,
  method_name: "foundation_status",
  args_base64: "e30=",
});
const status = Buffer.from(view.result).toString("utf8");
if (status !== '"foundation: no business behavior"') {
  throw new Error(`Unexpected foundation_status: ${status}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      network: "testnet",
      accountId,
      blockHeight: account.block_height,
      blockHash: account.block_hash,
      codeHash: account.code_hash,
      storageUsage: account.storage_usage,
      amount: account.amount,
      locked: account.locked,
      foundationStatus: JSON.parse(status),
      preparedWasmSha256: manifest.wasmSha256,
      preparedSourceHead: manifest.sourceHead,
      transactionHash: manifest.transactionHash,
    },
    null,
    2,
  )}\n`,
);
