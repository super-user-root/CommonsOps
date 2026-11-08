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
  // Static live-section IDs render on the server; the per-template card and
  // action IDs appear after the client read (scoped per template id).
  for (const id of [
    "live-registry",
    "live-registry-heading",
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

// Small generated-HTML inspection, not a browser layout/DOM harness. Closed
// details still ship every child; only their native summary is initially shown.
function inspectNativeDisclosures(html) {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const stack = [];
  const targets = new Map();
  let elements = 0;
  let defaultElements = 0;
  let disclosures = 0;
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  for (const match of clean.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
    const [, closing, rawTag, attributes] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      if (stack.at(-1)?.tag === tag) stack.pop();
      continue;
    }
    const parent = stack.at(-1);
    const hidden = Boolean(
      parent?.hidden || (parent?.closed && tag !== "summary"),
    );
    elements++;
    if (!hidden) defaultElements++;
    const id = attributes.match(/\bid="([^"]+)"/)?.[1];
    if (id) targets.set(id, { tag, hidden });
    if (tag === "details") {
      disclosures++;
      assert.doesNotMatch(attributes, /\bopen(?:\s|=|$)/);
    }
    if (!voidTags.has(tag))
      stack.push({ tag, hidden, closed: tag === "details" });
  }
  return { elements, defaultElements, disclosures, targets };
}

test("native closed disclosures keep full recorded proof in HTML and stage anchors outside", async () => {
  const html = await readFile(builtPage, "utf8");
  const result = inspectNativeDisclosures(html);
  assert(result.disclosures >= 6);
  assert(
    result.defaultElements < result.elements * 0.6,
    "default tour still exposes most proof elements",
  );
  for (const id of [
    "journey",
    "journey-heading",
    "operator-stage",
    "operator-stage-heading",
    "contributor-stage",
    "contributor-stage-heading",
    "reviewer-stage",
    "reviewer-stage-heading",
    "state-handling",
    "state-handling-heading",
  ]) {
    assert.equal(
      result.targets.get(id)?.hidden,
      false,
      `${id} is inside a closed disclosure`,
    );
  }
  assert.equal(
    result.targets.get("contributor-fixture-commit-sha-label")?.hidden,
    true,
  );
  for (const pattern of [
    /data-recorded-proof="operator"/,
    /data-recorded-proof="contributor"/,
    /data-recorded-proof="reviewer"/,
    /0\.5 NEAR/,
    /Approved alone is not payment\./,
    /EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2/,
    /ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7/,
    /09936627004b6e19664173302ff9d52613f5febef27ab34cfa488b54b83d71b8/,
  ])
    assert.match(html, pattern);
  for (const summary of html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)) {
    assert(
      summary[1].replace(/<[^>]*>/g, "").length > 20,
      "summary must name the hidden evidence",
    );
  }
  console.log(
    `STATIC_HTML_ELEMENTS=${result.elements}; DEFAULT_DISCLOSURE_ELEMENTS=${result.defaultElements}; CLOSED_DETAILS=${result.disclosures}; no pixel/layout claim`,
  );
});

function luminance(hex) {
  const channels = hex
    .match(/[a-f0-9]{2}/gi)
    .map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test("tour palette contrast and compact touch/focus rules are retained", async () => {
  const styles = await readFile(stylesPath, "utf8");
  for (const [foreground, background, minimum] of [
    ["#1d1d1f", "#f5f5f7", 4.5],
    ["#6e6e73", "#f5f5f7", 4.5],
    ["#424245", "#ffffff", 4.5],
    ["#0066cc", "#f5f5f7", 4.5],
    ["#ffffff", "#0071e3", 4.5],
    ["#a1a1a6", "#1d1d1f", 4.5],
    ["#a1a1a6", "#2d2d2d", 4.5],
    ["#2997ff", "#1d1d1f", 4.5],
    ["#ff453a", "#1d1d1f", 4.5],
    ["#8a4b00", "#fff3e1", 4.5],
    ...["#2997ff", "#7a5cff", "#bf5af2", "#ff375f", "#ff9f0a"].map((stop) => [
      stop,
      "#000000",
      3,
    ]),
  ]) {
    assert(styles.includes(foreground) && styles.includes(background));
    const values = [luminance(foreground), luminance(background)].sort(
      (a, b) => b - a,
    );
    assert(
      (values[0] + 0.05) / (values[1] + 0.05) >= minimum,
      `${foreground}/${background}`,
    );
  }
  assert.match(styles, /summary:focus-visible/);
  assert.match(styles, /\.github-link \{[^}]*width: 44px;[^}]*height: 44px/s);
  assert.match(styles, /\.proof-details > summary \{[^}]*min-height: 44px/s);
  assert.equal((styles.match(/@media \(max-width: 760px\)/g) ?? []).length, 1);
  assert.doesNotMatch(styles, /min-height: (?:38px|clamp\(560px)/);
  assert.match(styles, /scroll-snap-type: x mandatory/);
});
