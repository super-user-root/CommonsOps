import { useId } from "react";
import type {
  ReviewerModel,
  ReviewerRequestState,
  ReviewerTransactionIntent,
} from "../features/reviewer/reviewer.ts";
import { reviewerRequestDetail } from "../features/reviewer/reviewer.ts";
import { formatYoctoNearExact } from "../features/contributor/contributor.ts";

interface ReviewerPanelProps {
  readonly model: ReviewerModel;
  readonly requestState: ReviewerRequestState;
  readonly idScope?: string;
}

function safeId(value: string): string {
  const scoped = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return scoped.replace(/^-+|-+$/g, "") || "cycle";
}

function intentLabel(intent: ReviewerTransactionIntent): string {
  return intent.method === "add_proposal"
    ? "Add Transfer proposal"
    : "Link proposal";
}

function requestRole(state: ReviewerRequestState): "alert" | "status" {
  return state.status === "ERROR" ? "alert" : "status";
}

function IntentPreview({
  intent,
  reasonId,
}: {
  readonly intent: ReviewerTransactionIntent;
  readonly reasonId: string;
}) {
  const label = intentLabel(intent);
  return (
    <article className="intent-preview">
      <h3>{label}</h3>
      <dl>
        <div>
          <dt>Network</dt>
          <dd>{intent.network}</dd>
        </div>
        <div>
          <dt>Receiver</dt>
          <dd>{intent.receiverId || "No reviewed registry account"}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>
            <code>{intent.method}</code>
          </dd>
        </div>
        <div>
          <dt>Attached deposit</dt>
          <dd>
            {intent.attachedDepositYocto} yoctoNEAR{" "}
            <small>({formatYoctoNearExact(intent.attachedDepositYocto)})</small>
          </dd>
        </div>
      </dl>
      <p id={reasonId}>{intent.disabledReason}</p>
      <button
        className="button primary"
        type="button"
        disabled={!intent.signingEnabled}
        aria-describedby={reasonId}
      >
        {label}
      </button>
    </article>
  );
}

