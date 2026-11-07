import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixtureJourney,
  fixtureJourneyConstants,
} from "./fixture-journey.ts";

const expectedWalletOnlyReason = "Wallet connector is not configured.";
const expectedClaimUnavailableReason = `Only an open, live cycle can be claimed. ${expectedWalletOnlyReason}`;
const expectedExpireUnavailableReason = `Neither the claim nor work deadline has elapsed. ${expectedWalletOnlyReason}`;

test("derives exact disabled operator intents from recorded template 0", async () => {
  const journey = await buildFixtureJourney();
  assert.deepEqual(
    journey.operator.intents.map((intent) => intent.method),
    ["create_template", "materialize_cycle"],
  );

  const [create, materialize] = journey.operator.intents;
  assert(create && materialize);
  assert.deepEqual(create, {
    receiverId: "commonsops.testnet",
    method: "create_template",
    args: {
      input: {
        dao_account_id: "commonsops-dao.sputnikv2.testnet",
        title: "Public documentation maintenance",
        description:
          "Recurring maintenance of the CommonsOps public documentation: review and merge community pull requests.",
        start_at_ns: "1793910183011867400",
        interval_ns: "604800000000000",
        work_window_ns: "432000000000000",
        claim_duration_ns: "172800000000000",
        amount_yocto: "500000000000000000000000",
      },
    },
    attachedDepositYocto: "40960000000000000000000",
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: expectedWalletOnlyReason,
  });
  assert.deepEqual(materialize, {
    receiverId: "commonsops.testnet",
    method: "materialize_cycle",
    args: { template_id: "0" },
    attachedDepositYocto: "163840000000000000000000",
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: expectedWalletOnlyReason,
  });
});

test("derives the recorded claimed cycle identity, evidence and all four disabled intents", async () => {
  const journey = await buildFixtureJourney();
  const contributor = journey.contributor;

  assert.equal(contributor.cycle.status, "CLAIMED");
  assert.equal(contributor.view.lifecycle, "CLAIMED");
  assert.equal(
    contributor.observedBlockTimestampNs,
    fixtureJourneyConstants.observedBlockTimestampNs,
  );
  assert.deepEqual(contributor.cycle.key, {
    template_id: "0",
    period_index: "0",
  });
  assert.deepEqual(contributor.view.key, {
    template_id: "0",
    period_index: "0",
  });
  assert.equal(
    contributor.cycle.dao_account_id,
    "commonsops-dao.sputnikv2.testnet",
  );
  assert.equal(contributor.cycle.claim?.claimant_id, "commonsops.testnet");
  assert.equal(
    contributor.cycle.claim?.payout_recipient_id,
    contributor.cycle.claim?.claimant_id,
  );
  assert.equal(contributor.view.payoutRecipientId, "commonsops.testnet");
  assert.deepEqual(contributor.evidencePreview, {
    repository_owner: "super-user-root",
    repository_name: "commonsops",
    pull_request_number: "17",
    url: "https://github.com/super-user-root/commonsops/pull/17",
    commit_sha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
    digest_sha256:
      "09936627004b6e19664173302ff9d52613f5febef27ab34cfa488b54b83d71b8",
  });
  assert.deepEqual(
    contributor.intents.map((intent) => intent.method),
    [
      "claim_cycle",
      "release_claim",
      "expire_cycle_or_claim",
      "submit_evidence",
    ],
  );
  for (const intent of contributor.intents) {
    assert.equal(intent.network, "TESTNET");
    assert.equal(intent.receiverId, "commonsops.testnet");
    assert.equal(intent.attachedDepositYocto, "0");
    assert.equal(intent.signingEnabled, false);
    assert.match(intent.disabledReason, /Wallet connector is not configured/);
  }

  const claim = contributor.intents.find(
    (intent) => intent.method === "claim_cycle",
  );
  const release = contributor.intents.find(
    (intent) => intent.method === "release_claim",
  );
  const expire = contributor.intents.find(
    (intent) => intent.method === "expire_cycle_or_claim",
  );
  const submit = contributor.intents.find(
    (intent) => intent.method === "submit_evidence",
  );
  assert(claim && release && expire && submit);
  assert.equal(claim.disabledReason, expectedClaimUnavailableReason);
  assert.equal(release.actionAllowed, true);
  assert.equal(release.disabledReason, expectedWalletOnlyReason);
  assert.equal(expire.disabledReason, expectedExpireUnavailableReason);
  assert.equal(submit.actionAllowed, true);
  assert.deepEqual(submit.args, {
    cycle_key: { template_id: "0", period_index: "0" },
    repository_owner: "super-user-root",
    repository_name: "commonsops",
    pull_request_number: "17",
    commit_sha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
  });
  assert.equal("payout_recipient_id" in submit.args, false);
  assert.equal("digest_sha256" in submit.args, false);
});

