import assert from "node:assert/strict";
import { test } from "node:test";
import { foundationMetadata } from "@commonsops/domain";
import { adapterFoundationMetadata } from "@commonsops/near";
import { siteMetadata } from "../apps/web/lib/site.ts";

test("domain export is immutable foundation metadata, not business state", () => {
  assert.deepEqual(foundationMetadata, {
    name: "CommonsOps",
    stage: "foundation",
    businessBehaviorImplemented: false,
  });
  assert.ok(Object.isFrozen(foundationMetadata));
  assert.equal(Reflect.set(foundationMetadata, "stage", "live"), false);
  assert.equal(foundationMetadata.stage, "foundation");
});

test("NEAR adapter export enables no network, wallet, reads, or transactions", () => {
  assert.deepEqual(adapterFoundationMetadata, {
    stage: "foundation",
    networkConfigured: false,
    walletConnected: false,
    liveReadsEnabled: false,
    transactionsEnabled: false,
  });
  assert.ok(Object.isFrozen(adapterFoundationMetadata));
});

test("shell metadata accurately describes the scaffold", () => {
  assert.equal(siteMetadata.title, "CommonsOps | Foundation");
  assert.match(siteMetadata.description, /No live data or transactions/);
  assert.equal(siteMetadata.stage, "foundation");
  assert.equal(siteMetadata.liveData, false);
  assert.equal(siteMetadata.transactions, false);
});
