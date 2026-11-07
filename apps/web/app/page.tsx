import {
  createWalletBoundary,
  emptyRegistryReadState,
  networkConfigs,
} from "../lib/config.ts";
import {
  buildFixtureJourney,
  fixtureJourneyConstants,
} from "../lib/fixture-journey.ts";
import { siteMetadata } from "../lib/site.ts";
import { ContributorPanel } from "../src/components/contributor-panel.tsx";
import { OperatorPanel } from "../src/components/operator-panel.tsx";
import { ReviewerPanel } from "../src/components/reviewer-panel-client.tsx";
import { StatePatternGallery } from "../src/components/state-pattern-gallery.tsx";

const testnetWallet = createWalletBoundary("TESTNET");
const walletReason =
  testnetWallet.state.status === "UNAVAILABLE"
    ? testnetWallet.state.reason
    : "Wallet signing is not available.";
const mainnetState = emptyRegistryReadState("MAINNET");

export default async function HomePage() {
  const journey = await buildFixtureJourney();
  const [createIntent, materializeIntent] = journey.operator.intents;
  if (!createIntent || !materializeIntent) {
    throw new Error("ERR_FIXTURE_OPERATOR_INTENTS");
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <main id="main-content" tabIndex={-1}>
        <header className="masthead">
          <a
            className="wordmark"
            href="#workspace"
            aria-label="CommonsOps workspace home"
          >
            <span className="mark" aria-hidden="true">
              C
            </span>
            CommonsOps
          </a>
          <nav className="journey-nav" aria-label="Recorded journey">
            <a href="#operator-stage">Operator</a>
            <a href="#contributor-stage">Contributor</a>
            <a href="#reviewer-stage">Reviewer</a>
            <a href="#state-handling">States</a>
          </nav>
          <div className="header-actions">
            <span className="network-badge testnet">Testnet workspace</span>
            <button
              className="button secondary"
              type="button"
              disabled
              aria-describedby="wallet-disabled-reason"
            >
              Wallet unavailable
            </button>
            <span id="wallet-disabled-reason" className="visually-hidden">
              {walletReason}
            </span>
          </div>
        </header>

        <section
          className="hero compact"
          id="workspace"
          aria-labelledby="heading"
        >
          <p className="eyebrow">Social Money · recurring maintenance</p>
          <h1 id="heading">
            Follow the work.
            <br />
            <em>Verify the payout.</em>
          </h1>
          <p className="intro">
            CommonsOps coordinates recurring public documentation work, freezes
            contributor evidence on NEAR, and keeps approval and funds inside an
            existing Sputnik DAO.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#operator-stage">
              Explore the recorded journey
            </a>
            <span className="microcopy">
              Read-only snapshots of the recorded live journey. No wallet
              signature or transaction is available.
            </span>
          </div>
          <aside
            className="fixture-banner"
            aria-labelledby="fixture-banner-title"
          >
            <span className="fixture-number" aria-hidden="true">
              01—03
            </span>
            <div>
              <h2 id="fixture-banner-title">
                Recorded live journey · NEAR testnet
              </h2>
              <p>
                {journey.provenance.notice} Values are the exact recorded
                onchain data, imported in place. No clock, random value, wallet,
                RPC, or GitHub request is used.
              </p>
            </div>
          </aside>
        </section>

        <section
          className="network-panel"
          id="network-status"
          aria-labelledby="network-heading"
        >
          <div>
            <p className="eyebrow">Connection boundary</p>
            <h2 id="network-heading">Choose evidence, not assumptions.</h2>
            <p>
              Testnet and mainnet remain separate configurations. The CommonsOps
              registry is deployed on testnet (
              {networkConfigs.TESTNET.registryAccountId}); mainnet stays
              isolated and unconfigured. This workspace still performs no live
              RPC and no signing — the journey below imports the recorded
              onchain data in place.
            </p>
          </div>
          <div className="network-grid" aria-label="Network configurations">
            <article className="network-card selected">
              <div className="card-heading">
                <span className="dot" aria-hidden="true" />
                Testnet
              </div>
              <strong>{networkConfigs.TESTNET.registryAccountId}</strong>
              <p>{networkConfigs.TESTNET.rpcUrl}</p>
              <span className="pill">
                Registry deployed · no in-app RPC by design
              </span>
            </article>
            <article className="network-card muted-card">
              <div className="card-heading">
                <span className="dot muted" aria-hidden="true" />
                Mainnet
              </div>
              <strong>{mainnetState.status}</strong>
              <p>{networkConfigs.MAINNET.rpcUrl}</p>
              <span className="pill">Disabled · isolated config</span>
            </article>
          </div>
        </section>

        <section
          className="journey-section section-shell"
          aria-labelledby="journey-heading"
        >
          <div className="section-intro split-intro">
            <div>
              <p className="eyebrow">Recorded journey</p>
              <h2 id="journey-heading">Three roles. Three frozen stages.</h2>
            </div>
            <p>
              This walkthrough renders the recorded testnet journey through the
              reviewed vertical slice. Each role receives an immutable snapshot
              of the recorded stage; later evidence never mutates the earlier
              operator or contributor preview.
            </p>
          </div>

          <article
            className="journey-stage"
            id="operator-stage"
            aria-labelledby="operator-stage-heading"
            tabIndex={-1}
          >
            <div className="stage-rail" aria-hidden="true">
              <span>01</span>
              <span className="rail-line" />
            </div>
            <div className="stage-content">
              <header className="stage-heading">
                <p className="stage-role">Operator</p>
                <div>
                  <h3 id="operator-stage-heading">
                    Define the recurring work.
                  </h3>
                  <p>
                    Registered template 0 on testnet: exact integer wire values
                    produce unsigned create and materialize intents. The intents
                    stay disabled — no wallet is integrated by design; the
                    executed transactions are recorded in
                    docs/testnet-journey.md.
                  </p>
                </div>
              </header>
              <div className="panel-stack">
                <OperatorPanel
                  draft={journey.operator.draft}
                  intent={createIntent}
                  state={journey.operator.requestState}
                  headingId="operator-create-heading"
                  headingLevel={4}
                  eyebrow="Recorded template 0 · Testnet"
                />
                <OperatorPanel
                  draft={journey.operator.draft}
                  intent={materializeIntent}
                  state={journey.operator.requestState}
                  headingId="operator-materialize-heading"
                  headingLevel={4}
                  eyebrow="Exact materialize preview · Testnet"
                />
              </div>
            </div>
          </article>

          <article
            className="journey-stage"
            id="contributor-stage"
            aria-labelledby="contributor-stage-heading"
            tabIndex={-1}
          >
            <div className="stage-rail" aria-hidden="true">
              <span>02</span>
              <span className="rail-line" />
            </div>
            <div className="stage-content">
              <header className="stage-heading">
                <p className="stage-role">Contributor</p>
                <div>
                  <h3 id="contributor-stage-heading">
                    Bind the claim and evidence.
                  </h3>
                  <p>
                    The recorded CLAIMED cycle 0:0, observed at block timestamp{" "}
                    <span className="exact-value">
                      {journey.contributor.observedBlockTimestampNs} ns
                    </span>{" "}
                    (the recorded claim block). Claimant and payout recipient
                    are the same account; all four reviewed intent previews
                    remain unsigned and disabled — the executed transactions are
                    recorded in docs/testnet-journey.md.
                  </p>
                </div>
              </header>
              <ContributorPanel
                view={journey.contributor.view}
                connectedAccountId={journey.contributor.connectedAccountId}
                evidenceDraft={journey.contributor.evidenceDraft}
                evidencePreview={journey.contributor.evidencePreview}
                intents={journey.contributor.intents}
                requestState={journey.contributor.requestState}
                idScope="contributor-fixture"
                headingLevel={4}
              />
            </div>
          </article>

          <article
            className="journey-stage"
            id="reviewer-stage"
            aria-labelledby="reviewer-stage-heading"
            tabIndex={-1}
          >
            <div className="stage-rail" aria-hidden="true">
              <span>03</span>
              <span className="rail-line" />
            </div>
            <div className="stage-content">
              <header className="stage-heading">
                <p className="stage-role">Reviewer</p>
                <div>
                  <h3 id="reviewer-stage-heading">
                    Trace approval to a verified payout.
                  </h3>
                  <p>
                    This separate immutable SUBMITTED + linked cycle is paired
                    with the recorded proposal-0 payout receipt graph — the
                    executed transaction{" "}
                    <span className="exact-value">
                      {fixtureJourneyConstants.transactionHash}
                    </span>
                    . The canonical adapter—not browser state—derives PAID and
                    preserves its full provenance.
                  </p>
                </div>
              </header>

              <aside className="nonpayment-boundary" role="status">
                <strong>Approved alone is not payment.</strong>
                <span>
                  The approved-only rendering derives{" "}
                  <b>{journey.reviewer.approvedOnlyModel.payment.state}</b>:{" "}
                  {journey.reviewer.approvedOnlyModel.payment.reason}
                </span>
              </aside>

              <ReviewerPanel
                model={journey.reviewer.model}
                requestState={journey.reviewer.requestState}
                idScope="recorded-proposal-0"
                headingLevel={4}
              />

              <p className="fixture-source-note">
                <strong>Recorded-snapshot provenance:</strong>{" "}
                <code>{journey.provenance.fixtureSource}</code> is the recorded
                EXPERIMENTAL_tx_status response for the executed payout,
                imported in place and passed through{" "}
                <code>buildReviewerModel</code>. It was not copied, edited, or
                presented as a current RPC read; re-derive it live with{" "}
                <code>node scripts/reconcile-live.mjs</code>. Verified
                transaction{" "}
                <span className="exact-value">
                  {fixtureJourneyConstants.transactionHash}
                </span>
                .
              </p>
            </div>
          </article>
        </section>

        <StatePatternGallery patterns={journey.statePatterns} />

        <section className="truth-panel" aria-labelledby="truth-heading">
          <div>
            <p className="eyebrow">Implemented today</p>
            <h2 id="truth-heading">
              Contract and verifier foundations are real. Live operations are
              not.
            </h2>
            <p>
              The workspace renders the recorded live journey through reviewed
              construction and verification logic. It still does not enable a
              wallet, run RPC, or make any network request; live verification
              stays in the read-only scripts.
            </p>
          </div>
          <dl className="facts">
            <div>
              <dt>Journey data</dt>
              <dd>Recorded live journey</dd>
            </div>
            <div>
              <dt>Live registry</dt>
              <dd>{networkConfigs.TESTNET.registryAccountId} — deployed</dd>
            </div>
            <div>
              <dt>Wallet signing</dt>
              <dd>Disabled</dd>
            </div>
            <div>
              <dt>Current stage</dt>
              <dd>{siteMetadata.stage}</dd>
            </div>
          </dl>
        </section>

        <footer>
          <span>CommonsOps · Testnet-first workspace</span>
          <span>No keys. No fabricated records. No transaction controls.</span>
        </footer>
      </main>
    </>
  );
}
