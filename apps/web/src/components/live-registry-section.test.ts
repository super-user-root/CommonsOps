import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const componentPath = path.resolve(
  import.meta.dirname,
  "live-registry-section.tsx",
);
const providerPath = path.resolve(
  import.meta.dirname,
  "live-wallet-provider.tsx",
);
const headerPath = path.resolve(
  import.meta.dirname,
  "header-wallet-button.tsx",
);
const pagePath = path.resolve(import.meta.dirname, "../../app/page.tsx");
const walletLoaderPath = path.resolve(
  import.meta.dirname,
  "../../lib/live/wallet.ts",
);

test("live section keeps the required label, honest states, and scoped heading", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(
    component,
    /Live registry · NEAR testnet — connect a wallet to interact/,
  );
  assert.match(component, /id="live-registry"/);
  assert.match(component, /aria-labelledby="live-registry-heading"/);
  // Snapshot-dependent cards render once the live read succeeds.
  for (const id of [
    "live-template-heading",
    "live-latest-cycle-heading",
    "live-next-cycle-heading",
  ]) {
    assert.match(component, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  // Honest states: loading, named error without fallback data, retry.
  assert.match(
    component,
    /Querying \{registryAccountId\} at a NEAR testnet final block/,
  );
  assert.match(component, /No\s+fallback\s+data is shown/);
  assert.match(component, /Re-read live state/);
  // No open cycle yet is rendered honestly for the next period.
  assert.match(
    component,
    /No cycle for period \{nextPeriodIndex \?\? "\?"\} yet/,
  );
  // Wallet rejection is honest: no request sent.
  assert.match(component, /describeLiveRequest/);
  // Operator methods stay display-only and the DAO payout note is present.
  assert.match(component, /display-only/);
  assert.match(component, /docs\/testnet-journey\.md/);
});

test("live section derives actions only from the reviewed intent builders", async () => {
  const component = await readFile(componentPath, "utf8");
  for (const builder of [
    "deriveContributorCycleView",
    "contributorCycleIntent",
    "evidenceSubmissionPreview",
  ]) {
    assert.match(component, new RegExp(builder));
  }
  // The four contributor methods and no operator method are sendable.
  for (const method of [
    "claim_cycle",
    "release_claim",
    "expire_cycle_or_claim",
    "submit_evidence",
  ]) {
    assert.match(component, new RegExp(`"${method}"`));
  }
  assert.doesNotMatch(component, /"materialize_cycle"/);
  assert.doesNotMatch(component, /"create_template"/);
  assert.doesNotMatch(component, /"link_proposal"/);
});

test("wallet code loads client-side only and holds no keys", async () => {
  const loader = await readFile(walletLoaderPath, "utf8");
  // Every wallet-selector import is a dynamic import inside the factory.
  assert.match(
    loader,
    /await Promise\.all\(\[\s*import\("@near-wallet-selector\/core"\)/,
  );
  assert.doesNotMatch(
    loader,
    /import\s+(?!type)\{[^}]*\}\s+from\s+"@near-wallet-selector\//,
  );
  assert.match(loader, /assertTestnet\(networkId\)/);

  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /"use client"/);
  assert.match(provider, /signAndSendTransactions/);

  const header = await readFile(headerPath, "utf8");
  assert.match(header, /"use client"/);
  assert.match(header, /Connect testnet wallet/);
  assert.match(header, /Disconnect/);
});

test("page mounts the provider once and the header uses the live control", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.equal(page.split("<LiveWalletProvider>").length - 1, 1);
  assert.equal(page.split("</LiveWalletProvider>").length - 1, 1);
  assert.match(page, /<HeaderWalletButton \/>/);
  assert.match(
    page,
    /<LiveRegistrySection registryAccountId=\{registryAccountId\} \/>/,
  );
  assert.doesNotMatch(page, /Wallet unavailable/);
  assert.doesNotMatch(
    page,
    /disabled\s+aria-describedby="wallet-disabled-reason"/,
  );
  // The recorded journey stages remain, still labeled recorded.
  assert.match(page, /id="operator-stage"/);
  assert.match(page, /id="contributor-stage"/);
  assert.match(page, /id="reviewer-stage"/);
  assert.match(page, /Recorded live journey · NEAR testnet/);
});
