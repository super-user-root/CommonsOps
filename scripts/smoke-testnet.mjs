#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RPC_URL,
  REVIEWED_WASM_SHA256,
  nearCodeHash,
  rpcCall,
  verifyDeploymentTransaction,
  wasmDigest,
} from "./deployment-lib.mjs";

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
if (
  manifest.contractAccountId !== accountId ||
  manifest.wasmSha256 !== REVIEWED_WASM_SHA256 ||
  manifest.status !== "DEPLOYED"
) {
  throw new Error("Prepared deployment manifest is incomplete or mismatched");
}
if (!/^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(manifest.transactionHash ?? "")) {
  throw new Error("Deployment transaction hash is missing");
}
const transaction = await rpcCall("EXPERIMENTAL_tx_status", {
  tx_hash: manifest.transactionHash,
  sender_account_id: accountId,
  wait_until: "FINAL",
});
const verified = verifyDeploymentTransaction(manifest, transaction);
if (JSON.stringify(verified.receiptIds) !== JSON.stringify(manifest.receipts)) {
  throw new Error("Manifest receipt IDs differ from finalized transaction");
}
const pinnedBlock = verified.finalizedBlockHash;
const account = await rpcCall("query", {
  request_type: "view_account",
  block_id: pinnedBlock,
  account_id: accountId,
});
const code = await rpcCall("query", {
  request_type: "view_code",
  block_id: pinnedBlock,
  account_id: accountId,
});
const onchainBytes = Buffer.from(code.code_base64, "base64");
const onchainSha256 = wasmDigest(onchainBytes);
const expectedCodeHash = nearCodeHash(onchainBytes);
if (
  onchainSha256 !== REVIEWED_WASM_SHA256 ||
  expectedCodeHash !== account.code_hash ||
  manifest.postDeployment?.blockHash !== pinnedBlock ||
  manifest.postDeployment?.codeHash !== account.code_hash
) {
  throw new Error(
    "Onchain code or post-deployment provenance does not match reviewed artifact",
  );
}
const view = await rpcCall("query", {
  request_type: "call_function",
  block_id: pinnedBlock,
  account_id: accountId,
  method_name: "foundation_status",
  args_base64: "e30=",
});
const status = Buffer.from(view.result).toString("utf8");
if (status !== '"foundation: no business behavior"') {
  throw new Error(`Unexpected foundation_status: ${status}`);
}
const result = {
  network: "testnet",
  rpcUrl: RPC_URL,
  accountId,
  sourceHead: manifest.sourceHead,
  transactionHash: verified.transactionHash,
  receiptIds: verified.receiptIds,
  pinnedBlockHash: pinnedBlock,
  pinnedBlockHeight: account.block_height,
  preCodeHash: manifest.preDeployment.codeHash,
  postCodeHash: account.code_hash,
  wasmSha256: onchainSha256,
  wasmBytes: onchainBytes.length,
  storageUsage: account.storage_usage,
  amount: account.amount,
  locked: account.locked,
  foundationStatus: JSON.parse(status),
};
await writeFile(
  path.join(root, "deployments", "testnet", "smoke-result.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
