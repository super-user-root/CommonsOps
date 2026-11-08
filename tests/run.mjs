import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CHECK_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const MAX_COMMAND_LENGTH = 7_000;

/** @param {string} directory @returns {string[]} */
export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", "target"].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    // Next regenerates this declaration during production build.
    if (entry.name === "next-env.d.ts") return [];
    return /\.(?:json|yaml|yml|ts|tsx|mjs|css|md)$/.test(entry.name)
      ? [file]
      : [];
  });
}

/** The original selection, with only the argument representation changed.
 * @param {string} root
 */
export function formattingFiles(root) {
  return [
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
}

/** Conservative size including executable, separators, terminating NUL and
 * quoting/escaping overhead. UTF-8 bytes also bound POSIX argument storage;
 * UTF-16 code units bound Windows. This is accounting, NOT shell quoting.
 * @param {string} command @param {readonly string[]} args
 */
export function commandLength(command, args) {
  return [command, ...args].reduce((total, arg) => {
    if (typeof arg !== "string" || arg.includes("\0"))
      throw new Error("Command arguments must be strings without NUL bytes");
    return (
      total +
      Math.max(arg.length, Buffer.byteLength(arg, "utf8")) +
      (arg.match(/[\\"]/g)?.length ?? 0) +
      3
    );
  }, 1);
}

/** Preflight every argument before spawning anything; never truncate/drop files.
 * @param {string} command @param {string[]} prefix @param {string[]} files
 * @param {number} [limit]
 * @returns {string[][]}
 */
export function batchArguments(
  command,
  prefix,
  files,
  limit = MAX_COMMAND_LENGTH,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_COMMAND_LENGTH)
    throw new Error("Invalid command length limit");
  const base = commandLength(command, prefix);
  if (base > limit)
    throw new Error(
      "Executable and fixed arguments exceed command length limit",
    );
  const batches = [];
  let batch = [...prefix];
  let size = base;
  for (const file of files) {
    const cost = commandLength(command, [...prefix, file]) - base;
    if (base + cost > limit)
      throw new Error(
        `Individual file argument exceeds command length limit: ${file}`,
      );
    if (size + cost > limit) {
      batches.push(batch);
      batch = [...prefix];
      size = base;
    }
    batch.push(file);
    size += cost;
  }
  if (batch.length > prefix.length) batches.push(batch);
  return batches;
}

/** Resolve the JS CLI from the installed package, and verify the exact pin.
 * No PATH lookup, pnpm exec, .cmd shim, glob expansion or shell is involved.
 * @param {string} root
 */
export function prettierEntry(root) {
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const require = createRequire(manifestPath);
  const installedPath = require.resolve("prettier/package.json");
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  if (
    installed.name !== "prettier" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.devDependencies?.prettier ?? "") ||
    installed.version !== manifest.devDependencies.prettier
  )
    throw new Error(
      "Installed Prettier does not match the pinned package version",
    );
  const bin =
    typeof installed.bin === "string" ? installed.bin : installed.bin?.prettier;
  if (typeof bin !== "string" || !/\.(?:cjs|mjs|js)$/.test(bin))
    throw new Error("Pinned Prettier has no JavaScript CLI entry");
  return require.resolve(path.resolve(path.dirname(installedPath), bin));
}

/** @typedef {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => {status: number | null, signal?: NodeJS.Signals | null, error?: Error}} Spawn
 * @typedef {{root?: string, spawn?: Spawn, log?: (message: string) => void, env?: NodeJS.ProcessEnv}} RunnerOptions
 */

/** @param {string | undefined} command @param {RunnerOptions} [options] */
export function main(command, options = {}) {
  const root = options.root ?? CHECK_ROOT;
  const contract = path.join(root, "contracts", "registry");
  const spawn = options.spawn ?? spawnSync;
  const log = options.log ?? console.log;
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...(options.env ?? process.env),
    NEXT_TELEMETRY_DISABLED: "1",
    CARGO_NET_OFFLINE: "true",
  };
  const packageConfig = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (process.versions.node !== packageConfig.engines.node)
    throw new Error(
      `Use Node ${packageConfig.engines.node}; found ${process.versions.node}`,
    );

  /** @param {string} executable @param {string[]} args @param {string} [cwd] */
  function run(executable, args, cwd = root) {
    log(`\n> ${executable} ${args.join(" ")}`);
    const result = spawn(executable, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Check failed (${result.status ?? result.signal}): ${executable} ${args.join(" ")}`,
      );
  }

  /** @param {string[]} args */
  function pnpm(args) {
    const launcher = env.npm_execpath;
    if (!launcher || !/pnpm/i.test(launcher))
      throw new Error("Run checks via pnpm scripts");
    run(process.execPath, [launcher, ...args]);
  }

  const checks = {
    lint() {
      const batches = batchArguments(
        process.execPath,
        [prettierEntry(root), "--check"],
        formattingFiles(root),
      );
      for (const args of batches) run(process.execPath, args);
      for (const file of sourceFiles(path.join(root, "tests")).filter((file) =>
        file.endsWith(".mjs"),
      ))
        run(process.execPath, ["--check", file]);
      run("cargo", ["+1.98.0", "fmt", "--all", "--", "--check"], contract);
    },
    typecheck() {
      pnpm(["--recursive", "typecheck"]);
    },
    test() {
      run(process.execPath, [
        "--test",
        "tests/foundation.test.ts",
        "tests/run.test.mjs",
      ]);
    },
    "test:contract"() {
      run("cargo", ["+1.98.0", "test", "--locked", "--offline"], contract);
    },
    build() {
      pnpm(["--filter", "@commonsops/web", "build"]);
    },
    "build:contract"() {
      run(
        "cargo",
        [
          "+1.98.0",
          "build",
          "--locked",
          "--offline",
          "--target",
          "wasm32-unknown-unknown",
          "--release",
        ],
        contract,
      );
      run(process.execPath, [
        "--test",
        "tests/wasm.test.mjs",
        "scripts/deployment-lib.test.mjs",
        "scripts/historical-reads.test.mjs",
      ]);
    },
    "test:production"() {
      run(process.execPath, ["tests/production.mjs"]);
    },
  };
  if (command === "verify:offline") {
    for (const check of Object.values(checks)) check();
    log(
      "\nPASS verify:offline — format/syntax, TypeScript, unit tests, Rust tests, production build, WASM, local HTTP",
    );
  } else if (command && Object.hasOwn(checks, command)) {
    checks[/** @type {keyof typeof checks} */ (command)]();
  } else {
    throw new Error(`Unknown check: ${command}`);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main(process.argv[2]);
