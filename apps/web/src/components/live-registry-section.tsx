"use client";

// Live registry surface: read-only JSON-RPC reads of commonsops.testnet plus
// contributor transactions signed by the connected wallet. Every state is
// honest — loading, named errors, wallet rejection ("no request sent"), and
// submitted transactions with explorer links. No simulated success, no
// fabricated data, and the DAO payout flow stays out of the app.
//
// Every registered template has a compact summary. One selected group exposes
// its full live detail/actions; selection changes invalidate pending preparation.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LatestTask } from "../../lib/live/latest-task.ts";
import {
  deriveTemplateAvailability,
  preferredTemplate,
  TemplateSelection,
  type TemplateAvailability,
} from "../../lib/live/template-selection.ts";
import type { Evidence } from "@commonsops/domain";
import {
  contributorCycleIntent,
  deriveContributorCycleView,
  evidenceSubmissionPreview,
  formatYoctoNearExact,
  type ContributorCycleView,
  type ContributorMethod,
  type ContributorTransactionIntent,
  type GithubEvidenceDraft,
} from "../features/contributor/contributor.ts";
import { assertTestnet } from "../../lib/live/network.ts";
import {
  fetchLiveRegistrySnapshot,
  type LiveCycleRead,
  type LiveRegistrySnapshot,
  type LiveTemplateRead,
} from "../../lib/live/registry-reads.ts";
import { LiveRpcError, RPC_LIMITS } from "../../lib/live/rpc.ts";
import {
  describeLiveRequest,
  settleWalletRequest,
  TransactionEvidence,
  SendAuthority,
  type LiveRequestState,
} from "../../lib/live/transactions.ts";
import { useLiveWallet } from "./live-wallet-provider.tsx";

const CONTRIBUTOR_METHODS: readonly ContributorMethod[] = [
  "claim_cycle",
  "release_claim",
  "expire_cycle_or_claim",
  "submit_evidence",
];

const METHOD_LABELS: Readonly<Record<ContributorMethod, string>> = {
  claim_cycle: "Claim cycle",
  release_claim: "Release claim",
  expire_cycle_or_claim: "Settle expiry",
  submit_evidence: "Submit evidence",
};

interface DerivedActions {
  readonly contextKey: string;
  readonly view: ContributorCycleView;
  // submit_evidence is present only when the canonical evidence draft is
  // valid; an invalid draft disables that one send instead of inventing args.
  readonly intents: Readonly<
    Partial<Record<ContributorMethod, ContributorTransactionIntent>>
  >;
  readonly evidencePreview: Evidence | null;
  readonly evidenceError: string | null;
}

const EMPTY_EVIDENCE_DRAFT: GithubEvidenceDraft = Object.freeze({
  repositoryOwner: "",
  repositoryName: "",
  pullRequestNumber: "",
  commitSha: "",
});

function failureText(error: unknown): { code: string; message: string } {
  if (error instanceof LiveRpcError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "ERR_LIVE_READ",
    message: error instanceof Error ? error.message : String(error),
  };
}

function cycleHeading(cycle: {
  key: { template_id: string; period_index: string };
}) {
  return `Cycle ${cycle.key.template_id}:${cycle.key.period_index}`;
}

function nsToDate(timestampNs: string): string {
  const parsed = BigInt(timestampNs);
  const millis = parsed / 1_000_000n;
  return new Date(Number(millis)).toISOString();
}

