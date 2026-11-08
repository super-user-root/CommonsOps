#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadDeployedWasm } from "../tests/fixtures/deployment/fixture.mjs";
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
  const code = await loadDeployedWasm();
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

test("deployed fixture pins exact bytes and rejects mutations even with valid WASM structure", async () => {
  const code = await loadDeployedWasm();
  assert.ok(WebAssembly.validate(code));
  const manifest = createDeploymentManifest(input);
  manifest.transactionHash = "4".repeat(44);
  manifest.status = "DEPLOYED";
  verifyDeploymentTransaction(manifest, fakeTransaction(manifest, code));
  const changedByte = Buffer.from(code);
  changedByte[changedByte.length - 1] ^= 1;
  // A custom section leaves executable structure/exports unchanged, but these
  // different bytes must never be accepted as the immutable deployed artifact.
  const structurallyValidDifferent = Buffer.concat([
    code,
    Buffer.from([0, 2, 1, 120]),
  ]);
  assert.ok(WebAssembly.validate(structurallyValidDifferent));
  for (const changed of [
    changedByte,
    code.subarray(0, code.length - 1),
    structurallyValidDifferent,
  ])
    assert.throws(
      () =>
        verifyDeploymentTransaction(
          manifest,
          fakeTransaction(manifest, changed),
        ),
      /WASM does not match the reviewed artifact/,
    );
  assert.equal(
    createHash("sha256").update(code).digest("hex"),
    REVIEWED_WASM_SHA256,
  );
});

test("transaction verifier accepts the nearcore 32-byte code view and rejects other lengths", async () => {
  // Current nearcore RPC transaction views replace the DeployContract code
  // with a 32-byte internal identifier instead of echoing the full WASM.
  const manifest = createDeploymentManifest(input);
  manifest.transactionHash = "4".repeat(44);
  manifest.status = "DEPLOYED";
  const verified = verifyDeploymentTransaction(
    manifest,
    fakeTransaction(manifest, Buffer.alloc(32, 1)),
  );
  assert.equal(verified.transactionHash, "4".repeat(44));
  assert.deepEqual(verified.receiptIds, ["6".repeat(44)]);
  for (const length of [0, 1, 31, 33, 261_225, 261_227]) {
    assert.throws(() =>
      verifyDeploymentTransaction(
        manifest,
        fakeTransaction(manifest, Buffer.alloc(length, 1)),
      ),
    );
  }
});

test("transaction verifier rejects mismatched transaction identity and unknown outcomes", async () => {
  const code = await loadDeployedWasm();
  for (const [mutate, reason] of [
    [
      (tx) => (tx.transaction.hash = "8".repeat(44)),
      /hash\/key\/nonce\/signer\/receiver/,
    ],
    [
      (tx) => (tx.transaction.public_key = `ed25519:${"9".repeat(44)}`),
      /hash\/key\/nonce\/signer\/receiver/,
    ],
    [(tx) => (tx.transaction.nonce += 1), /hash\/key\/nonce\/signer\/receiver/],
    [
      (tx) => (tx.transaction_outcome.outcome.status = {}),
      /missing, unknown or failed outcomes/,
    ],
    [
      (tx) => (tx.receipts_outcome[0].outcome.status = {}),
      /missing, unknown or failed outcomes/,
    ],
  ]) {
    const manifest = createDeploymentManifest(input);
    manifest.transactionHash = "4".repeat(44);
    manifest.status = "DEPLOYED";
    const transaction = fakeTransaction(manifest, code);
    // Positive control ensures each negative reaches its intended validator.
    verifyDeploymentTransaction(manifest, transaction);
    mutate(transaction);
    assert.throws(
      () => verifyDeploymentTransaction(manifest, transaction),
      reason,
    );
  }
});

test("transaction verifier rejects an unrelated initialization event receipt", async () => {
  const code = await loadDeployedWasm();
  const manifest = createDeploymentManifest(input);
  manifest.transactionHash = "4".repeat(44);
  manifest.status = "DEPLOYED";
  const transaction = fakeTransaction(manifest, code);
  verifyDeploymentTransaction(manifest, transaction);
  transaction.receipts_outcome[0].outcome.logs = [];
  transaction.receipts_outcome.push({
    id: "8".repeat(44),
    block_hash: "9".repeat(44),
    outcome: {
      logs: [
        'EVENT_JSON:{"standard":"commonsops","version":"1.0.0","event":"registry_initialized","data":[]}',
      ],
      status: { SuccessValue: "" },
    },
  });
  assert.throws(
    () => verifyDeploymentTransaction(manifest, transaction),
    /initialization receipt is missing/,
  );
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
