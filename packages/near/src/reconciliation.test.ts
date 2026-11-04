import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  canonicalJsonString,
  RECONCILIATION_SCHEMA_VERSION as DOMAIN_SCHEMA_VERSION,
  reconciliationBounds as domainReconciliationBounds,
  registryBounds,
} from "../../domain/src/index.ts";
import {
  createReconciliationStore,
  isReconciliationStore,
  reconcilePayment,
  RECONCILIATION_MAX_RECORDS,
  RECONCILIATION_TX_STATUS_RPC_ID,
  type ReconciliationRecord,
  type ReconciliationRpcTransport,
  type ReconciliationTxStatusRpcRequest,
} from "./index.ts";

const fixtures = path.resolve(
  import.meta.dirname,
  "../../../tests/fixtures/reconciliation",
);

const DAO = "dao.example.testnet";
const ALICE = "alice.example.testnet";
const AMOUNT = "5100000000000000000000000";
const CODE_HASH = "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq";
const TX = "6uzuBipBzBod3BcjGW3mz5dgXRd3ujforNw2k7YVvmug";
const ACTION = "EXXtTcFksfrvuPbWYW32MEEvuxFLFiNJA9267CJca6f";
const PAYOUT = "GEU8yPojva5caEpZCcpQ26zzydsasxgGQRv2BAqQZUdq";
const PAYOUT_BLOCK = "7TGrboF8jPxEwFc4hVJdZr6482bJbNxNNQWz3pLDrA7U";
const OTHER_ACTION = "ANFk69g1vcgixz1zUmCwrqVFR9Ao2xnBKfdWHPqeNdgV";
const OTHER_PAYOUT = "73TjJb7zz2DSGa5kW7xgic2NUkLJ9XHZKUmaAd1Ga8wT";
const OTHER_BLOCK = "AtWj2d5x7HGUbCFMLkTHN9Kn1AH4TxriJ9hKWAMT35XS";
const FAIL_TX = "ERuBPTRPpks6JxZ5pv7zePnv3Ea2d4Fzj9zAwQdS5KqK";
const AMB_TX = "8uzS2ft8XGQmFQpWU96bkcwB13Tx8qcuAArbhPsZ5mjs";
const NONFINAL_TX = "8T2gcGXN1Rza8i2UniRj6gwnmSuhkVAki8eUxnmxLDC4";
const PROVENANCE = "P3-T03 synthetic fixture replay; no live RPC";

const AUTHENTIC_DAO = "marmaj.sputnikv2.testnet";
const AUTHENTIC_RECIPIENT = "chloe.testnet";
const AUTHENTIC_AMOUNT = "81900000000000000000000000";
const AUTHENTIC_TX = "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm";
const AUTHENTIC_ACTION = "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ";
const AUTHENTIC_PAYOUT = "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ";
const AUTHENTIC_BLOCK = "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy";

const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) {
    leadingZeroes += 1;
  }
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = base58Alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return "1".repeat(leadingZeroes) + encoded;
}

function cryptoHashFromSeed(seed: string): string {
  return base58Encode(createHash("sha256").update(seed).digest());
}

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(fixtures, name), "utf8"),
  ) as unknown;
}

function expectation(
  overrides: Partial<
    Parameters<typeof reconcilePayment>[0]["expectation"]
  > = {},
): Parameters<typeof reconcilePayment>[0]["expectation"] {
  return {
    network: "TESTNET",
    daoAccountId: DAO,
    proposalId: "77",
    claimantId: ALICE,
    recipientId: ALICE,
    amountYocto: AMOUNT,
    profile: { version: "2.0.0", codeHash: CODE_HASH },
    cycle: { templateId: "7", periodIndex: "3" },
    ...overrides,
  };
}

function candidate(
  overrides: Partial<Parameters<typeof reconcilePayment>[0]["candidate"]> = {},
): Parameters<typeof reconcilePayment>[0]["candidate"] {
  return { transactionHash: TX, signerId: ALICE, ...overrides };
}

