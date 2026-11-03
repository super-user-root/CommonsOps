#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  REVIEWED_CONTRACT_TREE,
  REVIEWED_SOURCE_HEAD,
  REVIEWED_WASM_BYTES,
  REVIEWED_WASM_SHA256,
  base58Encode,
  bashCommand,
  createDeploymentManifest,
  nearCodeHash,
  powerShellCommand,
  validateTestnetAccount,
  verifyDeploymentTransaction,
} from "./deployment-lib.mjs";

const publicKey = `ed25519:${"2".repeat(44)}`;
const blockHash = "3".repeat(44);
const input = {
  accountId: "registry.commonsops.testnet",
  managerId: "manager.testnet",
  signerPublicKey: publicKey,
  nonce: 42,
  blockHash,
  preDeployment: {
    blockHash,
    blockHeight: 100,
    codeHash: "11111111111111111111111111111111",
    storageUsage: 182,
    amount: "1000000000000000000000000",
    locked: "0",
  },
  sourceHead: REVIEWED_SOURCE_HEAD,
  contractTree: REVIEWED_CONTRACT_TREE,
  wasmBytes: REVIEWED_WASM_BYTES,
  wasmSha256: REVIEWED_WASM_SHA256,
};

function fakeTransaction(manifest, code = Buffer.alloc(REVIEWED_WASM_BYTES)) {
  // Synthetic zero bytes are useful for fail-closed negative cases; positive tests pass reviewed bytes.
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash: manifest.transactionHash,
      signer_id: manifest.contractAccountId,
      receiver_id: manifest.contractAccountId,
      public_key: manifest.signerPublicKey,
      nonce: manifest.nonce,
      actions: [
        { DeployContract: { code: code.toString("base64") } },
        {
          FunctionCall: {
            method_name: "new",
            args: Buffer.from(JSON.stringify(manifest.initArgs)).toString(
              "base64",
            ),
            gas: manifest.prepaidGas,
            deposit: manifest.attachedDeposit,
          },
        },
      ],
    },
    transaction_outcome: {
      block_hash: "5".repeat(44),
      outcome: { status: { SuccessReceiptId: "6".repeat(44) } },
    },
    receipts_outcome: [
      {
        id: "6".repeat(44),
        block_hash: "7".repeat(44),
        outcome: {
          logs: [
            'EVENT_JSON:{"standard":"commonsops","version":"1.0.0","event":"registry_initialized","data":[]}',
          ],
          status: { SuccessValue: "" },
        },
      },
    ],
  };
}

test("builds shell-specific unsigned atomic deploy and init manifest", () => {
  const manifest = createDeploymentManifest(input);
  assert.deepEqual(manifest.atomicActions, [
    "DeployContract",
    "FunctionCall:new",
  ]);
  assert.deepEqual(manifest.initArgs, {
    manager_id: "manager.testnet",
    network: "TESTNET",
  });
  assert.equal(manifest.attachedDeposit, "0");
  assert.equal(manifest.transactionHash, null);
  assert(!JSON.stringify(manifest).includes("private"));
  assert.equal(
    manifest.artifactPath,
    `deployments/testnet/artifacts/${REVIEWED_WASM_SHA256}.wasm`,
  );
  assert.match(bashCommand(manifest), /^'near' /);
  assert.match(powerShellCommand(manifest), /^& near /);
  assert(!bashCommand(manifest).includes("sign-with-keychain"));
});

test("rejects mainnet, unreviewed source, artifact, and incomplete signer inputs", () => {
  assert.throws(() =>
    validateTestnetAccount("registry.near", "contract account"),
  );
  for (const patch of [
    { contractTree: "a".repeat(40) },
    { wasmSha256: "b".repeat(64) },
    { wasmBytes: 0 },
    { signerPublicKey: "<PUBLIC_KEY>" },
    { nonce: 0 },
    { blockHash: "<BLOCK_HASH>" },
    { preDeployment: { ...input.preDeployment, blockHash: "7".repeat(44) } },
  ]) {
    assert.throws(() => createDeploymentManifest({ ...input, ...patch }));
  }
});

test("transaction verifier rejects wrong action order and code", () => {
  const manifest = createDeploymentManifest(input);
  const transaction = fakeTransaction(manifest);
  // Synthetic zero bytes cannot match the reviewed artifact.
  assert.throws(
    () => verifyDeploymentTransaction(manifest, transaction),
    /WASM does not match/,
  );
  transaction.transaction.actions.reverse();
  assert.throws(() => verifyDeploymentTransaction(manifest, transaction));
});

test("transaction verifier accepts exact reviewed atomic receipt provenance", async () => {
  const wasmPath = path.resolve(
    import.meta.dirname,
    "../contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
  );
  const code = await readFile(wasmPath);
  const manifest = createDeploymentManifest(input);
  manifest.transactionHash = "4".repeat(44);
  manifest.status = "DEPLOYED";
  const verified = verifyDeploymentTransaction(
    manifest,
    fakeTransaction(manifest, code),
  );
  assert.equal(verified.transactionHash, "4".repeat(44));
  assert.equal(verified.transactionBlockHash, "5".repeat(44));
  assert.equal(verified.postStateBlockHash, "7".repeat(44));
  assert.deepEqual(verified.receiptIds, ["6".repeat(44)]);
});

test("transaction verifier rejects mismatched transaction identity and unknown outcomes", async () => {
  const code = await readFile(
    path.resolve(
      import.meta.dirname,
      "../contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
    ),
  );
  for (const mutate of [
    (tx) => (tx.transaction.hash = "8".repeat(44)),
    (tx) => (tx.transaction.public_key = `ed25519:${"9".repeat(44)}`),
    (tx) => (tx.transaction.nonce += 1),
    (tx) => (tx.transaction_outcome.outcome.status = {}),
    (tx) => (tx.receipts_outcome[0].outcome.status = {}),
  ]) {
    const manifest = createDeploymentManifest(input);
    manifest.transactionHash = "4".repeat(44);
    manifest.status = "DEPLOYED";
    const transaction = fakeTransaction(manifest, code);
    mutate(transaction);
    assert.throws(() => verifyDeploymentTransaction(manifest, transaction));
  }
});

test("base58 NEAR code hash uses SHA-256 bytes", () => {
  const bytes = Buffer.alloc(32);
  const digestBytes = createHash("sha256").update(bytes).digest();
  assert.equal(nearCodeHash(bytes), base58Encode(digestBytes));
  assert.equal(
    base58Encode(Buffer.alloc(32)),
    "11111111111111111111111111111111",
  );
});
