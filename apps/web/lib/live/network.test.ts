import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTestnet,
  explorerAccountUrl,
  explorerTransactionUrl,
  liveNetworkConfigFor,
  MainnetRefusedError,
} from "./network.ts";

test("testnet resolves to the pinned official RPC configuration", () => {
  const config = liveNetworkConfigFor("testnet");
  assert.ok(config);
  assert.equal(config.networkId, "testnet");
  assert.equal(config.nodeUrl, "https://rpc.testnet.near.org");
  assert.equal(config.helperUrl, "https://helper.testnet.near.org");
  assert.ok(config.explorerUrl.includes("testnet"));
  assert.ok(Object.isFrozen(config));
});

test("mainnet resolves to null: it is unconfigured and must never be used", () => {
  assert.equal(liveNetworkConfigFor("mainnet"), null);
  assert.equal(liveNetworkConfigFor("MAINNET"), null);
  assert.equal(liveNetworkConfigFor(""), null);
  assert.equal(liveNetworkConfigFor("localnet"), null);
});

test("assertTestnet throws a named refusal for mainnet and any other network", () => {
  for (const networkId of ["mainnet", "MAINNET", "localnet", ""]) {
    assert.throws(
      () => assertTestnet(networkId),
      (error: unknown) => {
        assert.ok(error instanceof MainnetRefusedError);
        assert.equal(error.code, "ERR_MAINNET_REFUSED");
        assert.match(error.message, /ERR_MAINNET_REFUSED/);
        assert.match(error.message, /testnet-only/);
        assert.equal(error.networkId, networkId);
        return true;
      },
    );
  }
  const config = assertTestnet("testnet");
  assert.equal(config.nodeUrl, "https://rpc.testnet.near.org");
});

test("explorer URLs are testnet-only and validate their inputs", () => {
  const recorded = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
  assert.equal(
    explorerTransactionUrl(recorded),
    `https://explorer.testnet.near.org/transactions/${recorded}`,
  );
  assert.throws(() => explorerTransactionUrl("not-a-hash"));
  assert.throws(() => explorerTransactionUrl(""));
  assert.equal(
    explorerAccountUrl("commonsops.testnet"),
    "https://explorer.testnet.near.org/accounts/commonsops.testnet",
  );
  assert.throws(() => explorerAccountUrl("Bad Account"));
});
