import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  CHECK_ROOT,
  MAX_COMMAND_LENGTH,
  batchArguments,
  commandLength,
  formattingFiles,
  main,
  prettierEntry,
  sourceFiles,
} from "./run.mjs";

/** @param {import("node:test").TestContext} t */
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "commonsops-runner-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(
    directory,
    "long checkout with spaces",
    "Unicode café 维护",
    "representative nested project root",
  );
  /** @param {string} name @param {string} text */
  const put = (name, text) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const manifest = JSON.parse(
    readFileSync(path.join(CHECK_ROOT, "package.json"), "utf8"),
  );
  put("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  put("pnpm-workspace.yaml", "packages: []\n");
  put("pnpm-lock.yaml", "lockfileVersion: 1\n");
  put("README.md", "# Fixture\n");
  for (const dir of [
    "apps",
    "packages",
    "tests",
    "docs",
    ".github/workflows",
    "contracts/registry",
  ])
    mkdirSync(path.join(root, dir), { recursive: true });
  // A synthetic installed-package descriptor for isolated orchestration tests.
  // Actual pinned Prettier execution is tested separately below.
  put(
    "node_modules/prettier/package.json",
    JSON.stringify({
      name: "prettier",
      version: manifest.devDependencies.prettier,
      bin: "./bin/prettier.cjs",
    }),
  );
  put(
    "node_modules/prettier/bin/prettier.cjs",
    "// Orchestration fixture, never executed.\n",
  );
  for (let index = 0; index < 160; index++)
    put(
      `apps/fixtures with spaces/记录 café ${String(index).padStart(3, "0")} representative source file.json`,
      "null\n",
    );
  put("tests/example.mjs", "export {};\n");
  return { root, put };
}

test("selection preserves every original extension, root and exclusion with deterministic relative paths", (t) => {
  const { root, put } = fixture(t);
  for (const name of [
    "apps/app.tsx",
    "packages/value.ts",
    "docs/note.md",
    "apps/style.css",
    ".github/workflows/check.yml",
    "apps/out/retained.json",
  ])
    put(name, "");
  for (const name of [
    "apps/node_modules/ignored.ts",
    "apps/.next/ignored.json",
    "packages/target/ignored.md",
    "apps/next-env.d.ts",
    "scripts/previously-excluded.mjs",
    "apps/ignored.txt",
    "docs/UPPER.MD",
  ])
    put(name, "");
  const previous = [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "README.md",
    ...["apps", "packages", "tests", "docs", ".github/workflows"].flatMap(
      (dir) =>
        sourceFiles(path.join(root, dir)).map((file) =>
          path.relative(root, file).replaceAll("\\", "/"),
        ),
    ),
  ];
  const files = formattingFiles(root);
  assert.deepEqual(files, previous);
  assert.equal(files.length, 171);
  assert.ok(files.includes("apps/out/retained.json"));
  assert.ok(files.includes("tests/example.mjs"));
  assert.ok(
    files.every(
      (file) =>
        !path.isAbsolute(file) &&
        !file.includes("\\") &&
        !file.includes("ignored") &&
        !file.includes("next-env") &&
        !file.includes("UPPER"),
    ),
  );
  assert.deepEqual(formattingFiles(root), files);
});

test("bounded batches cover long, spaced and unicode paths exactly once in unchanged order", (t) => {
  const { root } = fixture(t);
  const files = formattingFiles(root);
  for (const executable of [
    process.execPath,
    "C:\\Program Files\\Node café\\node.exe",
  ]) {
    const prefix = [
      path.join(root, "node_modules", "prettier", "bin", "prettier.cjs"),
      "--check",
    ];
    const batches = batchArguments(executable, prefix, files);
    assert.ok(batches.length > 1);
    assert.deepEqual(
      batches.flatMap((batch) => batch.slice(prefix.length)),
      files,
    );
    assert.deepEqual(batchArguments(executable, prefix, files), batches);
    for (const batch of batches) {
      assert.ok(batch.length > prefix.length);
      assert.ok(commandLength(executable, batch) <= MAX_COMMAND_LENGTH);
      assert.deepEqual(batch.slice(0, prefix.length), prefix);
    }
  }
  assert.ok(commandLength("node", ["维护😀"]) > "node 维护😀".length);
});

test("oversized individual arguments and prefixes fail rather than silently dropping files", () => {
  assert.throws(
    () =>
      batchArguments(
        "node",
        ["prettier.cjs", "--check"],
        ["ok.ts", `${"x".repeat(7_000)}.ts`],
      ),
    /Individual file/,
  );
  assert.throws(
    () => batchArguments("n".repeat(7_000), [], ["a.ts"]),
    /fixed arguments/,
  );
  assert.throws(() => batchArguments("node", [], ["nul\0.ts"]), /NUL/);
  for (const cap of [0, -1, 1.5, Infinity, NaN, 7_001])
    assert.throws(() => batchArguments("node", [], [], cap));
  assert.deepEqual(batchArguments("node", [], []), []);
  const exact = commandLength("node", ["cli", "a.ts"]);
  assert.deepEqual(batchArguments("node", ["cli"], ["a.ts"], exact), [
    ["cli", "a.ts"],
  ]);
  assert.throws(() => batchArguments("node", ["cli"], ["a.ts"], exact - 1));
});

