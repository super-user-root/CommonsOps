#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  REVIEWED_SOURCE_HEAD,
  REVIEWED_WASM_BYTES,
  REVIEWED_WASM_SHA256,
  bashCommand,
  createDeploymentManifest,
  powerShellCommand,
  rpcCall,
  wasmDigest,
} from "./deployment-lib.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const releaseWasm = path.join(
  root,
  "contracts",
  "registry",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "commonsops_registry.wasm",
);
const [accountId, managerId = accountId ?? ""] = process.argv.slice(2);
if (!accountId || !managerId) {
  throw new Error(
    "Usage: node scripts/prepare-testnet-deployment.mjs <existing-contract-account.testnet> [manager-account.testnet]",
  );
}
const sourceHead = (
  await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    windowsHide: true,
  })
).stdout.trim();
if (sourceHead !== REVIEWED_SOURCE_HEAD) {
  throw new Error(
    `Checkout HEAD ${sourceHead} is not reviewed ${REVIEWED_SOURCE_HEAD}`,
  );
}
const status = (
  await execFileAsync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    {
      cwd: root,
      windowsHide: true,
    },
  )
).stdout.trim();
if (status)
  throw new Error("Tracked worktree files must be clean before preparation");
const bytes = await readFile(releaseWasm);
const digest = wasmDigest(bytes);
if (digest !== REVIEWED_WASM_SHA256 || bytes.length !== REVIEWED_WASM_BYTES) {
  throw new Error("Current WASM differs from the reviewed artifact");
}
const accessKey = await rpcCall("query", {
  request_type: "view_access_key_list",
  finality: "final",
  account_id: accountId,
});
const fullAccess = accessKey.keys.filter(
  (entry) => entry.access_key.permission === "FullAccess",
);
if (fullAccess.length !== 1) {
  throw new Error(
    `Expected exactly one full-access key; found ${fullAccess.length}`,
  );
}
const signerPublicKey = fullAccess[0].public_key;
const nonce = Number(fullAccess[0].access_key.nonce) + 1;
if (!Number.isSafeInteger(nonce))
  throw new Error("Access-key nonce is not a safe integer");
const blockHash = accessKey.block_hash;
const preAccount = await rpcCall("query", {
  request_type: "view_account",
  block_id: blockHash,
  account_id: accountId,
});
const preDeployment = {
  blockHash,
  blockHeight: preAccount.block_height,
  codeHash: preAccount.code_hash,
  storageUsage: preAccount.storage_usage,
  amount: preAccount.amount,
  locked: preAccount.locked,
};
const artifactDirectory = path.join(
  root,
  "deployments",
  "testnet",
  "artifacts",
);
await mkdir(artifactDirectory, { recursive: true });
const artifactPath = path.join(artifactDirectory, `${digest}.wasm`);
await copyFile(releaseWasm, artifactPath);
const copied = await readFile(artifactPath);
if (wasmDigest(copied) !== digest || copied.length !== bytes.length) {
  throw new Error("Content-addressed WASM copy verification failed");
}
const manifest = createDeploymentManifest({
  accountId,
  managerId,
  signerPublicKey,
  nonce,
  blockHash,
  preDeployment,
  sourceHead,
  wasmBytes: bytes.length,
  wasmSha256: digest,
});
await writeFile(
  path.join(root, "deployments", "testnet", "prepared-deployment.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `${JSON.stringify(
    {
      wasmSha256: manifest.wasmSha256,
      wasmBytes: manifest.wasmBytes,
      signerPublicKey,
      nonce,
      recentBlockHash: blockHash,
      bash: bashCommand(manifest),
      powershell: powerShellCommand(manifest),
    },
    null,
    2,
  )}\n`,
);
