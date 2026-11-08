#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeCallFunctionResult } from "../packages/near/src/read-only-rpc.ts";
import {
  RPC_URL,
  REVIEWED_WASM_SHA256,
  assertReviewedArtifact,
  historicalRun,
  isMain,
  nearCodeHash,
  parseReadOnlyArgs,
  rpcCall,
  validateTestnetAccount,
  verificationFailure,
  verifyDeploymentTransaction,
  wasmDigest,
  writeJsonAtomic,
} from "./deployment-lib.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const USAGE =
  "Usage: node scripts/smoke-testnet.mjs <contract-account.testnet> [--stdout-only]";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export function parseArgs(argv) {
  return parseReadOnlyArgs(argv, { accountRequired: true, usage: USAGE });
}

export async function verifySmoke(manifest, accountId, options = {}) {
  validateTestnetAccount(accountId, "contract account");
  if (
    manifest?.contractAccountId !== accountId ||
    manifest.wasmSha256 !== REVIEWED_WASM_SHA256 ||
    manifest.status !== "DEPLOYED" ||
    manifest.network !== "testnet"
  )
    throw new Error("Prepared deployment manifest is incomplete or mismatched");
  assertReviewedArtifact({
    contractTree: manifest.contractTree,
    wasmBytes: manifest.wasmBytes,
    wasmSha256: manifest.wasmSha256,
  });
  if (!HASH.test(manifest.transactionHash ?? ""))
    throw new Error("Deployment transaction hash is missing");
  const post = manifest.postDeployment;
  if (
    !post ||
    !HASH.test(post.blockHash ?? "") ||
    !Number.isSafeInteger(post.blockHeight) ||
    post.blockHeight < 0
  )
    throw new Error("Post-initialization block identity is missing or invalid");
  const block = { hash: post.blockHash, height: String(post.blockHeight) };
  const txParams = {
    tx_hash: manifest.transactionHash,
    sender_account_id: accountId,
    wait_until: "FINAL",
  };
  const query = (requestType) => ({
    request_type: requestType,
    block_id: block.hash,
    account_id: accountId,
  });
  const accountParams = query("view_account");
  const codeParams = query("view_code");
  const viewParams = {
    ...query("call_function"),
    method_name: "foundation_status",
    args_base64: "e30=",
  };
  const reads = [
    { method: "EXPERIMENTAL_tx_status", params: txParams },
    ...[accountParams, codeParams, viewParams].map((params) => ({
      method: "query",
      params,
      block,
    })),
  ];

  // Four logical calls, at most two attempts at each of two official endpoints.
  const { value, runProvenance } = await historicalRun(
    reads,
    16,
    options,
    async (context) => {
      const verified = await rpcCall(
        "EXPERIMENTAL_tx_status",
        txParams,
        context,
        (transaction) => {
          const verified = verifyDeploymentTransaction(manifest, transaction);
          if (
            JSON.stringify(verified.receiptIds) !==
            JSON.stringify(manifest.receipts)
          )
            throw new Error(
              "Manifest receipt IDs differ from finalized transaction",
            );
          if (
            verified.postStateBlockHash !== block.hash ||
            verified.transactionBlockHash !==
              manifest.broadcast?.transactionBlockHash
          )
            throw new Error(
              "Finalized initialization transaction or receipt block differs from manifest",
            );
          return verified;
        },
      );
      const account = await rpcCall(
        "query",
        accountParams,
        context,
        (account) => {
          if (
            account.code_hash !== post.codeHash ||
            !Number.isSafeInteger(account.storage_usage) ||
            account.storage_usage < 0 ||
            typeof account.amount !== "string" ||
            typeof account.locked !== "string" ||
            !/^(0|[1-9][0-9]*)$/.test(account.amount) ||
            !/^(0|[1-9][0-9]*)$/.test(account.locked)
          )
            throw new Error(
              "Onchain account state does not match post-deployment provenance",
            );
          return account;
        },
      );
      const code = await rpcCall("query", codeParams, context, (code) => {
        // view_code is base64 WASM, NOT call_function's 64KiB JSON byte array.
        // The transport's 2MiB stream bound applies before this strict decode.
        if (typeof code.code_base64 !== "string")
          throw new Error("Onchain code_base64 is missing");
        const bytes = Buffer.from(code.code_base64, "base64");
        if (bytes.toString("base64") !== code.code_base64)
          throw new Error("Onchain code_base64 is not canonical");
        const sha256 = wasmDigest(bytes);
        assertReviewedArtifact({
          contractTree: manifest.contractTree,
          wasmBytes: bytes.length,
          wasmSha256: sha256,
        });
        if (
          nearCodeHash(bytes) !== account.code_hash ||
          (code.hash !== undefined && code.hash !== account.code_hash)
        )
          throw new Error(
            "Onchain code or post-deployment provenance does not match reviewed artifact",
          );
        return { sha256, length: bytes.length };
      });
      const foundationStatus = await rpcCall(
        "query",
        viewParams,
        context,
        (view) => {
          const status = decodeCallFunctionResult(view, context.limits);
          if (status !== "foundation: no business behavior")
            throw new Error("Unexpected foundation_status");
          return status;
        },
      );
      context.check();
      return {
        network: "testnet",
        rpcUrl: RPC_URL,
        accountId,
        sourceHead: manifest.sourceHead,
        transactionHash: verified.transactionHash,
        receiptIds: verified.receiptIds,
        pinnedBlockHash: block.hash,
        pinnedBlockHeight: account.block_height,
        preCodeHash: manifest.preDeployment.codeHash,
        postCodeHash: account.code_hash,
        wasmSha256: code.sha256,
        wasmBytes: code.length,
        storageUsage: account.storage_usage,
        amount: account.amount,
        locked: account.locked,
        foundationStatus,
      };
    },
  );
  return { ...value, runProvenance };
}

export async function main(
  argv = process.argv.slice(2),
  { root = ROOT, rpc = {}, stdout = (text) => process.stdout.write(text) } = {},
) {
  const { accountId, stdoutOnly } = parseArgs(argv);
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "deployments/testnet/prepared-deployment.json"),
      "utf8",
    ),
  );
  const result = await verifySmoke(manifest, accountId, rpc);
  if (!stdoutOnly)
    await writeJsonAtomic(
      path.join(root, "deployments/testnet/smoke-result.json"),
      result,
    );
  stdout(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(verificationFailure(error), null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}