test("derives the recorded proposal-0 PAID provenance and keeps Approved alone unpaid", async () => {
  const journey = await buildFixtureJourney();
  const reviewer = journey.reviewer;

  assert.equal(reviewer.cycle.status, "SUBMITTED");
  assert.equal(reviewer.cycle.proposal_link?.key.network, "TESTNET");
  assert.equal(
    reviewer.cycle.proposal_link?.key.dao_account_id,
    "commonsops-dao.sputnikv2.testnet",
  );
  assert.equal(reviewer.cycle.proposal_link?.key.proposal_id, "0");
  assert.equal(reviewer.model.link.status, "LINKED_IMMUTABLE");
  assert.equal(reviewer.model.link.intent, null);
  assert.equal(reviewer.model.profileSupported, false);
  assert.equal(reviewer.model.profileVerifiable, true);
  assert.match(
    reviewer.model.fixtureNotice,
    /Recorded testnet tx_status snapshot for the proposal-0 payout/,
  );
  assert.deepEqual(reviewer.model.payment, {
    state: "PAID",
    reason: "Verified one successful causal native NEAR payout",
    conflictReason: null,
    proposalStatus: "Approved",
    adapterState: "PAID",
    transactionHash: fixtureJourneyConstants.transactionHash,
    actionReceiptId: fixtureJourneyConstants.actionReceiptId,
    payoutReceiptId: fixtureJourneyConstants.payoutReceiptId,
    evidenceKey:
      "testnet:commonsops-dao.sputnikv2.testnet:0:kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro:EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2",
    blockHash: fixtureJourneyConstants.blockHash,
  });

  assert.equal(
    reviewer.approvedOnlyModel.payment.state,
    "PENDING_PAYMENT_EVIDENCE",
  );
  assert.notEqual(reviewer.approvedOnlyModel.payment.state, "PAID");
  assert.equal(reviewer.approvedOnlyModel.payment.adapterState, null);
  assert.equal(reviewer.approvedOnlyModel.payment.transactionHash, null);
  assert.match(
    reviewer.approvedOnlyModel.payment.reason,
    /Approved alone is not payment proof/,
  );
});

test("marks every snapshot as an immutable recorded-journey testnet snapshot", async () => {
  const first = await buildFixtureJourney();
  const second = await buildFixtureJourney();

  assert.deepEqual(first.provenance, {
    mode: "FIXTURE_ONLY",
    network: "TESTNET",
    registryDeployment: "commonsops.testnet",
    walletAvailable: false,
    liveReadsRan: false,
    notice:
      "Stages 1–3 are separate immutable fixture snapshots of the recorded live testnet journey (docs/testnet-journey.md), not one mutable live record.",
    fixtureSource: "apps/web/lib/fixtures/proposal-0-paid.json",
  });
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.contributor.cycle, first.reviewer.cycle);
  assert.equal(first.contributor.cycle.status, "CLAIMED");
  assert.equal(first.reviewer.cycle.status, "SUBMITTED");
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.operator.draft), true);
  assert.equal(Object.isFrozen(first.contributor.cycle), true);
  assert.equal(Object.isFrozen(first.reviewer.cycle.proposal_link), true);
  assert.equal(Object.isFrozen(first.reviewer.model.payment), true);
  assert.equal(
    Object.isFrozen(first.reviewer.model.addProposalIntent.args),
    true,
  );
  assert.equal(
    Object.isFrozen(first.reviewer.model.proposal.kind.Transfer),
    true,
  );
});

test("defines explicit semantic rendering patterns without claiming live requests", async () => {
  const journey = await buildFixtureJourney();
  assert.deepEqual(
    journey.statePatterns.map(({ key, role }) => ({ key, role })),
    [
      { key: "LOADING", role: "status" },
      { key: "EMPTY_UNCONFIGURED", role: "status" },
      { key: "PENDING", role: "status" },
      { key: "ERROR", role: "alert" },
      { key: "VERIFIED_FIXTURE", role: "status" },
    ],
  );
  for (const pattern of journey.statePatterns) {
    assert.match(pattern.detail, /no live request/i);
  }
  assert.match(
    journey.statePatterns.find((pattern) => pattern.key === "PENDING")
      ?.detail ?? "",
    /Approved alone is not payment proof/,
  );
  assert.match(
    journey.statePatterns.find((pattern) => pattern.key === "VERIFIED_FIXTURE")
      ?.detail ?? "",
    /canonical adapter derived PAID/,
  );
  assert.match(
    journey.statePatterns.find((pattern) => pattern.key === "VERIFIED_FIXTURE")
      ?.detail ?? "",
    /node scripts\/reconcile-live\.mjs/,
  );
  assert.doesNotMatch(
    journey.statePatterns.find(
      (pattern) => pattern.key === "EMPTY_UNCONFIGURED",
    )?.detail ?? "",
    /testnet is unconfigured/i,
  );
});
