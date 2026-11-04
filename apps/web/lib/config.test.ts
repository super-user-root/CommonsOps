import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletBoundary,
  emptyRegistryReadState,
  networkConfigs,
} from "./config.ts";

test("testnet and mainnet configurations are explicit and isolated", () => {
  assert.equal(networkConfigs.TESTNET.network, "TESTNET");
  assert.match(networkConfigs.TESTNET.rpcUrl, /testnet/);
  assert.equal(networkConfigs.TESTNET.registryAccountId, null);
  assert.equal(networkConfigs.MAINNET.network, "MAINNET");
  assert.match(networkConfigs.MAINNET.rpcUrl, /mainnet/);
  assert.notEqual(networkConfigs.TESTNET.rpcUrl, networkConfigs.MAINNET.rpcUrl);
  assert(Object.isFrozen(networkConfigs));
});

test("wallet boundary fails closed until connector and deployment exist", async () => {
  const wallet = createWalletBoundary("TESTNET");
  assert.equal(wallet.state.status, "UNAVAILABLE");
  assert.equal(wallet.canRead, false);
  assert.equal(wallet.canSign, false);
  await assert.rejects(wallet.connect(), /WALLET_DISABLED/);
  await assert.rejects(wallet.sign(), /WALLET_DISABLED/);
});

test("read state is unconfigured without a deployed contract", () => {
  assert.deepEqual(emptyRegistryReadState("TESTNET"), {
    network: "TESTNET",
    contractAccountId: null,
    status: "UNCONFIGURED",
    templates: [],
    cycles: [],
    paymentStates: {},
    error: null,
  });
});
