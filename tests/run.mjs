import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const contract = path.join(root, "contracts", "registry");
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  CARGO_NET_OFFLINE: "true",
};
const packageConfig = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
if (process.versions.node !== packageConfig.engines.node) {
  throw new Error(
    `Use Node ${packageConfig.engines.node}; found ${process.versions.node}`,
  );
}

/** @param {string} command @param {string[]} args @param {string} [cwd] */
function run(command, args, cwd = root) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Check failed (${result.status ?? result.signal}): ${command} ${args.join(" ")}`,
    );
}

/** @param {string[]} args */
function pnpm(args) {
  const launcher = process.env.npm_execpath;
  if (!launcher || !/pnpm/i.test(launcher))
    throw new Error("Run checks via pnpm scripts");
  run(process.execPath, [launcher, ...args]);
}

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
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

const checks = {
  lint() {
    const files = [
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "README.md",
      ...["apps", "packages", "tests", "docs", ".github/workflows"].flatMap(
        (dir) => sourceFiles(path.join(root, dir)),
      ),
    ];
    pnpm(["exec", "prettier", "--check", ...files]);
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
    run(process.execPath, ["--test", "tests/foundation.test.ts"]);
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
    run(process.execPath, ["--test", "tests/wasm.test.mjs"]);
  },
  "test:production"() {
    run(process.execPath, ["tests/production.mjs"]);
  },
};
const command = process.argv[2];
if (command === "verify:offline") {
  for (const check of Object.values(checks)) check();
  console.log(
    "\nPASS verify:offline — format/syntax, TypeScript, unit tests, Rust tests, production build, WASM, local HTTP",
  );
} else if (command && command in checks) {
  checks[/** @type {keyof typeof checks} */ (command)]();
} else {
  throw new Error(`Unknown check: ${command}`);
}
