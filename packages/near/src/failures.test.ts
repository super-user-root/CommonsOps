// P3-T04 failure matrix: one data-driven table proving that the whole
// evidence pipeline (adapter -> reconcilePayment -> reconciliation store)
// fails closed for every unsafe class in the P3-T04 spec and ADR P0-T02
// §10/§12. Each row asserts the exact expected adapter verdict (state plus
// reason) and, wherever persistence is involved, that the store stays
// byte-identical (fingerprint, size, and canonical records). The final
// invariant test scans every recorded observation; the self-check test
// proves every table row ran exactly once. No live RPC, no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createReconciliationStore,
  reconcilePayment,
  RECONCILIATION_MAX_RECORDS,
  RECONCILIATION_TX_STATUS_RPC_ID,
  verifyNativeSputnikPayment,
  type ExpectedNativePayment,
  type PaymentState,
  type ReconciliationRecord,
  type ReconciliationResult,
  type ReconciliationStore,
  type VerifiedPayment,
} from "./index.ts";

const fixturesRoot = path.resolve(
  import.meta.dirname,
  "../../../tests/fixtures",
);

const DAO = "dao.example.testnet";
const OTHER_DAO = "other.dao.testnet";
const ALICE = "alice.example.testnet";
const BOB = "bob.example.testnet";
const CHLOE = "chloe.testnet";
const AUTHENTIC_DAO = "marmaj.sputnikv2.testnet";
const AMOUNT = "5100000000000000000000000";
const BOND = "19000000000000000000000";
const CODE_HASH = "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq";
const TX = "6uzuBipBzBod3BcjGW3mz5dgXRd3ujforNw2k7YVvmug";
const ACTION = "EXXtTcFksfrvuPbWYW32MEEvuxFLFiNJA9267CJca6f";
const PAYOUT = "GEU8yPojva5caEpZCcpQ26zzydsasxgGQRv2BAqQZUdq";
const PAYOUT_BLOCK = "7TGrboF8jPxEwFc4hVJdZr6482bJbNxNNQWz3pLDrA7U";
const PROVENANCE = "P3-T04 synthetic failure-matrix replay; no live RPC";

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

// Deterministic identifiers for in-test mutations, derived from fixed seeds.
function hashFromSeed(seed: string, byteLength = 32): string {
  const digest = createHash("sha256").update(seed).digest();
  return base58Encode(digest.subarray(0, byteLength));
}

const fixtureCache = new Map<string, Promise<unknown>>();

function fixture(relative: string): Promise<unknown> {
  const cached = fixtureCache.get(relative);
  if (cached) return cached;
  const loaded = readFile(path.join(fixturesRoot, relative), "utf8").then(
    (text) => JSON.parse(text) as unknown,
  );
  fixtureCache.set(relative, loaded);
  return loaded;
}

function mutate<T>(value: T, change: (draft: T) => void): T {
  const draft = structuredClone(value);
  change(draft);
  return draft;
}

const baseExpected: ExpectedNativePayment = {
  network: "testnet",
  daoAccountId: DAO,
  proposalId: "77",
  recipientId: ALICE,
  amountYocto: AMOUNT,
  version: "2.0.0",
  codeHash: CODE_HASH,
};

function proposalBody(overrides: {
  id?: number;
  status?: string;
  tokenId?: string;
  receiverId?: string;
  amount?: string;
  msg?: unknown;
}): unknown {
  return {
    id: overrides.id ?? 77,
    status: overrides.status ?? "Approved",
    kind: {
      Transfer: {
        token_id: overrides.tokenId ?? "",
        receiver_id: overrides.receiverId ?? ALICE,
        amount: overrides.amount ?? AMOUNT,
        msg: overrides.msg === undefined ? null : overrides.msg,
      },
    },
  };
}

type ReconcileExpectation = Parameters<
  typeof reconcilePayment
>[0]["expectation"];
type ReconcileCandidate = Parameters<typeof reconcilePayment>[0]["candidate"];

