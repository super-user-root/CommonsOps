import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletBoundary,
  emptyRegistryReadState,
  networkConfigs,
} from "./config.ts";

test("testnet is the deployed registry network and mainnet stays isolated", () => {
  assert.equal(networkConfigs.TESTNET.network, "TESTNET");
  assert.match(networkConfigs.TESTNET.rpcUrl, /testnet/);
  assert.equal(networkConfigs.TESTNET.registryAccountId, "commonsops.testnet");
  assert.equal(networkConfigs.TESTNET.deployed, true);
  assert.equal(networkConfigs.MAINNET.network, "MAINNET");
  assert.match(networkConfigs.MAINNET.rpcUrl, /mainnet/);
  assert.equal(networkConfigs.MAINNET.registryAccountId, null);
  assert.equal(networkConfigs.MAINNET.deployed, false);
  assert.notEqual(networkConfigs.TESTNET.rpcUrl, networkConfigs.MAINNET.rpcUrl);
  assert.notEqual(
    networkConfigs.TESTNET.registryAccountId,
    networkConfigs.MAINNET.registryAccountId,
  );
  assert(Object.isFrozen(networkConfigs));
});

test("wallet boundary fails closed on every network even with a deployment", async () => {
  const testnet = createWalletBoundary("TESTNET");
  assert.equal(testnet.state.status, "UNAVAILABLE");
  assert.equal(
    testnet.state.reason,
    "No supported wallet connector is configured.",
  );
  assert.equal(testnet.canRead, false);
  assert.equal(testnet.canSign, false);
  await assert.rejects(testnet.connect(), /WALLET_DISABLED/);
  await assert.rejects(testnet.sign(), /WALLET_DISABLED/);

  const mainnet = createWalletBoundary("MAINNET");
  assert.equal(mainnet.state.status, "UNAVAILABLE");
  assert.equal(
    mainnet.state.reason,
    "No mainnet registry deployment is configured.",
  );
  await assert.rejects(mainnet.connect(), /WALLET_DISABLED/);
  await assert.rejects(mainnet.sign(), /WALLET_DISABLED/);
});

test("read state is unconfigured on mainnet and pinned to the deployed testnet registry", () => {
  assert.deepEqual(emptyRegistryReadState("TESTNET"), {
    network: "TESTNET",
    contractAccountId: "commonsops.testnet",
    status: "LOADING",
    templates: [],
    cycles: [],
    paymentStates: {},
    error: null,
  });
  assert.deepEqual(emptyRegistryReadState("MAINNET"), {
    network: "MAINNET",
    contractAccountId: null,
    status: "UNCONFIGURED",
    templates: [],
    cycles: [],
    paymentStates: {},
    error: null,
  });
});
