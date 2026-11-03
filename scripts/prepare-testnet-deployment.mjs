#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bashCommand,
  createDeploymentManifest,
  wasmDigest,
} from "./deployment-lib.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const wasm = path.join(
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
    "Usage: node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]",
  );
}
const bytes = await readFile(wasm);
const sourceHead = process.env.COMMONSOPS_SOURCE_HEAD ?? "";
const manifest = createDeploymentManifest({
  accountId,
  managerId,
  sourceHead,
  wasmBytes: bytes.length,
  wasmSha256: wasmDigest(bytes),
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
      unsignedCommand: bashCommand(manifest),
    },
    null,
    2,
  )}\n`,
);
