import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Cycle, CycleStatus } from "@commonsops/domain";
import {
  contributorCycleIntent,
  contributorRequestDetail,
  deriveContributorCycleView,
  evidenceSubmissionPreview,
  formatYoctoNearExact,
  normalizeGithubEvidence,
} from "./contributor.ts";

const U64_MAX = "18446744073709551615";
const claimant = "alice.testnet";

function cycle(status: CycleStatus, overrides: Partial<Cycle> = {}): Cycle {
  const claim =
    status === "CLAIMED" || status === "SUBMITTED"
      ? {
          claimant_id: claimant,
          payout_recipient_id: claimant,
          expires_at_ns: "500",
        }
      : null;
  const evidence =
    status === "SUBMITTED"
      ? {
          repository_owner: "example",
          repository_name: "docs",
          pull_request_number: "42",
          url: "https://github.com/example/docs/pull/42",
          commit_sha: "ab".repeat(20),
          digest_sha256:
            "03970fbdf3f5f23e4be7a57548214c1a85ba8ecafac0cc3a34d9f52881e94773",
        }
      : null;
  return {
    key: { template_id: "7", period_index: "3" },
    status,
    opens_at_ns: "100",
    deadline_at_ns: "600",
    dao_account_id: "community.sputnikv2.testnet",
    amount_yocto: "1000000000000000000000001",
    claim,
    evidence,
    submitted_at_ns: status === "SUBMITTED" ? "400" : null,
    proposal_link: null,
    ...overrides,
  };
}

const draft = {
  repositoryOwner: "Example",
  repositoryName: "Docs.Site",
  pullRequestNumber: "42",
  commitSha: "AB".repeat(20),
};

test("normalizes contract-identical canonical evidence with browser SHA-256", async () => {
  const evidence = await normalizeGithubEvidence(draft);
  const canonical = `[1,"example","docs.site","42","${"ab".repeat(20)}"]`;
  assert.deepEqual(evidence, {
    repository_owner: "example",
    repository_name: "docs.site",
    pull_request_number: "42",
    url: "https://github.com/example/docs.site/pull/42",
    commit_sha: "ab".repeat(20),
    digest_sha256: createHash("sha256").update(canonical).digest("hex"),
  });
});

test("rejects evidence bounds, overflow, zero and malformed values", async () => {
  const invalidDrafts = [
    { ...draft, repositoryOwner: "a".repeat(101) },
    { ...draft, repositoryOwner: "owner/escape" },
    { ...draft, repositoryName: "." },
    { ...draft, repositoryName: ".." },
    { ...draft, pullRequestNumber: "0" },
    { ...draft, pullRequestNumber: "01" },
    { ...draft, pullRequestNumber: U64_MAX + "0" },
    { ...draft, commitSha: "a".repeat(39) },
    { ...draft, commitSha: "g".repeat(40) },
  ];
  for (const invalid of invalidDrafts) {
    await assert.rejects(normalizeGithubEvidence(invalid));
  }
  await assert.doesNotReject(
    normalizeGithubEvidence({ ...draft, pullRequestNumber: U64_MAX }),
  );
});

test("creates exact zero-deposit claim, release and public-expiry ABI intents", () => {
  const claimIntent = contributorCycleIntent(
    null,
    "claim_cycle",
    cycle("OPEN"),
    "100",
    claimant,
  );
  assert.deepEqual(claimIntent, {
    receiverId: "",
    method: "claim_cycle",
    args: { cycle_key: { template_id: "7", period_index: "3" } },
    attachedDepositYocto: "0",
    network: "TESTNET",
    actionAllowed: true,
    signingEnabled: false,
    disabledReason:
      "No reviewed testnet registry deployment is configured. Wallet connector is not configured.",
  });

  const releaseIntent = contributorCycleIntent(
    "registry.testnet",
    "release_claim",
    cycle("CLAIMED"),
    "499",
    claimant,
  );
  assert.deepEqual(releaseIntent.args, {
    cycle_key: { template_id: "7", period_index: "3" },
  });
  assert.equal(releaseIntent.attachedDepositYocto, "0");
  assert.equal(releaseIntent.actionAllowed, true);
  assert.equal(releaseIntent.signingEnabled, false);
  assert.equal(
    releaseIntent.disabledReason,
    "Wallet connector is not configured.",
  );

  const expiryIntent = contributorCycleIntent(
    "registry.testnet",
    "expire_cycle_or_claim",
    cycle("CLAIMED"),
    "500",
    "settler.testnet",
  );
  assert.equal(expiryIntent.actionAllowed, true);
  assert.equal(expiryIntent.attachedDepositYocto, "0");
  assert.deepEqual(expiryIntent.args, {
    cycle_key: { template_id: "7", period_index: "3" },
  });
});

