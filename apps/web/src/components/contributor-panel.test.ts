import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { contributorPanelIds } from "./contributor-panel-ids.ts";

const componentPath = path.resolve(
  import.meta.dirname,
  "contributor-panel.tsx",
);
const pagePath = path.resolve(import.meta.dirname, "../../app/page.tsx");
const stylesPath = path.resolve(import.meta.dirname, "../../app/globals.css");
const exactCommitSha = "ab".repeat(20);

function allIds(ids: ReturnType<typeof contributorPanelIds>) {
  return [
    ids.heading,
    ids.bindingHeading,
    ids.evidenceReason,
    ids.commitShaLabel,
    ...Object.values(ids.actionReasons),
  ];
}

test("contributor panel IDs stay unique and internally resolvable across two instances", () => {
  const first = contributorPanelIds("fixture-one");
  const second = contributorPanelIds("fixture-two");
  const firstIds = allIds(first);
  const secondIds = allIds(second);
  const everyId = [...firstIds, ...secondIds];

  assert.equal(new Set(everyId).size, everyId.length);
  for (const id of firstIds) assert.match(id, /^fixture-one-/);
  for (const id of secondIds) assert.match(id, /^fixture-two-/);

  const firstReferences = [
    first.heading,
    first.bindingHeading,
    first.evidenceReason,
    first.commitShaLabel,
    ...Object.values(first.actionReasons),
  ];
  const secondReferences = [
    second.heading,
    second.bindingHeading,
    second.evidenceReason,
    second.commitShaLabel,
    ...Object.values(second.actionReasons),
  ];
  for (const reference of firstReferences) assert(firstIds.includes(reference));
  for (const reference of secondReferences)
    assert(secondIds.includes(reference));
});

test("contributor panel uses only scoped nested IDs and page supplies an explicit scope", async () => {
  const [component, page] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  assert.match(component, /readonly idScope: string;/);
  assert.match(component, /contributorPanelIds\(idScope\)/);
  assert.match(component, /aria-labelledby=\{ids\.bindingHeading\}/);
  assert.match(component, /aria-describedby=\{ids\.evidenceReason\}/);
  assert.match(
    component,
    /const reasonId = ids\.actionReasons\[intent\.method\];/,
  );
  assert.doesNotMatch(component, /id="binding-heading"/);
  assert.doesNotMatch(component, /id="evidence-disabled-reason"/);
  assert.doesNotMatch(component, /`contributor-disabled-\$\{intent\.method\}`/);
  assert.match(page, /idScope="contributor-fixture"/);
});

test("full commit SHA is visible static wrapping text without input clipping", async () => {
  const [component, styles] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(component, /<output/);
  assert.match(component, /className="exact-value commit-sha-value"/);
  assert.match(component, /<code>\{evidenceDraft\.commitSha\}<\/code>/);
  assert.doesNotMatch(component, /<input value=\{evidenceDraft\.commitSha\}/);
  assert.equal(exactCommitSha.length, 40);

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
