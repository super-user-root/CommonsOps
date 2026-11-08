#!/usr/bin/env node
// Re-derives the fixed recorded CommonsOps testnet payout through the production
// adapter/read model. Read-only; this is not discovery or a live registry-link
// service. Attribution provenance remains the original immutable source string.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReconciliationStore,
  reconcilePayment,
} from "../packages/near/src/reconciliation.ts";
import { parseRpcEnvelope } from "../packages/near/src/read-only-rpc.ts";
import {
  historicalRun,
  isMain,
  parseReadOnlyArgs,
  rpcCall,
  verificationFailure,
  writeJsonAtomic,
} from "./deployment-lib.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const USAGE = "Usage: node scripts/reconcile-live.mjs [--stdout-only]";
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
const RECORDED_FINGERPRINT =
  "f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965";

export function parseArgs(argv) {
  return parseReadOnlyArgs(argv, { usage: USAGE });
}

export async function verifyReconciliation(options = {}) {
  const reads = [
    {
      method: "EXPERIMENTAL_tx_status",
      params: {
        tx_hash: CANDIDATE_TX_HASH,
        sender_account_id: CONTRACT_ACCOUNT_ID,
      },
    },
  ];
  const { value, runProvenance } = await historicalRun(
    reads,
    4,
    options,
    async (context) => {
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
        // Preserve the original envelope and protocol number types. The shared
        // stream/duplicate-safe parser ran before this adapter receives anything.
        transport: (request) =>
          rpcCall(request.method, request.params, context, (_result, raw) =>
            parseRpcEnvelope(raw, context.limits),
          ),
        provenance: PROVENANCE,
        store,
      });
      context.check();
      if (
        (applied.status !== "APPLIED" && applied.status !== "IDEMPOTENT") ||
        applied.adapterState !== "PAID" ||
        !applied.record
      )
        throw new Error(
          `Live reconciliation did not derive PAID: ${JSON.stringify(applied)}`,
        );
      const snapshot = store.exportSnapshot();
      if (snapshot.fingerprint !== RECORDED_FINGERPRINT)
        throw new Error(
          "Reconciliation snapshot fingerprint differs from the recorded journey",
        );
      context.check();
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
      return { record, snapshot };
    },
  );
  return {
    record: { ...value.record, runProvenance },
    snapshot: value.snapshot,
  };
}

export async function main(
  argv = process.argv.slice(2),
  { root = ROOT, rpc = {}, stdout = (text) => process.stdout.write(text) } = {},
) {
  const { stdoutOnly } = parseArgs(argv);
  const { record, snapshot } = await verifyReconciliation(rpc);
  if (!stdoutOnly) {
    // Each file is replaced atomically only after all verification succeeds.
    await writeJsonAtomic(
      path.join(root, "deployments/testnet/reconciliation-snapshot.json"),
      snapshot,
    );
    await writeJsonAtomic(
      path.join(root, "deployments/testnet/replay-record.json"),
      record,
    );
  }
  stdout(`${JSON.stringify(record, null, 2)}\n`);
  return record;
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(verificationFailure(error), null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}
