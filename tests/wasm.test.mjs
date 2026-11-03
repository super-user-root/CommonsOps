import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const wasmPath = new URL(
  "../contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm",
  import.meta.url,
);

test("release WASM is valid and exposes only scaffold contract methods", async () => {
  const bytes = await readFile(wasmPath);
  assert.ok(bytes.length > 8, "WASM artifact must not be empty");
  assert.ok(WebAssembly.validate(bytes));
  const module = new WebAssembly.Module(bytes);
  const functions = WebAssembly.Module.exports(module)
    .filter((entry) => entry.kind === "function")
    .map((entry) => entry.name)
    .sort();
  // near-sdk adds the standard NEP-330 source-metadata view automatically.
  assert.deepEqual(functions, [
    "contract_source_metadata",
    "foundation_status",
    "new",
  ]);
  const imports = WebAssembly.Module.imports(module);
  assert.ok(imports.length > 0, "NEAR host imports must exist");
  assert.ok(imports.every((entry) => entry.module === "env"));
  assert.ok(!imports.some((entry) => /promise_/.test(entry.name)));
});