function record(
  overrides: Partial<ReconciliationRecord> = {},
): ReconciliationRecord {
  return {
    schemaVersion: 1,
    network: "TESTNET",
    daoAccountId: DAO,
    proposalId: "77",
    actionReceiptId: ACTION,
    payoutReceiptId: PAYOUT,
    cycle: { templateId: "7", periodIndex: "3" },
    expectedRecipientId: ALICE,
    expectedAmountYocto: AMOUNT,
    profileVersion: "2.0.0",
    profileCodeHash: CODE_HASH,
    transactionHash: TX,
    payoutBlockHash: PAYOUT_BLOCK,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function recordingTransport(
  response: unknown,
  requests: ReconciliationTxStatusRpcRequest[],
): ReconciliationRpcTransport {
  return async (request) => {
    requests.push(structuredClone(request));
    return response;
  };
}

async function reconcileFixture(
  store: ReturnType<typeof createReconciliationStore>,
  name: string,
  overrides: Partial<Parameters<typeof reconcilePayment>[0]> = {},
): Promise<Awaited<ReturnType<typeof reconcilePayment>>> {
  const requests: ReconciliationTxStatusRpcRequest[] = [];
  const result = await reconcilePayment({
    expectation: expectation(),
    candidate: candidate(),
    transport: recordingTransport(await fixture(name), requests),
    provenance: PROVENANCE,
    store,
    ...overrides,
  });
  assert.equal(requests.length, 1);
  return result;
}

function storeFingerprintState(
  store: ReturnType<typeof createReconciliationStore>,
) {
  return {
    fingerprint: store.fingerprint(),
    size: store.size(),
    records: store.listRecords(),
  };
}

function withOwnProto<T extends object>(value: T, protoValue: unknown): T {
  Object.defineProperty(value, "__proto__", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: protoValue,
  });
  return value;
}

test("issues exactly one canonical EXPERIMENTAL_tx_status request and applies the verified payout", async () => {
  const requests: ReconciliationTxStatusRpcRequest[] = [];
  const store = createReconciliationStore();
  const result = await reconcilePayment({
    expectation: expectation(),
    candidate: candidate(),
    transport: recordingTransport(
      await fixture("tx-status-paid.json"),
      requests,
    ),
    provenance: PROVENANCE,
    store,
  });
  assert.deepEqual(requests, [
    {
      jsonrpc: "2.0",
      id: RECONCILIATION_TX_STATUS_RPC_ID,
      method: "EXPERIMENTAL_tx_status",
      params: { tx_hash: TX, sender_account_id: ALICE },
    },
  ]);
  assert.equal(result.status, "APPLIED");
  assert.equal(result.adapterState, "PAID");
  assert.ok(result.record);
  assert.deepEqual(result.record, {
    schemaVersion: 1,
    network: "TESTNET",
    daoAccountId: DAO,
    proposalId: "77",
    actionReceiptId: ACTION,
    payoutReceiptId: PAYOUT,
    cycle: { templateId: "7", periodIndex: "3" },
    expectedRecipientId: ALICE,
    expectedAmountYocto: AMOUNT,
    profileVersion: "2.0.0",
    profileCodeHash: CODE_HASH,
    transactionHash: TX,
    payoutBlockHash: PAYOUT_BLOCK,
    provenance: PROVENANCE,
  });
  assert.equal(store.size(), 1);
  assert.equal(
    store.getByProposal("TESTNET", DAO, "77")?.payoutReceiptId,
    PAYOUT,
  );
  assert.equal(store.getByPayoutReceipt("TESTNET", PAYOUT)?.proposalId, "77");
});

test("reconciles the authentic P3-T01 proposal 63 evidence end to end", async () => {
  const store = createReconciliationStore();
  const result = await reconcileFixture(
    store,
    "../sputnik/proposal-63-paid.json",
    {
      expectation: expectation({
        daoAccountId: AUTHENTIC_DAO,
        proposalId: "63",
        claimantId: AUTHENTIC_RECIPIENT,
        recipientId: AUTHENTIC_RECIPIENT,
        amountYocto: AUTHENTIC_AMOUNT,
      }),
      candidate: candidate({
        transactionHash: AUTHENTIC_TX,
        signerId: AUTHENTIC_RECIPIENT,
      }),
      provenance: "P3-T01 verified public evidence replay; no live RPC",
    },
  );
  assert.equal(result.status, "APPLIED");
  assert.deepEqual(result.record, {
    schemaVersion: 1,
    network: "TESTNET",
    daoAccountId: AUTHENTIC_DAO,
    proposalId: "63",
    actionReceiptId: AUTHENTIC_ACTION,
    payoutReceiptId: AUTHENTIC_PAYOUT,
    cycle: { templateId: "7", periodIndex: "3" },
    expectedRecipientId: AUTHENTIC_RECIPIENT,
    expectedAmountYocto: AUTHENTIC_AMOUNT,
    profileVersion: "2.0.0",
    profileCodeHash: CODE_HASH,
    transactionHash: AUTHENTIC_TX,
    payoutBlockHash: AUTHENTIC_BLOCK,
    provenance: "P3-T01 verified public evidence replay; no live RPC",
  });
});

test("re-applying the identical attribution is idempotent and returns the existing record", async () => {
  const store = createReconciliationStore();
  const first = await reconcileFixture(store, "tx-status-paid.json");
  assert.equal(first.status, "APPLIED");
  const before = storeFingerprintState(store);
  const second = await reconcileFixture(store, "tx-status-paid.json");
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(second.adapterState, "PAID");
  assert.equal(second.record, first.record);
  const applied = store.apply(record());
  assert.equal(applied.status, "IDEMPOTENT");
  assert.equal(applied.record, first.record);
  assert.deepEqual(storeFingerprintState(store), before);
});

test("conflicting attributions are rejected and leave the store byte-identical", () => {
  const store = createReconciliationStore();
  const first = store.apply(record());
  assert.equal(first.status, "APPLIED");
  const before = storeFingerprintState(store);
  const conflicts = [
    [
      "different payout for the same proposal",
      record({
        payoutReceiptId: OTHER_PAYOUT,
        actionReceiptId: OTHER_ACTION,
        transactionHash: OTHER_ACTION,
        payoutBlockHash: OTHER_BLOCK,
      }),
    ],
    [
      "same proposal, same payout, different action receipt",
      record({ actionReceiptId: OTHER_ACTION }),
    ],
    [
      "same payout receipt bound to another proposal",
      record({
        proposalId: "78",
        transactionHash: OTHER_ACTION,
        payoutBlockHash: OTHER_BLOCK,
      }),
    ],
    [
      "same attribution with different payment metadata",
      record({ payoutBlockHash: OTHER_BLOCK }),
    ],
    [
      "same attribution with different cycle binding",
      record({ cycle: { templateId: "7", periodIndex: "4" } }),
    ],
    [
      "same attribution with different provenance",
      record({ provenance: "other replay" }),
    ],
  ] as const;
  for (const [name, conflicting] of conflicts) {
    const result = store.apply(conflicting);
    assert.equal(result.status, "CONFLICT", name);
    assert.ok(result.reason.length > 0, name);
    assert.equal(result.record, null, name);
    assert.deepEqual(storeFingerprintState(store), before, name);
  }
});

test("non-PAID adapter verdicts are returned with reasons and never persisted", async () => {
  const wrongProposalAction = JSON.parse(
    JSON.stringify(await fixture("tx-status-paid.json")),
  ) as {
    result: {
      transaction: { actions: Array<{ FunctionCall: { args: string } }> };
      receipts: Array<{
        receipt: {
          Action: { actions: Array<{ FunctionCall: { args: string } }> };
        };
      }>;
    };
  };
  const otherProposalArgs = Buffer.from(
    JSON.stringify({ id: 78, action: "VoteApprove" }),
  ).toString("base64");
  wrongProposalAction.result.transaction.actions[0]!.FunctionCall.args =
    otherProposalArgs;
  wrongProposalAction.result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args =
    otherProposalArgs;
  const cases: Array<{
    name: string;
    response: unknown;
    state: string;
    reason?: RegExp;
    expectation?: Partial<
      Parameters<typeof reconcilePayment>[0]["expectation"]
    >;
    candidate?: Partial<Parameters<typeof reconcilePayment>[0]["candidate"]>;
  }> = [
    {
      name: "failed proposal action receipt",
      response: await fixture("tx-status-failed.json"),
      state: "FAILED",
      reason: /Proposal action receipt failed/,
      candidate: { transactionHash: FAIL_TX },
    },
    {
      name: "ambiguous payout graph",
      response: await fixture("tx-status-ambiguous.json"),
      state: "AMBIGUOUS",
      reason: /Payout receipt attribution is ambiguous/,
      candidate: { transactionHash: AMB_TX },
    },
    {
      name: "proposal action for another proposal id",
      response: wrongProposalAction,
      state: "INVALID",
      reason: /does not match linked proposal/,
    },
    {
      name: "nonfinal transaction status",
      response: await fixture("tx-status-nonfinal.json"),
      state: "UNKNOWN",
      reason: /Transaction is not final or targets another DAO/,
      candidate: { transactionHash: NONFINAL_TX },
    },
    {
      name: "unsupported pinned profile",
      response: await fixture("tx-status-paid.json"),
      state: "UNKNOWN",
      reason: /Unsupported Sputnik deployment profile/,
      expectation: { profile: { version: "2.0.0", codeHash: "1".repeat(32) } },
    },
    {
      name: "expected amount has no causal payout match",
      response: await fixture("tx-status-paid.json"),
      state: "FAILED",
      reason: /No causal payout receipt matches expected payment/,
      expectation: { amountYocto: "1" },
    },
  ];
  for (const entry of cases) {
    const store = createReconciliationStore();
    const before = storeFingerprintState(store);
    const requests: ReconciliationTxStatusRpcRequest[] = [];
    const result = await reconcilePayment({
      expectation: expectation(entry.expectation),
      candidate: candidate(entry.candidate),
      transport: recordingTransport(entry.response, requests),
      provenance: PROVENANCE,
      store,
    });
    assert.equal(requests.length, 1, entry.name);
    assert.equal(result.status, "NOT_APPLIED", entry.name);
    assert.equal(result.adapterState, entry.state, entry.name);
    assert.equal(result.record, null, entry.name);
    if (entry.reason) {
      assert.match(result.reason, entry.reason, entry.name);
    } else {
      assert.ok(result.reason.length > 0, entry.name);
    }
    assert.deepEqual(storeFingerprintState(store), before, entry.name);
  }
});

test("malformed, inherited, accessor, proxy, and special-key inputs are rejected", async () => {
  const store = createReconciliationStore();
  const before = storeFingerprintState(store);
  const base = {
    expectation: expectation(),
    candidate: candidate(),
    provenance: PROVENANCE,
    store,
  };
  const rejections: Array<[string, unknown, RegExp]> = [
    [
      "accessor input field",
      {
        ...base,
        get provenance() {
          return PROVENANCE;
        },
        transport: async () => ({}),
      },
      /own enumerable data property required/,
    ],
    [
      "inherited expectation fields",
      {
        ...base,
        expectation: Object.create({
          network: "TESTNET",
          daoAccountId: DAO,
          proposalId: "77",
          claimantId: ALICE,
          recipientId: ALICE,
          amountYocto: AMOUNT,
          profile: { version: "2.0.0", codeHash: CODE_HASH },
          cycle: { templateId: "7", periodIndex: "3" },
        }),
        transport: async () => ({}),
      },
      /plain object with no custom prototype required/,
    ],
    [
      "proxied expectation",
      {
        ...base,
        expectation: new Proxy(expectation(), {}),
        transport: async () => ({}),
      },
      /proxies and non-cloneable data are not allowed/,
    ],
    [
      "__proto__ special key on candidate",
      {
        ...base,
        candidate: withOwnProto(candidate(), { signerId: "evil.testnet" }),
        transport: async () => ({}),
      },
      /unexpected or missing fields/,
    ],
    [
      "symbol key on candidate",
      (() => {
        const value = { ...base, candidate: candidate() };
        (value.candidate as unknown as Record<PropertyKey, unknown>)[
          Symbol("s")
        ] = 1;
        return { ...value, transport: async () => ({}) };
      })(),
      /symbol properties are not allowed/,
    ],
    [
      "malformed candidate transaction hash",
      {
        ...base,
        candidate: candidate({ transactionHash: "not-a-hash" }),
        transport: async () => ({}),
      },
      /candidate transaction.transactionHash: base58 value required/,
    ],
    [
      "claimant differs from payout recipient",
      {
        ...base,
        expectation: expectation({ claimantId: "bob.example.testnet" }),
        transport: async () => ({}),
      },
      /claimant must equal payout recipient/,
    ],
    [
      "non-canonical proposal id",
      {
        ...base,
        expectation: expectation({ proposalId: "077" }),
        transport: async () => ({}),
      },
      /expectation.proposalId: canonical decimal required/,
    ],
    [
      "non-canonical amount",
      {
        ...base,
        expectation: expectation({ amountYocto: "1.0" }),
        transport: async () => ({}),
      },
      /expectation.amountYocto: canonical decimal required/,
    ],
    [
      "unsupported network",
      {
        ...base,
        expectation: expectation({ network: "MAINNET" as never }),
        transport: async () => ({}),
      },
      /expectation.network: TESTNET required/,
    ],
    [
      "oversized provenance",
      { ...base, provenance: "x".repeat(201), transport: async () => ({}) },
      /reconcile input.provenance: bounded text required/,
    ],
    [
      "empty provenance",
      { ...base, provenance: "   ", transport: async () => ({}) },
      /reconcile input.provenance: bounded text required/,
    ],
    [
      "transport is not a function",
      { ...base, transport: "fetch" },
      /injected RPC function required/,
    ],
    [
      "store is not a reconciliation store",
      { ...base, store: { apply: () => {} }, transport: async () => ({}) },
      /reconciliation store required/,
    ],
    [
      "unexpected expectation field",
      {
        ...base,
        expectation: { ...expectation(), extra: 1 },
        transport: async () => ({}),
      },
      /unexpected or missing fields/,
    ],
  ];
  for (const [name, input, pattern] of rejections) {
    await assert.rejects(
      reconcilePayment(input as Parameters<typeof reconcilePayment>[0]),
      pattern,
      name,
    );
  }
  assert.deepEqual(storeFingerprintState(store), before);
});

test("malformed or uncorrelated tx_status responses fail closed before the adapter", async () => {
  const paid = JSON.parse(
    JSON.stringify(await fixture("tx-status-paid.json")),
  ) as { result: { transaction: object } };
  const store = createReconciliationStore();
  const before = storeFingerprintState(store);
  const badResponses: Array<[string, unknown, RegExp]> = [
    [
      "JSON-RPC error envelope",
      {
        jsonrpc: "2.0",
        id: RECONCILIATION_TX_STATUS_RPC_ID,
        error: { code: -32000, message: "Transaction not found" },
      },
      /tx_status response: RPC error reported/,
    ],
    [
      "missing result",
      { jsonrpc: "2.0", id: RECONCILIATION_TX_STATUS_RPC_ID },
      /result required/,
    ],
    [
      "unexpected top-level key",
      {
        jsonrpc: "2.0",
        id: RECONCILIATION_TX_STATUS_RPC_ID,
        result: paid.result,
        extra: true,
      },
      /unexpected or missing fields/,
    ],
    [
      "missing finality status",
      { jsonrpc: "2.0", id: RECONCILIATION_TX_STATUS_RPC_ID, result: {} },
      /final_execution_status/,
    ],
    [
      "non-object result",
      { jsonrpc: "2.0", id: RECONCILIATION_TX_STATUS_RPC_ID, result: 42 },
      /JSON object required/,
    ],
    [
      "transaction hash differs from the candidate",
      {
        jsonrpc: "2.0",
        id: RECONCILIATION_TX_STATUS_RPC_ID,
        result: {
          ...paid.result,
          transaction: { ...paid.result.transaction, hash: ACTION },
        },
      },
      /does not match the candidate/,
    ],
  ];
  for (const [name, response, pattern] of badResponses) {
    await assert.rejects(
      reconcilePayment({
        expectation: expectation(),
        candidate: candidate(),
        transport: async () => response,
        provenance: PROVENANCE,
        store,
      }),
      pattern,
      name,
    );
  }
  const cyclic: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: RECONCILIATION_TX_STATUS_RPC_ID,
  };
  cyclic.self = cyclic;
  await assert.rejects(
    reconcilePayment({
      expectation: expectation(),
      candidate: candidate(),
      transport: async () => cyclic,
      provenance: PROVENANCE,
      store,
    }),
    /cyclic|cloneable|proxies/,
    "cyclic response",
  );
  assert.deepEqual(storeFingerprintState(store), before);
});

