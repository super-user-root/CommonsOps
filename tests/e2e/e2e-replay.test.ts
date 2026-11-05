// P3-T06 replay mode: deterministic, fully offline end-to-end exercise of the
// merged reconciliation path (packages/near) for the recorded live testnet
// journey. The transport is the committed authentic Sputnik 2.3.1
// EXPERIMENTAL_tx_status fixture; no Date, randomness, or network is used at
// runtime, and every identifier below is public onchain data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createReconciliationStore,
  isReconciliationStore,
  reconcilePayment,
  RECONCILIATION_TX_STATUS_RPC_ID,
  type ReconciliationRecord,
  type ReconciliationRpcTransport,
  type ReconciliationSnapshot,
} from "@commonsops/near";

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "../fixtures/sputnik/dao-proposal-0-231-paid.json",
);
const REGISTRY_VIEWS_PATH = path.resolve(
  import.meta.dirname,
  "registry-views.json",
);

// Public identifiers of the recorded journey (docs/testnet-journey.md,
// scripts/reconcile-live.mjs, tests/fixtures/sputnik/dao-proposal-0-231-paid.json).
const REGISTRY = "commonsops.testnet";
const DAO = "commonsops-dao.sputnikv2.testnet";
const PARTICIPANT = "commonsops.testnet";
const PROPOSAL_ID = "0";
const AMOUNT_YOCTO = "500000000000000000000000";
const PROFILE_VERSION = "2.3.1";
const PROFILE_CODE_HASH = "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH";
const CANDIDATE_TX = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
const ACTION_RECEIPT = "kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro";
const PAYOUT_RECEIPT = "EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2";
const PAYOUT_BLOCK = "5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6";
// Exact provenance of the canonical live runner, so the replay store must be
// byte-identical to the recorded live store snapshot.
const PROVENANCE =
  "CommonsOps live testnet journey: act_proposal VoteApprove on proposal 0 of commonsops-dao.sputnikv2.testnet";
// Snapshot fingerprint recorded in docs/testnet-journey.md for the live run.
const LIVE_SNAPSHOT_FINGERPRINT =
  "f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965";

const BASE58_ALPHABET =
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
    encoded = BASE58_ALPHABET[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  return "1".repeat(leadingZeroes) + encoded;
}

// Deterministic seeded identifier: SHA-256 of a fixed seed string, encoded in
// the canonical base58 form the reconciliation record parser requires.
function cryptoHashFromSeed(seed: string): string {
  return base58Encode(createHash("sha256").update(seed).digest());
}

// Deterministic seeded decimal identifier inside the u64 proposal-id range.
function decimalIdFromSeed(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const value = BigInt(`0x${digest.toString("hex")}`) & ((1n << 64n) - 1n);
  return value.toString();
}

async function loadTxStatusFixture(): Promise<unknown> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as unknown;
}

interface TransportProbe {
  requests: unknown[];
}

function fixtureTransport(
  payload: unknown,
  probe: TransportProbe,
): ReconciliationRpcTransport {
  return async (request) => {
    probe.requests.push(request);
    assert.equal(request.jsonrpc, "2.0");
    assert.equal(request.id, RECONCILIATION_TX_STATUS_RPC_ID);
    assert.equal(request.method, "EXPERIMENTAL_tx_status");
    assert.deepEqual(request.params, {
      tx_hash: CANDIDATE_TX,
      sender_account_id: PARTICIPANT,
    });
    return payload;
  };
}

function expectation(
  overrides: Partial<
    Parameters<typeof reconcilePayment>[0]["expectation"]
  > = {},
): Parameters<typeof reconcilePayment>[0]["expectation"] {
  return {
    network: "TESTNET",
    daoAccountId: DAO,
    proposalId: PROPOSAL_ID,
    claimantId: PARTICIPANT,
    recipientId: PARTICIPANT,
    amountYocto: AMOUNT_YOCTO,
    profile: { version: PROFILE_VERSION, codeHash: PROFILE_CODE_HASH },
    cycle: { templateId: "0", periodIndex: "0" },
    ...overrides,
  };
}

