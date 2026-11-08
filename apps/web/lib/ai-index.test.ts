import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readCanonicalAiIndex } from "./ai-index.ts";
import { GET, dynamic } from "../app/llms.txt/route.ts";

const root = path.resolve(import.meta.dirname, "../../..");
test("AI index is the canonical repository file from module or unrelated cwd, with public absolute links", async () => {
  const expected = await readFile(path.join(root, "llms.txt"), "utf8");
  assert.equal(
    await readCanonicalAiIndex(import.meta.dirname, path.parse(root).root),
    expected,
  );
  assert.equal(
    await readCanonicalAiIndex(
      path.parse(root).root,
      path.join(root, "apps/web"),
    ),
    expected,
  );
  assert.equal(dynamic, "force-static");
  const response = await GET();
  assert.equal(
    response.headers.get("content-type"),
    "text/plain; charset=utf-8",
  );
  assert.equal(await response.text(), expected);
  assert.doesNotMatch(
    expected,
    /\.commonsops[\\/]|[A-Z]:\\|three-way identical WASM/,
  );
  const links = [...expected.matchAll(/\]\(([^)]+)\)/g)].map(
    (match) => match[1]!,
  );
  assert(links.length > 15);
  for (const link of links) {
    assert(
      link.startsWith(
        "https://github.com/super-user-root/CommonsOps/blob/main/",
      ),
      link,
    );
    await access(
      path.join(root, new URL(link).pathname.split("/blob/main/")[1]!),
    );
  }
  await assert.rejects(access(path.join(root, "apps/web/public/llms.txt")));
});
