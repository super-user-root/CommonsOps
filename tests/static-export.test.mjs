import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Pages exports canonical llms bytes with the base-path-aware footer link and recorded HTML proof", async () => {
  const [canonical, exported, html] = await Promise.all([
    readFile(new URL("llms.txt", root)),
    readFile(new URL("apps/web/out/llms.txt", root)),
    readFile(new URL("apps/web/out/index.html", root), "utf8"),
  ]);
  assert.deepEqual(exported, canonical);
  assert.match(html, /href="\/CommonsOps\/llms\.txt"/);
  assert.match(html, /data-recorded-proof="operator"/);
  assert.match(html, /data-recorded-proof="contributor"/);
  assert.match(html, /data-recorded-proof="reviewer"/);
  assert.match(html, /1032733c2115b9e9c038d50617f6e151ac8bd59d/);
  assert.match(html, /EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:[\s=>])/);
  console.log(
    `AI_INDEX_BYTES=${canonical.byteLength}; exported bytes identical`,
  );
});