// Replays the committed fixture into a fresh store exactly as the canonical
// live runner does, returning the result plus the store for further steps.
async function replayHappyPath(): Promise<{
  result: Awaited<ReturnType<typeof reconcilePayment>>;
  store: ReturnType<typeof createReconciliationStore>;
  probe: TransportProbe;
}> {
  const store = createReconciliationStore();
  const probe: TransportProbe = { requests: [] };
  const transport = fixtureTransport(await loadTxStatusFixture(), probe);
  const result = await reconcilePayment({
    expectation: expectation(),
    candidate: { transactionHash: CANDIDATE_TX, signerId: PARTICIPANT },
    transport,
    provenance: PROVENANCE,
    store,
  });
  return { result, store, probe };
}

function storeBytes(store: ReturnType<typeof createReconciliationStore>): {
  fingerprint: string;
  canonical: Uint8Array;
  records: readonly ReconciliationRecord[];
  size: number;
} {
  const snapshot: ReconciliationSnapshot = store.exportSnapshot();
  return {
    fingerprint: snapshot.fingerprint,
    canonical: store.exportCanonicalBytes(),
    records: store.listRecords(),
    size: store.size(),
  };
}

function assertStoreUnchanged(
  before: ReturnType<typeof storeBytes>,
  after: ReturnType<typeof storeBytes>,
): void {
  assert.equal(after.size, before.size);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.deepEqual([...after.canonical], [...before.canonical]);
  assert.deepEqual(after.records, before.records);
}

function expectedRecord(
  overrides: Partial<ReconciliationRecord> = {},
): ReconciliationRecord {
  return {
    schemaVersion: 1,
    network: "TESTNET",
    daoAccountId: DAO,
    proposalId: PROPOSAL_ID,
    actionReceiptId: ACTION_RECEIPT,
    payoutReceiptId: PAYOUT_RECEIPT,
    cycle: { templateId: "0", periodIndex: "0" },
    expectedRecipientId: PARTICIPANT,
    expectedAmountYocto: AMOUNT_YOCTO,
    profileVersion: PROFILE_VERSION,
    profileCodeHash: PROFILE_CODE_HASH,
    transactionHash: CANDIDATE_TX,
    payoutBlockHash: PAYOUT_BLOCK,
    provenance: PROVENANCE,
    ...overrides,
  };
}

test("happy path: committed 2.3.1 fixture replays to APPLIED/PAID with full provenance", async () => {
  const { result, store, probe } = await replayHappyPath();
  assert.equal(probe.requests.length, 1);
  assert.equal(result.status, "APPLIED");
  assert.equal(result.reason, "verified attribution recorded");
  assert.equal(result.adapterState, "PAID");
  assert.deepEqual(result.record, expectedRecord());
  assert.ok(isReconciliationStore(store));

  const snapshot = store.exportSnapshot();
  assert.equal(store.size(), 1);
  assert.equal(snapshot.records.length, 1);
  assert.deepEqual(snapshot.records[0], expectedRecord());
  assert.deepEqual(
    store.getByProposal("TESTNET", DAO, PROPOSAL_ID),
    expectedRecord(),
  );
  assert.deepEqual(
    store.getByPayoutReceipt("TESTNET", PAYOUT_RECEIPT),
    expectedRecord(),
  );

  // Full provenance: the record binds the onchain causal graph (act receipt,
  // payout receipt, payout block) to the registry-linked expectation.
  assert.equal(result.record?.actionReceiptId, ACTION_RECEIPT);
  assert.equal(result.record?.payoutReceiptId, PAYOUT_RECEIPT);
  assert.equal(result.record?.payoutBlockHash, PAYOUT_BLOCK);
  assert.equal(result.record?.transactionHash, CANDIDATE_TX);
  assert.equal(result.record?.profileVersion, PROFILE_VERSION);
  assert.equal(result.record?.profileCodeHash, PROFILE_CODE_HASH);
  assert.equal(result.record?.expectedAmountYocto, AMOUNT_YOCTO);
  assert.equal(result.record?.expectedRecipientId, PARTICIPANT);
  assert.equal(result.record?.provenance, PROVENANCE);

  // The replay store is byte-identical to the recorded live journey store.
  assert.equal(snapshot.fingerprint, LIVE_SNAPSHOT_FINGERPRINT);
});