export function LiveRegistrySection({
  registryAccountId,
}: {
  registryAccountId: string;
}) {
  const wallet = useLiveWallet();
  const reads = useMemo(() => new LatestTask<LiveRegistrySnapshot>(), []);
  const readState = useSyncExternalStore(
    reads.subscribe,
    reads.getSnapshot,
    reads.getSnapshot,
  );
  const evidence = useMemo(() => new TransactionEvidence(), []);
  const snapshotAuthority = useMemo(() => new SendAuthority(), []);
  const selection = useMemo(() => new TemplateSelection(), []);
  const summaries = useMemo(
    () => new LatestTask<readonly TemplateAvailability[]>(),
    [],
  );
  useSyncExternalStore(
    summaries.subscribe,
    summaries.getSnapshot,
    summaries.getSnapshot,
  );
  const [choice, setChoice] = useState<{
    scope: string;
    id: string | null;
  } | null>(null);
  const [, evidenceVersion] = useState(0);
  const recordRequest = useCallback(
    (key: string, state: LiveRequestState) => {
      evidence.set(key, state);
      evidenceVersion((version) => version + 1);
    },
    [evidence],
  );

  const config = useMemo(() => assertTestnet("testnet"), []);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    snapshotAuthority.invalidate(); // Synchronous, before React publishes loading.
    const deadline = performance.now() + RPC_LIMITS.deadlineMs;
    return reads.run(
      registryAccountId,
      (signal) =>
        fetchLiveRegistrySnapshot(config, registryAccountId, { signal }),
      false,
      () => {
        if (performance.now() >= deadline)
          throw new LiveRpcError(
            "ERR_RPC_DEADLINE",
            "Refresh publication exceeded its deadline.",
          );
      },
    );
  }, [reads, config, registryAccountId, snapshotAuthority]);
  useEffect(() => {
    void refresh();
    return () => {
      snapshotAuthority.invalidate();
      reads.cancel();
    };
  }, [refresh, reads, snapshotAuthority]);

  const snapshot =
    readState.dataKey === registryAccountId ? readState.data : null;
  const fresh =
    readState.status === "READY" && readState.dataKey === registryAccountId;
  snapshotAuthority.update(
    JSON.stringify([
      registryAccountId,
      snapshot?.block.hash,
      snapshot?.block.height,
      fresh,
      wallet.accountId,
    ]),
  );
  const loading = readState.status === "LOADING" || readState.status === "IDLE";
  const readFailure =
    readState.status === "ERROR" ? failureText(readState.error) : null;
  const managerId = useMemo(() => {
    for (const read of snapshot?.templates ?? []) {
      if (read.kind === "READY") return read.template.manager_id;
    }
    return null;
  }, [snapshot]);

  const summaryKey = JSON.stringify([snapshot, wallet.accountId]);
  const selectionScope = JSON.stringify([registryAccountId, wallet.accountId]);
  useEffect(() => {
    if (!snapshot) {
      summaries.cancel();
      return;
    }
    void summaries.run(summaryKey, () =>
      Promise.all(
        snapshot.templates.map((read) =>
          deriveTemplateAvailability(
            read,
            snapshot.block.timestampNs,
            wallet.accountId,
          ),
        ),
      ),
    );
    return () => summaries.cancel();
  }, [summaries, snapshot, summaryKey, wallet.accountId]);
  useEffect(() => () => selection.dispose(), [selection]);
  const availability = summaries.current(summaryKey);
  const selectedId =
    choice?.scope === selectionScope &&
    (choice.id === null ||
      snapshot?.templates.some((read) => read.templateId === choice.id))
      ? choice.id
      : preferredTemplate(availability ?? []);
  const selectedRead = snapshot?.templates.find(
    (read) => read.templateId === selectedId,
  );
  const selectedAvailability = availability?.find(
    (entry) => entry.templateId === selectedId,
  );
  // Also invalidate during render when a snapshot/account change removes or
  // replaces the selected detail. Event-driven hiding invalidates even earlier.
  selection.select(selectedRead && selectedAvailability ? selectedId : null);
  const chooseTemplate = (id: string | null) => {
    selection.select(id); // Synchronous: never wait for React to hide the old group.
    setChoice({ scope: selectionScope, id });
  };
  const pageTemplate = (direction: 1 | -1) => {
    const list = snapshot?.templates ?? [];
    if (!list.length) return;
    const current = list.findIndex((read) => read.templateId === selectedId);
    const index = (current + direction + list.length) % list.length;
    chooseTemplate(list[index]!.templateId);
    const track = trackRef.current;
    const item = track?.children[index];
    if (track && item)
      track.scrollTo({
        left:
          track.scrollLeft +
          item.getBoundingClientRect().left -
          track.getBoundingClientRect().left,
        behavior: "smooth",
      });
  };

  return (
    <section
      className="live-section section-shell"
      id="live-registry"
      aria-labelledby="live-registry-heading"
    >
      <div className="section-intro split-intro">
        <div>
          <p className="eyebrow">
            Live registry · NEAR testnet — connect a wallet to interact
          </p>
          <h2 id="live-registry-heading">Live registry, same rules.</h2>
        </div>
        <p>
          Read <code>{registryAccountId}</code> at a final testnet block without
          a wallet. Select a template for details and contributor actions. Your
          wallet signs; the operator and DAO govern outside this app.
        </p>
      </div>

      {/* One infrastructure alert/Retry in this live region. The separate
          state-pattern gallery below contains an explicitly labelled example. */}
      {readFailure ? (
        <div
          className="live-card live-unreachable"
          role="alert"
          data-live-rpc-error
        >
          <h3>Live registry read unavailable</h3>
          <p>
            Official NEAR testnet RPC could not verify this refresh (
            {readFailure.code}). {readFailure.message} Check your connection or
            try again. No fallback data is shown.
          </p>
          <div className="live-recovery-actions">
            <a className="button secondary" href="#journey">
              View recorded testnet evidence — not a live result
            </a>
            <button
              className="button primary"
              type="button"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}
      <div className="live-meta" role="status" aria-live="polite">
        {loading ? (
          <p>Querying {registryAccountId} at a NEAR testnet final block…</p>
        ) : null}
        {snapshot && !fresh ? (
          <p>
            <strong>Stale snapshot — previous verified data.</strong> Signing is
            disabled until a successful refresh.
          </p>
        ) : null}
        {snapshot ? (
          <div className="live-source">
            <p>
              Observed final block{" "}
              <span className="exact-value">{snapshot.block.height}</span> at{" "}
              {nsToDate(snapshot.block.timestampNs)}. Validated read
              endpoint(s):{" "}
              <code>
                {snapshot.endpoints.join(", ") || "provenance unavailable"}
              </code>
              . Availability is at this block, not a reservation or payout
              guarantee.
              {snapshot.enumerationStop === "COMPLETE"
                ? ""
                : snapshot.enumerationStop === "CAPPED"
                  ? " Template enumeration stopped at the cap; more templates may exist onchain."
                  : " Template discovery interrupted by a template error; later IDs were not read."}
            </p>
            <details className="proof-details">
              <summary>Exact block and legacy contract marker</summary>
              <p>
                Block hash: <code>{snapshot.block.hash}</code>. Timestamp:{" "}
                <code>{snapshot.block.timestampNs} ns</code>.
              </p>
              <p>
                Foundation status: <code>{snapshot.foundationStatus}</code>.
                This is a legacy scaffold literal, not a business-state check or
                a claim that the deployed lifecycle is missing.
              </p>
            </details>
          </div>
        ) : null}
        {!readFailure ? (
          <button
            className="button secondary"
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Reading…" : "Re-read live state"}
          </button>
        ) : null}
      </div>

      <aside className="shared-slot-notice" aria-label="Shared demo slot">
        <p>
          <strong>Cycle 2:0 is one global shared slot.</strong> The first
          claimant occupies it. Only their active, unsubmitted claim can be
          released; immutable evidence submission prevents release. No
          guaranteed DAO payout.
        </p>
        <p>
          Slot occupied or RPC unavailable?{" "}
          <a href="#journey">Recorded proof</a> and{" "}
          <code>node --test tests/e2e/e2e-replay.test.ts</code> are repeatable
          without a wallet or an available cycle.
          <a href="https://github.com/super-user-root/CommonsOps/blob/main/docs/testnet-journey.md#shared-demo-slot">
            {" "}
            Read the shared-slot and release guide.
          </a>
        </p>
      </aside>

      {snapshot ? (
        <>
          <div className="live-track-nav">
            <span className="live-track-hint">
              Select a template · swipe summaries on mobile
            </span>
            <button
              className="button secondary"
              type="button"
              aria-label="Previous template group"
              disabled={!snapshot.templates.length}
              onClick={() => pageTemplate(-1)}
            >
              ‹
            </button>
            <button
              className="button secondary"
              type="button"
              aria-label="Next template group"
              disabled={!snapshot.templates.length}
              onClick={() => pageTemplate(1)}
            >
              ›
            </button>
          </div>
          <div
            className="live-template-track"
            role="region"
            aria-label="Live registry templates, one summary per swipe"
            tabIndex={0}
            ref={trackRef}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                pageTemplate(event.key === "ArrowRight" ? 1 : -1);
              }
            }}
          >
            {snapshot.templates.map((read) => {
              const summary = availability?.find(
                (entry) => entry.templateId === read.templateId,
              );
              return (
                <article
                  className="live-card live-template-summary"
                  key={read.templateId}
                >
                  <h3 id={`live-template-${read.templateId}-heading`}>
                    Template {read.templateId}
                    {read.kind === "READY"
                      ? ` — ${read.template.input.title}`
                      : " — read failed"}
                  </h3>
                  <p>
                    {!fresh ? "Stale — signing disabled. " : ""}
                    {summary?.label ?? "Checking cycle availability…"}
                  </p>
                  {summary?.view ? (
                    <p>
                      {cycleHeading(summary.view.cycle)} ·{" "}
                      {formatYoctoNearExact(
                        summary.view.cycle.amount_yocto,
                      ).replace(/\.?(0+) NEAR$/, " NEAR")}
                    </p>
                  ) : null}
                  {read.kind === "ERROR" ? (
                    <p role={fresh ? "alert" : undefined}>
                      {read.code}: {read.message} No cycle availability is
                      inferred from failed reads.
                    </p>
                  ) : null}
                  {summary?.error && read.kind === "READY" ? (
                    <p role={fresh ? "alert" : undefined}>{summary.error}</p>
                  ) : null}
                  <button
                    className="button secondary"
                    type="button"
                    aria-expanded={selectedId === read.templateId}
                    aria-controls="live-selected-template"
                    onClick={() =>
                      chooseTemplate(
                        selectedId === read.templateId ? null : read.templateId,
                      )
                    }
                  >
                    {selectedId === read.templateId ? "Hide" : "View"} template{" "}
                    {read.templateId} details
                  </button>
                </article>
              );
            })}
          </div>
          <div id="live-selected-template">
            {selectedRead?.kind === "READY" && selectedAvailability ? (
              <LiveTemplateGroup
                key={selectedRead.templateId}
                read={selectedRead}
                availability={selectedAvailability}
                selection={selection}
                registryAccountId={registryAccountId}
                observedBlockTimestampNs={snapshot.block.timestampNs}
                fresh={fresh}
                snapshotAuthority={snapshotAuthority}
                evidence={evidence}
                recordRequest={recordRequest}
                onSent={() => void refresh()}
              />
            ) : selectedRead?.kind === "ERROR" ? (
              <p>
                Template {selectedRead.templateId} could not be verified.
                Re-read the live state to try again; other summaries remain
                accessible.
              </p>
            ) : (
              <p>
                {snapshot.templates.length
                  ? "Select a template to inspect its live details and actions."
                  : "No registered templates were returned at this final block."}
              </p>
            )}
          </div>
        </>
      ) : null}

      {evidence.records().length ? (
        <article
          className="live-card"
          aria-label="Transaction evidence from this browser"
        >
          <h3>Transaction evidence from this browser</h3>
          <p>
            Wallet-reported sends are retained across refreshes, including
            template read failures. They do not certify execution success or DAO
            payment.
          </p>
          {evidence.records().map((record, index) => (
            <p key={`${record.transactionHash}-${index}`}>
              <a href={record.explorerUrl} target="_blank" rel="noreferrer">
                {record.method}: {record.transactionHash}
              </a>
            </p>
          ))}
        </article>
      ) : null}

      <div className="live-grid live-handoffs">
        <article className="live-card" aria-labelledby="live-operator-heading">
          <h3 id="live-operator-heading">Operator methods — display-only</h3>
          <p>
            The operator provisions work outside this app; the contract enforces
            manager authorization.
          </p>
          <details className="proof-details">
            <summary>Manager methods and connected-account role</summary>
            <p>
              <code>create_template</code>, <code>materialize_cycle</code>,{" "}
              <code>set_template_active</code>,{" "}
              <code>skip_expired_periods</code> and <code>link_proposal</code>{" "}
              belong to the registry manager ( {managerId ?? "onchain manager"}
              ). They stay display-only in this workspace; the contract enforces
              manager authorization onchain regardless of what any UI offers.
            </p>
            {wallet.accountId && managerId ? (
              <p>
                {wallet.accountId === managerId
                  ? "The connected account is the registry manager. These methods still stay display-only in this workspace."
                  : "The connected account is not the registry manager."}
              </p>
            ) : null}
          </details>
        </article>

        <article className="live-card" aria-labelledby="live-dao-heading">
          <h3 id="live-dao-heading">DAO payout — not in this app</h3>
          <p>
            The Sputnik DAO keeps custody of payout funds and decides payment.
            CommonsOps retains storage collateral, not a payout treasury. A
            proposal link or an approval is not proof of payment. See the{" "}
            <a href="https://github.com/super-user-root/CommonsOps/blob/main/docs/testnet-journey.md">
              recorded journey in docs/testnet-journey.md
            </a>
            .
          </p>
        </article>
      </div>
    </section>
  );
}