test("creates exact submit_evidence ABI intent without digest or arbitrary recipient", async () => {
  const preview = await evidenceSubmissionPreview(
    "registry.testnet",
    cycle("CLAIMED"),
    "499",
    claimant,
    draft,
  );
  assert.deepEqual(preview.intent, {
    receiverId: "registry.testnet",
    method: "submit_evidence",
    args: {
      cycle_key: { template_id: "7", period_index: "3" },
      repository_owner: "example",
      repository_name: "docs.site",
      pull_request_number: "42",
      commit_sha: "ab".repeat(20),
    },
    attachedDepositYocto: "0",
    network: "TESTNET",
    actionAllowed: true,
    signingEnabled: false,
    disabledReason: "Wallet connector is not configured.",
  });
  assert.equal("digest_sha256" in preview.intent.args, false);
  assert.equal("payout_recipient_id" in preview.intent.args, false);
  assert.equal("recipient" in preview.intent.args, false);
});

test("requires active claimant and strict claim/work deadlines for evidence", async () => {
  const other = await evidenceSubmissionPreview(
    null,
    cycle("CLAIMED"),
    "499",
    "bob.testnet",
    draft,
  );
  assert.equal(other.intent.actionAllowed, false);
  assert.match(other.intent.disabledReason, /not the active claimant/);

  const disconnected = await evidenceSubmissionPreview(
    null,
    cycle("CLAIMED"),
    "499",
    null,
    draft,
  );
  assert.equal(disconnected.intent.actionAllowed, false);
  assert.match(
    disconnected.intent.disabledReason,
    /Connect the active claimant/,
  );

  for (const now of ["500", "600"]) {
    const stale = await evidenceSubmissionPreview(
      null,
      cycle("CLAIMED"),
      now,
      claimant,
      draft,
    );
    assert.equal(stale.intent.actionAllowed, false);
  }

  const deadlineBound = await evidenceSubmissionPreview(
    null,
    cycle("CLAIMED", {
      claim: {
        claimant_id: claimant,
        payout_recipient_id: claimant,
        expires_at_ns: "600",
      },
    }),
    "600",
    claimant,
    draft,
  );
  assert.equal(deadlineBound.intent.actionAllowed, false);
  assert.match(deadlineBound.intent.disabledReason, /work deadline/);
});

test("enforces immutable claimant-to-recipient binding", () => {
  const claimed = deriveContributorCycleView(cycle("CLAIMED"), "499", claimant);
  assert.equal(claimed.payoutRecipientId, claimant);
  assert.equal(claimed.cycle.claim?.claimant_id, claimed.payoutRecipientId);
  assert.equal(claimed.actions.release_claim.allowed, true);

  assert.throws(() =>
    deriveContributorCycleView(
      cycle("CLAIMED", {
        claim: {
          claimant_id: claimant,
          payout_recipient_id: "mallory.testnet",
          expires_at_ns: "500",
        },
      }),
      "499",
      claimant,
    ),
  );
  assert.equal(
    deriveContributorCycleView(cycle("OPEN"), "100", claimant)
      .payoutRecipientId,
    null,
  );
});