test("snapshots round-trip through export and import with identical fingerprints", async () => {
  const source = createReconciliationStore();
  await reconcileFixture(source, "tx-status-paid.json");
  source.apply(
    record({
      proposalId: "78",
      payoutReceiptId: OTHER_PAYOUT,
      actionReceiptId: OTHER_ACTION,
      transactionHash: OTHER_ACTION,
      payoutBlockHash: OTHER_BLOCK,
    }),
  );
  source.apply(
    record({
      proposalId: "79",
      payoutReceiptId: cryptoHashFromSeed("round-trip"),
      actionReceiptId: cryptoHashFromSeed("round-trip-action"),
      transactionHash: cryptoHashFromSeed("round-trip-action"),
      payoutBlockHash: cryptoHashFromSeed("round-trip-block"),
    }),
  );
  const snapshot = source.exportSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.records));
  assert.ok(Object.isFrozen(snapshot.records[0]));
  assert.ok(Object.isFrozen(snapshot.records[0]?.cycle));
  const target = createReconciliationStore();
  target.importSnapshot(structuredClone(snapshot));
  assert.equal(target.fingerprint(), source.fingerprint());
  assert.deepEqual(target.listRecords(), source.listRecords());
  assert.equal(
    target.getByProposal("TESTNET", DAO, "78")?.payoutReceiptId,
    OTHER_PAYOUT,
  );
  assert.equal(
    target.getByPayoutReceipt("TESTNET", OTHER_PAYOUT)?.proposalId,
    "78",
  );
  const empty = createReconciliationStore();
  const emptySnapshot = empty.exportSnapshot();
  const restored = createReconciliationStore();
  restored.importSnapshot(structuredClone(emptySnapshot));
  assert.equal(restored.fingerprint(), empty.fingerprint());
  assert.equal(restored.size(), 0);
});

