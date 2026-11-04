import type { Cycle } from "@commonsops/domain";
import paidProposal63ReceiptGraph from "../../../tests/fixtures/sputnik/proposal-63-paid.json" with { type: "json" };
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

const templateId = "7";
const periodIndex = "3";
const claimantId = "chloe.testnet";
const daoAccountId = "marmaj.sputnikv2.testnet";
const payoutAmountYocto = "81900000000000000000000000";

export const fixtureJourneyConstants = Object.freeze({
  templateId,
  periodIndex,
  observedBlockTimestampNs: "1795558800000000000",
  fixtureSource: "tests/fixtures/sputnik/proposal-63-paid.json",
  transactionHash: "2Nk6t5MJJ6uRUrpoNcY7Hhuaupw9do7ybvxpxZYYS1Dm",
  actionReceiptId: "4Rag51CLP56uPZqovgMzEiNKNeSLF8Bn7G3WiNhuGtuJ",
  payoutReceiptId: "H7tr1j2QAcFx3ibwqKeSHtBwpiaFYRaUfPbj6YzBddgJ",
  blockHash: "8VY8wMxeLmDnncFcU6bpECgJfycypv22qAGm1HeNtygy",
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
    readonly registryDeployment: null;
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
    opens_at_ns: "1795555200000000000",
    deadline_at_ns: "1795987200000000000",
    dao_account_id: daoAccountId,
    amount_yocto: payoutAmountYocto,
    claim: {
      claimant_id: claimantId,
      payout_recipient_id: claimantId,
      expires_at_ns: "1795641600000000000",
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
    opens_at_ns: "1795555200000000000",
    deadline_at_ns: "1795987200000000000",
    dao_account_id: daoAccountId,
    amount_yocto: payoutAmountYocto,
    claim: {
      claimant_id: claimantId,
      payout_recipient_id: claimantId,
      expires_at_ns: "1795641600000000000",
    },
    evidence: { ...evidence },
    submitted_at_ns: "1795562400000000000",
    proposal_link: {
      key: {
        network: "TESTNET",
        dao_account_id: daoAccountId,
        proposal_id: "63",
      },
      linked_at_ns: "1795566000000000000",
    },
  } satisfies Cycle);
}

function proposal63Fixture() {
  return deepFreeze({
    id: 63,
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
 * Builds deterministic server-rendered snapshots. It never reads the clock,
 * generates identifiers, performs RPC, or mutates the imported P3-T01 fixture.
 */
export async function buildFixtureJourney(): Promise<FixtureJourney> {
  const draft = deepFreeze({
    daoAccountId,
    title: "Recurring public documentation maintenance",
    description:
      "Review and update the community's public contributor documentation.",
    startAtNs: "1793740800000000000",
    intervalNs: "604800000000000",
    workWindowNs: "432000000000000",
    claimDurationNs: "86400000000000",
    amountYocto: payoutAmountYocto,
  } satisfies CreateTemplateDraft);

  const operatorIntents = deepFreeze([
    createTemplateIntent(null, draft, TEMPLATE_MIN_DEPOSIT_YOCTO.toString()),
    templateActionIntent(
      null,
      "materialize_cycle",
      templateId,
      undefined,
      CYCLE_MIN_DEPOSIT_YOCTO.toString(),
    ),
  ] satisfies readonly TransactionIntent[]);

  const contributorCycle = claimedCycleFixture();
  const evidenceDraft = deepFreeze({
    repositoryOwner: "Example",
    repositoryName: "Docs",
    pullRequestNumber: "42",
    commitSha: "ab".repeat(20),
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
        null,
        "claim_cycle",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      contributorCycleIntent(
        null,
        "release_claim",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      contributorCycleIntent(
        null,
        "expire_cycle_or_claim",
        contributorCycle,
        observedBlockTimestampNs,
        claimantId,
      ),
      evidenceSubmissionPreview(
        null,
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
  const proposal = proposal63Fixture();
  const reviewerBase = {
    cycle: reviewerCycle,
    profile: {
      version: "2.0.0",
      codeHash: "ZGdM2TFdQpcXrxPxvq25514EViyi9xBSboetDiB3Uiq",
    },
    policy: { proposal_bond: "19000000000000000000000" },
    reviewedRegistryAccountId: null,
    proposalIdForLink: null,
  } as const;

  const [reviewerModel, approvedOnlyModel] = await Promise.all([
    buildReviewerModel({
      ...reviewerBase,
      observation: {
        kind: "FIXTURE",
        fixtureLabel:
          "P3-T01 authentic proposal-63 RPC snapshot imported in place from tests/fixtures/sputnik/proposal-63-paid.json; not a live read",
        proposal,
        receiptResponse: paidProposal63ReceiptGraph,
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
        "No live request ran. No reviewed testnet registry deployment exists, so the current safe read state contains no live records.",
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
      detail: `Fixture success pattern only; no live request ran. The canonical adapter derived ${reviewerModel.payment.state}: ${reviewerModel.payment.reason}.`,
    },
  ] satisfies readonly StatePattern[]);

  return deepFreeze({
    provenance: {
      mode: "FIXTURE_ONLY",
      network: "TESTNET",
      registryDeployment: null,
      walletAvailable: false,
      liveReadsRan: false,
      notice:
        "Stages 1–3 are separate immutable fixture snapshots of one journey, not one mutable live record.",
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
