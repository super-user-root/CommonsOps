import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  canonicalEvidenceBytes,
  parseDecimal,
  registryBounds,
} from "./index.ts";

test("decimal wire values retain u64/u128 precision", () => {
  assert.equal(parseDecimal("9007199254740993", 64), 9007199254740993n);
  assert.equal(
    parseDecimal("340282366920938463463374607431768211455", 128),
    (1n << 128n) - 1n,
  );
  for (const invalid of ["-1", "1.5", "01", " 1", "1e3", ""]) {
    assert.throws(() => parseDecimal(invalid, 64), /ERR_INVALID_DECIMAL/);
  }
  assert.throws(
    () => parseDecimal("18446744073709551616", 64),
    /ERR_INTEGER_OVERFLOW/,
  );
});

test("evidence canonical serialization matches the Rust fixed-order fixture", () => {
  const bytes = canonicalEvidenceBytes(
    "Example",
    "Docs",
    "42",
    "AB".repeat(20),
  );
  const expected = `[1,"example","docs","42","${"ab".repeat(20)}"]`;
  assert.equal(new TextDecoder().decode(bytes), expected);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(expected).digest("hex"),
  );
  assert.throws(
    () => canonicalEvidenceBytes("owner/evil", "docs", "1", "a".repeat(40)),
    /ERR_INVALID_GITHUB_NAME/,
  );
  assert.throws(
    () => canonicalEvidenceBytes("owner", "..", "1", "a".repeat(40)),
    /ERR_INVALID_GITHUB_NAME/,
  );
  assert.throws(
    () => canonicalEvidenceBytes("owner", "docs", "0", "a".repeat(40)),
    /ERR_INVALID_PR_NUMBER/,
  );
  assert.throws(
    () => canonicalEvidenceBytes("owner", "docs", "1", "g".repeat(40)),
    /ERR_INVALID_COMMIT_SHA/,
  );
});

test("registry bounds are immutable and describe storage reserve limits", () => {
  assert(Object.isFrozen(registryBounds));
  assert.equal(registryBounds.maxTitleBytes, 120);
  assert.equal(registryBounds.templateReserveBytes, 4096);
  assert.equal(registryBounds.cycleReserveBytes, 16384);
});
