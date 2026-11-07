import assert from "node:assert/strict";
import test from "node:test";
import type { Cycle } from "@commonsops/domain";
import {
  contributorCycleIntent,
  evidenceSubmissionPreview,
  type ContributorTransactionIntent,
  type GithubEvidenceDraft,
} from "../../src/features/contributor/contributor.ts";
import {
  contributorWalletTransaction,
  describeLiveRequest,
  extractTransactionHash,
  sendContributorIntent,
  toWalletSelectorTransaction,
} from "./transactions.ts";
import { explorerTransactionUrl } from "./network.ts";

const REGISTRY = "commonsops.testnet";
// Exact recorded journey values (docs/testnet-journey.md, cycle 0:0 claim).
const OBSERVED_NS = "1793910672509596700";

function claimedCycleFixture(): Cycle {
  return {
    key: { template_id: "0", period_index: "0" },
    status: "CLAIMED",
    opens_at_ns: "1793910183011867400",
    deadline_at_ns: "1794342183011867400",
    dao_account_id: "commonsops-dao.sputnikv2.testnet",
    amount_yocto: "500000000000000000000000",
    claim: {
      claimant_id: "commonsops.testnet",
      payout_recipient_id: "commonsops.testnet",
      expires_at_ns: "1794083472509596599",
    },
    evidence: null,
    submitted_at_ns: null,
    proposal_link: null,
  };
}

const evidenceDraft: GithubEvidenceDraft = {
  repositoryOwner: "super-user-root",
  repositoryName: "CommonsOps",
  pullRequestNumber: "17",
  commitSha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
};

async function claimantIntent(
  method: "claim_cycle" | "release_claim" | "expire_cycle_or_claim",
): Promise<ContributorTransactionIntent> {
  return contributorCycleIntent(
    REGISTRY,
    method,
    claimedCycleFixture(),
    OBSERVED_NS,
    "commonsops.testnet",
  );
}

test("wallet transaction preserves the reviewed intent construction byte-for-byte", async () => {
  const intent = await claimantIntent("release_claim");
  assert.equal(intent.actionAllowed, true);
  const transaction = contributorWalletTransaction(intent, REGISTRY);
  assert.equal(transaction.receiverId, REGISTRY);
  assert.equal(transaction.actions.length, 1);
  const action = transaction.actions[0];
  assert.ok(action);
  assert.equal(action.type, "FunctionCall");
  assert.equal(action.params.methodName, "release_claim");
  assert.deepEqual(action.params.args, {
    cycle_key: { template_id: "0", period_index: "0" },
  });
  // Wire values match the executed journey: 100 TeraGas, zero deposit.
  assert.equal(action.params.gas, "100000000000000");
  assert.equal(action.params.deposit, "0");
});

test("claiming is refused for the already-claimed live cycle", async () => {
  const claim = await claimantIntent("claim_cycle");
  assert.equal(claim.actionAllowed, false);
  assert.match(claim.disabledReason, /Only an open, live cycle can be claimed/);
  assert.throws(
    () => contributorWalletTransaction(claim, REGISTRY),
    /ERR_INTENT_NOT_ALLOWED/,
  );
});

test("evidence transaction args equal the reviewed canonicalization exactly", async () => {
  const preview = await evidenceSubmissionPreview(
    REGISTRY,
    claimedCycleFixture(),
    OBSERVED_NS,
    "commonsops.testnet",
    evidenceDraft,
  );
  const transaction = contributorWalletTransaction(preview.intent, REGISTRY);
  const action = transaction.actions[0];
  assert.ok(action);
  assert.equal(action.params.methodName, "submit_evidence");
  assert.deepEqual(action.params.args, {
    cycle_key: { template_id: "0", period_index: "0" },
    repository_owner: "super-user-root",
    repository_name: "commonsops",
    pull_request_number: "17",
    commit_sha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
  });
});

test("transactions refuse unavailable intents, wrong receivers, and deposits", async () => {
  const unavailable = await contributorCycleIntent(
    REGISTRY,
    "release_claim",
    claimedCycleFixture(),
    OBSERVED_NS,
    "someone-else.testnet",
  );
  assert.equal(unavailable.actionAllowed, false);
  assert.throws(
    () => contributorWalletTransaction(unavailable, REGISTRY),
    /ERR_INTENT_NOT_ALLOWED/,
  );

  const claim = await claimantIntent("release_claim");
  assert.throws(
    () => contributorWalletTransaction(claim, "other.testnet"),
    /ERR_INTENT_RECEIVER/,
  );
  assert.throws(
    () =>
      contributorWalletTransaction(
        { ...claim, attachedDepositYocto: "1" as never },
        REGISTRY,
      ),
    /ERR_INTENT_DEPOSIT/,
  );
  assert.throws(
    () =>
      contributorWalletTransaction(
        { ...claim, network: "MAINNET" as never },
        REGISTRY,
      ),
    /ERR_INTENT_NETWORK/,
  );
});

