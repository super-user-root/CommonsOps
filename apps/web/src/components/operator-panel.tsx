import type {
  CreateTemplateDraft,
  OperatorRequestState,
  TransactionIntent,
} from "../features/operator/operator.ts";

interface OperatorPanelProps {
  readonly draft: CreateTemplateDraft;
  readonly intent: TransactionIntent;
  readonly state: OperatorRequestState;
}

function formatYocto(value: string) {
  const amount = BigInt(value);
  const whole = amount / 10n ** 24n;
  const fraction = (amount % 10n ** 24n)
    .toString()
    .padStart(24, "0")
    .slice(0, 4)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} NEAR` : `${whole} NEAR`;
}

export function OperatorPanel({ draft, intent, state }: OperatorPanelProps) {
  return (
    <section className="operator-panel" aria-labelledby="operator-heading">
      <div>
        <p className="eyebrow">Operator preview</p>
        <h2 id="operator-heading">
          Create one recurring maintenance template.
        </h2>
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
          <dt>Interval</dt>
          <dd>{draft.intervalNs} ns</dd>
        </div>
        <div>
          <dt>Work window</dt>
          <dd>{draft.workWindowNs} ns</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>{formatYocto(draft.amountYocto)}</dd>
        </div>
        <div>
          <dt>Storage collateral</dt>
          <dd>{formatYocto(intent.attachedDepositYocto)}</dd>
        </div>
      </dl>
      <div className="intent-preview" role="status" aria-live="polite">
        <strong>{state.status}</strong>
        <code>{intent.method}</code>
        <span>{intent.disabledReason}</span>
      </div>
      <button
        className="button primary"
        type="button"
        disabled={!intent.signingEnabled}
      >
        Create template
      </button>
    </section>
  );
}