test("rebuilds are deterministic regardless of application order", () => {
  const records = [
    record(),
    record({
      proposalId: "78",
      payoutReceiptId: OTHER_PAYOUT,
      actionReceiptId: OTHER_ACTION,
      transactionHash: OTHER_ACTION,
      payoutBlockHash: OTHER_BLOCK,
    }),
    record({
      proposalId: "79",
      payoutReceiptId: cryptoHashFromSeed("determinism"),
      actionReceiptId: cryptoHashFromSeed("determinism-action"),
      transactionHash: cryptoHashFromSeed("determinism-action"),
      payoutBlockHash: cryptoHashFromSeed("determinism-block"),
    }),
  ];
  const forward = createReconciliationStore();
  for (const entry of records)
    assert.equal(forward.apply(entry).status, "APPLIED");
  const reverse = createReconciliationStore();
  for (const entry of [...records].reverse()) {
    assert.equal(reverse.apply(entry).status, "APPLIED");
  }
  const imported = createReconciliationStore();
  imported.importSnapshot(structuredClone(forward.exportSnapshot()));
  assert.equal(forward.fingerprint(), reverse.fingerprint());
  assert.equal(forward.fingerprint(), imported.fingerprint());
  assert.deepEqual(
    new TextDecoder().decode(forward.exportCanonicalBytes()),
    new TextDecoder().decode(imported.exportCanonicalBytes()),
  );
  assert.deepEqual(reverse.listRecords(), forward.listRecords());
});

