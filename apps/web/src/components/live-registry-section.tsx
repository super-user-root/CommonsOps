"use client";

// Live registry surface: read-only JSON-RPC reads of commonsops.testnet plus
// contributor transactions signed by the connected wallet. Every state is
// honest — loading, named errors, wallet rejection ("no request sent"), and
// submitted transactions with explorer links. No simulated success, no
// fabricated data, and the DAO payout flow stays out of the app.
//
// Every registered template is enumerated (sequential ids until the registry
// returns none, capped); each template gets its own card group and its own
// wallet-signed contributor actions bound to that template's live cycles.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LiveRpcError } from "../../lib/live/rpc.ts";
import {
  describeLiveRequest,
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

const IDLE_REQUESTS: Readonly<Record<ContributorMethod, LiveRequestState>> =
  Object.freeze({
    claim_cycle: Object.freeze({ status: "IDLE" }),
    release_claim: Object.freeze({ status: "IDLE" }),
    expire_cycle_or_claim: Object.freeze({ status: "IDLE" }),
    submit_evidence: Object.freeze({ status: "IDLE" }),
  });

type ReadState =
  | { readonly status: "LOADING" }
  | { readonly status: "READY"; readonly snapshot: LiveRegistrySnapshot }
  | {
      readonly status: "ERROR";
      readonly code: string;
      readonly message: string;
    };

interface DerivedActions {
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
  const [readState, setReadState] = useState<ReadState>({ status: "LOADING" });

  const config = useMemo(() => assertTestnet("testnet"), []);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Carousel paging for the mobile template track: one group per swipe.
  const scrollTrack = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" });
  }, []);

  const refresh = useCallback(async () => {
    setReadState({ status: "LOADING" });
    try {
      const snapshot = await fetchLiveRegistrySnapshot(
        config,
        registryAccountId,
      );
      setReadState({ status: "READY", snapshot });
    } catch (error) {
      const failure = failureText(error);
      setReadState({ status: "ERROR", ...failure });
    }
  }, [config, registryAccountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const snapshot = readState.status === "READY" ? readState.snapshot : null;
  const managerId = useMemo(() => {
    for (const read of snapshot?.templates ?? []) {
      if (read.kind === "READY") return read.template.manager_id;
    }
    return null;
  }, [snapshot]);

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
          This section reads the deployed registry{" "}
          <code>{registryAccountId}</code> directly from your browser via
          read-only JSON-RPC at NEAR testnet final blocks — no wallet needed.
          Every registered template is enumerated, each with its latest existing
          cycle and its next period. Connect a testnet wallet and each active
          template's contributor actions become sendable: your wallet signs, the
          transaction goes to the registry, and the result links to the
          explorer. The DAO payout flow stays outside this app (see{" "}
          <a href="https://github.com/super-user-root/CommonsOps/blob/main/docs/testnet-journey.md">
            docs/testnet-journey.md
          </a>
          ).
        </p>
      </div>

      <div className="live-meta" role="status" aria-live="polite">
        {readState.status === "LOADING" ? (
          <p>Querying {registryAccountId} at a NEAR testnet final block…</p>
        ) : null}
        {readState.status === "ERROR" ? (
          <p className="live-error" role="alert">
            Live read failed ({readState.code}): {readState.message} No fallback
            data is shown.
          </p>
        ) : null}
        {snapshot ? (
          <>
            <p>
              Observed final block{" "}
              <span className="exact-value">{snapshot.block.height}</span> at{" "}
              <span className="exact-value">
                {snapshot.block.timestampNs} ns
              </span>{" "}
              ({nsToDate(snapshot.block.timestampNs)}). Read-only JSON-RPC to{" "}
              <code>{config.nodeUrl}</code>. Foundation status:{" "}
              <code>{snapshot.foundationStatus}</code>
              {snapshot.enumerationComplete
                ? ""
                : " — template enumeration stopped at the cap; more templates may exist onchain."}
            </p>
          </>
        ) : null}
        <button
          className="button secondary"
          type="button"
          onClick={() => void refresh()}
        >
          {readState.status === "LOADING" ? "Reading…" : "Re-read live state"}
        </button>
      </div>

      {snapshot ? (
        <>
          <div className="live-track-nav">
            <span className="live-track-hint" aria-hidden="true">
              One template per swipe
            </span>
            <button
              className="button secondary"
              type="button"
              aria-label="Previous template group"
              onClick={() => scrollTrack(-1)}
            >
              ‹
            </button>
            <button
              className="button secondary"
              type="button"
              aria-label="Next template group"
              onClick={() => scrollTrack(1)}
            >
              ›
            </button>
          </div>
          <div
            className="live-template-track"
            role="region"
            aria-label="Live registry templates, one group per swipe"
            tabIndex={0}
            ref={trackRef}
          >
            {snapshot.templates.map((read) =>
              read.kind === "READY" ? (
                <LiveTemplateGroup
                  key={read.templateId}
                  read={read}
                  registryAccountId={registryAccountId}
                  observedBlockTimestampNs={snapshot.block.timestampNs}
                  onSent={() => void refresh()}
                />
              ) : (
                <article
                  className="live-card live-template-error"
                  key={read.templateId}
                  role="alert"
                >
                  <h3>Template {read.templateId} — read failed</h3>
                  <p>
                    {read.code}: {read.message} No fallback data is shown, and
                    templates after this one were not read. Re-read the live
                    state to try again.
                  </p>
                </article>
              ),
            )}
          </div>
        </>
      ) : null}

      <div className="live-grid">
        <article className="live-card" aria-labelledby="live-operator-heading">
          <h3 id="live-operator-heading">Operator methods — display-only</h3>
          <p>
            <code>create_template</code>, <code>materialize_cycle</code>,{" "}
            <code>set_template_active</code>, <code>skip_expired_periods</code>{" "}
            and <code>link_proposal</code> belong to the registry manager ({" "}
            {managerId ?? "onchain manager"}). They stay display-only in this
            workspace; the contract enforces manager authorization onchain
            regardless of what any UI offers.
          </p>
          {wallet.accountId && managerId ? (
            <p>
              {wallet.accountId === managerId
                ? "The connected account is the registry manager. These methods still stay display-only in this workspace."
                : "The connected account is not the registry manager."}
            </p>
          ) : null}
        </article>

        <article className="live-card" aria-labelledby="live-dao-heading">
          <h3 id="live-dao-heading">DAO payout — not in this app</h3>
          <p>
            The Sputnik DAO keeps custody and approves payouts inside its own
            governance. CommonsOps never holds funds and this app never
            simulates a payout: a DAO member creates the transfer proposal in
            the DAO, and the registry links it one-time onchain. The recorded
            end-to-end payout is documented in{" "}
            <code>docs/testnet-journey.md</code> and rendered as the recorded
            reviewer stage below.
          </p>
        </article>
      </div>
    </section>
  );
}

