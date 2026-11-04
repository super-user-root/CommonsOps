import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixtureJourney,
  fixtureJourneyConstants,
} from "./fixture-journey.ts";

const expectedNoDeploymentReason =
  "No reviewed testnet registry deployment is configured.";
const expectedContributorNoDeploymentReason =
  "No reviewed testnet registry deployment is configured. Wallet connector is not configured.";

test("derives exact disabled operator fixture intents", async () => {
  const journey = await buildFixtureJourney();
  assert.deepEqual(
    journey.operator.intents.map((intent) => intent.method),
    ["create_template", "materialize_cycle"],
  );

  const [create, materialize] = journey.operator.intents;
  assert(create && materialize);
  assert.deepEqual(create, {
    receiverId: "",
    method: "create_template",
    args: {
      input: {
        dao_account_id: "marmaj.sputnikv2.testnet",
        title: "Recurring public documentation maintenance",
        description:
          "Review and update the community's public contributor documentation.",
        start_at_ns: "1793740800000000000",
        interval_ns: "604800000000000",
        work_window_ns: "432000000000000",
        claim_duration_ns: "86400000000000",
        amount_yocto: "81900000000000000000000000",
      },
    },
    attachedDepositYocto: "40960000000000000000000",
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: expectedNoDeploymentReason,
  });
  assert.deepEqual(materialize, {
    receiverId: "",
    method: "materialize_cycle",
    args: { template_id: "7" },
    attachedDepositYocto: "163840000000000000000000",
    network: "TESTNET",
    signingEnabled: false,
    disabledReason: expectedNoDeploymentReason,
  });
});

test("derives claimed contributor identity, evidence and all four disabled intents", async () => {
  const journey = await buildFixtureJourney();
  const contributor = journey.contributor;

  assert.equal(contributor.cycle.status, "CLAIMED");
  assert.equal(contributor.view.lifecycle, "CLAIMED");
  assert.equal(
    contributor.observedBlockTimestampNs,
    fixtureJourneyConstants.observedBlockTimestampNs,
  );
  assert.equal(contributor.cycle.claim?.claimant_id, "chloe.testnet");
  assert.equal(
    contributor.cycle.claim?.payout_recipient_id,
    contributor.cycle.claim?.claimant_id,
  );
  assert.equal(contributor.view.payoutRecipientId, "chloe.testnet");
  assert.deepEqual(contributor.evidencePreview, {
    repository_owner: "example",
    repository_name: "docs",
    pull_request_number: "42",
    url: "https://github.com/example/docs/pull/42",
    commit_sha: "ab".repeat(20),
    digest_sha256:
      "03970fbdf3f5f23e4be7a57548214c1a85ba8ecafac0cc3a34d9f52881e94773",
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
    assert.equal(intent.receiverId, "");
    assert.equal(intent.attachedDepositYocto, "0");
    assert.equal(intent.signingEnabled, false);
    assert.match(intent.disabledReason, /No reviewed testnet registry/);
  }

  const release = contributor.intents.find(
    (intent) => intent.method === "release_claim",
  );
  const submit = contributor.intents.find(
    (intent) => intent.method === "submit_evidence",
  );
  assert(release && submit);
  assert.equal(release.actionAllowed, true);
  assert.equal(release.disabledReason, expectedContributorNoDeploymentReason);
  assert.equal(submit.actionAllowed, true);
  assert.deepEqual(submit.args, {
    cycle_key: { template_id: "7", period_index: "3" },
    repository_owner: "example",
    repository_name: "docs",
    pull_request_number: "42",
    commit_sha: "ab".repeat(20),
  });
  assert.equal("payout_recipient_id" in submit.args, false);
  assert.equal("digest_sha256" in submit.args, false);
});

test("derives authentic proposal-63 PAID provenance and keeps Approved alone unpaid", async () => {
  const journey = await buildFixtureJourney();
  const reviewer = journey.reviewer;

  assert.equal(reviewer.cycle.status, "SUBMITTED");
  assert.equal(reviewer.cycle.proposal_link?.key.network, "TESTNET");
  assert.equal(reviewer.cycle.proposal_link?.key.proposal_id, "63");
  assert.equal(reviewer.model.link.status, "LINKED_IMMUTABLE");
  assert.equal(reviewer.model.link.intent, null);
  assert.match(reviewer.model.fixtureNotice, /P3-T01 authentic proposal-63/);
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
      "testnet:marmaj.sputnikv2.testnet:63:4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ:H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
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

test("marks every snapshot as immutable fixture-only testnet data with no deployment", async () => {
  const first = await buildFixtureJourney();
  const second = await buildFixtureJourney();

  assert.deepEqual(first.provenance, {
    mode: "FIXTURE_ONLY",
    network: "TESTNET",
    registryDeployment: null,
    walletAvailable: false,
    liveReadsRan: false,
    notice:
      "Stages 1–3 are separate immutable fixture snapshots of one journey, not one mutable live record.",
    fixtureSource: "tests/fixtures/sputnik/proposal-63-paid.json",
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
});
