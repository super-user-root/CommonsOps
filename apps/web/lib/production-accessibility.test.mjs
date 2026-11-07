import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const builtPage = path.join(webRoot, ".next", "server", "app", "index.html");
const stylesPath = path.join(webRoot, "app", "globals.css");
// The recorded immutable evidence commit SHA (docs/testnet-journey.md step 5).
const exactCommitSha = "1032733c2115b9e9c038d50617f6e151ac8bd59d";

function attributeValues(html, name) {
  return [...html.matchAll(new RegExp(`\\b${name}="([^"]+)"`, "g"))].map(
    (match) => match[1],
  );
}

test("production page exposes the full SHA and resolves scoped contributor ARIA IDs", async () => {
  const [html, styles] = await Promise.all([
    readFile(builtPage, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);
  const ids = attributeValues(html, "id");
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicateIds)], []);

  const references = [
    ...attributeValues(html, "aria-labelledby"),
    ...attributeValues(html, "aria-describedby"),
  ].flatMap((value) => value.split(/\s+/));
  const missingReferences = references.filter(
    (reference) => !ids.includes(reference),
  );
  assert.deepEqual([...new Set(missingReferences)], []);

  const output = html.match(
    /<output class="exact-value commit-sha-value"[^>]*>([\s\S]*?)<\/output>/,
  )?.[1];
  assert(output);
  assert.match(output, new RegExp(`<code>${exactCommitSha}</code>`));
  assert.equal(exactCommitSha.length, 40);
  assert.doesNotMatch(html, new RegExp(`<input[^>]+value="${exactCommitSha}"`));
  assert.doesNotMatch(html, /<form\b/);

  for (const id of [
    "contributor-fixture-heading",
    "contributor-fixture-binding-heading",
    "contributor-fixture-evidence-disabled-reason",
    "contributor-fixture-commit-sha-label",
    "contributor-fixture-disabled-claim_cycle",
    "contributor-fixture-disabled-release_claim",
    "contributor-fixture-disabled-expire_cycle_or_claim",
    "contributor-fixture-disabled-submit_evidence",
  ]) {
    assert(ids.includes(id), `missing scoped contributor ID: ${id}`);
  }

  const wrappingRule = styles.match(
    /\.commit-sha-value code \{[\s\S]*?\n\}/,
  )?.[0];
  assert(wrappingRule);
  assert.match(wrappingRule, /max-width: 100%/);
  assert.match(wrappingRule, /overflow: visible/);
  assert.match(wrappingRule, /overflow-wrap: anywhere/);
  assert.match(wrappingRule, /white-space: normal/);
  assert.match(wrappingRule, /word-break: break-all/);
  assert.doesNotMatch(wrappingRule, /text-overflow|overflow: (?:hidden|clip)/);
});

test("production page exposes the live registry section with an enabled wallet control", async () => {
  const [html, styles] = await Promise.all([
    readFile(builtPage, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  // The stale read-only boundary is gone from the header.
  assert.doesNotMatch(html, /Wallet unavailable/);
  assert.doesNotMatch(html, /no in-app RPC by design/);

  // The live section is present and clearly labeled live.
  assert.match(
    html,
    /Live registry · NEAR testnet — connect a wallet to interact/,
  );
  const ids = attributeValues(html, "id");
  // Static live-section IDs render on the server; the snapshot-dependent
  // card IDs (live-template-heading etc.) appear after the client read.
  for (const id of [
    "live-registry",
    "live-registry-heading",
    "live-actions-heading",
    "live-operator-heading",
    "live-dao-heading",
  ]) {
    assert(ids.includes(id), `missing live section ID: ${id}`);
  }

  // The header wallet control is a real, reachable, enabled button.
  const walletButton = html.match(
    /<button[^>]*id="wallet-connect-button"[^>]*>([\s\S]*?)<\/button>/,
  );
  assert.ok(walletButton, "header wallet connect button missing");
  assert.match(walletButton[0], /Connect testnet wallet/);
  assert.doesNotMatch(walletButton[0], /\bdisabled\b/);

  // Live request states are announced politely; the DAO payout note is
  // display-only and points at the recorded journey doc.
  assert.ok(html.includes('aria-live="polite"'));
  assert.match(html, /DAO payout — not in this app/);
  assert.match(html, /docs\/testnet-journey\.md/);

  // The live styles exist for the new components.
  assert.match(styles, /\.live-section \{/);
  assert.match(styles, /\.live-card \{/);
  assert.match(styles, /\.account-chip \{/);
});