test("the wallet-selector action serializes the exact reviewed args bytes", async () => {
  const intent = await claimantIntent("release_claim");
  const transaction = contributorWalletTransaction(intent, REGISTRY);
  const selectorTransaction = await toWalletSelectorTransaction(transaction);
  assert.equal(selectorTransaction.receiverId, REGISTRY);
  assert.equal(selectorTransaction.actions.length, 1);
  const najAction = selectorTransaction.actions[0] as unknown as {
    functionCall: {
      methodName: string;
      args: Uint8Array;
      gas: bigint;
      deposit: bigint;
    };
    enum: string;
  };
  assert.equal(najAction.enum, "functionCall");
  assert.equal(najAction.functionCall.methodName, "release_claim");
  // The onchain bytes are exactly JSON of the reviewed intent args.
  assert.equal(
    Buffer.from(najAction.functionCall.args).toString("utf8"),
    JSON.stringify({ cycle_key: { template_id: "0", period_index: "0" } }),
  );
  assert.equal(najAction.functionCall.gas, 100000000000000n);
  assert.equal(najAction.functionCall.deposit, 0n);
});

test("extractTransactionHash reads the wallet outcome or fails honestly", () => {
  const hash = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
  assert.equal(
    extractTransactionHash([{ transaction_outcome: { id: hash } }]),
    hash,
  );
  assert.equal(extractTransactionHash([{ transaction: { hash } }]), hash);
  assert.throws(() => extractTransactionHash([]), /ERR_TX_HASH_MISSING/);
  assert.throws(
    () => extractTransactionHash([{ transaction_outcome: { id: 42 } }]),
    /ERR_TX_HASH_MISSING/,
  );
});

test("sendContributorIntent reports success with the testnet explorer link", async () => {
  const hash = "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7";
  const intent = await claimantIntent("release_claim");
  const sent = [];
  const outcome = await sendContributorIntent(
    async (transaction) => {
      sent.push(transaction);
      return [{ transaction_outcome: { id: hash } }];
    },
    intent,
    REGISTRY,
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(outcome, {
    kind: "SUCCESS",
    transactionHash: hash,
    explorerUrl: explorerTransactionUrl(hash),
  });
});

test("a dismissed wallet request is reported as rejected with nothing sent", async () => {
  const intent = await claimantIntent("release_claim");
  const outcome = await sendContributorIntent(
    async () => {
      throw new Error("User dismissed the transaction");
    },
    intent,
    REGISTRY,
  );
  assert.equal(outcome.kind, "REJECTED");
  assert.match(outcome.detail, /No transaction was sent/);
});

test("wallet failures surface the wallet's own message, never success", async () => {
  const intent = await claimantIntent("release_claim");
  const outcome = await sendContributorIntent(
    async () => {
      throw new Error("Account alice.testnet doesn't have enough balance");
    },
    intent,
    REGISTRY,
  );
  assert.equal(outcome.kind, "ERROR");
  assert.match(outcome.message, /enough balance/);
});

test("describeLiveRequest labels every state truthfully", () => {
  assert.match(
    describeLiveRequest({ status: "IDLE" }),
    /No transaction request/,
  );
  assert.match(
    describeLiveRequest({ status: "PENDING", method: "claim_cycle" }),
    /Nothing is sent until you approve/,
  );
  assert.match(
    describeLiveRequest({
      status: "SUCCESS",
      method: "claim_cycle",
      transactionHash: "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7",
      explorerUrl:
        "https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7",
    }),
    /was signed and sent/,
  );
  assert.match(
    describeLiveRequest({
      status: "REJECTED",
      method: "claim_cycle",
      detail:
        "The wallet request was dismissed. No transaction was sent and no onchain state changed.",
    }),
    /no request sent/,
  );
  assert.match(
    describeLiveRequest({
      status: "ERROR",
      method: "claim_cycle",
      message: "not enough balance",
    }),
    /failed/,
  );
});