test("proposal/evidence reuse to a second cycle is CONFLICT and leaves the store byte-identical", async () => {
  const { store } = await replayHappyPath();
  const before = storeBytes(store);

  // End-to-end: the same linked proposal 0 attributed to cycle 0:1.
  const second = await reconcilePayment({
    expectation: expectation({
      cycle: { templateId: "0", periodIndex: "1" },
    }),
    candidate: { transactionHash: CANDIDATE_TX, signerId: PARTICIPANT },
    transport: fixtureTransport(await loadTxStatusFixture(), { requests: [] }),
    provenance: PROVENANCE,
    store,
  });
  assert.equal(second.status, "CONFLICT");
  assert.equal(
    second.reason,
    "the same attribution is already recorded with different payment metadata",
  );
  assert.equal(second.adapterState, "PAID");
  assert.equal(second.record, null);
  assertStoreUnchanged(before, storeBytes(store));

  // Store-level: the same proposal id bound to a different payout receipt
  // (seeded deterministically) is rejected as a proposal-key replay.
  const seededPayout = cryptoHashFromSeed("P3-T06 second-cycle payout receipt");
  const sameProposal = store.apply(
    expectedRecord({
      actionReceiptId: cryptoHashFromSeed("P3-T06 second-cycle action receipt"),
      payoutReceiptId: seededPayout,
      payoutBlockHash: cryptoHashFromSeed("P3-T06 second-cycle payout block"),
      transactionHash: cryptoHashFromSeed("P3-T06 second-cycle transaction"),
      cycle: { templateId: "0", periodIndex: "1" },
    }),
  );
  assert.equal(sameProposal.status, "CONFLICT");
  assert.equal(
    sameProposal.reason,
    "the proposal key is already bound to a different payout attribution",
  );
  assert.equal(sameProposal.record, null);
  assertStoreUnchanged(before, storeBytes(store));

  // Store-level: the same payout receipt attributed to a second cycle under a
  // seeded second proposal id is rejected as a payout-key replay.
  const seededProposalId = decimalIdFromSeed("P3-T06 seeded proposal id");
  assert.match(seededProposalId, /^(0|[1-9][0-9]*)$/);
  const samePayout = store.apply(
    expectedRecord({
      proposalId: seededProposalId,
      cycle: { templateId: "0", periodIndex: "1" },
    }),
  );
  assert.equal(samePayout.status, "CONFLICT");
  assert.equal(
    samePayout.reason,
    "the payout receipt is already bound to a different proposal attribution",
  );
  assert.equal(samePayout.record, null);
  assertStoreUnchanged(before, storeBytes(store));
});

test("duplicate-apply of the identical record is IDEMPOTENT with no state change", async () => {
  const { result, store } = await replayHappyPath();
  const before = storeBytes(store);

  const rerun = await reconcilePayment({
    expectation: expectation(),
    candidate: { transactionHash: CANDIDATE_TX, signerId: PARTICIPANT },
    transport: fixtureTransport(await loadTxStatusFixture(), { requests: [] }),
    provenance: PROVENANCE,
    store,
  });
  assert.equal(rerun.status, "IDEMPOTENT");
  assert.equal(rerun.reason, "the identical attribution is already recorded");
  assert.equal(rerun.adapterState, "PAID");
  assert.deepEqual(rerun.record, expectedRecord());
  assertStoreUnchanged(before, storeBytes(store));

  const direct = store.apply(expectedRecord());
  assert.equal(direct.status, "IDEMPOTENT");
  assert.deepEqual(direct.record, expectedRecord());
  assertStoreUnchanged(before, storeBytes(store));
});

test("deterministic seeded replay: two fresh stores converge byte-for-byte", async () => {
  const first = await replayHappyPath();
  const second = await replayHappyPath();
  const left = storeBytes(first.store);
  const right = storeBytes(second.store);
  assert.deepEqual(left.records, right.records);
  assert.equal(left.fingerprint, right.fingerprint);
  assert.equal(left.fingerprint, LIVE_SNAPSHOT_FINGERPRINT);
  assert.deepEqual([...left.canonical], [...right.canonical]);
  assert.equal(left.size, right.size);
});