test("import rejects tampered, duplicated, unordered, and over-capacity snapshots without mutation", async () => {
  const source = createReconciliationStore();
  await reconcileFixture(source, "tx-status-paid.json");
  source.apply(
    record({
      proposalId: "78",
      payoutReceiptId: OTHER_PAYOUT,
      actionReceiptId: OTHER_ACTION,
      transactionHash: OTHER_ACTION,
      payoutBlockHash: OTHER_BLOCK,
    }),
  );
  const snapshot = JSON.parse(JSON.stringify(source.exportSnapshot())) as {
    fingerprint: string;
    records: Array<Record<string, unknown>>;
    schemaVersion: number;
  };
  const canonical = new TextDecoder().decode(source.exportCanonicalBytes());
  const fingerprint = source.fingerprint();
  const before = storeFingerprintState(source);

  const tamperedValue = structuredClone(snapshot);
  tamperedValue.records[0]!.payoutBlockHash = OTHER_BLOCK;
  assert.throws(
    () => source.importSnapshot(tamperedValue),
    /fingerprint mismatch/,
  );

  const tamperedFingerprint = structuredClone(snapshot);
  tamperedFingerprint.fingerprint = "b".repeat(64);
  assert.throws(
    () => source.importSnapshot(tamperedFingerprint),
    /fingerprint mismatch/,
  );

  const payloadWithoutFingerprint = JSON.parse(canonical);
  assert.throws(
    () => source.importSnapshot(payloadWithoutFingerprint),
    /unexpected or missing fields/,
  );

  const reordered = structuredClone(snapshot);
  reordered.records.reverse();
  assert.throws(
    () => source.importSnapshot(reordered),
    /canonical evidence-key order/,
  );

  const duplicated = structuredClone(snapshot);
  duplicated.records.push(structuredClone(duplicated.records[0]!));
  assert.throws(
    () => source.importSnapshot(duplicated),
    /duplicate evidence key/,
  );

  const invalidRecord = structuredClone(snapshot);
  invalidRecord.records[0]!.proposalId = "077";
  assert.throws(
    () => source.importSnapshot(invalidRecord),
    /canonical decimal/,
  );

  const missingField = structuredClone(snapshot);
  delete missingField.records[0]!.provenance;
  assert.throws(
    () => source.importSnapshot(missingField),
    /unexpected or missing fields/,
  );

  const overCapacity = {
    schemaVersion: 1,
    fingerprint: "c".repeat(64),
    records: Array.from(
      { length: RECONCILIATION_MAX_RECORDS + 1 },
      (_, index) =>
        record({
          proposalId: String(index),
          payoutReceiptId: cryptoHashFromSeed(`capacity-import-${index}`),
          actionReceiptId: cryptoHashFromSeed(
            `capacity-import-action-${index}`,
          ),
          transactionHash: cryptoHashFromSeed(`capacity-import-tx-${index}`),
          payoutBlockHash: cryptoHashFromSeed(`capacity-import-block-${index}`),
        }),
    ),
  };
  assert.throws(
    () => source.importSnapshot(overCapacity),
    /bounded record array/,
  );

  const wrongSchema = { ...structuredClone(snapshot), schemaVersion: 2 };
  assert.throws(
    () => source.importSnapshot(wrongSchema),
    /schemaVersion: 1 required/,
  );

  assert.deepEqual(storeFingerprintState(source), {
    fingerprint,
    size: before.size,
    records: before.records,
  });
});

