// Test-only immutable deployed artifact. Never substitute a fresh host build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  REVIEWED_CONTRACT_TREE,
  REVIEWED_WASM_BYTES,
  REVIEWED_WASM_SHA256,
  assertReviewedArtifact,
  nearCodeHash,
} from "../../../scripts/deployment-lib.mjs";

export const DEPLOYED_WASM_PATH =
  "tests/fixtures/deployment/9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c.wasm";
const ROOT = new URL("../../../", import.meta.url);

export async function loadDeployedWasm() {
  const bytes = await readFile(new URL(DEPLOYED_WASM_PATH, ROOT));
  const manifest = JSON.parse(
    await readFile(
      new URL("deployments/testnet/prepared-deployment.json", ROOT),
      "utf8",
    ),
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(bytes.length, 261_226);
  assert.equal(
    sha256,
    "9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c",
  );
  assert.equal(bytes.length, REVIEWED_WASM_BYTES);
  assert.equal(sha256, REVIEWED_WASM_SHA256);
  assert.equal(manifest.status, "DEPLOYED");
  assert.equal(manifest.contractTree, REVIEWED_CONTRACT_TREE);
  assert.equal(manifest.wasmBytes, bytes.length);
  assert.equal(manifest.wasmSha256, sha256);
  assert.equal(
    nearCodeHash(bytes),
    "Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP",
  );
  assert.equal(nearCodeHash(bytes), manifest.postDeployment.codeHash);
  assertReviewedArtifact({
    contractTree: manifest.contractTree,
    wasmBytes: bytes.length,
    wasmSha256: sha256,
  });
  return bytes;
}