function LiveTemplateGroup({
  read,
  availability,
  selection,
  registryAccountId,
  observedBlockTimestampNs,
  fresh,
  snapshotAuthority,
  evidence,
  recordRequest,
  onSent,
}: {
  read: Extract<LiveTemplateRead, { kind: "READY" }>;
  availability: TemplateAvailability;
  selection: TemplateSelection;
  registryAccountId: string;
  observedBlockTimestampNs: string;
  fresh: boolean;
  snapshotAuthority: SendAuthority;
  evidence: TransactionEvidence;
  recordRequest: (key: string, state: LiveRequestState) => void;
  onSent: () => void;
}) {
  const wallet = useLiveWallet();
  const derivation = useMemo(() => new LatestTask<DerivedActions>(), []);
  const derivedState = useSyncExternalStore(
    derivation.subscribe,
    derivation.getSnapshot,
    derivation.getSnapshot,
  );
  const [evidenceDraft, setEvidenceDraft] = useState(EMPTY_EVIDENCE_DRAFT);
  const inputAuthority = useMemo(() => new SendAuthority(), []);
  useEffect(() => () => inputAuthority.invalidate(), [inputAuthority]);

  const template = read.template;
  const templateId = read.templateId;
  const paused = read.paused;
  // Shared summary selection uses canonical derivation: prefer the connected
  // active claim, then an actual open/in-window cycle, else the newest read.
  const actionableCycle = availability.view?.cycle ?? null;

  const contextKey = JSON.stringify([
    registryAccountId,
    actionableCycle,
    observedBlockTimestampNs,
    wallet.accountId,
  ]);
  const inputKey = JSON.stringify([contextKey, evidenceDraft, fresh]);
  inputAuthority.update(inputKey);
  // The editor may retain the last validated cycle view for these same inputs;
  // its obsolete intents are never read by the send path.
  const evidenceEditable =
    fresh &&
    derivedState.data?.contextKey === contextKey &&
    derivedState.data.view.actions.submit_evidence.allowed;
  // Render-time key gating invalidates old intents BEFORE effects run.
  const derived = fresh ? derivation.current(inputKey) : null;
  const derivedError =
    fresh && derivedState.status === "ERROR" && derivedState.key === inputKey
      ? failureText(derivedState.error)
      : null;
  const sendGate = useRef({ inputKey, fresh, accountId: wallet.accountId });
  sendGate.current = { inputKey, fresh, accountId: wallet.accountId };
  const requestKey = (method: ContributorMethod) =>
    JSON.stringify([
      registryAccountId,
      templateId,
      actionableCycle?.key.period_index,
      method,
    ]);

  useEffect(() => {
    if (!actionableCycle || !fresh) {
      derivation.cancel();
      return;
    }
    const connectedAccountId = wallet.accountId;
    void derivation.run(inputKey, async () => {
      const view = await deriveContributorCycleView(
        actionableCycle,
        observedBlockTimestampNs,
        connectedAccountId,
      );
      const cycleMethods = CONTRIBUTOR_METHODS.filter(
        (method) => method !== "submit_evidence",
      );
      const intents: {
        -readonly [M in ContributorMethod]?: ContributorTransactionIntent;
      } = {};
      await Promise.all(
        cycleMethods.map(async (method) => {
          intents[method] = await contributorCycleIntent(
            registryAccountId,
            method,
            actionableCycle,
            observedBlockTimestampNs,
            connectedAccountId,
          );
        }),
      );
      let evidencePreview: Evidence | null = null;
      let evidenceError: string | null = null;
      if (view.actions.submit_evidence.allowed) {
        try {
          const preview = await evidenceSubmissionPreview(
            registryAccountId,
            actionableCycle,
            observedBlockTimestampNs,
            connectedAccountId,
            evidenceDraft,
          );
          evidencePreview = preview.evidence;
          intents.submit_evidence = preview.intent;
        } catch (error) {
          evidenceError =
            error instanceof Error ? error.message : String(error);
        }
      }
      return { contextKey, view, intents, evidencePreview, evidenceError };
    });
    return () => derivation.cancel();
  }, [
    derivation,
    inputKey,
    contextKey,
    fresh,
    actionableCycle,
    observedBlockTimestampNs,
    wallet.accountId,
    registryAccountId,
    evidenceDraft,
  ]);

  async function handleSend(method: ContributorMethod) {
    const gate = sendGate.current;
    const intent = derivation.current(gate.inputKey)?.intents[method];
    const key = requestKey(method);
    if (
      !gate.fresh ||
      !intent ||
      !gate.accountId ||
      !intent.actionAllowed ||
      evidence.get(key).status === "PENDING"
    )
      return;
    const selectionToken = selection.capture(templateId, gate.accountId);
    const snapshotToken = snapshotAuthority.capture(
      gate.accountId,
      () => selectionToken.valid() && sendGate.current.fresh,
    );
    const token = inputAuthority.capture(
      gate.accountId,
      () =>
        snapshotToken.valid() &&
        derivation.current(gate.inputKey) !== null &&
        sendGate.current.accountId === gate.accountId,
    );
    recordRequest(key, { status: "PENDING", method });
    const outcome = await settleWalletRequest(() =>
      wallet.sendIntent(intent, registryAccountId, token),
    );
    if (outcome.kind === "SUCCESS") {
      recordRequest(key, {
        status: "SUCCESS",
        method,
        transactionHash: outcome.transactionHash,
        explorerUrl: outcome.explorerUrl,
      });
      onSent();
      return;
    }
    recordRequest(
      key,
      outcome.kind === "REJECTED"
        ? { status: "REJECTED", method, detail: outcome.detail }
        : { status: "ERROR", method, message: outcome.message },
    );
  }

  return (
    <article
      className="live-template-group"
      aria-labelledby={`live-template-${templateId}-heading`}
    >
      <details className="proof-details">
        <summary>
          Template {templateId} — exact schedule, storage and cycle evidence
        </summary>
        <div className="live-grid">
          <article
            className="live-card"
            aria-labelledby={`live-template-${templateId}-detail-heading`}
          >
            <h3 id={`live-template-${templateId}-detail-heading`}>
              Template {template.id} — {template.input.title}
              {paused ? " (paused)" : ""}
            </h3>
            <p>{template.input.description}</p>
            <dl className="live-facts">
              <div>
                <dt>Manager (operator)</dt>
                <dd>{template.manager_id}</dd>
              </div>
              <div>
                <dt>Active</dt>
                <dd>{template.active ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>DAO (payout approver)</dt>
                <dd>{template.input.dao_account_id}</dd>
              </div>
              <div>
                <dt>Payout per cycle</dt>
                <dd>
                  {template.input.amount_yocto} yoctoNEAR{" "}
                  <small>
                    ({formatYoctoNearExact(template.input.amount_yocto)})
                  </small>
                </dd>
              </div>
              <div>
                <dt>Interval</dt>
                <dd>{template.input.interval_ns} ns</dd>
              </div>
              <div>
                <dt>Work window</dt>
                <dd>{template.input.work_window_ns} ns</dd>
              </div>
              <div>
                <dt>Claim duration</dt>
                <dd>{template.input.claim_duration_ns} ns</dd>
              </div>
              <div>
                <dt>Next period to materialize</dt>
                <dd>{template.next_period_index}</dd>
              </div>
            </dl>
          </article>

          {paused ? (
            <article
              className="live-card"
              aria-labelledby={`live-paused-${templateId}-heading`}
            >
              <h3 id={`live-paused-${templateId}-heading`}>Paused template</h3>
              <p>
                This template is paused onchain, so its cycles were not read and
                it offers no contributor actions here. The registry manager can
                resume it; re-read the live state after that to see its cycles.
              </p>
            </article>
          ) : (
            <>
              <article
                className="live-card"
                aria-labelledby={`live-latest-${templateId}-heading`}
              >
                <h3 id={`live-latest-${templateId}-heading`}>
                  {read.latestCycle
                    ? read.latestCycle.cycle
                      ? cycleHeading(read.latestCycle.cycle)
                      : `Period ${read.latestCycle.periodIndex}`
                    : "No earlier cycle"}
                </h3>
                {read.latestCycle?.cycle ? (
                  <LiveCycleFacts cycle={read.latestCycle.cycle} />
                ) : (
                  <p>
                    {read.latestCycle
                      ? `No cycle exists for period ${read.latestCycle.periodIndex} (it may have been skipped).`
                      : "No period of this template has been materialized yet."}
                  </p>
                )}
              </article>

              <article
                className="live-card"
                aria-labelledby={`live-next-${templateId}-heading`}
              >
                <h3 id={`live-next-${templateId}-heading`}>
                  {read.nextCycle?.cycle
                    ? cycleHeading(read.nextCycle.cycle)
                    : `Period ${read.template.next_period_index}`}
                </h3>
                {read.nextCycle?.cycle ? (
                  <LiveCycleFacts cycle={read.nextCycle.cycle} />
                ) : (
                  <p>
                    No cycle for period {read.template.next_period_index} yet —
                    nothing new is claimable on this template right now. The
                    registry operator materializes the next due period onchain;
                    this view re-reads the registry and will show it here.
                  </p>
                )}
              </article>
            </>
          )}
        </div>
      </details>

      {paused ? null : (
        <article
          className="live-card live-actions"
          aria-labelledby={`live-actions-${templateId}-heading`}
        >
          <h3 id={`live-actions-${templateId}-heading`}>
            Contributor actions for template {templateId} (wallet-signed)
          </h3>
          {evidenceEditable ? (
            <div className="live-evidence-inputs">
              {(
                [
                  ["repositoryOwner", "Repository owner"],
                  ["repositoryName", "Repository name"],
                  ["pullRequestNumber", "Pull request number"],
                  ["commitSha", "Commit SHA (40 hex characters)"],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={evidenceDraft[field]}
                    onChange={(event) => {
                      inputAuthority.invalidate();
                      setEvidenceDraft((draft) => ({
                        ...draft,
                        [field]: event.target.value,
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {!fresh ? (
            <p>
              Stale snapshot — contributor signing disabled until refreshed.
            </p>
          ) : !actionableCycle ? (
            <p>
              No cycle is available for actions in this app.{" "}
              {availability.label}.
              {availability.error ? ` ${availability.error}` : ""}
            </p>
          ) : !wallet.accountId ? (
            <>
              <p>
                Connect a testnet wallet to interact. The read-only views above
                work without one. When connected, actions target{" "}
                {cycleHeading(actionableCycle)} and your wallet signs every
                transaction — nothing is ever signed or sent for you.
              </p>
              <button
                className="button primary"
                type="button"
                onClick={(event) => void wallet.connect(event.currentTarget)}
              >
                Connect testnet wallet
              </button>
            </>
          ) : derivedError ? (
            <p role="alert">
              Live action derivation failed ({derivedError.code}):{" "}
              {derivedError.message} No transaction controls are shown for
              unverified state.
            </p>
          ) : !derived ? (
            <p>Deriving reviewed intents from the live cycle…</p>
          ) : (
            <>
              <p>
                Actions target {cycleHeading(actionableCycle)} (
                {derived.view.lifecycle.toLowerCase()} at the observed final
                block). Availability follows the reviewed construction; the
                contract enforces the rest onchain. Zero attached deposit on
                every contributor method; network gas still costs testnet NEAR
                (100 TGas prepaid). Submission is immutable and prevents
                release.
              </p>
              <div className="live-action-grid">
                {CONTRIBUTOR_METHODS.map((method) => {
                  const intent = derived.intents[method];
                  const availability = derived.view.actions[method];
                  const requestState = evidence.get(requestKey(method));
                  const sendable =
                    fresh &&
                    intent !== undefined &&
                    intent.actionAllowed &&
                    availability.allowed &&
                    !(method === "submit_evidence" && derived.evidenceError);
                  return (
                    <div className="live-action" key={method}>
                      <h4>{METHOD_LABELS[method]}</h4>
                      <p>
                        {availability.reason ??
                          "Available to your connected account."}
                      </p>
                      {method === "submit_evidence" && availability.allowed ? (
                        <div className="live-evidence-inputs">
                          {derived.evidenceError ? (
                            <p className="live-error" role="alert">
                              Evidence validation failed:{" "}
                              {derived.evidenceError}
                            </p>
                          ) : null}
                          {derived.evidencePreview ? (
                            <dl className="evidence-preview">
                              <div>
                                <dt>Canonical URL</dt>
                                <dd>{derived.evidencePreview.url}</dd>
                              </div>
                              <div>
                                <dt>Canonical SHA-256</dt>
                                <dd>{derived.evidencePreview.digest_sha256}</dd>
                              </div>
                            </dl>
                          ) : null}
                        </div>
                      ) : null}
                      <button
                        className="button primary"
                        type="button"
                        disabled={
                          !sendable || requestState.status === "PENDING"
                        }
                        onClick={() => void handleSend(method)}
                      >
                        {requestState.status === "PENDING"
                          ? "Waiting for wallet…"
                          : METHOD_LABELS[method]}
                      </button>
                      <p
                        className="live-request-state"
                        role="status"
                        aria-live="polite"
                      >
                        {describeLiveRequest(requestState)}
                      </p>
                      {requestState.status === "SUCCESS" ? (
                        <p>
                          <a
                            href={requestState.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View {requestState.method} on the testnet explorer
                          </a>
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </article>
      )}
    </article>
  );
}

function LiveCycleFacts({
  cycle,
}: {
  cycle: NonNullable<LiveCycleRead["cycle"]>;
}) {
  return (
    <>
      <p className="live-status-line">
        Status <strong>{cycle.status}</strong>
      </p>
      <dl className="live-facts">
        <div>
          <dt>Opens</dt>
          <dd>
            {cycle.opens_at_ns} ns{" "}
            <small>({nsToDate(cycle.opens_at_ns)})</small>
          </dd>
        </div>
        <div>
          <dt>Work deadline</dt>
          <dd>
            {cycle.deadline_at_ns} ns{" "}
            <small>({nsToDate(cycle.deadline_at_ns)})</small>
          </dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>
            {cycle.amount_yocto} yoctoNEAR{" "}
            <small>({formatYoctoNearExact(cycle.amount_yocto)})</small>
          </dd>
        </div>
        <div>
          <dt>Claimant</dt>
          <dd>{cycle.claim?.claimant_id ?? "Unclaimed"}</dd>
        </div>
        <div>
          <dt>Payout recipient</dt>
          <dd>
            {cycle.claim?.payout_recipient_id ?? "Assigned only by claiming"}
          </dd>
        </div>
        <div>
          <dt>Claim expires</dt>
          <dd>
            {cycle.claim
              ? `${cycle.claim.expires_at_ns} ns`
              : "No active claim"}
          </dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {cycle.evidence ? (
              <>
                <a href={cycle.evidence.url} target="_blank" rel="noreferrer">
                  {cycle.evidence.repository_owner}/
                  {cycle.evidence.repository_name}#
                  {cycle.evidence.pull_request_number}
                </a>{" "}
                <small className="exact-value">
                  {cycle.evidence.commit_sha}
                </small>
              </>
            ) : (
              "Not submitted"
            )}
          </dd>
        </div>
        <div>
          <dt>DAO proposal link</dt>
          <dd>
            {cycle.proposal_link
              ? `${cycle.proposal_link.key.dao_account_id} proposal ${cycle.proposal_link.key.proposal_id}`
              : "None"}
          </dd>
        </div>
      </dl>
      {cycle.proposal_link ? (
        <p className="live-status-line">
          Submitted evidence and payout recipient are immutable on this
          onchain-submitted cycle. Its proposal link does not establish payment;
          finalized causal payout receipts must be independently verified.
        </p>
      ) : null}
    </>
  );
}