function reconcileExpectation(
  overrides: Partial<ReconcileExpectation> = {},
): ReconcileExpectation {
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

function reconcileCandidate(
  overrides: Partial<ReconcileCandidate> = {},
): ReconcileCandidate {
  return { transactionHash: TX, signerId: ALICE, ...overrides };
}

function reconciliationRecord(
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

interface StoreStateSnapshot {
  readonly fingerprint: string;
  readonly size: number;
  readonly canonical: string;
  readonly records: readonly ReconciliationRecord[];
}

function storeState(store: ReconciliationStore): StoreStateSnapshot {
  return {
    fingerprint: store.fingerprint(),
    size: store.size(),
    canonical: new TextDecoder().decode(store.exportCanonicalBytes()),
    records: store.listRecords(),
  };
}

function assertStoreUnchanged(
  store: ReconciliationStore,
  before: StoreStateSnapshot,
  label: string,
): void {
  const after = storeState(store);
  assert.equal(after.fingerprint, before.fingerprint, `${label}: fingerprint`);
  assert.equal(after.size, before.size, `${label}: size`);
  assert.equal(after.canonical, before.canonical, `${label}: canonical bytes`);
  assert.deepEqual(after.records, before.records, `${label}: records`);
}

function baselineStore(): ReconciliationStore {
  const store = createReconciliationStore();
  const applied = store.apply(reconciliationRecord());
  assert.equal(applied.status, "APPLIED");
  return store;
}

// Canonical JSON mirroring the store fingerprint preimage so the MAINNET
// import row can present a fully consistent, correctly fingerprinted
// snapshot and still be rejected.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

interface MatrixObservation {
  readonly id: string;
  readonly cls: string;
  readonly level: "adapter" | "reconcile" | "store";
  readonly paid: boolean;
  readonly persisted: boolean;
}

interface MatrixCase {
  readonly id: string;
  readonly cls: string;
  readonly level: "adapter" | "reconcile" | "store";
  execute: () => Promise<void> | void;
}

const observations: MatrixObservation[] = [];
const executedRowIds: string[] = [];
const adapterResults = new Map<string, VerifiedPayment>();

function mark(
  row: { id: string; cls: string },
  level: MatrixObservation["level"],
  paid: boolean,
  persisted: boolean,
): void {
  executedRowIds.push(row.id);
  observations.push({
    id: row.id,
    cls: row.cls,
    level,
    paid,
    persisted,
  });
}

function adapterVerdict(row: {
  id: string;
  cls: string;
  name: string;
  expected: ExpectedNativePayment;
  proposal: unknown;
  response: unknown;
  state: PaymentState;
  reason: RegExp;
  exact?: VerifiedPayment;
}): MatrixCase {
  return {
    id: row.id,
    cls: row.cls,
    level: "adapter",
    execute: () => {
      const result = verifyNativeSputnikPayment(
        row.expected,
        row.proposal,
        row.response,
      );
      assert.equal(result.state, row.state, `${row.id} (${row.name}): state`);
      assert.match(
        result.reason,
        row.reason,
        `${row.id} (${row.name}): reason`,
      );
      if (row.exact) {
        assert.deepEqual(result, row.exact, `${row.id} (${row.name}): exact`);
      }
      adapterResults.set(row.id, result);
      mark(row, "adapter", result.state === "PAID", false);
    },
  };
}

function adapterThrows(row: {
  id: string;
  cls: string;
  name: string;
  expected: ExpectedNativePayment;
  proposal: unknown;
  response: unknown;
  pattern: RegExp;
}): MatrixCase {
  return {
    id: row.id,
    cls: row.cls,
    level: "adapter",
    execute: () => {
      assert.throws(
        () =>
          verifyNativeSputnikPayment(row.expected, row.proposal, row.response),
        row.pattern,
        `${row.id} (${row.name})`,
      );
      mark(row, "adapter", false, false);
    },
  };
}

interface ReconcileRowInput {
  id: string;
  cls: string;
  name: string;
  store?: () => ReconciliationStore;
  response: unknown;
  expectation?: Partial<ReconcileExpectation>;
  candidate?: Partial<ReconcileCandidate>;
  provenance?: string;
  status?: ReconciliationResult["status"];
  adapterState?: PaymentState;
  reason?: RegExp;
  exactRecord?: ReconciliationRecord;
  throws?: RegExp;
}

// Candidates bind to the response under test: fixture rows carry their own
// transaction hash and signer, so each row replays exactly its own evidence.
function candidateFor(
  row: Pick<ReconcileRowInput, "response" | "candidate">,
): ReconcileCandidate {
  if (row.candidate) return reconcileCandidate(row.candidate);
  const transaction = (
    row.response as {
      result?: { transaction?: { hash?: unknown; signer_id?: unknown } };
    }
  )?.result?.transaction;
  if (
    typeof transaction?.hash === "string" &&
    typeof transaction.signer_id === "string"
  ) {
    return {
      transactionHash: transaction.hash,
      signerId: transaction.signer_id,
    };
  }
  return reconcileCandidate();
}

function reconcileRow(row: ReconcileRowInput): MatrixCase {
  return {
    id: row.id,
    cls: row.cls,
    level: "reconcile",
    execute: async () => {
      const store = (row.store ?? createReconciliationStore)();
      const before = storeState(store);
      const input = {
        expectation: reconcileExpectation(row.expectation),
        candidate: candidateFor(row),
        transport: async () => row.response,
        provenance: row.provenance ?? PROVENANCE,
        store,
      };
      if (row.throws) {
        await assert.rejects(
          reconcilePayment(input),
          row.throws,
          `${row.id} (${row.name})`,
        );
        assertStoreUnchanged(store, before, row.id);
        mark(row, "reconcile", false, false);
        return;
      }
      const result = await reconcilePayment(input);
      assert.equal(
        result.status,
        row.status,
        `${row.id} (${row.name}): status`,
      );
      if (row.adapterState !== undefined) {
        assert.equal(
          result.adapterState,
          row.adapterState,
          `${row.id} (${row.name}): adapterState`,
        );
      }
      if (row.reason) {
        assert.match(
          result.reason,
          row.reason,
          `${row.id} (${row.name}): reason`,
        );
      }
      const persisted =
        result.status === "APPLIED" || result.status === "IDEMPOTENT";
      if (persisted) {
        assert.ok(result.record, `${row.id} (${row.name}): record`);
        if (row.exactRecord) {
          assert.deepEqual(
            result.record,
            row.exactRecord,
            `${row.id} (${row.name}): record`,
          );
        }
      } else {
        assert.equal(result.record, null, `${row.id} (${row.name}): no record`);
        assertStoreUnchanged(store, before, row.id);
      }
      mark(row, "reconcile", result.adapterState === "PAID", persisted);
    },
  };
}

interface StoreRowInput {
  id: string;
  cls: string;
  name: string;
  store?: () => ReconciliationStore;
  throws?: RegExp;
  status?: ReconciliationResult["status"];
  selfContained?: boolean;
  run: (store: ReconciliationStore) => unknown;
}

function storeRow(row: StoreRowInput): MatrixCase {
  return {
    id: row.id,
    cls: row.cls,
    level: "store",
    execute: () => {
      const store = (row.store ?? baselineStore)();
      const before = storeState(store);
      if (row.throws) {
        assert.throws(
          () => row.run(store),
          row.throws,
          `${row.id} (${row.name})`,
        );
        mark(row, "store", false, false);
      } else if (row.status) {
        const result = row.run(store) as ReconciliationResult;
        assert.equal(
          result.status,
          row.status,
          `${row.id} (${row.name}): status`,
        );
        assert.ok(result.reason.length > 0, `${row.id} (${row.name}): reason`);
        const persisted =
          result.status === "APPLIED" || result.status === "IDEMPOTENT";
        if (persisted) {
          assert.ok(result.record, `${row.id} (${row.name}): record`);
        } else {
          assert.equal(
            result.record,
            null,
            `${row.id} (${row.name}): no record`,
          );
        }
        mark(row, "store", result.adapterState === "PAID", persisted);
      } else {
        row.run(store);
        mark(row, "store", false, false);
      }
      if (!row.selfContained) assertStoreUnchanged(store, before, row.id);
    },
  };
}

// ---------------------------------------------------------------------------
// The matrix. Every row is enumerated here in one place; the class tests
// below execute them in table order and the trailing tests verify the
// invariants and full coverage.
// ---------------------------------------------------------------------------
const MATRIX: readonly MatrixCase[] = [
  // ---- positive control: the exact causal PAID path -----------------------
  adapterVerdict({
    id: "pc-authentic-proposal-63-paid",
    cls: "positive-control",
    name: "authentic P3-T01 proposal 63 evidence verifies PAID with exact identity",
    expected: {
      network: "testnet",
      daoAccountId: AUTHENTIC_DAO,
      proposalId: "63",
      recipientId: CHLOE,
      amountYocto: "81900000000000000000000000",
      version: "2.0.0",
      codeHash: CODE_HASH,
    },
    proposal: proposalBody({
      id: 63,
      receiverId: CHLOE,
      amount: "81900000000000000000000000",
    }),
    response: await fixture("sputnik/proposal-63-paid.json"),
    state: "PAID",
    reason: /Verified one successful causal native NEAR payout/,
    exact: {
      state: "PAID",
      reason: "Verified one successful causal native NEAR payout",
      transactionHash: "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm",
      actionReceiptId: "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
      payoutReceiptId: "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
      evidenceKey:
        "testnet:marmaj.sputnikv2.testnet:63:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
      blockHash: "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy",
    },
  }),

  // ---- class 1: governance status -----------------------------------------
  adapterVerdict({
    id: "gov-inprogress-without-receipt-data",
    cls: "governance-status",
    name: "InProgress proposal with no receipt data is UNKNOWN, never PAID",
    expected: baseExpected,
    proposal: proposalBody({ status: "InProgress" }),
    response: {},
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "gov-inprogress-authentic-failed-act",
    cls: "governance-status",
    name: "authentic InProgress proposal 62 with failed act receipt is FAILED",
    expected: {
      network: "testnet",
      daoAccountId: AUTHENTIC_DAO,
      proposalId: "62",
      recipientId: CHLOE,
      amountYocto: "378000000000000000000000000",
      version: "2.0.0",
      codeHash: CODE_HASH,
    },
    proposal: proposalBody({
      id: 62,
      status: "InProgress",
      receiverId: CHLOE,
      amount: "378000000000000000000000000",
    }),
    response: await fixture("sputnik/proposal-62-failed.json"),
    state: "FAILED",
    reason: /Proposal action receipt failed/,
  }),
  adapterVerdict({
    id: "gov-rejected-vote-graph",
    cls: "governance-status",
    name: "Rejected proposal vote graph is INVALID, never PAID",
    expected: baseExpected,
    proposal: proposalBody({ status: "Rejected" }),
    response: await fixture("failures/rejected-vote-no-payout.json"),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "gov-rejected-without-receipt-data",
    cls: "governance-status",
    name: "Rejected proposal with no receipt data is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({ status: "Rejected" }),
    response: {},
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "gov-removed-vote-graph",
    cls: "governance-status",
    name: "Removed proposal vote graph is INVALID, never PAID",
    expected: baseExpected,
    proposal: proposalBody({ status: "Removed" }),
    response: await fixture("failures/rejected-vote-no-payout.json"),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "gov-removed-without-receipt-data",
    cls: "governance-status",
    name: "Removed proposal with no receipt data is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({ status: "Removed" }),
    response: {},
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "gov-expired-vote-graph",
    cls: "governance-status",
    name: "Expired proposal vote graph is INVALID, never PAID",
    expected: baseExpected,
    proposal: proposalBody({ status: "Expired" }),
    response: await fixture("failures/rejected-vote-no-payout.json"),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "gov-expired-without-receipt-data",
    cls: "governance-status",
    name: "Expired proposal with no receipt data is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({ status: "Expired" }),
    response: {},
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "gov-approved-graph-without-payout-child",
    cls: "governance-status",
    name: "approval action with no causal payout transfer is FAILED",
    expected: baseExpected,
    proposal: proposalBody({ status: "Approved" }),
    response: mutate(
      await fixture("failures/rejected-vote-no-payout.json"),
      (draft) => {
        const args = Buffer.from(
          JSON.stringify({ id: 77, action: "VoteApprove" }),
        ).toString("base64");
        const result = (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { args: string } }>;
              };
              receipts: Array<{
                receipt: {
                  Action: {
                    actions: Array<{ FunctionCall: { args: string } }>;
                  };
                };
              }>;
            };
          }
        ).result;
        result.transaction.actions[0]!.FunctionCall.args = args;
        result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args = args;
      },
    ),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),

  // ---- class 2: execution failures ----------------------------------------
  adapterVerdict({
    id: "exec-authentic-act-receipt-failed",
    cls: "execution-failure",
    name: "authentic proposal-62 failed act_proposal receipt is FAILED",
    expected: {
      network: "testnet",
      daoAccountId: AUTHENTIC_DAO,
      proposalId: "62",
      recipientId: CHLOE,
      amountYocto: "378000000000000000000000000",
      version: "2.0.0",
      codeHash: CODE_HASH,
    },
    proposal: proposalBody({
      id: 62,
      status: "InProgress",
      receiverId: CHLOE,
      amount: "378000000000000000000000000",
    }),
    response: await fixture("sputnik/proposal-62-failed.json"),
    state: "FAILED",
    reason: /Proposal action receipt failed/,
  }),
  adapterVerdict({
    id: "exec-payout-receipt-failed",
    cls: "execution-failure",
    name: "successful act with failed causal payout transfer is FAILED",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/payout-failed.json"),
    state: "FAILED",
    reason: /Matching payout receipt failed/,
  }),
  adapterVerdict({
    id: "exec-payout-success-receipt-id-not-success-value",
    cls: "execution-failure",
    name: "payout outcome SuccessReceiptId where SuccessValue is required is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/payout-success-receipt-id.json"),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  adapterVerdict({
    id: "exec-tx-outcome-status-missing",
    cls: "execution-failure",
    name: "missing transaction outcome status is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        delete (
          draft as {
            result: { transaction_outcome: { outcome: { status?: unknown } } };
          }
        ).result.transaction_outcome.outcome.status;
      },
    ),
    state: "UNKNOWN",
    reason: /Proposal transaction outcome is not a successful receipt/,
  }),
  adapterVerdict({
    id: "exec-action-outcome-status-missing",
    cls: "execution-failure",
    name: "missing action receipt outcome status is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        delete (
          draft as {
            result: {
              receipts_outcome: Array<{ outcome: { status?: unknown } }>;
            };
          }
        ).result.receipts_outcome[0]!.outcome.status;
      },
    ),
    state: "UNKNOWN",
    reason: /Proposal action receipt outcome is unknown/,
  }),
  adapterVerdict({
    id: "exec-nonfinal-executing-optimistic",
    cls: "execution-failure",
    name: "EXECUTING_OPTIMISTIC finality over a paid graph is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/nonfinal-executing-optimistic.json"),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "exec-nonfinal-none",
    cls: "execution-failure",
    name: "NONE finality over a paid graph is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/nonfinal-none.json"),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "exec-nonfinal-applied",
    cls: "execution-failure",
    name: "APPLIED (pre-final) finality over a paid graph is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("failures/nonfinal-executing-optimistic.json"),
      (draft) => {
        (
          draft as { result: { final_execution_status: string } }
        ).result.final_execution_status = "APPLIED";
      },
    ),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "exec-receipts-array-absent",
    cls: "execution-failure",
    name: "absent receipts array is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        delete (draft as { result: { receipts?: unknown } }).result.receipts;
      },
    ),
    state: "UNKNOWN",
    reason: /Receipt graph is incomplete/,
  }),
  adapterVerdict({
    id: "exec-outcomes-array-absent",
    cls: "execution-failure",
    name: "absent receipts_outcome array is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        delete (draft as { result: { receipts_outcome?: unknown } }).result
          .receipts_outcome;
      },
    ),
    state: "UNKNOWN",
    reason: /Receipt graph is incomplete/,
  }),

  // ---- class 3: mismatches -------------------------------------------------
  adapterVerdict({
    id: "mis-wrong-proposal-id-tx-level",
    cls: "mismatch",
    name: "wrong proposal id in the transaction action is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { args: string } }>;
              };
            };
          }
        ).result.transaction.actions[0]!.FunctionCall.args = Buffer.from(
          JSON.stringify({ id: 78, action: "VoteApprove" }),
        ).toString("base64");
      },
    ),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "mis-wrong-proposal-id-action-receipt-level",
    cls: "mismatch",
    name: "wrong proposal id in the action receipt is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as {
            result: {
              receipts: Array<{
                receipt: {
                  Action: {
                    actions: Array<{ FunctionCall: { args: string } }>;
                  };
                };
              }>;
            };
          }
        ).result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args =
          Buffer.from(
            JSON.stringify({ id: 78, action: "VoteApprove" }),
          ).toString("base64");
      },
    ),
    state: "INVALID",
    reason: /Proposal action receipt does not match linked proposal/,
  }),
  adapterVerdict({
    id: "mis-wrong-dao-receiver",
    cls: "mismatch",
    name: "transaction targeting another DAO is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as { result: { transaction: { receiver_id: string } } }
        ).result.transaction.receiver_id = OTHER_DAO;
      },
    ),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "mis-wrong-recipient-expectation",
    cls: "mismatch",
    name: "expectation for another recipient finds no causal payout and is FAILED",
    expected: { ...baseExpected, recipientId: BOB },
    proposal: proposalBody({ receiverId: BOB }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  adapterVerdict({
    id: "mis-wrong-recipient-receipt",
    cls: "mismatch",
    name: "payout transfer to another recipient is excluded and FAILED",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const receipts = (
          draft as {
            result: {
              receipts: Array<{ receipt_id: string; receiver_id: string }>;
            };
          }
        ).result.receipts;
        const payout = receipts.find(
          (receipt) => receipt.receipt_id === PAYOUT,
        );
        assert.ok(payout);
        payout.receiver_id = BOB;
      },
    ),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  adapterVerdict({
    id: "mis-dust-amount",
    cls: "mismatch",
    name: "dust expectation matches no causal transfer and is FAILED",
    expected: { ...baseExpected, amountYocto: "10" },
    proposal: proposalBody({ amount: "10" }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  adapterVerdict({
    id: "mis-non-native-token-id",
    cls: "mismatch",
    name: "non-native token_id proposal body is INVALID",
    expected: baseExpected,
    proposal: proposalBody({ tokenId: "ft.example.testnet" }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "INVALID",
    reason: /Proposal does not match expected native payout/,
  }),
  adapterVerdict({
    id: "mis-non-null-msg",
    cls: "mismatch",
    name: "non-null proposal msg is INVALID",
    expected: baseExpected,
    proposal: proposalBody({ msg: "memo" }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "INVALID",
    reason: /Proposal does not match expected native payout/,
  }),
  adapterVerdict({
    id: "mis-zero-tx-actions",
    cls: "mismatch",
    name: "transaction with zero actions is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as { result: { transaction: { actions: unknown[] } } }
        ).result.transaction.actions = [];
      },
    ),
    state: "INVALID",
    reason: /Transaction does not contain one proposal action/,
  }),
  adapterVerdict({
    id: "mis-extra-tx-actions",
    cls: "mismatch",
    name: "transaction with an extra action is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as {
            result: { transaction: { actions: unknown[] } };
          }
        ).result.transaction.actions.push({ Transfer: { deposit: "1" } });
      },
    ),
    state: "INVALID",
    reason: /Transaction does not contain one proposal action/,
  }),
  adapterVerdict({
    id: "mis-extra-action-receipt-actions",
    cls: "mismatch",
    name: "action receipt with an extra action is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as {
            result: {
              receipts: Array<{ receipt: { Action: { actions: unknown[] } } }>;
            };
          }
        ).result.receipts[0]!.receipt.Action.actions.push({
          Transfer: { deposit: "1" },
        });
      },
    ),
    state: "INVALID",
    reason: /Proposal action receipt does not match linked proposal/,
  }),
  adapterVerdict({
    id: "mis-nonzero-act-deposit",
    cls: "mismatch",
    name: "act_proposal action with nonzero deposit is INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const action = (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { deposit: string } }>;
              };
            };
          }
        ).result.transaction.actions[0]!;
        action.FunctionCall.deposit = "1";
      },
    ),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "mis-args-not-vote-approve",
    cls: "mismatch",
    name: "non-VoteApprove act args are INVALID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const args = Buffer.from(
          JSON.stringify({ id: 77, action: "VoteFinalize" }),
        ).toString("base64");
        const result = (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { args: string } }>;
              };
              receipts: Array<{
                receipt: {
                  Action: {
                    actions: Array<{ FunctionCall: { args: string } }>;
                  };
                };
              }>;
            };
          }
        ).result;
        result.transaction.actions[0]!.FunctionCall.args = args;
        result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args = args;
      },
    ),
    state: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  adapterVerdict({
    id: "mis-bond-refund-identical-both-succeed",
    cls: "mismatch",
    name: "bond refund identical to the expected amount with twin payout is AMBIGUOUS",
    expected: { ...baseExpected, amountYocto: BOND },
    proposal: proposalBody({ amount: BOND }),
    response: await fixture("failures/bond-identical-ambiguous.json"),
    state: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  adapterVerdict({
    id: "mis-bond-refund-identical-payout-failed",
    cls: "mismatch",
    name: "bond refund identical to the expected amount with failed payout is AMBIGUOUS, never PAID",
    // Source fix (head vs base defec7b9): the base adapter ignored the failed
    // matching-amount child and returned PAID on the surviving identical
    // bond-refund transfer; the fixed adapter returns AMBIGUOUS per ADR §10.
    // This row fails against base (state PAID) and passes at head.
    expected: { ...baseExpected, amountYocto: BOND },
    proposal: proposalBody({ amount: BOND }),
    response: await fixture("failures/bond-identical-payout-failed.json"),
    state: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  adapterVerdict({
    id: "mis-system-refund-matching-amount",
    cls: "mismatch",
    name: "system gas refund matching the exact amount is excluded and FAILED",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/system-refund-matching-amount.json"),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  adapterVerdict({
    id: "mis-decoy-transfer-not-direct-child",
    cls: "mismatch",
    name: "same-recipient same-amount transfer without direct causal link is FAILED",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/decoy-unlinked-transfer.json"),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  adapterVerdict({
    id: "mis-decoy-does-not-disturb-real-payout",
    cls: "mismatch",
    name: "unrelated same-recipient same-amount transfer outside the causal set is ignored and the real payout stays PAID",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const result = (
          draft as {
            result: {
              receipts: Array<Record<string, unknown>>;
              receipts_outcome: Array<Record<string, unknown>>;
            };
          }
        ).result;
        const decoyId = hashFromSeed(
          "P3-T04/mis-decoy-does-not-disturb-real-payout/decoy",
        );
        const decoyBlock = hashFromSeed(
          "P3-T04/mis-decoy-does-not-disturb-real-payout/block",
        );
        result.receipts.push({
          predecessor_id: DAO,
          priority: 0,
          receipt: {
            Action: {
              actions: [{ Transfer: { deposit: AMOUNT } }],
              gas_price: "250008035",
              input_data_ids: [],
              is_promise_yield: false,
              output_data_receivers: [],
              signer_id: ALICE,
              signer_public_key:
                "ed25519:5FTfLUtjcUXNP9bRu8go3Qcv2kFKJJvMrEiZufLHDdmp",
            },
          },
          receipt_id: decoyId,
          receiver_id: ALICE,
        });
        result.receipts_outcome.push({
          block_hash: decoyBlock,
          id: decoyId,
          outcome: {
            executor_id: ALICE,
            gas_burnt: 223182562500,
            logs: [],
            metadata: { gas_profile: null, version: 1 },
            receipt_ids: [],
            status: { SuccessValue: "" },
            tokens_burnt: "22318256250000000000",
          },
          proof: [],
        });
      },
    ),
    state: "PAID",
    reason: /Verified one successful causal native NEAR payout/,
    exact: {
      state: "PAID",
      reason: "Verified one successful causal native NEAR payout",
      transactionHash: TX,
      actionReceiptId: ACTION,
      payoutReceiptId: PAYOUT,
      evidenceKey: `testnet:${DAO}:77:${ACTION}:${PAYOUT}`,
      blockHash: PAYOUT_BLOCK,
    },
  }),
  adapterVerdict({
    id: "mis-ft-transfer-child",
    cls: "mismatch",
    name: "token ft_transfer_call child cannot satisfy a native payout and is FAILED",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/ft-transfer-child.json"),
    state: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),

  // ---- class 4: ambiguity and incompleteness ------------------------------
  adapterVerdict({
    id: "amb-duplicate-identical-payouts",
    cls: "ambiguity-incompleteness",
    name: "duplicate identical payout candidates are AMBIGUOUS (existing twin fixture)",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("reconciliation/tx-status-ambiguous.json"),
    state: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  adapterVerdict({
    id: "amb-missing-child-receipt",
    cls: "ambiguity-incompleteness",
    name: "missing child receipt is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const result = (
          draft as {
            result: { receipts: Array<{ receipt_id: string }> };
          }
        ).result;
        result.receipts = result.receipts.filter(
          (receipt) => receipt.receipt_id !== PAYOUT,
        );
      },
    ),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  adapterVerdict({
    id: "amb-missing-child-outcome",
    cls: "ambiguity-incompleteness",
    name: "missing child outcome is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const result = (
          draft as {
            result: { receipts_outcome: Array<{ id: string }> };
          }
        ).result;
        result.receipts_outcome = result.receipts_outcome.filter(
          (entry) => entry.id !== PAYOUT,
        );
      },
    ),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  adapterVerdict({
    id: "amb-garbled-graph",
    cls: "ambiguity-incompleteness",
    name: "garbled graph with missing receipts, orphan outcomes and cycles is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/garbled-graph.json"),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  adapterVerdict({
    id: "amb-null-receipt-entry",
    cls: "ambiguity-incompleteness",
    name: "null entry in the receipts array is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (draft as { result: { receipts: unknown[] } }).result.receipts.unshift(
          null,
        );
      },
    ),
    state: "UNKNOWN",
    reason: /Receipt graph is incomplete/,
  }),
  adapterVerdict({
    id: "amb-receipts-wrong-type",
    cls: "ambiguity-incompleteness",
    name: "receipts as a non-array object is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (draft as { result: { receipts: unknown } }).result.receipts = {};
      },
    ),
    state: "UNKNOWN",
    reason: /Receipt graph is incomplete/,
  }),
  adapterVerdict({
    id: "amb-payout-zero-actions",
    cls: "ambiguity-incompleteness",
    name: "payout receipt with zero actions is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const receipts = (
          draft as {
            result: {
              receipts: Array<{
                receipt_id: string;
                receipt: { Action: { actions: unknown[] } };
              }>;
            };
          }
        ).result.receipts;
        const payout = receipts.find(
          (receipt) => receipt.receipt_id === PAYOUT,
        );
        assert.ok(payout);
        payout.receipt.Action.actions = [];
      },
    ),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  adapterVerdict({
    id: "amb-payout-extra-actions",
    cls: "ambiguity-incompleteness",
    name: "payout receipt with two Transfer actions is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: await fixture("failures/payout-extra-actions.json"),
    state: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),

  // ---- class 6: input hostility at the adapter boundary --------------------
  adapterThrows({
    id: "hostile-getter-throws",
    cls: "input-hostility",
    name: "throwing getter on the response never yields a verdict",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: {
      get final_execution_status() {
        throw new Error("boom: hostile getter");
      },
    },
    pattern: /boom: hostile getter/,
  }),
  adapterVerdict({
    id: "hostile-cyclic-response",
    cls: "input-hostility",
    name: "cyclic response object terminates with UNKNOWN and no hang",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: (() => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      return cyclic;
    })(),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "hostile-symbol-keys",
    cls: "input-hostility",
    name: "symbol-keyed response carries no readable data and is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: (() => {
      const symbolOnly: Record<PropertyKey, unknown> = {};
      symbolOnly[Symbol("p3-t04")] = { final_execution_status: "FINAL" };
      return symbolOnly;
    })(),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "hostile-proto-own-key",
    cls: "input-hostility",
    name: "own __proto__ key on the response is ignored and the verdict stays UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: (() => {
      const value: Record<string, unknown> = {};
      Object.defineProperty(value, "__proto__", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { final_execution_status: "FINAL" },
      });
      return value;
    })(),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "hostile-inherited-partial-response",
    cls: "input-hostility",
    name: "partially inherited response cannot fabricate a verdict and is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: Object.create({ final_execution_status: "FINAL" }),
    state: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  adapterVerdict({
    id: "hostile-unsupported-code-hash",
    cls: "input-hostility",
    name: "unsupported pinned profile is UNKNOWN",
    expected: { ...baseExpected, codeHash: "1".repeat(32) },
    proposal: proposalBody({}),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "UNKNOWN",
    reason: /Unsupported Sputnik deployment profile/,
  }),
  adapterVerdict({
    id: "hostile-noncanonical-expected-id",
    cls: "input-hostility",
    name: "non-canonical expected proposal id is INVALID",
    expected: { ...baseExpected, proposalId: "077" },
    proposal: proposalBody({}),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "INVALID",
    reason: /Expected proposal ID is not canonical decimal/,
  }),
  adapterVerdict({
    id: "hostile-zero-expected-amount",
    cls: "input-hostility",
    name: "zero expected amount is INVALID",
    expected: { ...baseExpected, amountYocto: "0" },
    proposal: proposalBody({ amount: "0" }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "INVALID",
    reason: /Expected payment amount is invalid/,
  }),
  adapterVerdict({
    id: "hostile-nondecimal-expected-amount",
    cls: "input-hostility",
    name: "non-decimal expected amount is INVALID",
    expected: { ...baseExpected, amountYocto: "1.0" },
    proposal: proposalBody({ amount: "1.0" }),
    response: await fixture("reconciliation/tx-status-paid.json"),
    state: "INVALID",
    reason: /Expected payment amount is invalid/,
  }),
  adapterVerdict({
    id: "hostile-null-response",
    cls: "input-hostility",
    name: "null response is UNKNOWN",
    expected: baseExpected,
    proposal: proposalBody({}),
    response: null,
    state: "UNKNOWN",
    reason: /Transaction response is missing/,
  }),

  // ---- class 5: replay and persistence through reconcilePayment ------------
  reconcileRow({
    id: "rec-paid-applied",
    cls: "replay-persistence",
    name: "baseline paid fixture is applied with the exact record",
    store: () => sharedReconcileStore(),
    response: await fixture("reconciliation/tx-status-paid.json"),
    status: "APPLIED",
    adapterState: "PAID",
    reason: /verified attribution recorded/,
    exactRecord: reconciliationRecord(),
  }),
  reconcileRow({
    id: "rec-paid-idempotent",
    cls: "replay-persistence",
    name: "exact re-attribution through the full pipeline is idempotent and byte-identical",
    store: () => sharedReconcileStore(),
    response: await fixture("reconciliation/tx-status-paid.json"),
    status: "IDEMPOTENT",
    adapterState: "PAID",
    reason: /identical attribution is already recorded/,
  }),
  reconcileRow({
    id: "rec-same-proposal-different-payout-conflict",
    cls: "replay-persistence",
    name: "same proposal with a second paid graph conflicts and leaves the store byte-identical",
    store: () => sharedReconcileStore(),
    response: await fixture("failures/paid-second-payout.json"),
    status: "CONFLICT",
    adapterState: "PAID",
    reason: /proposal key is already bound/,
  }),
  reconcileRow({
    id: "rec-same-payout-different-proposal-conflict",
    cls: "replay-persistence",
    name: "payout receipt reused across proposals conflicts and leaves the store byte-identical",
    store: () => sharedReconcileStore(),
    response: await fixture("failures/paid-reused-payout.json"),
    expectation: { proposalId: "78" },
    status: "CONFLICT",
    adapterState: "PAID",
    reason: /payout receipt is already bound/,
  }),
  reconcileRow({
    id: "rec-payout-receipt-failed",
    cls: "replay-persistence",
    name: "failed payout transfer never persists",
    response: await fixture("failures/payout-failed.json"),
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /Matching payout receipt failed/,
  }),
  reconcileRow({
    id: "rec-payout-success-receipt-id",
    cls: "replay-persistence",
    name: "payout without SuccessValue never persists",
    response: await fixture("failures/payout-success-receipt-id.json"),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  reconcileRow({
    id: "rec-nonfinal-executing-optimistic",
    cls: "replay-persistence",
    name: "nonfinal EXECUTING_OPTIMISTIC graph never persists",
    response: await fixture("failures/nonfinal-executing-optimistic.json"),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  reconcileRow({
    id: "rec-nonfinal-none",
    cls: "replay-persistence",
    name: "nonfinal NONE graph never persists",
    response: await fixture("failures/nonfinal-none.json"),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  reconcileRow({
    id: "rec-rejected-vote-graph",
    cls: "replay-persistence",
    name: "rejected vote graph never persists",
    response: await fixture("failures/rejected-vote-no-payout.json"),
    status: "NOT_APPLIED",
    adapterState: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  reconcileRow({
    id: "rec-approval-graph-without-payout",
    cls: "replay-persistence",
    name: "approval graph without payout child never persists",
    response: mutate(
      await fixture("failures/rejected-vote-no-payout.json"),
      (draft) => {
        const args = Buffer.from(
          JSON.stringify({ id: 77, action: "VoteApprove" }),
        ).toString("base64");
        const result = (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { args: string } }>;
              };
              receipts: Array<{
                receipt: {
                  Action: {
                    actions: Array<{ FunctionCall: { args: string } }>;
                  };
                };
              }>;
            };
          }
        ).result;
        result.transaction.actions[0]!.FunctionCall.args = args;
        result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args = args;
      },
    ),
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  reconcileRow({
    id: "rec-authentic-proposal-62",
    cls: "replay-persistence",
    name: "authentic failed proposal 62 evidence never persists",
    response: await fixture("sputnik/proposal-62-failed.json"),
    expectation: {
      daoAccountId: AUTHENTIC_DAO,
      proposalId: "62",
      claimantId: CHLOE,
      recipientId: CHLOE,
      amountYocto: "378000000000000000000000000",
    },
    candidate: {
      transactionHash: "kk8eesmbegdpNfbeNeofc3GXGtBWyHsQRd5b8G7tAwr",
      signerId: CHLOE,
    },
    provenance: "P3-T04 authentic evidence replay; no live RPC",
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /Proposal action receipt failed/,
  }),
  reconcileRow({
    id: "rec-bond-identical-ambiguous",
    cls: "replay-persistence",
    name: "bond-identical twin payouts never persist",
    response: await fixture("failures/bond-identical-ambiguous.json"),
    expectation: { amountYocto: BOND },
    status: "NOT_APPLIED",
    adapterState: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  reconcileRow({
    id: "rec-bond-identical-payout-failed",
    cls: "replay-persistence",
    name: "bond-identical graph with failed matching payout is AMBIGUOUS and never persists",
    response: await fixture("failures/bond-identical-payout-failed.json"),
    expectation: { amountYocto: BOND },
    status: "NOT_APPLIED",
    adapterState: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  reconcileRow({
    id: "rec-system-refund-matching-amount",
    cls: "replay-persistence",
    name: "system refund matching the amount never persists",
    response: await fixture("failures/system-refund-matching-amount.json"),
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  reconcileRow({
    id: "rec-decoy-not-direct-child",
    cls: "replay-persistence",
    name: "grandchild payout-shaped transfer never persists",
    response: await fixture("failures/decoy-unlinked-transfer.json"),
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  reconcileRow({
    id: "rec-garbled-graph",
    cls: "replay-persistence",
    name: "garbled graph never persists",
    response: await fixture("failures/garbled-graph.json"),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  reconcileRow({
    id: "rec-payout-extra-actions",
    cls: "replay-persistence",
    name: "payout with extra actions never persists",
    response: await fixture("failures/payout-extra-actions.json"),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Payout receipt evidence is incomplete or unknown/,
  }),
  reconcileRow({
    id: "rec-ft-transfer-child",
    cls: "replay-persistence",
    name: "token transfer child never satisfies a native payout",
    response: await fixture("failures/ft-transfer-child.json"),
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  reconcileRow({
    id: "rec-duplicate-payouts",
    cls: "replay-persistence",
    name: "ambiguous twin payouts never persist",
    response: await fixture("reconciliation/tx-status-ambiguous.json"),
    status: "NOT_APPLIED",
    adapterState: "AMBIGUOUS",
    reason: /Payout receipt attribution is ambiguous/,
  }),
  reconcileRow({
    id: "rec-dust-amount",
    cls: "replay-persistence",
    name: "dust expectation never persists against a paid graph",
    response: await fixture("reconciliation/tx-status-paid.json"),
    expectation: { amountYocto: "10" },
    status: "NOT_APPLIED",
    adapterState: "FAILED",
    reason: /No causal payout receipt matches expected payment/,
  }),
  reconcileRow({
    id: "rec-wrong-dao",
    cls: "replay-persistence",
    name: "transaction for another DAO never persists",
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (
          draft as { result: { transaction: { receiver_id: string } } }
        ).result.transaction.receiver_id = OTHER_DAO;
      },
    ),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Transaction is not final or targets another DAO/,
  }),
  reconcileRow({
    id: "rec-wrong-proposal-id-args",
    cls: "replay-persistence",
    name: "act args for another proposal never persist",
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        const args = Buffer.from(
          JSON.stringify({ id: 78, action: "VoteApprove" }),
        ).toString("base64");
        const result = (
          draft as {
            result: {
              transaction: {
                actions: Array<{ FunctionCall: { args: string } }>;
              };
              receipts: Array<{
                receipt: {
                  Action: {
                    actions: Array<{ FunctionCall: { args: string } }>;
                  };
                };
              }>;
            };
          }
        ).result;
        result.transaction.actions[0]!.FunctionCall.args = args;
        result.receipts[0]!.receipt.Action.actions[0]!.FunctionCall.args = args;
      },
    ),
    status: "NOT_APPLIED",
    adapterState: "INVALID",
    reason: /Proposal action does not match linked proposal/,
  }),
  reconcileRow({
    id: "rec-unsupported-profile",
    cls: "replay-persistence",
    name: "unsupported pinned profile never persists",
    response: await fixture("reconciliation/tx-status-paid.json"),
    expectation: { profile: { version: "2.0.0", codeHash: "1".repeat(32) } },
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Unsupported Sputnik deployment profile/,
  }),
  reconcileRow({
    id: "rec-null-receipt-entry",
    cls: "replay-persistence",
    name: "null receipt entry never persists",
    response: mutate(
      await fixture("reconciliation/tx-status-paid.json"),
      (draft) => {
        (draft as { result: { receipts: unknown[] } }).result.receipts.unshift(
          null,
        );
      },
    ),
    status: "NOT_APPLIED",
    adapterState: "UNKNOWN",
    reason: /Receipt graph is incomplete/,
  }),
  reconcileRow({
    id: "rec-deeply-nested-response",
    cls: "input-hostility",
    name: "response nested beyond the depth bound is rejected before the adapter",
    response: (() => {
      let node: unknown = { final_execution_status: "FINAL" };
      for (let depth = 0; depth < 65; depth += 1) {
        node = { wrapped: node };
      }
      return {
        jsonrpc: "2.0",
        id: RECONCILIATION_TX_STATUS_RPC_ID,
        result: node,
      };
    })(),
    throws: /too large or deeply nested/,
  }),
  reconcileRow({
    id: "rec-oversized-string",
    cls: "input-hostility",
    name: "response string beyond the byte bound is rejected before the adapter",
    response: {
      jsonrpc: "2.0",
      id: RECONCILIATION_TX_STATUS_RPC_ID,
      result: {
        final_execution_status: "FINAL",
        receipts: ["x".repeat(65_537)],
      },
    },
    throws: /JSON string exceeds the byte limit/,
  }),
  reconcileRow({
    id: "rec-oversized-array",
    cls: "input-hostility",
    name: "response array beyond the length bound is rejected before the adapter",
    response: {
      jsonrpc: "2.0",
      id: RECONCILIATION_TX_STATUS_RPC_ID,
      result: {
        final_execution_status: "FINAL",
        receipts: Array.from({ length: 300_001 }, () => null),
      },
    },
    throws: /bounded plain JSON array required/,
  }),
  reconcileRow({
    id: "rec-cyclic-response",
    cls: "input-hostility",
    name: "cyclic RPC response is rejected before the adapter",
    response: (() => {
      const cyclic: Record<string, unknown> = {
        jsonrpc: "2.0",
        id: RECONCILIATION_TX_STATUS_RPC_ID,
      };
      cyclic.self = cyclic;
      return cyclic;
    })(),
    throws: /cyclic|cloneable|proxies/,
  }),
  reconcileRow({
    id: "rec-malformed-base58-candidate",
    cls: "input-hostility",
    name: "candidate hash with non-base58 characters is rejected",
    response: await fixture("reconciliation/tx-status-paid.json"),
    candidate: { transactionHash: `0OIl${"a".repeat(40)}` },
    throws: /base58 value required/,
  }),
  reconcileRow({
    id: "rec-wrong-length-hash",
    cls: "input-hostility",
    name: "candidate hash decoding to 31 bytes is rejected",
    response: await fixture("reconciliation/tx-status-paid.json"),
    candidate: {
      transactionHash: hashFromSeed("P3-T04/rec-wrong-length-hash", 31),
    },
    throws: /32 bytes required/,
  }),
  reconcileRow({
    id: "rec-zero-amount-expectation",
    cls: "input-hostility",
    name: "zero expected amount is rejected at the reconcile boundary",
    response: await fixture("reconciliation/tx-status-paid.json"),
    expectation: { amountYocto: "0" },
    throws: /canonical positive decimal is out of range/,
  }),
  reconcileRow({
    id: "rec-wrong-type-amount",
    cls: "input-hostility",
    name: "numeric expected amount is rejected at the reconcile boundary",
    response: await fixture("reconciliation/tx-status-paid.json"),
    expectation: { amountYocto: 5 as never },
    throws: /canonical decimal required/,
  }),

  // ---- class 5: store-level replay integrity -------------------------------
  storeRow({
    id: "st-idempotent-identical-record",
    cls: "replay-persistence-store",
    name: "re-applying the identical record is idempotent and byte-identical",
    status: "IDEMPOTENT",
    run: (store) => store.apply(reconciliationRecord()),
  }),
  storeRow({
    id: "st-conflict-payout-for-same-proposal",
    cls: "replay-persistence-store",
    name: "same proposal bound to a different payout conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(
        reconciliationRecord({
          actionReceiptId: hashFromSeed("P3-T04/st-conflict-payout/action"),
          payoutReceiptId: hashFromSeed("P3-T04/st-conflict-payout/payout"),
          transactionHash: hashFromSeed("P3-T04/st-conflict-payout/action"),
          payoutBlockHash: hashFromSeed("P3-T04/st-conflict-payout/block"),
        }),
      ),
  }),
  storeRow({
    id: "st-conflict-proposal-for-same-payout",
    cls: "replay-persistence-store",
    name: "same payout receipt bound to another proposal conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(
        reconciliationRecord({
          proposalId: "78",
          transactionHash: hashFromSeed("P3-T04/st-conflict-proposal/tx"),
          payoutBlockHash: hashFromSeed("P3-T04/st-conflict-proposal/block"),
        }),
      ),
  }),
  storeRow({
    id: "st-conflict-action-for-same-proposal",
    cls: "replay-persistence-store",
    name: "same proposal with a different action receipt conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(
        reconciliationRecord({
          actionReceiptId: hashFromSeed("P3-T04/st-conflict-action/action"),
          transactionHash: hashFromSeed("P3-T04/st-conflict-action/action"),
          payoutBlockHash: hashFromSeed("P3-T04/st-conflict-action/block"),
        }),
      ),
  }),
  storeRow({
    id: "st-conflict-cycle-drift",
    cls: "replay-persistence-store",
    name: "same evidence key with a different cycle binding conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(
        reconciliationRecord({
          cycle: { templateId: "7", periodIndex: "4" },
        }),
      ),
  }),
  storeRow({
    id: "st-conflict-block-drift",
    cls: "replay-persistence-store",
    name: "same evidence key with a different payout block conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(
        reconciliationRecord({
          payoutBlockHash: hashFromSeed("P3-T04/st-conflict-block/block"),
        }),
      ),
  }),
  storeRow({
    id: "st-conflict-provenance-drift",
    cls: "replay-persistence-store",
    name: "same evidence key with different provenance conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(reconciliationRecord({ provenance: "other replay" })),
  }),
  storeRow({
    id: "st-conflict-amount-drift",
    cls: "replay-persistence-store",
    name: "same evidence key with a different expected amount conflicts",
    status: "CONFLICT",
    run: (store) =>
      store.apply(reconciliationRecord({ expectedAmountYocto: "1" })),
  }),
  storeRow({
    id: "st-mainnet-apply-rejected",
    cls: "replay-persistence-store",
    name: "MAINNET record application is rejected before mutation",
    // Source fix (head vs base defec7b9): the base store accepted MAINNET
    // records (documented in the P3-T03 handoff as a limitation); the pinned
    // read model now rejects them before mutation. Fails against base.
    throws: /reconciliation record\.network: TESTNET required/,
    run: (store) => store.apply(reconciliationRecord({ network: "MAINNET" })),
  }),
  storeRow({
    id: "st-mainnet-import-rejected",
    cls: "replay-persistence-store",
    name: "MAINNET record injection via a consistently fingerprinted snapshot is rejected",
    // Source fix (head vs base defec7b9): same TESTNET pin, exercised through
    // importSnapshot with a correctly recomputed fingerprint, so even a fully
    // consistent forged snapshot is rejected. Fails against base.
    throws: /reconciliation record\.network: TESTNET required/,
    run: (store) => {
      const mainnetRecord = {
        ...reconciliationRecord(),
        network: "MAINNET",
        proposalId: "78",
        actionReceiptId: hashFromSeed("P3-T04/st-mainnet-import/action"),
        payoutReceiptId: hashFromSeed("P3-T04/st-mainnet-import/payout"),
        transactionHash: hashFromSeed("P3-T04/st-mainnet-import/action"),
        payoutBlockHash: hashFromSeed("P3-T04/st-mainnet-import/block"),
      };
      const records = [mainnetRecord, reconciliationRecord()];
      const snapshot = {
        schemaVersion: 1,
        fingerprint: createHash("sha256")
          .update(canonicalJson({ schemaVersion: 1, records }))
          .digest("hex"),
        records,
      };
      store.importSnapshot(snapshot);
    },
  }),
  storeRow({
    id: "st-import-over-capacity-rejected",
    cls: "replay-persistence-store",
    name: "import beyond the record capacity is rejected before mutation",
    throws: /bounded record array required/,
    run: (store) => {
      const records = Array.from(
        { length: RECONCILIATION_MAX_RECORDS + 1 },
        (_, index) =>
          reconciliationRecord({
            proposalId: String(index),
            actionReceiptId: hashFromSeed(`P3-T04/cap-import/action/${index}`),
            payoutReceiptId: hashFromSeed(`P3-T04/cap-import/payout/${index}`),
            transactionHash: hashFromSeed(`P3-T04/cap-import/action/${index}`),
            payoutBlockHash: hashFromSeed(`P3-T04/cap-import/block/${index}`),
          }),
      );
      store.importSnapshot({
        schemaVersion: 1,
        fingerprint: "f".repeat(64),
        records,
      });
    },
  }),
  storeRow({
    id: "st-apply-over-capacity-rejected",
    cls: "replay-persistence-store",
    name: "apply beyond the record capacity is rejected before mutation",
    selfContained: true,
    run: (store) => {
      for (let index = 0; index < RECONCILIATION_MAX_RECORDS - 1; index += 1) {
        const applied = store.apply(
          reconciliationRecord({
            proposalId: String(index + 1000),
            actionReceiptId: hashFromSeed(`P3-T04/cap-apply/action/${index}`),
            payoutReceiptId: hashFromSeed(`P3-T04/cap-apply/payout/${index}`),
            transactionHash: hashFromSeed(`P3-T04/cap-apply/action/${index}`),
            payoutBlockHash: hashFromSeed(`P3-T04/cap-apply/block/${index}`),
          }),
        );
        assert.equal(applied.status, "APPLIED");
      }
      assert.equal(store.size(), RECONCILIATION_MAX_RECORDS);
      const fingerprint = store.fingerprint();
      assert.throws(
        () =>
          store.apply(
            reconciliationRecord({
              proposalId: "999999",
              actionReceiptId: hashFromSeed("P3-T04/cap-apply/overflow-action"),
              payoutReceiptId: hashFromSeed("P3-T04/cap-apply/overflow-payout"),
              transactionHash: hashFromSeed("P3-T04/cap-apply/overflow-action"),
              payoutBlockHash: hashFromSeed("P3-T04/cap-apply/overflow-block"),
            }),
          ),
        /capacity is exhausted/,
      );
      assert.equal(store.fingerprint(), fingerprint);
    },
  }),

  // ---- class 6: input hostility at the store boundary ----------------------
  storeRow({
    id: "st-accessor-field-apply",
    cls: "input-hostility-store",
    name: "accessor record field is rejected",
    throws: /own enumerable data property required/,
    run: (store) =>
      store.apply({
        ...reconciliationRecord(),
        get provenance() {
          return PROVENANCE;
        },
      } as ReconciliationRecord),
  }),
  storeRow({
    id: "st-inherited-record-apply",
    cls: "input-hostility-store",
    name: "inherited record prototype is rejected",
    throws: /plain object with no custom prototype required/,
    run: (store) =>
      store.apply(
        Object.create(reconciliationRecord()) as ReconciliationRecord,
      ),
  }),
  storeRow({
    id: "st-proxy-record-apply",
    cls: "input-hostility-store",
    name: "proxied record is rejected",
    throws: /proxies and non-cloneable data are not allowed/,
    run: (store) =>
      store.apply(
        new Proxy(reconciliationRecord(), {}) as ReconciliationRecord,
      ),
  }),
  storeRow({
    id: "st-proto-own-key-apply",
    cls: "input-hostility-store",
    name: "own __proto__ key on the record is rejected",
    throws: /unexpected or missing fields/,
    run: (store) => {
      const value = reconciliationRecord() as unknown as Record<
        PropertyKey,
        unknown
      >;
      Object.defineProperty(value, "__proto__", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: { network: "MAINNET" },
      });
      store.apply(value as unknown as ReconciliationRecord);
    },
  }),
  storeRow({
    id: "st-symbol-key-apply",
    cls: "input-hostility-store",
    name: "symbol key on the record is rejected",
    throws: /symbol properties are not allowed/,
    run: (store) => {
      const value = reconciliationRecord() as unknown as Record<
        PropertyKey,
        unknown
      >;
      value[Symbol("p3-t04")] = 1;
      store.apply(value as unknown as ReconciliationRecord);
    },
  }),
  storeRow({
    id: "st-non-base58-receipt-apply",
    cls: "input-hostility-store",
    name: "record with non-base58 receipt id is rejected",
    throws: /base58 value required/,
    run: (store) =>
      store.apply(
        reconciliationRecord({ actionReceiptId: `0OIl${"a".repeat(40)}` }),
      ),
  }),
  storeRow({
    id: "st-noncanonical-proposal-id-apply",
    cls: "input-hostility-store",
    name: "record with non-canonical proposal id is rejected",
    throws: /canonical decimal required/,
    run: (store) => store.apply(reconciliationRecord({ proposalId: "077" })),
  }),
  storeRow({
    id: "st-null-record-import",
    cls: "input-hostility-store",
    name: "null record entry inside a snapshot is rejected",
    throws: /exact plain object required/,
    run: (store) =>
      store.importSnapshot({
        schemaVersion: 1,
        fingerprint: "a".repeat(64),
        records: [null],
      }),
  }),
  storeRow({
    id: "st-tampered-fingerprint-import",
    cls: "input-hostility-store",
    name: "snapshot with a tampered fingerprint is rejected",
    throws: /fingerprint mismatch/,
    run: (store) => {
      const snapshot = structuredClone(store.exportSnapshot()) as {
        schemaVersion: number;
        fingerprint: string;
        records: ReconciliationRecord[];
      };
      snapshot.fingerprint = "b".repeat(64);
      store.importSnapshot(snapshot);
    },
  }),
  storeRow({
    id: "st-duplicate-evidence-import",
    cls: "input-hostility-store",
    name: "snapshot with a duplicate evidence key is rejected",
    throws: /duplicate evidence key/,
    run: (store) => {
      const snapshot = structuredClone(store.exportSnapshot()) as {
        schemaVersion: number;
        fingerprint: string;
        records: ReconciliationRecord[];
      };
      snapshot.records.push(structuredClone(snapshot.records[0]!));
      store.importSnapshot(snapshot);
    },
  }),
  storeRow({
    id: "st-hostile-lookups",
    cls: "input-hostility-store",
    name: "hostile lookup arguments are rejected and MAINNET lookups return null",
    run: (store) => {
      assert.throws(
        () => store.getByProposal("testnet" as never, DAO, "77"),
        /network required/,
      );
      assert.throws(
        () => store.getByProposal("TESTNET", DAO, "077"),
        /canonical decimal required/,
      );
      assert.throws(
        () => store.getByPayoutReceipt("TESTNET", `0OIl${"a".repeat(40)}`),
        /base58 value required/,
      );
      assert.throws(
        () => store.getByProposal("TESTNET", "bad_account!", "77"),
        /valid NEAR account required/,
      );
      assert.equal(store.getByProposal("MAINNET", DAO, "77"), null);
      assert.equal(store.getByPayoutReceipt("MAINNET", PAYOUT), null);
    },
  }),
];

// Shared store for the pipeline rows that build on the applied baseline. The
// rows run in table order inside the replay-persistence class test, so the
// APPLIED baseline row always precedes the idempotency and conflict rows.
let sharedStore: ReconciliationStore | null = null;
function sharedReconcileStore(): ReconciliationStore {
  sharedStore ??= createReconciliationStore();
  return sharedStore;
}

const classes = [...new Set(MATRIX.map((row) => row.cls))];
for (const cls of classes) {
  const rows = MATRIX.filter((row) => row.cls === cls);
  test(`failure matrix — ${cls} (${rows.length} rows)`, async () => {
    for (const row of rows) await row.execute();
  });
}

test("failure matrix invariant — PAID implies full evidence identity and persistence only on applied attributions", () => {
  assert.equal(observations.length, MATRIX.length);
  for (const observation of observations) {
    if (observation.level === "adapter") {
      assert.equal(
        observation.persisted,
        false,
        `${observation.id}: adapter rows never persist`,
      );
      const verdict = adapterResults.get(observation.id);
      if (!verdict) {
        // Rows whose hostile input threw before a verdict exists: the
        // observation already records that nothing was paid or persisted.
        assert.equal(
          observation.paid,
          false,
          `${observation.id}: thrown rows are never paid`,
        );
        continue;
      }
      assert.equal(
        observation.paid,
        verdict.state === "PAID",
        `${observation.id}: paid flag matches verdict`,
      );
      if (verdict.state === "PAID") {
        assert.ok(verdict.transactionHash, `${observation.id}: tx hash`);
        assert.ok(verdict.actionReceiptId, `${observation.id}: action receipt`);
        assert.ok(verdict.payoutReceiptId, `${observation.id}: payout receipt`);
        assert.ok(verdict.evidenceKey, `${observation.id}: evidence key`);
        assert.ok(verdict.blockHash, `${observation.id}: block hash`);
      } else {
        assert.equal(
          verdict.payoutReceiptId,
          null,
          `${observation.id}: no payout receipt`,
        );
        assert.equal(
          verdict.evidenceKey,
          null,
          `${observation.id}: no evidence key`,
        );
      }
    } else if (observation.persisted) {
      assert.ok(
        observation.paid,
        `${observation.id}: persisted observation must be a verified PAID attribution`,
      );
    }
  }
});

test("failure matrix self-check — every table row ran exactly once with full class coverage", () => {
  assert.equal(executedRowIds.length, MATRIX.length);
  assert.equal(new Set(executedRowIds).size, MATRIX.length);
  for (const row of MATRIX) {
    assert.ok(executedRowIds.includes(row.id), `${row.id}: ran`);
  }
  const counts = new Map<string, number>();
  for (const row of MATRIX) {
    counts.set(row.cls, (counts.get(row.cls) ?? 0) + 1);
  }
  for (const cls of [
    "positive-control",
    "governance-status",
    "execution-failure",
    "mismatch",
    "ambiguity-incompleteness",
    "input-hostility",
    "replay-persistence",
    "replay-persistence-store",
    "input-hostility-store",
  ]) {
    assert.ok((counts.get(cls) ?? 0) > 0, `${cls}: covered`);
  }
  const nonPaid = observations.filter((entry) => !entry.paid);
  assert.ok(
    nonPaid.every((entry) => !entry.persisted),
    "no non-PAID observation ever persisted",
  );
  const persisted = observations.filter((entry) => entry.persisted);
  assert.ok(
    persisted.every((entry) => entry.paid),
    "every persisted observation came from a PAID attribution",
  );
});
