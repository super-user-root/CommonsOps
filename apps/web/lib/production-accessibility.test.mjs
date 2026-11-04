import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const webRoot = path.resolve(import.meta.dirname, "..");
const builtPage = path.join(webRoot, ".next", "server", "app", "index.html");
const stylesPath = path.join(webRoot, "app", "globals.css");
const exactCommitSha = "ab".repeat(20);

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
