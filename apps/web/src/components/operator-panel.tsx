import type {
  CreateTemplateDraft,
  OperatorRequestState,
  TransactionIntent,
} from "../features/operator/operator.ts";

interface OperatorPanelProps {
  readonly draft: CreateTemplateDraft;
  readonly intent: TransactionIntent;
  readonly state: OperatorRequestState;
  readonly headingId?: string;
  readonly headingLevel?: 2 | 3 | 4;
  readonly eyebrow?: string;
}

function formatYocto(value: string) {
  const amount = BigInt(value);
  const whole = amount / 10n ** 24n;
  const fraction = (amount % 10n ** 24n)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} NEAR` : `${whole} NEAR`;
}

function actionLabel(intent: TransactionIntent) {
  if (intent.method === "set_template_active") {
    return intent.args.active ? "Resume template" : "Pause template";
  }
  return intent.method === "materialize_cycle"
    ? "Open due cycle"
    : "Create template";
}

function stateDetail(state: OperatorRequestState) {
  if (state.status === "PENDING") return `Preparing ${state.method}`;
  if (state.status === "SUCCESS") return `Transaction ${state.transactionHash}`;
  if (state.status === "ERROR") return state.message;
  return "No request prepared";
}

export function OperatorPanel({
  draft,
  intent,
  state,
  headingId = "operator-heading",
  headingLevel = 2,
  eyebrow = "Operator preview",
}: OperatorPanelProps) {
  const label = actionLabel(intent);
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : "h4";
  const disabledId = `${headingId}-disabled-reason`;
  return (
    <section className="operator-panel" aria-labelledby={headingId}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <Heading id={headingId}>{label}</Heading>
        <p>
          This preview uses exact integer wire values. Signing remains disabled
          until a reviewed testnet registry and wallet connector exist.
        </p>
      </div>
      <dl className="operator-summary">
        <div>
          <dt>DAO</dt>
          <dd>{draft.daoAccountId}</dd>
        </div>
        <div>
          <dt>Title</dt>
          <dd>{draft.title}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>{draft.startAtNs} ns</dd>
        </div>
        <div>
          <dt>Interval</dt>
          <dd>{draft.intervalNs} ns</dd>
        </div>
        <div>
          <dt>Work window</dt>
          <dd>{draft.workWindowNs} ns</dd>
        </div>
        <div>
          <dt>Claim duration</dt>
          <dd>{draft.claimDurationNs} ns</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>
            {draft.amountYocto} yoctoNEAR{" "}
            <small>({formatYocto(draft.amountYocto)})</small>
          </dd>
        </div>
        <div>
          <dt>Storage collateral</dt>
          <dd>
            {intent.attachedDepositYocto} yoctoNEAR{" "}
            <small>({formatYocto(intent.attachedDepositYocto)})</small>
          </dd>
        </div>
      </dl>
      <div className="intent-preview" role="status" aria-live="polite">
        <strong>{state.status}</strong>
        <code>{intent.method}</code>
        <span>{stateDetail(state)}</span>
        <span id={disabledId}>{intent.disabledReason}</span>
      </div>
      <button
        className="button primary"
        type="button"
        disabled={!intent.signingEnabled}
        aria-describedby={disabledId}
      >
        {label}
      </button>
    </section>
  );
}
