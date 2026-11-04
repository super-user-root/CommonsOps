import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const componentPath = path.resolve(
  import.meta.dirname,
  "../../components/reviewer-panel.tsx",
);

test("reviewer panel scopes every instance with React useId", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /import \{ useId \} from "react";/);
  assert.match(source, /const instanceId = safeId\(useId\(\)\);/);
  assert.match(source, /const scope = `\$\{readableScope\}-\$\{instanceId\}`;/);
  assert.match(source, /const addReasonId = `\$\{scope\}-add-disabled`;/);
  assert.match(source, /const linkReasonId = `\$\{scope\}-link-disabled`;/);
  assert.match(source, /id=\{reasonId\}>\{intent\.disabledReason\}/);
  assert.match(source, /aria-describedby=\{reasonId\}/);
  assert.equal(
    /const scope = safeId\(idScope \?\? `reviewer-\$\{cycleId\}`\)/.test(
      source,
    ),
    false,
    "cycle or caller scope alone must never determine DOM IDs",
  );
});