test("recorded registry views match the reconciliation expectations", async () => {
  const viewsFile = JSON.parse(await readFile(REGISTRY_VIEWS_PATH, "utf8")) as {
    schemaVersion: number;
    network: string;
    registryAccountId: string;
    block: { height: number; timestampNs: number; isoUtc: string };
    views: Record<string, { method: string; args: unknown; result: unknown }>;
  };
  assert.equal(viewsFile.schemaVersion, 1);
  assert.equal(viewsFile.network, "testnet");
  assert.equal(viewsFile.registryAccountId, REGISTRY);
  assert.ok(Number.isInteger(viewsFile.block.height));
  assert.ok(viewsFile.block.height > 0);

  const template = viewsFile.views.get_template_0?.result as {
    id: string;
    manager_id: string;
    active: boolean;
    next_period_index: string;
    input: {
      dao_account_id: string;
      amount_yocto: string;
      start_at_ns: string;
      interval_ns: string;
      work_window_ns: string;
      claim_duration_ns: string;
    };
  };
  assert.equal(template.id, "0");
  assert.equal(template.manager_id, REGISTRY);
  assert.equal(template.active, true);
  assert.equal(template.next_period_index, "1");
  assert.equal(template.input.dao_account_id, DAO);
  assert.equal(template.input.amount_yocto, AMOUNT_YOCTO);
  // Cycle 0:0 bounds derive from the template cadence: 7-day interval,
  // 5-day work window, 2-day claim duration.
  assert.equal(
    BigInt(template.input.interval_ns),
    7n * 24n * 60n * 60n * 1_000_000_000n,
  );
  assert.equal(
    BigInt(template.input.work_window_ns),
    5n * 24n * 60n * 60n * 1_000_000_000n,
  );
  assert.equal(
    BigInt(template.input.claim_duration_ns),
    2n * 24n * 60n * 60n * 1_000_000_000n,
  );

  const cycle = viewsFile.views.get_cycle_0_0?.result as {
    key: { template_id: string; period_index: string };
    status: string;
    dao_account_id: string;
    amount_yocto: string;
    claim: { claimant_id: string; payout_recipient_id: string } | null;
    evidence: {
      repository_owner: string;
      repository_name: string;
      pull_request_number: string;
      url: string;
      commit_sha: string;
    } | null;
    proposal_link: {
      key: { network: string; dao_account_id: string; proposal_id: string };
    } | null;
  };
  assert.deepEqual(cycle.key, { template_id: "0", period_index: "0" });
  assert.equal(cycle.status, "SUBMITTED");
  assert.equal(cycle.dao_account_id, template.input.dao_account_id);
  assert.equal(cycle.amount_yocto, template.input.amount_yocto);
  // The claim binds the claimant to the payout recipient, exactly as the
  // reconciliation expectation requires.
  assert.equal(cycle.claim?.claimant_id, PARTICIPANT);
  assert.equal(cycle.claim?.payout_recipient_id, PARTICIPANT);
  assert.equal(cycle.evidence?.repository_owner, "super-user-root");
  assert.equal(cycle.evidence?.repository_name, "commonsops");
  assert.equal(cycle.evidence?.pull_request_number, "17");
  assert.equal(
    cycle.evidence?.url,
    "https://github.com/super-user-root/commonsops/pull/17",
  );
  assert.equal(
    cycle.evidence?.commit_sha,
    "1032733c2115b9e9c038d50617f6e151ac8bd59d",
  );
  // The registry link is present and points proposal 0 at cycle 0:0.
  assert.ok(cycle.proposal_link);
  assert.deepEqual(cycle.proposal_link?.key, {
    network: "TESTNET",
    dao_account_id: DAO,
    proposal_id: PROPOSAL_ID,
  });
  assert.deepEqual(viewsFile.views.get_proposal_cycle_0?.result, {
    template_id: "0",
    period_index: "0",
  });

  // The recorded onchain state is exactly what the reconciliation expectation
  // and the replayed record assert.
  const { store } = await replayHappyPath();
  const record = store.listRecords()[0];
  assert.ok(record);
  assert.equal(record.daoAccountId, cycle.dao_account_id);
  assert.equal(record.expectedAmountYocto, cycle.amount_yocto);
  assert.equal(record.expectedRecipientId, cycle.claim?.payout_recipient_id);
  assert.deepEqual(record.cycle, { templateId: "0", periodIndex: "0" });
});