test("record capacity is bounded before mutation", () => {
  const store = createReconciliationStore();
  assert.equal(RECONCILIATION_MAX_RECORDS, 2_000);
  for (let index = 0; index < RECONCILIATION_MAX_RECORDS; index += 1) {
    const result = store.apply(
      record({
        proposalId: String(index),
        payoutReceiptId: cryptoHashFromSeed(`capacity-${index}`),
        actionReceiptId: cryptoHashFromSeed(`capacity-action-${index}`),
        transactionHash: cryptoHashFromSeed(`capacity-tx-${index}`),
        payoutBlockHash: cryptoHashFromSeed(`capacity-block-${index}`),
      }),
    );
    assert.equal(result.status, "APPLIED");
  }
  assert.equal(store.size(), RECONCILIATION_MAX_RECORDS);
  const before = storeFingerprintState(store);
  assert.throws(
    () =>
      store.apply(
        record({
          proposalId: String(RECONCILIATION_MAX_RECORDS),
          payoutReceiptId: cryptoHashFromSeed("capacity-overflow"),
          actionReceiptId: cryptoHashFromSeed("capacity-overflow-action"),
          transactionHash: cryptoHashFromSeed("capacity-overflow-tx"),
          payoutBlockHash: cryptoHashFromSeed("capacity-overflow-block"),
        }),
      ),
    /capacity is exhausted/,
  );
  assert.deepEqual(storeFingerprintState(store), before);
  assert.equal(store.getByProposal("TESTNET", DAO, "0")?.proposalId, "0");
});

