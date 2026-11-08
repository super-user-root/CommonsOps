import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const documents = [
  "README.md",
  "llms.txt",
  "demo/README.md",
  ...(await readdir(path.join(root, "docs")))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `docs/${file}`),
];
function slugs(markdown: string): Set<string> {
  const result = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1]!
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  for (const match of markdown.matchAll(/\bid="([^"]+)"/g))
    result.add(match[1]!);
  return result;
}

test("public local and absolute repository links resolve, including internal document anchors", async () => {
  let checked = 0;
  for (const file of documents) {
    const text = await readFile(path.join(root, file), "utf8");
    for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
      let link = match[1]!;
      let target: string;
      let anchor: string | undefined;
      if (
        link.startsWith(
          "https://github.com/super-user-root/CommonsOps/blob/main/",
        )
      ) {
        link = link.split("/blob/main/")[1]!;
        [target, anchor] = link.split("#") as [string, string?];
        target = path.join(root, decodeURIComponent(target));
      } else if (/^[a-z]+:/i.test(link)) continue;
      else {
        [target, anchor] = link.split("#") as [string, string?];
        target = target
          ? path.resolve(root, path.dirname(file), decodeURIComponent(target))
          : path.join(root, file);
      }
      assert(
        !path.relative(root, target).startsWith(".."),
        `outside public repo: ${file} ${link}`,
      );
      await access(target);
      if (anchor && /\.(?:md|txt)$/.test(target))
        assert(
          slugs(await readFile(target, "utf8")).has(decodeURIComponent(anchor)),
          `${file}: missing anchor ${link}`,
        );
      checked++;
    }
    assert.doesNotMatch(
      text,
      /\.commonsops\/(?:handoffs|reviews)|decisions\/P4-T01-security-waivers/,
    );
  }
  assert(checked > 60, `only ${checked} public links checked`);
});

test("curl examples are finite and decode nested get_cycle ABI; signing snippets are unsigned with quoted accounts", async () => {
  let curls = 0;
  let calls = 0;
  for (const file of documents) {
    const text = await readFile(path.join(root, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("curl ")) {
        assert.match(line, /--connect-timeout 5/);
        assert.match(line, /--max-time 15/);
        assert.match(line, /\| node tests\/decode-rpc-view\.ts$/);
        const raw = line.match(/-d '([^']+)'/)?.[1];
        assert(raw, `${file}: missing JSON payload`);
        const request = JSON.parse(raw);
        assert.equal(request.method, "query");
        assert.equal(request.params.method_name, "get_cycle");
        assert.deepEqual(
          JSON.parse(
            Buffer.from(request.params.args_base64, "base64").toString("utf8"),
          ),
          { cycle_key: { template_id: "2", period_index: "0" } },
        );
        curls++;
      }
      if (line.startsWith("near contract call-function as-transaction ")) {
        assert.match(line, / (?:claim_cycle|release_claim) json-args /);
        assert.match(
          line,
          /sign-as "\$CLAIMANT_ACCOUNT" network-config testnet sign-later$/,
        );
        assert.doesNotMatch(line, /sign-with|\bsend\b|sign-as\s+</);
        assert.match(line, /prepaid-gas '100 TGas' attached-deposit '0 NEAR'/);
        const args = JSON.parse(line.match(/json-args '([^']+)'/)![1]!);
        assert.deepEqual(args, {
          cycle_key: { template_id: "2", period_index: "0" },
        });
        calls++;
      }
    }
  }
  assert.equal(curls, 2);
  assert.equal(calls, 3);
});

test("public routes retain shared-slot, scope, artifact and publication caveats without current screenshot claims", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const demo = await readFile(path.join(root, "demo/README.md"), "utf8");
  const index = await readFile(path.join(root, "llms.txt"), "utf8");
  for (const text of [readme, demo, index]) {
    const normalized = text.replace(/\s+/g, " ");
    assert.match(normalized, /one global (?:shared )?(?:demo )?slot/i);
    assert.match(normalized, /pending human publication/i);
    assert.match(normalized, /storage collateral/);
  }
  assert.match(readme, /authorship/);
  assert.match(readme, /coordinated disclosure/);
  assert.match(readme, /legacy.*marker|Legacy marker/);
  assert.doesNotMatch(
    readme,
    /\b\d+ (?:TypeScript|Rust) tests|sign-with-keychain|!\[[^\]]*\]\(demo\/screenshots\/0[1-9]-/,
  );
  assert.doesNotMatch(demo, /There is no hosted demo|will be added when/);
  assert.match(index, /add_proposal/);
  assert.match(index, /2\.0\.0/);
  assert.match(index, /2\.3\.1/);
  for (const file of [
    "README.md",
    "llms.txt",
    "docs/COMMANDS.md",
    "docs/release-verification.md",
    "docs/p4-t02-findings.md",
    "docs/CONTRACT_HARDENING.md",
  ]) {
    const text = await readFile(path.join(root, file), "utf8");
    assert.match(
      text,
      /9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c/,
    );
    assert.match(
      text,
      /17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7/,
    );
    assert.match(text, /Windows/);
    assert.match(text, /Linux/);
  }
});
