import type { Cycle } from "@commonsops/domain";
import recordedProposal0ReceiptGraph from "./fixtures/proposal-0-paid.json" with { type: "json" };
import {
  contributorCycleIntent,
  deriveContributorCycleView,
  evidenceSubmissionPreview,
  type ContributorCycleView,
  type ContributorRequestState,
  type ContributorTransactionIntent,
  type GithubEvidenceDraft,
} from "../src/features/contributor/contributor.ts";
import {
  createTemplateIntent,
  CYCLE_MIN_DEPOSIT_YOCTO,
  TEMPLATE_MIN_DEPOSIT_YOCTO,
  templateActionIntent,
  type CreateTemplateDraft,
  type OperatorRequestState,
  type TransactionIntent,
} from "../src/features/operator/operator.ts";
import {
  buildReviewerModel,
  type ReviewerModel,
  type ReviewerRequestState,
} from "../src/features/reviewer/reviewer.ts";

// Every value below is the exact recorded onchain data of the executed
// CommonsOps testnet journey documented in docs/testnet-journey.md
// (registry commonsops.testnet, template 0, cycle 0:0, DAO proposal 0).
const templateId = "0";
const periodIndex = "0";
const claimantId = "commonsops.testnet";
const daoAccountId = "commonsops-dao.sputnikv2.testnet";
const payoutAmountYocto = "500000000000000000000000";
const registryAccountId = "commonsops.testnet";

export const fixtureJourneyConstants = Object.freeze({
  templateId,
  periodIndex,
  // Block-header timestamp of the recorded claim_cycle execution block
  // (8cpCnL53LBMi5N2TKTsG6SLj5EwpgUPN7vpUo4YRAAci, journey step 4); at this
  // instant the recorded claim was live.
  observedBlockTimestampNs: "1793910672509596700",
  fixtureSource: "apps/web/lib/fixtures/proposal-0-paid.json",
  transactionHash: "ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7",
  actionReceiptId: "kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro",
  payoutReceiptId: "EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2",
  blockHash: "5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6",
});

export type StatePatternKey =
  "LOADING" | "EMPTY_UNCONFIGURED" | "PENDING" | "ERROR" | "VERIFIED_FIXTURE";

export interface StatePattern {
  readonly key: StatePatternKey;
  readonly label: string;
  readonly role: "status" | "alert";
  readonly detail: string;
}