export function ReviewerPanel({
  model,
  requestState,
  idScope,
}: ReviewerPanelProps) {
  const instanceId = safeId(useId());
  const cycleId = `${model.cycle.key.template_id}:${model.cycle.key.period_index}`;
  const readableScope = safeId(idScope ?? `reviewer-${cycleId}`);
  const scope = `${readableScope}-${instanceId}`;
  const headingId = `${scope}-heading`;
  const trustId = `${scope}-trust`;
  const requestId = `${scope}-request`;
  const addReasonId = `${scope}-add-disabled`;
  const linkReasonId = `${scope}-link-disabled`;
  const claim = model.cycle.claim!;
  const evidence = model.cycle.evidence!;
  const payment = model.payment;

  return (
    <section
      className="reviewer-panel"
      aria-labelledby={headingId}
      aria-describedby={trustId}
    >
      <header>
        <p className="eyebrow">Reviewer fixture preview · Testnet</p>
        <h2 id={headingId}>Cycle {cycleId}</h2>
        <p>{model.fixtureNotice}</p>
      </header>

      <aside className="binding-notice" id={trustId}>
        <h3>Trust and authorization boundary</h3>
        <p>
          This read-only module renders supplied registry and fixture data. It
          performs no RPC, GitHub, wallet, storage, signing, or transaction
          action. Sputnik governs and pays from its treasury. Payment is only a
          derived adapter result from a finalized causal receipt graph; an
          Approved proposal alone is not PAID. Proposal-link uniqueness is
          enforced by the registry, while receipt replay belongs to the
          canonical offchain read model.
        </p>
      </aside>

      <section aria-labelledby={`${scope}-evidence-heading`}>
        <h3 id={`${scope}-evidence-heading`}>Immutable submission</h3>
        <dl className="evidence-preview">
          <div>
            <dt>Registry status</dt>
            <dd>{model.cycle.status}</dd>
          </div>
          <div>
            <dt>DAO</dt>
            <dd>{model.cycle.dao_account_id}</dd>
          </div>
          <div>
            <dt>Claimant</dt>
            <dd>{claim.claimant_id}</dd>
          </div>
          <div>
            <dt>Frozen payout recipient</dt>
            <dd>{claim.payout_recipient_id}</dd>
          </div>
          <div>
            <dt>Payout</dt>
            <dd>
              {model.cycle.amount_yocto} yoctoNEAR{" "}
              <small>({formatYoctoNearExact(model.cycle.amount_yocto)})</small>
            </dd>
          </div>
          <div>
            <dt>Canonical GitHub evidence</dt>
            <dd>{evidence.url}</dd>
          </div>
          <div>
            <dt>Commit SHA</dt>
            <dd>{evidence.commit_sha}</dd>
          </div>
          <div>
            <dt>Canonical SHA-256</dt>
            <dd>{evidence.digest_sha256}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={`${scope}-proposal-heading`}>
        <h3 id={`${scope}-proposal-heading`}>
          Sputnik Transfer proposal preview
        </h3>
        <p>{model.proposal.description}</p>
        <dl>
          <div>
            <dt>Profile</dt>
            <dd>
              {model.profile.version} · {model.profile.codeHash}
              {model.profileSupported ? " · supported" : " · unsupported"}
            </dd>
          </div>
          <div>
            <dt>Native token ID</dt>
            <dd>
              <code>&quot;&quot;</code>
            </dd>
          </div>
          <div>
            <dt>Receiver</dt>
            <dd>{model.proposal.kind.Transfer.receiver_id}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{model.proposal.kind.Transfer.amount} yoctoNEAR</dd>
          </div>
          <div>
            <dt>Message</dt>
            <dd>null</dd>
          </div>
          <div>
            <dt>Policy proposal bond</dt>
            <dd>
              {model.policy.proposal_bond} yoctoNEAR{" "}
              <small>
                ({formatYoctoNearExact(model.policy.proposal_bond)})
              </small>
            </dd>
          </div>
        </dl>
        <IntentPreview
          intent={model.addProposalIntent}
          reasonId={addReasonId}
        />
      </section>

      <section aria-labelledby={`${scope}-link-heading`}>
        <h3 id={`${scope}-link-heading`}>Immutable registry proposal link</h3>
        <dl>
          <div>
            <dt>Link status</dt>
            <dd>{model.link.status}</dd>
          </div>
          <div>
            <dt>Proposal ID</dt>
            <dd>{model.link.proposalId ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt>Boundary</dt>
            <dd>{model.link.reason}</dd>
          </div>
        </dl>
        {model.link.intent ? (
          <IntentPreview intent={model.link.intent} reasonId={linkReasonId} />
        ) : (
          <p>No link transaction preview is available.</p>
        )}
      </section>

      <section aria-labelledby={`${scope}-payment-heading`}>
        <h3 id={`${scope}-payment-heading`}>Derived reviewer/payment state</h3>
        <dl>
          <div>
            <dt>Derived state</dt>
            <dd>{payment.state}</dd>
          </div>
          <div>
            <dt>Adapter reason</dt>
            <dd>{payment.reason}</dd>
          </div>
          {payment.conflictReason ? (
            <div>
              <dt>Conflict reason</dt>
              <dd>{payment.conflictReason}</dd>
            </div>
          ) : null}
          <div>
            <dt>Proposal status</dt>
            <dd>{payment.proposalStatus ?? "Not available"}</dd>
          </div>
          <div>
            <dt>Adapter state</dt>
            <dd>{payment.adapterState ?? "Adapter not invoked"}</dd>
          </div>
          <div>
            <dt>Transaction hash</dt>
            <dd>{payment.transactionHash ?? "Not verified"}</dd>
          </div>
          <div>
            <dt>Proposal action receipt</dt>
            <dd>{payment.actionReceiptId ?? "Not verified"}</dd>
          </div>
          <div>
            <dt>Payout receipt</dt>
            <dd>{payment.payoutReceiptId ?? "Not verified"}</dd>
          </div>
          <div>
            <dt>Evidence key</dt>
            <dd>{payment.evidenceKey ?? "Not verified"}</dd>
          </div>
          <div>
            <dt>Payout block</dt>
            <dd>{payment.blockHash ?? "Not verified"}</dd>
          </div>
        </dl>
      </section>

      <div
        className="request-status"
        id={requestId}
        role={requestRole(requestState)}
        aria-live="polite"
        aria-atomic="true"
      >
        <strong>{requestState.status}</strong>
        <span>{reviewerRequestDetail(requestState)}</span>
      </div>
    </section>
  );
}
