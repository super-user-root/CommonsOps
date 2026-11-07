import assert from "node:assert/strict";
import test from "node:test";
import { emptyRegistryReadState, networkConfigs } from "./config.ts";

test("testnet is the deployed registry network and mainnet stays isolated", () => {
  assert.equal(networkConfigs.TESTNET.network, "TESTNET");
  assert.match(networkConfigs.TESTNET.rpcUrl, /testnet/);
  assert.equal(networkConfigs.TESTNET.rpcUrl, "https://rpc.testnet.near.org");
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