test("Prettier resolves the exact installed pinned JS entry and rejects a mismatched version", (t) => {
  assert.match(
    prettierEntry(CHECK_ROOT),
    /prettier[\\/]bin[\\/]prettier\.cjs$/,
  );
  const { root, put } = fixture(t);
  assert.equal(
    prettierEntry(root),
    path.join(root, "node_modules/prettier/bin/prettier.cjs"),
  );
  put(
    "node_modules/prettier/package.json",
    JSON.stringify({
      name: "prettier",
      version: "0.0.0",
      bin: "./bin/prettier.cjs",
    }),
  );
  assert.throws(() => prettierEntry(root), /pinned package version/);
});

test("ordinary verify gate retains every phase and includes runner and historical regressions", (t) => {
  const { root } = fixture(t);
  /** @type {Array<{command: string, args: string[], options: import("node:child_process").SpawnSyncOptions}>} */
  const calls = [];
  /** @type {string[]} */
  const messages = [];
  main("verify:offline", {
    root,
    env: { npm_execpath: "C:/Program Files/pnpm/pnpm.cjs" },
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    log: (message) => messages.push(message),
  });
  const batches = calls.filter((call) => call.args[0] === prettierEntry(root));
  assert.ok(batches.length > 1);
  assert.deepEqual(
    batches.flatMap((call) => call.args.slice(2)),
    formattingFiles(root),
  );
  for (const call of batches) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.options.cwd, root);
    assert.equal(call.options.shell, false);
    assert.ok(commandLength(call.command, call.args) <= MAX_COMMAND_LENGTH);
  }
  assert.ok(
    calls.some(
      (call) =>
        call.args[0] === "--check" && call.args[1]?.endsWith("example.mjs"),
    ),
  );
  assert.deepEqual(
    calls
      .filter((call) => call.command === "cargo")
      .map((call) => call.args[1]),
    ["fmt", "test", "build"],
  );
  assert.ok(calls.some((call) => call.args.includes("typecheck")));
  assert.ok(calls.some((call) => call.args.includes("tests/run.test.mjs")));
  assert.ok(
    calls.some((call) => call.args.includes("tests/foundation.test.ts")),
  );
  assert.ok(
    calls.some((call) =>
      call.args.includes("scripts/historical-reads.test.mjs"),
    ),
  );
  assert.ok(calls.some((call) => call.args.includes("tests/production.mjs")));
  assert.equal(
    messages.filter((message) => message.startsWith("\nPASS verify:offline"))
      .length,
    1,
  );
});

test("a failed batch, spawn error or signal stops later phases and never prints overall PASS", (t) => {
  const { root } = fixture(t);
  for (const failure of [
    { status: 17 },
    { status: null, signal: /** @type {const} */ ("SIGTERM") },
    { status: null, error: new Error("spawn refused") },
  ]) {
    let calls = 0;
    /** @type {string[]} */
    const messages = [];
    assert.throws(
      () =>
        main("verify:offline", {
          root,
          spawn: () => (++calls === 2 ? failure : { status: 0 }),
          log: (message) => messages.push(message),
        }),
      /Check failed|spawn refused/,
    );
    assert.equal(calls, 2);
    assert.ok(
      messages.every((message) => !message.includes("PASS verify:offline")),
    );
  }
});

test("real pinned Prettier runs direct with shell false in a long spaced Unicode cwd", (t) => {
  const { root } = fixture(t);
  for (const args of batchArguments(
    process.execPath,
    [prettierEntry(CHECK_ROOT), "--check"],
    formattingFiles(root),
  )) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      shell: false,
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /All matched files use Prettier code style/);
  }
});

test("import is guarded and direct invocation uses the runner root, not caller cwd", (t) => {
  const { root } = fixture(t);
  const runner = path.join(CHECK_ROOT, "tests/run.mjs");
  const imported = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { CHECK_ROOT } from ${JSON.stringify(pathToFileURL(runner).href)}; console.log(CHECK_ROOT);`,
    ],
    { cwd: root, encoding: "utf8", shell: false },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), CHECK_ROOT);
  const direct = spawnSync(process.execPath, [runner, "not-a-check"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /Unknown check: not-a-check/);
  assert.doesNotMatch(direct.stderr, /ENOENT|Use Node/);
  // Exercise the real direct entry from an unrelated temporary cwd without
  // recursively running this suite. It must lint the actual runner checkout,
  // not this temporary fixture's synthetic Prettier or missing Rust package.
  const directLint = spawnSync(process.execPath, [runner, "lint"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    env: { ...process.env },
  });
  assert.equal(directLint.status, 0, directLint.stdout + directLint.stderr);
  assert.match(directLint.stdout, /All matched files use Prettier code style/);
  assert.match(directLint.stdout, /cargo \+1\.98\.0 fmt/);
  assert.ok(
    !directLint.stdout.includes(path.join(root, "node_modules/prettier")),
  );
});
