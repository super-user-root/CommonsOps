#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bashCommand,
  createDeploymentManifest,
  validateTestnetAccount,
} from "./deployment-lib.mjs";

const input = {
  accountId: "registry.commonsops.testnet",
  managerId: "manager.testnet",
  sourceHead: "a".repeat(40),
  wasmBytes: 261_226,
  wasmSha256: "b".repeat(64),
};

test("builds an unsigned atomic deploy and init manifest", () => {
  const manifest = createDeploymentManifest(input);
  assert.deepEqual(manifest.atomicActions, [
    "DeployContract",
    "FunctionCall:new",
  ]);
  assert.deepEqual(manifest.initArgs, {
    manager_id: "manager.testnet",
    network: "TESTNET",
  });
  assert.equal(manifest.attachedDeposit, "0 NEAR");
  assert.equal(manifest.transactionHash, null);
  assert(!JSON.stringify(manifest).includes("private"));
  assert.deepEqual(manifest.unsignedCommandArgs.slice(-2), [
    "save-to-file",
    "deployments/testnet/unsigned-deploy.transaction",
  ]);
  const command = bashCommand(manifest);
  assert.match(command, /'sign-later'/);
  assert.match(command, /'DeployContract'|deploy/);
  assert(!command.includes("sign-with-keychain"));
});

test("rejects mainnet or malformed account and provenance inputs", () => {
  assert.throws(
    () => validateTestnetAccount("registry.near", "contract account"),
    /named \.testnet account/,
  );
  for (const patch of [
    { sourceHead: "a".repeat(39) },
    { wasmSha256: "z".repeat(64) },
    { wasmBytes: 0 },
  ]) {
    assert.throws(() => createDeploymentManifest({ ...input, ...patch }));
  }
});