test("store records are deeply frozen and lookups are validated", async () => {
  const store = createReconciliationStore();
  const result = await reconcileFixture(store, "tx-status-paid.json");
  const record = result.record;
  assert.ok(record);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.cycle));
  assert.equal(store.getByProposal("TESTNET", DAO, "77"), record);
  assert.equal(store.getByPayoutReceipt("TESTNET", PAYOUT), record);
  assert.equal(store.getByProposal("MAINNET", DAO, "77"), null);
  assert.equal(store.getByPayoutReceipt("TESTNET", OTHER_PAYOUT), null);
  assert.equal(isReconciliationStore(store), true);
  assert.equal(isReconciliationStore({}), false);
  assert.throws(
    () => store.getByProposal("testnet" as never, DAO, "77"),
    /network required/,
  );
  assert.throws(
    () => store.getByProposal("TESTNET", DAO, "077"),
    /canonical decimal/,
  );
  assert.throws(() => store.getByPayoutReceipt("TESTNET", "short"), /base58/);
  assert.throws(
    () => store.getByProposal("TESTNET", "bad_account!", "77"),
    /account/,
  );
  assert.throws(
    () => store.apply({ schemaVersion: 2 } as never),
    /unexpected or missing fields/,
  );
});

test("mirrors the domain canonical serializer, schema version, and registry capacity", async () => {
  assert.equal(DOMAIN_SCHEMA_VERSION, 1);
  assert.equal(domainReconciliationBounds.maxRecords, registryBounds.maxCycles);
  assert.equal(RECONCILIATION_MAX_RECORDS, registryBounds.maxCycles);
  const store = createReconciliationStore();
  await reconcileFixture(store, "tx-status-paid.json");
  store.apply(
    record({
      proposalId: "78",
      payoutReceiptId: OTHER_PAYOUT,
      actionReceiptId: OTHER_ACTION,
      transactionHash: OTHER_ACTION,
      payoutBlockHash: OTHER_BLOCK,
    }),
  );
  const exported = new TextDecoder().decode(store.exportCanonicalBytes());
  assert.equal(
    exported,
    canonicalJsonString({
      records: JSON.parse(exported).records,
      schemaVersion: 1,
    } as never),
  );
  const expectedFingerprint = createHash("sha256")
    .update(store.exportCanonicalBytes())
    .digest("hex");
  assert.equal(store.fingerprint(), expectedFingerprint);
});

