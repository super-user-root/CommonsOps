import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  canonicalEvidenceBytes,
  canonicalJsonBounds,
  canonicalJsonBytes,
  canonicalJsonString,
  canonicalDecimalString,
  isCanonicalDecimal,
  parseAccountId,
  parseCryptoHash,
  parseDecimal,
  RECONCILIATION_SCHEMA_VERSION,
  reconciliationBounds,
  reconciliationEvidenceKey,
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

test("canonical decimal helpers accept only bounded canonical syntax", () => {
  assert.equal(isCanonicalDecimal("0", 64), true);
  assert.equal(isCanonicalDecimal("18446744073709551615", 64), true);
  assert.equal(isCanonicalDecimal("18446744073709551616", 64), false);
  assert.equal(isCanonicalDecimal("01", 64), false);
  assert.equal(isCanonicalDecimal("-1", 64), false);
  assert.equal(isCanonicalDecimal(1, 64), false);
  assert.equal(isCanonicalDecimal(null, 128), false);
  assert.throws(
    () =>
      canonicalDecimalString("340282366920938463463374607431768211456", 128),
    /ERR_INTEGER_OVERFLOW/,
  );
  assert.equal(canonicalDecimalString("0", 128), "0");
  assert.equal(canonicalDecimalString("1", 128, true), "1");
  assert.throws(
    () => canonicalDecimalString("0", 128, true),
    /ERR_INVALID_DECIMAL/,
  );
  assert.throws(() => canonicalDecimalString("1.0", 64), /ERR_INVALID_DECIMAL/);
});

test("account and crypto-hash parsing enforce canonical NEAR formats", () => {
  assert.equal(
    parseAccountId("alice.example.testnet"),
    "alice.example.testnet",
  );
  assert.throws(
    () => parseAccountId("Alice.testnet"),
    /ERR_INVALID_ACCOUNT_ID/,
  );
  assert.throws(() => parseAccountId("a"), /ERR_INVALID_ACCOUNT_ID/);
  assert.throws(() => parseAccountId("x".repeat(65)), /ERR_INVALID_ACCOUNT_ID/);
  const hash = "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm";
  assert.equal(parseCryptoHash(hash), hash);
  assert.equal(parseCryptoHash("1".repeat(32)), "1".repeat(32));
  assert.throws(() => parseCryptoHash("0OIl"), /ERR_INVALID_CRYPTO_HASH/);
  assert.throws(
    () => parseCryptoHash("1".repeat(33)),
    /ERR_INVALID_CRYPTO_HASH/,
  );
  assert.throws(() => parseCryptoHash(""), /ERR_INVALID_CRYPTO_HASH/);
  assert.throws(() => parseCryptoHash(42), /ERR_INVALID_CRYPTO_HASH/);
});

test("reconciliation evidence keys bind the canonical five-part identity", () => {
  const parts = {
    network: "TESTNET",
    daoAccountId: "dao.example.testnet",
    proposalId: "77",
    actionReceiptId: "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
    payoutReceiptId: "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  } as const;
  assert.equal(
    reconciliationEvidenceKey(parts),
    "testnet:dao.example.testnet:77:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  );
  assert.equal(
    reconciliationEvidenceKey({ ...parts, network: "MAINNET" }).startsWith(
      "mainnet:",
    ),
    true,
  );
  assert.throws(
    () => reconciliationEvidenceKey({ ...parts, network: "testnet" } as never),
    /ERR_INVALID_NETWORK/,
  );
  assert.throws(
    () => reconciliationEvidenceKey({ ...parts, proposalId: "077" }),
    /ERR_INVALID_DECIMAL/,
  );
  assert.throws(
    () => reconciliationEvidenceKey({ ...parts, payoutReceiptId: "short" }),
    /ERR_INVALID_CRYPTO_HASH/,
  );
  assert.equal(RECONCILIATION_SCHEMA_VERSION, 1);
  assert(Object.isFrozen(reconciliationBounds));
  assert.equal(reconciliationBounds.maxRecords, registryBounds.maxCycles);
  assert.equal(reconciliationBounds.maxProvenanceBytes, 200);
});

test("canonical JSON serializer sorts keys and rejects unsafe data", () => {
  const forward = { z: 1, a: { d: [3, 1], c: null }, m: 'x"y\n' };
  const backward = { m: 'x"y\n', a: { c: null, d: [3, 1] }, z: 1 };
  const expected = '{"a":{"c":null,"d":[3,1]},"m":"x\\"y\\n","z":1}';
  assert.equal(canonicalJsonString(forward), expected);
  assert.equal(canonicalJsonString(backward), expected);
  assert.equal(canonicalJsonString([]), "[]");
  assert.equal(canonicalJsonString({}), "{}");
  assert.equal(canonicalJsonString(-0), "0");
  assert.deepEqual(
    Array.from(canonicalJsonBytes(forward)),
    Array.from(new TextEncoder().encode(expected)),
  );
  const violations: Array<[string, () => unknown]> = [
    [
      "cycle",
      () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        return canonicalJsonString(cyclic as never);
      },
    ],
    ["bigint", () => canonicalJsonString({ a: 1n } as never)],
    ["undefined", () => canonicalJsonString({ a: undefined } as never)],
    ["nonfinite", () => canonicalJsonString({ a: Number.NaN } as never)],
    [
      "symbol",
      () => {
        const value = { a: 1 };
        (value as Record<PropertyKey, unknown>)[Symbol("s")] = 2;
        return canonicalJsonString(value as never);
      },
    ],
    [
      "accessor",
      () => {
        const value = { a: 1 };
        Object.defineProperty(value, "b", {
          enumerable: true,
          get() {
            return 2;
          },
        });
        return canonicalJsonString(value as never);
      },
    ],
    [
      "prototype",
      () => {
        class Custom {
          a = 1;
        }
        return canonicalJsonString(new Custom() as never);
      },
    ],
    [
      "array extra",
      () => {
        const value: unknown[] = [1, 2];
        (value as unknown as Record<string, unknown>).extra = 3;
        return canonicalJsonString(value as never);
      },
    ],
    ["sparse array", () => canonicalJsonString([1, , 3] as never)],
    [
      "proxy",
      () => {
        const target = { a: 1 };
        return canonicalJsonString(new Proxy(target, {}) as never);
      },
    ],
  ];
  for (const [name, violation] of violations) {
    assert.throws(violation, /ERR_/, name);
  }
  let deep: unknown = null;
  for (let index = 0; index < canonicalJsonBounds.maxDepth + 2; index += 1) {
    deep = { a: deep };
  }
  assert.throws(
    () => canonicalJsonString(deep as never),
    /ERR_CANONICAL_JSON_LIMITS/,
  );
  const wide = Array.from(
    { length: canonicalJsonBounds.maxNodes + 1 },
    (_, index) => index,
  );
  assert.throws(
    () => canonicalJsonString(wide as never),
    /ERR_CANONICAL_JSON_LIMITS/,
  );
  assert.equal(
    canonicalJsonString(Array.from({ length: 1000 }, (_, index) => index))
      .length > 0,
    true,
  );
});
