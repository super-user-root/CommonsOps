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
const readsPath = path.resolve(
  import.meta.dirname,
  "../../lib/live/registry-reads.ts",
);

test("live section keeps the required label, honest states, and scoped heading", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(
    component,
    /Live registry · NEAR testnet — connect a wallet to interact/,
  );
  assert.match(component, /id="live-registry"/);
  assert.match(component, /aria-labelledby="live-registry-heading"/);
  // Honest states: loading, named error without fallback data, retry.
  assert.match(
    component,
    /Querying \{registryAccountId\} at a NEAR testnet final block/,
  );
  assert.match(component, /No\s+fallback\s+data is shown/);
  assert.match(component, /View recorded testnet evidence — not a live result/);
  assert.match(
    component,
    /className="live-recovery-actions"[\s\S]*?href="#journey"/,
  );
  assert.match(component, /Cycle 2:0 is one global shared slot/);
  assert.match(component, /immutable evidence\s+submission prevents release/);
  assert.match(component, /node --test tests\/e2e\/e2e-replay.test.ts/);
  assert.match(component, /Re-read live state/);
  // Per-template read errors are named and do not invent data.
  assert.match(component, /[Tt]emplate discovery interrupted/);
  // No open cycle yet is rendered honestly for a template's next period.
  assert.match(
    component,
    /No cycle for period \{read\.template\.next_period_index\} yet/,
  );
  // Wallet rejection is honest: no request sent.
  assert.match(component, /describeLiveRequest/);
  // Operator methods stay display-only and the DAO payout note is present.
  assert.match(component, /display-only/);
  assert.match(component, /docs\/testnet-journey\.md/);
  // Foundation status is a global read in the meta strip.
  assert.match(component, /Foundation status:/);
});

test("every template has a stable summary and only selected validated detail/actions are mounted", async () => {
  const component = await readFile(componentPath, "utf8");
  // The snapshot's template list drives per-template groups.
  assert.match(component, /snapshot\.templates\.map/);
  // Scoped, per-template IDs (unique per template id, not hardcoded once).
  for (const pattern of [
    /id=\{`live-template-\$\{read.templateId\}-heading`\}/,
    /id=\{`live-latest-\$\{templateId\}-heading`\}/,
    /id=\{`live-next-\$\{templateId\}-heading`\}/,
    /id=\{`live-actions-\$\{templateId\}-heading`\}/,
  ]) {
    assert.match(component, pattern);
  }
  // One selected group's validated cycle supplies the existing builders.
  // The canonical preference/availability algorithm is executed in its own tests.
  assert.match(
    component,
    /selectedRead\?\.kind === "READY" && selectedAvailability/,
  );
  assert.match(
    component,
    /actionableCycle = availability\.view\?\.cycle \?\? null/,
  );
  assert.match(
    component,
    /deriveTemplateAvailability\(\s*read,\s*snapshot\.block\.timestampNs,\s*wallet\.accountId/,
  );
  assert.match(component, /selection\.select\(id\);[\s\S]*?setChoice/);
  assert.match(component, /selection\.capture\(templateId, gate.accountId\)/);
  assert.match(
    component,
    /selectionToken\.valid\(\) && sendGate.current.fresh/,
  );
  // Paused templates render without contributor actions.
  assert.match(component, /\{paused \? null : \(/);
  // Operator and DAO cards render once globally, not per template.
  assert.equal(
    component.split('aria-labelledby="live-operator-heading"').length - 1,
    1,
  );
  assert.equal(
    component.split('aria-labelledby="live-dao-heading"').length - 1,
    1,
  );
});

test("registry reads enumerate templates with hardened parsing and a cap", async () => {
  const reads = await readFile(readsPath, "utf8");
  assert.match(reads, /MAX_TEMPLATE_ENUMERATION = 16/);
  assert.match(reads, /for \(let id = 0; id < maxTemplates; id\+\+\)/);
  // A missing template (registry returns none) completes the enumeration…
  assert.match(reads, /if \(raw === null\)/);
  // …while a failing read is a named per-template ERROR entry, not a global throw.
  assert.match(reads, /kind: "ERROR"/);
  // Cycle reads run only for active templates.
  assert.match(reads, /if \(template\.active\)/);
  // The live snapshot still pins the hardened parsers.
  assert.match(reads, /parseTemplate\(raw\)/);
  assert.match(reads, /parseCycle\(/);
  assert.match(reads, /parseFoundationStatus\(/);
});

test("async controllers are wired to cancellation, key gating, stale send guard and parent evidence", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /reads.cancel\(\)/);
  assert.match(component, /disabled=\{loading\}/);
  assert.match(component, /Stale snapshot/);
  assert.match(component, /derivation.current\(inputKey\)/);
  assert.match(component, /!gate.fresh/);
  assert.match(component, /Transaction evidence from this browser/);
  assert.match(component, /settleWalletRequest/);
  assert.equal(component.split("data-live-rpc-error").length - 1, 1);
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /guardedWalletSend/);
  assert.match(provider, /prepare: ensureSelector/);
  assert.match(provider, /currentSigner:/);
  assert.match(provider, /transactions: \[\{ \.\.\.converted, signerId \}\]/);
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
