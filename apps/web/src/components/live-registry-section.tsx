"use client";

// Live registry surface: read-only JSON-RPC reads of commonsops.testnet plus
// contributor transactions signed by the connected wallet. Every state is
// honest — loading, named errors, wallet rejection ("no request sent"), and
// submitted transactions with explorer links. No simulated success, no
// fabricated data, and the DAO payout flow stays out of the app.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  LATEST_PERIOD_INDEX,
  type LiveRegistrySnapshot,
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
  const [derived, setDerived] = useState<DerivedActions | null>(null);
  const [derivedError, setDerivedError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [evidenceDraft, setEvidenceDraft] = useState(EMPTY_EVIDENCE_DRAFT);
  const [requestStates, setRequestStates] = useState(IDLE_REQUESTS);

  const config = useMemo(() => assertTestnet("testnet"), []);

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
  // The actions target the newest live cycle that exists: the next period's
  // cycle once materialized, otherwise the latest recorded one.
  const actionableCycle = snapshot
    ? (snapshot.nextCycle ?? snapshot.latestCycle)
    : null;

  useEffect(() => {
    if (!snapshot || !actionableCycle) {
      setDerived(null);
      return;
    }
    let cancelled = false;
    const observedBlockTimestampNs = snapshot.block.timestampNs;
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
    snapshot,
    actionableCycle,
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
      void refresh();
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

  const template = snapshot?.template ?? null;
  const nextPeriodIndex = template?.next_period_index ?? null;

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
          Connect a testnet wallet and the contributor actions below become
          sendable: your wallet signs, the transaction goes to the registry, and
          the result links to the explorer. The DAO payout flow stays outside
          this app (see{" "}
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
          <p>
            Observed final block{" "}
            <span className="exact-value">{snapshot.block.height}</span> at{" "}
            <span className="exact-value">{snapshot.block.timestampNs} ns</span>{" "}
            ({nsToDate(snapshot.block.timestampNs)}). Read-only JSON-RPC to{" "}
            <code>{config.nodeUrl}</code>.
          </p>
        ) : null}
        <button
          className="button secondary"
          type="button"
          onClick={() => void refresh()}
        >
          {readState.status === "LOADING" ? "Reading…" : "Re-read live state"}
        </button>
      </div>

      {snapshot && template ? (
        <div className="live-grid">
          <article
            className="live-card"
            aria-labelledby="live-template-heading"
          >
            <h3 id="live-template-heading">
              Template {template.id} — {template.input.title}
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
            <p className="live-status-line">
              <code>{snapshot.foundationStatus}</code>
            </p>
          </article>

          <article
            className="live-card"
            aria-labelledby="live-latest-cycle-heading"
          >
            <h3 id="live-latest-cycle-heading">
              {snapshot.latestCycle
                ? cycleHeading(snapshot.latestCycle)
                : `Cycle ${LATEST_PERIOD_INDEX === "0" ? `0:${LATEST_PERIOD_INDEX}` : "0:0"}`}
            </h3>
            {snapshot.latestCycle ? (
              <LiveCycleFacts cycle={snapshot.latestCycle} />
            ) : (
              <p>No cycle exists for period 0.</p>
            )}
          </article>

          <article
            className="live-card"
            aria-labelledby="live-next-cycle-heading"
          >
            <h3 id="live-next-cycle-heading">
              Period {nextPeriodIndex ?? "—"}
            </h3>
            {snapshot.nextCycle ? (
              <LiveCycleFacts cycle={snapshot.nextCycle} />
            ) : (
              <p>
                No cycle for period {nextPeriodIndex ?? "?"} yet — nothing new
                is claimable right now. The registry operator materializes the
                next due period onchain; this view re-reads the registry and
                will show it here.
              </p>
            )}
          </article>
        </div>
      ) : null}

      <article
        className="live-card live-actions"
        aria-labelledby="live-actions-heading"
      >
        <h3 id="live-actions-heading">Contributor actions (wallet-signed)</h3>
        {!snapshot || !actionableCycle ? (
          <p>
            Live actions need a successful registry read.{" "}
            {readState.status === "ERROR"
              ? "Fix the read error above and retry."
              : "Wait for the read to finish."}
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
              contract enforces the rest onchain. Zero attached deposit on every
              contributor method.
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
                            Evidence validation failed: {derived.evidenceError}
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
                      disabled={!sendable || requestState.status === "PENDING"}
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

      <div className="live-grid">
        <article className="live-card" aria-labelledby="live-operator-heading">
          <h3 id="live-operator-heading">Operator methods — display-only</h3>
          <p>
            <code>create_template</code>, <code>materialize_cycle</code>,{" "}
            <code>set_template_active</code>, <code>skip_expired_periods</code>{" "}
            and <code>link_proposal</code> belong to the registry manager ({" "}
            {template?.manager_id ?? "onchain manager"}). They stay display-only
            in this workspace; the contract enforces manager authorization
            onchain regardless of what any UI offers.
          </p>
          {wallet.accountId && template ? (
            <p>
              {wallet.accountId === template.manager_id
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

function LiveCycleFacts({
  cycle,
}: {
  cycle: NonNullable<LiveRegistrySnapshot["latestCycle"]>;
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
