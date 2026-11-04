import type { Evidence } from "@commonsops/domain";
import type {
  ContributorCycleView,
  ContributorRequestState,
  ContributorTransactionIntent,
  GithubEvidenceDraft,
} from "../features/contributor/contributor.ts";
import {
  contributorRequestDetail,
  formatYoctoNearExact,
} from "../features/contributor/contributor.ts";

interface ContributorPanelProps {
  readonly view: ContributorCycleView;
  readonly connectedAccountId: string | null;
  readonly evidenceDraft: GithubEvidenceDraft;
  readonly evidencePreview: Evidence | null;
  readonly intents: readonly ContributorTransactionIntent[];
  readonly requestState: ContributorRequestState;
}

const actionLabels: Readonly<
  Record<ContributorTransactionIntent["method"], string>
> = {
  claim_cycle: "Claim cycle",
  release_claim: "Release claim",
  expire_cycle_or_claim: "Settle expiry",
  submit_evidence: "Submit evidence",
};

function lifecycleMessage(view: ContributorCycleView) {
  switch (view.lifecycle) {
    case "OPEN":
      return view.workWindowLive
        ? "This supplied registry cycle is open for a claim."
        : "This supplied registry cycle is not open at the observed block time.";
    case "CLAIMED":
      return "An active claim binds the claimant to the payout recipient.";
    case "STALE_CLAIM":
      return "The claim is stale and a direct caller may settle it back to OPEN.";
    case "STALE_CYCLE":
      return "The work deadline has elapsed; the stored record needs public expiry settlement.";
    case "SUBMITTED":
      return "Evidence and payout recipient are immutable on this submitted cycle.";
    case "EXPIRED":
      return "This cycle is terminal because its work deadline expired.";
    case "CANCELLED":
      return "This cycle was cancelled and has no contributor action.";
  }
}

function requestTone(state: ContributorRequestState) {
  return state.status === "ERROR" ? "alert" : "status";
}

export function ContributorPanel({
  view,
  connectedAccountId,
  evidenceDraft,
  evidencePreview,
  intents,
  requestState,
}: ContributorPanelProps) {
  const cycleId = `${view.key.template_id}:${view.key.period_index}`;
  const claim = view.cycle.claim;
  const evidence = view.cycle.evidence ?? evidencePreview;

  return (
    <section
      className="contributor-panel"
      aria-labelledby="contributor-heading"
    >
      <header>
        <p className="eyebrow">Contributor preview · Testnet</p>
        <h2 id="contributor-heading">Cycle {cycleId}</h2>
        <p>{lifecycleMessage(view)}</p>
      </header>

      <dl className="contributor-summary">
        <div>
          <dt>Registry status</dt>
          <dd>{view.registryStatus}</dd>
        </div>
        <div>
          <dt>Derived lifecycle</dt>
          <dd>{view.lifecycle}</dd>
        </div>
        <div>
          <dt>Observed block timestamp</dt>
          <dd>{view.observedBlockTimestampNs} ns</dd>
        </div>
        <div>
          <dt>Opens</dt>
          <dd>{view.cycle.opens_at_ns} ns</dd>
        </div>
        <div>
          <dt>Work deadline</dt>
          <dd>{view.cycle.deadline_at_ns} ns</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>
            {view.cycle.amount_yocto} yoctoNEAR{" "}
            <small>({formatYoctoNearExact(view.cycle.amount_yocto)})</small>
          </dd>
        </div>
        <div>
          <dt>Connected account</dt>
          <dd>{connectedAccountId ?? "Not connected"}</dd>
        </div>
        <div>
          <dt>Claimant</dt>
          <dd>{claim?.claimant_id ?? "Unclaimed"}</dd>
        </div>
        <div>
          <dt>Payout recipient</dt>
          <dd>{view.payoutRecipientId ?? "Assigned only by claiming"}</dd>
        </div>
        <div>
          <dt>Claim expires</dt>
          <dd>{claim ? `${claim.expires_at_ns} ns` : "No active claim"}</dd>
        </div>
      </dl>

      <aside className="binding-notice" aria-labelledby="binding-heading">
        <h3 id="binding-heading">Recipient binding</h3>
        <p>
          Claimant and payout recipient are the same NEAR account. There is no
          recipient input. Release or expiry clears both before submission;
          submission freezes the recipient.
        </p>
      </aside>

      <fieldset disabled aria-describedby="evidence-disabled-reason">
        <legend>Canonical GitHub evidence preview</legend>
        <p id="evidence-disabled-reason">
          Presentational only: this module does not collect input, call GitHub,
          or submit a transaction.
        </p>
        <label>
          Repository owner
          <input value={evidenceDraft.repositoryOwner} readOnly />
        </label>
        <label>
          Repository name
          <input value={evidenceDraft.repositoryName} readOnly />
        </label>
        <label>
          Pull request number
          <input value={evidenceDraft.pullRequestNumber} readOnly />
        </label>
        <label>
          Commit SHA
          <input value={evidenceDraft.commitSha} readOnly />
        </label>
      </fieldset>

      {evidence ? (
        <dl className="evidence-preview">
          <div>
            <dt>Canonical URL</dt>
            <dd>{evidence.url}</dd>
          </div>
          <div>
            <dt>Canonical SHA-256</dt>
            <dd>{evidence.digest_sha256}</dd>
          </div>
        </dl>
      ) : null}

      <div
        className="request-status"
        role={requestTone(requestState)}
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>{requestState.status}</strong>
        <span>{contributorRequestDetail(requestState)}</span>
      </div>

      <div
        className="contributor-actions"
        aria-label="Transaction intent previews"
      >
        {intents.map((intent) => {
          const reasonId = `contributor-disabled-${intent.method}`;
          return (
            <article className="intent-preview" key={intent.method}>
              <h3>{actionLabels[intent.method]}</h3>
              <dl>
                <div>
                  <dt>Method</dt>
                  <dd>
                    <code>{intent.method}</code>
                  </dd>
                </div>
                <div>
                  <dt>Deposit</dt>
                  <dd>{intent.attachedDepositYocto} yoctoNEAR</dd>
                </div>
                <div>
                  <dt>Receiver</dt>
                  <dd>{intent.receiverId || "No reviewed deployment"}</dd>
                </div>
              </dl>
              <p id={reasonId}>{intent.disabledReason}</p>
              <button
                className="button primary"
                type="button"
                disabled={!intent.signingEnabled}
                aria-describedby={reasonId}
              >
                {actionLabels[intent.method]}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