export interface FixtureJourney {
  readonly provenance: {
    readonly mode: "FIXTURE_ONLY";
    readonly network: "TESTNET";
    readonly registryDeployment: string | null;
    readonly walletAvailable: false;
    readonly liveReadsRan: false;
    readonly notice: string;
    readonly fixtureSource: string;
  };
  readonly operator: {
    readonly draft: CreateTemplateDraft;
    readonly intents: readonly TransactionIntent[];
    readonly requestState: OperatorRequestState;
  };
  readonly contributor: {
    readonly cycle: Cycle;
    readonly view: ContributorCycleView;
    readonly connectedAccountId: string;
    readonly observedBlockTimestampNs: string;
    readonly evidenceDraft: GithubEvidenceDraft;
    readonly evidencePreview: NonNullable<Cycle["evidence"]>;
    readonly intents: readonly ContributorTransactionIntent[];
    readonly requestState: ContributorRequestState;
  };
  readonly reviewer: {
    readonly cycle: Cycle;
    readonly model: ReviewerModel;
    readonly approvedOnlyModel: ReviewerModel;
    readonly requestState: ReviewerRequestState;
  };
  readonly statePatterns: readonly StatePattern[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

function claimedCycleFixture(): Cycle {
  return deepFreeze({
    key: { template_id: templateId, period_index: periodIndex },
    status: "CLAIMED",
    opens_at_ns: "1793910183011867400",
    deadline_at_ns: "1794342183011867400",
    dao_account_id: daoAccountId,
    amount_yocto: payoutAmountYocto,
    claim: {
      claimant_id: claimantId,
      payout_recipient_id: claimantId,
      expires_at_ns: "1794083472509596599",
    },
    evidence: null,
    submitted_at_ns: null,
    proposal_link: null,
  } satisfies Cycle);
}

function submittedLinkedCycleFixture(
  evidence: NonNullable<Cycle["evidence"]>,
): Cycle {
  return deepFreeze({
    key: { template_id: templateId, period_index: periodIndex },
    status: "SUBMITTED",
    opens_at_ns: "1793910183011867400",
    deadline_at_ns: "1794342183011867400",
    dao_account_id: daoAccountId,
    amount_yocto: payoutAmountYocto,
    claim: {
      claimant_id: claimantId,
      payout_recipient_id: claimantId,
      expires_at_ns: "1794083472509596599",
    },
    evidence: { ...evidence },
    submitted_at_ns: "1793910689442132732",
    proposal_link: {
      key: {
        network: "TESTNET",
        dao_account_id: daoAccountId,
        proposal_id: "0",
      },
      linked_at_ns: "1793910838179857287",
    },
  } satisfies Cycle);
}

function proposal0Fixture() {
  // Exact recorded kind/status of DAO proposal 0 (docs/testnet-journey.md
  // step 6 and the recorded act_proposal VoteApprove transaction).
  return deepFreeze({
    id: 0,
    status: "Approved",
    kind: {
      Transfer: {
        token_id: "",
        receiver_id: claimantId,
        amount: payoutAmountYocto,
        msg: null,
      },
    },
  });
}

/**
 * Builds deterministic server-rendered snapshots of the recorded live
 * testnet journey (docs/testnet-journey.md). It never reads the clock,
 * generates identifiers, performs RPC, or mutates the imported fixture.
 */
export async function buildFixtureJourney(): Promise<FixtureJourney> {
  const draft = deepFreeze({
    daoAccountId,
    title: "Public documentation maintenance",
    description:
      "Recurring maintenance of the CommonsOps public documentation: review and merge community pull requests.",
    startAtNs: "1793910183011867400",
    intervalNs: "604800000000000",
    workWindowNs: "432000000000000",
    claimDurationNs: "172800000000000",
    amountYocto: payoutAmountYocto,
  } satisfies CreateTemplateDraft);

  const operatorIntents = deepFreeze([
    createTemplateIntent(
      registryAccountId,
      draft,
      TEMPLATE_MIN_DEPOSIT_YOCTO.toString(),
    ),
    templateActionIntent(
      registryAccountId,
      "materialize_cycle",
      templateId,
      undefined,
      CYCLE_MIN_DEPOSIT_YOCTO.toString(),
    ),
  ] satisfies readonly TransactionIntent[]);

  const contributorCycle = claimedCycleFixture();
  const evidenceDraft = deepFreeze({
    repositoryOwner: "super-user-root",
    repositoryName: "CommonsOps",
    pullRequestNumber: "17",
    commitSha: "1032733c2115b9e9c038d50617f6e151ac8bd59d",
  } satisfies GithubEvidenceDraft);
  const observedBlockTimestampNs =
    fixtureJourneyConstants.observedBlockTimestampNs;

  const [view, claimIntent, releaseIntent, expireIntent, submissionPreview] =
    await Promise.all([
      deriveContributorCycleView(
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      contributorCycleIntent(
        registryAccountId,
        "claim_cycle",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      contributorCycleIntent(
        registryAccountId,
        "release_claim",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      contributorCycleIntent(
        registryAccountId,
        "expire_cycle_or_claim",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      evidenceSubmissionPreview(
        registryAccountId,
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
        evidenceDraft,
      ),
    ]);

  const contributorIntents = deepFreeze([
    claimIntent,
    releaseIntent,
    expireIntent,
    submissionPreview.intent,
  ] satisfies readonly ContributorTransactionIntent[]);
  const reviewerCycle = submittedLinkedCycleFixture(submissionPreview.evidence);
  const proposal = proposal0Fixture();
  const reviewerBase = {
    cycle: reviewerCycle,
    profile: {
      version: "2.3.1",
      codeHash: "AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH",
    },
    policy: { proposal_bond: "0" },
    reviewedRegistryAccountId: registryAccountId,
    proposalIdForLink: null,
  } as const;

  const [reviewerModel, approvedOnlyModel] = await Promise.all([
    buildReviewerModel({
      ...reviewerBase,
      observation: {
        kind: "FIXTURE",
        fixtureLabel:
          "Recorded testnet tx_status snapshot for the proposal-0 payout, imported in place from apps/web/lib/fixtures/proposal-0-paid.json; not a live read",
        proposal,
        receiptResponse: recordedProposal0ReceiptGraph,
      },
    }),
    buildReviewerModel({
      ...reviewerBase,
      observation: {
        kind: "PENDING",
        fixtureLabel:
          "Approved-only rendering example with no receipt evidence and no live request",
        proposal,
      },
    }),
  ]);

  const statePatterns = deepFreeze([
    {
      key: "LOADING",
      label: "Loading",
      role: "status",
      detail:
        "Rendering example only; no live request ran. A future configured read would announce progress here.",
    },
    {
      key: "EMPTY_UNCONFIGURED",
      label: "Empty / unconfigured",
      role: "status",
      detail:
        "Rendering example only; no live request ran. Mainnet stays isolated and unconfigured; a read against an unconfigured network would show this empty state.",
    },
    {
      key: "PENDING",
      label: "Pending evidence",
      role: "status",
      detail: `Rendering example only; no live request ran. ${approvedOnlyModel.payment.reason}`,
    },
    {
      key: "ERROR",
      label: "Error",
      role: "alert",
      detail:
        "Rendering example only; no live request failed. A future bounded read error would be announced here without inventing fallback data.",
    },
    {
      key: "VERIFIED_FIXTURE",
      label: "Verified fixture",
      role: "status",
      detail: `Recorded-snapshot success pattern only; no live request ran. The canonical adapter derived ${reviewerModel.payment.state} from the recorded proposal-0 receipt graph: ${reviewerModel.payment.reason}. Re-derive it with node scripts/reconcile-live.mjs.`,
    },
  ] satisfies readonly StatePattern[]);

  return deepFreeze({
    provenance: {
      mode: "FIXTURE_ONLY",
      network: "TESTNET",
      registryDeployment: registryAccountId,
      walletAvailable: false,
      liveReadsRan: false,
      notice:
        "Stages 1–3 are separate immutable fixture snapshots of the recorded live testnet journey (docs/testnet-journey.md), not one mutable live record.",
      fixtureSource: fixtureJourneyConstants.fixtureSource,
    },
    operator: {
      draft,
      intents: operatorIntents,
      requestState: { status: "IDLE" },
    },
    contributor: {
      cycle: contributorCycle,
      view,
      connectedAccountId: claimantId,
      observedBlockTimestampNs,
      evidenceDraft,
      evidencePreview: submissionPreview.evidence,
      intents: contributorIntents,
      requestState: { status: "IDLE" },
    },
    reviewer: {
      cycle: reviewerCycle,
      model: reviewerModel,
      approvedOnlyModel,
      requestState: { status: "IDLE" },
    },
    statePatterns,
  } satisfies FixtureJourney);
}