test("empty-store fingerprint matches an independent SHA-256 of the canonical bytes", () => {
  const store = createReconciliationStore();
  const bytes = store.exportCanonicalBytes();
  assert.equal(
    Buffer.from(bytes).toString("utf8"),
    '{"records":[],"schemaVersion":1}',
  );
  assert.equal(
    store.fingerprint(),
    createHash("sha256").update(bytes).digest("hex"),
  );
});

test("nested adversarial keys yield bounded content-free diagnostics", async () => {
  const store = createReconciliationStore();
  const before = storeFingerprintState(store);
  const hugeKey = "K".repeat(120_000);
  const hugeInnerKey = "E".repeat(120_000);
  const inner: Record<string, unknown> = {};
  Object.defineProperty(inner, hugeInnerKey, {
    enumerable: true,
    get() {
      return 1;
    },
  });
  const rejection = await reconcilePayment({
    expectation: expectation(),
    candidate: candidate(),
    transport: async () => ({
      jsonrpc: "2.0",
      id: RECONCILIATION_TX_STATUS_RPC_ID,
      result: { [hugeKey]: inner },
    }),
    provenance: PROVENANCE,
    store,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(rejection instanceof Error, "expected the walk to reject");
  const message = rejection.message;
  assert.match(message, /own enumerable data property required/);
  assert.ok(
    new TextEncoder().encode(message).length <= 256,
    `diagnostic is not bounded: ${new TextEncoder().encode(message).length} bytes`,
  );
  assert.equal(message.includes(hugeKey), false);
  assert.equal(message.includes(hugeInnerKey), false);
  assert.equal(message.includes(hugeKey.slice(0, 64)), false);
  assert.equal(message.includes(hugeInnerKey.slice(0, 64)), false);
  assert.deepEqual(storeFingerprintState(store), before);
});