function LiveTemplateGroup({
  read,
  registryAccountId,
  observedBlockTimestampNs,
  onSent,
}: {
  read: Extract<LiveTemplateRead, { kind: "READY" }>;
  registryAccountId: string;
  observedBlockTimestampNs: string;
  onSent: () => void;
}) {
  const wallet = useLiveWallet();
  const [derived, setDerived] = useState<DerivedActions | null>(null);
  const [derivedError, setDerivedError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState(EMPTY_EVIDENCE_DRAFT);
  const [requestStates, setRequestStates] = useState(IDLE_REQUESTS);

  const template = read.template;
  const templateId = read.templateId;
  const paused = read.paused;
  // The actions target this template's newest live cycle: the next period's
  // cycle once materialized (e.g. the judge-demo 2:0 OPEN), otherwise the
  // latest existing one.
  const actionableCycle = paused
    ? null
    : (read.nextCycle?.cycle ?? read.latestCycle?.cycle ?? null);

  useEffect(() => {
    if (!actionableCycle) {
      setDerived(null);
      return;
    }
    let cancelled = false;
    const connectedAccountId = wallet.accountId;
    void (async () => {
      try {
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
        if (cancelled) return;
        setDerived({
          view,
          intents,
          evidencePreview,
          evidenceError,
        });
      } catch (error) {
        if (cancelled) return;
        // Honest derivation failure: no intents, named reason.
        setDerived(null);
        setDerivedError(failureText(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    actionableCycle,
    observedBlockTimestampNs,
    wallet.accountId,
    registryAccountId,
    evidenceDraft,
  ]);

  async function handleSend(method: ContributorMethod) {
    const intent = derived?.intents[method];
    if (!intent || !wallet.accountId) return;
    setRequestStates((previous) => ({
      ...previous,
      [method]: { status: "PENDING", method } as LiveRequestState,
    }));
    const outcome = await wallet.sendIntent(intent, registryAccountId);
    if (outcome.kind === "SUCCESS") {
      setRequestStates((previous) => ({
        ...previous,
        [method]: {
          status: "SUCCESS",
          method,
          transactionHash: outcome.transactionHash,
          explorerUrl: outcome.explorerUrl,
        } as LiveRequestState,
      }));
      // Re-query the live registry so the view reflects the signed outcome.
      onSent();
      return;
    }
    setRequestStates((previous) => ({
      ...previous,
      [method]:
        outcome.kind === "REJECTED"
          ? ({
              status: "REJECTED",
              method,
              detail: outcome.detail,
            } as LiveRequestState)
          : ({
              status: "ERROR",
              method,
              message: outcome.message,
            } as LiveRequestState),
    }));
  }

  return (
    <article
      className="live-template-group"
      aria-labelledby={`live-template-${templateId}-heading`}
    >
      <div className="live-grid">
        <article
          className="live-card"
          aria-labelledby={`live-template-${templateId}-heading`}
        >
          <h3 id={`live-template-${templateId}-heading`}>
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

      {paused ? null : (
        <article
          className="live-card live-actions"
          aria-labelledby={`live-actions-${templateId}-heading`}
        >
          <h3 id={`live-actions-${templateId}-heading`}>
            Contributor actions for template {templateId} (wallet-signed)
          </h3>
          {!actionableCycle ? (
            <p>
              No cycle of this template can be acted on yet — the actions appear
              once a cycle exists.
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
                onClick={() => void wallet.connect()}
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
                every contributor method.
              </p>
              <div className="live-action-grid">
                {CONTRIBUTOR_METHODS.map((method) => {
                  const intent = derived.intents[method];
                  const availability = derived.view.actions[method];
                  const requestState = requestStates[method];
                  const sendable =
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
                          <label>
                            Repository owner
                            <input
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              value={evidenceDraft.repositoryOwner}
                              onChange={(event) =>
                                setEvidenceDraft((draft) => ({
                                  ...draft,
                                  repositoryOwner: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Repository name
                            <input
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              value={evidenceDraft.repositoryName}
                              onChange={(event) =>
                                setEvidenceDraft((draft) => ({
                                  ...draft,
                                  repositoryName: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Pull request number
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              spellCheck={false}
                              value={evidenceDraft.pullRequestNumber}
                              onChange={(event) =>
                                setEvidenceDraft((draft) => ({
                                  ...draft,
                                  pullRequestNumber: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label>
                            Commit SHA (40 hex characters)
                            <input
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              value={evidenceDraft.commitSha}
                              onChange={(event) =>
                                setEvidenceDraft((draft) => ({
                                  ...draft,
                                  commitSha: event.target.value,
                                }))
                              }
                            />
                          </label>
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
          onchain-submitted cycle; the DAO payout is recorded in{" "}
          <code>docs/testnet-journey.md</code>.
        </p>
      ) : null}
    </>
  );
}
