#!/usr/bin/env node
// Reconciles the live CommonsOps testnet journey payout through the canonical
// adapter and read model. Read-only RPC: it never signs, spends, or mutates
// onchain state. The journey this reconciles is documented in
// docs/testnet-journey.md; every identifier below is public onchain data.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReconciliationStore,
  reconcilePayment,
} from "../packages/near/src/reconciliation.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.join(root, "deployments", "testnet");

const RPC_URL = "https://rpc.testnet.near.org";

const DAO_ACCOUNT_ID = "commonsops-dao.sputnikv2.testnet";
const CONTRACT_ACCOUNT_ID = "commonsops.testnet";
const PAYOUT_RECIPIENT_ID = "commonsops.testnet";
const PROPOSAL_ID = "0";
const PAYOUT_AMOUNT_YOCTO = "500000000000000000000000";
const CANDIDATE_TX_HASH = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
const PROFILE = Object.freeze({
  version: "2.3.1",
  codeHash: "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH",
});
const PROVENANCE =
  "CommonsOps live testnet journey: act_proposal VoteApprove on proposal 0 of commonsops-dao.sputnikv2.testnet";

async function transport(request) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`RPC transport failed: HTTP ${response.status}`);
  }
  return response.json();
}

const store = createReconciliationStore();

const applied = await reconcilePayment({
  expectation: {
    network: "TESTNET",
    daoAccountId: DAO_ACCOUNT_ID,
    proposalId: PROPOSAL_ID,
    claimantId: PAYOUT_RECIPIENT_ID,
    recipientId: PAYOUT_RECIPIENT_ID,
    amountYocto: PAYOUT_AMOUNT_YOCTO,
    profile: { ...PROFILE },
    cycle: { templateId: "0", periodIndex: "0" },
  },
  candidate: {
    transactionHash: CANDIDATE_TX_HASH,
    signerId: CONTRACT_ACCOUNT_ID,
  },
  transport,
  provenance: PROVENANCE,
  store,
});

if (
  (applied.status !== "APPLIED" && applied.status !== "IDEMPOTENT") ||
  applied.adapterState !== "PAID" ||
  !applied.record
) {
  throw new Error(
    `Live reconciliation did not derive PAID: ${JSON.stringify(applied)}`,
  );
}

const snapshot = store.exportSnapshot();
const record = {
  network: "TESTNET",
  registry: CONTRACT_ACCOUNT_ID,
  dao: DAO_ACCOUNT_ID,
  templateId: "0",
  cycleKey: { template_id: "0", period_index: "0" },
  payoutProposalId: PROPOSAL_ID,
  candidateTransactionHash: CANDIDATE_TX_HASH,
  reconciliationStatus: applied.status,
  adapterState: applied.adapterState,
  adapterReason: applied.reason,
  record: applied.record,
  snapshotFingerprint: snapshot.fingerprint,
  recordCount: snapshot.records.length,
};

await writeFile(
  path.join(outputDir, "reconciliation-snapshot.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(outputDir, "replay-record.json"),
  `${JSON.stringify(record, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