test("derives OPEN, CLAIMED, stale, submitted, expired and cancelled lifecycles", () => {
  assert.equal(
    deriveContributorCycleView(cycle("OPEN"), "100", claimant).lifecycle,
    "OPEN",
  );
  assert.equal(
    deriveContributorCycleView(cycle("CLAIMED"), "499", claimant).lifecycle,
    "CLAIMED",
  );
  const staleClaim = deriveContributorCycleView(
    cycle("CLAIMED"),
    "500",
    "settler.testnet",
  );
  assert.equal(staleClaim.lifecycle, "STALE_CLAIM");
  assert.equal(staleClaim.actions.expire_cycle_or_claim.allowed, true);
  assert.equal(staleClaim.actions.submit_evidence.allowed, false);

  const staleCycle = deriveContributorCycleView(
    cycle("OPEN"),
    "600",
    "settler.testnet",
  );
  assert.equal(staleCycle.lifecycle, "STALE_CYCLE");
  assert.equal(staleCycle.actions.expire_cycle_or_claim.allowed, true);

  assert.equal(
    deriveContributorCycleView(cycle("SUBMITTED"), "600", claimant).lifecycle,
    "SUBMITTED",
  );
  assert.equal(
    deriveContributorCycleView(cycle("EXPIRED"), "600", claimant).lifecycle,
    "EXPIRED",
  );
  assert.equal(
    deriveContributorCycleView(cycle("CANCELLED"), "200", claimant).lifecycle,
    "CANCELLED",
  );
});

test("does not fabricate contract settlement or permit premature public expiry", () => {
  const stale = deriveContributorCycleView(
    cycle("CLAIMED"),
    "500",
    "settler.testnet",
  );
  assert.equal(stale.registryStatus, "CLAIMED");
  assert.equal(stale.lifecycle, "STALE_CLAIM");

  const early = contributorCycleIntent(
    null,
    "expire_cycle_or_claim",
    cycle("CLAIMED"),
    "499",
    "settler.testnet",
  );
  assert.equal(early.actionAllowed, false);
  assert.match(early.disabledReason, /Neither the claim nor work deadline/);
});

test("validates all u64 cycle and observation values without Number coercion", () => {
  assert.doesNotThrow(() =>
    deriveContributorCycleView(
      cycle("OPEN", {
        key: { template_id: U64_MAX, period_index: U64_MAX },
        opens_at_ns: "0",
        deadline_at_ns: U64_MAX,
      }),
      "9007199254740993",
      claimant,
    ),
  );
  for (const invalid of ["01", "-1", "1.5", U64_MAX + "0"]) {
    assert.throws(() =>
      deriveContributorCycleView(cycle("OPEN"), invalid, claimant),
    );
  }
  assert.throws(() =>
    deriveContributorCycleView(
      cycle("OPEN", {
        key: { template_id: U64_MAX + "0", period_index: "0" },
      }),
      "100",
      claimant,
    ),
  );
});

test("renders exact yoctoNEAR and non-truncated 24-place NEAR values", () => {
  assert.equal(formatYoctoNearExact("0"), "0.000000000000000000000000 NEAR");
  assert.equal(
    formatYoctoNearExact("1000000000000000000000001"),
    "1.000000000000000000000001 NEAR",
  );
  assert.equal(
    formatYoctoNearExact("999999999999999999999999"),
    "0.999999999999999999999999 NEAR",
  );
});

test("models idle, pending, success and error request status honestly", () => {
  assert.match(contributorRequestDetail({ status: "IDLE" }), /No transaction/);
  assert.match(
    contributorRequestDetail({ status: "PENDING", method: "claim_cycle" }),
    /pending/,
  );
  assert.match(
    contributorRequestDetail({
      status: "SUCCESS",
      method: "release_claim",
      transactionHash: "tx-hash",
    }),
    /tx-hash/,
  );
  assert.match(
    contributorRequestDetail({
      status: "ERROR",
      method: "submit_evidence",
      message: "wallet rejected",
    }),
    /wallet rejected/,
  );
});
