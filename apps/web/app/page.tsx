import { emptyRegistryReadState, networkConfigs } from "../lib/config.ts";
import {
  buildFixtureJourney,
  fixtureJourneyConstants,
} from "../lib/fixture-journey.ts";
import { siteMetadata } from "../lib/site.ts";
import { ContributorPanel } from "../src/components/contributor-panel.tsx";
import { HeaderWalletButton } from "../src/components/header-wallet-button.tsx";
import { LiveRegistrySection } from "../src/components/live-registry-section.tsx";
import { LiveWalletProvider } from "../src/components/live-wallet-provider.tsx";
import { OperatorPanel } from "../src/components/operator-panel.tsx";
import { ReviewerPanel } from "../src/components/reviewer-panel-client.tsx";
import { StatePatternGallery } from "../src/components/state-pattern-gallery.tsx";

const mainnetState = emptyRegistryReadState("MAINNET");

export default async function HomePage() {
  const journey = await buildFixtureJourney();
  const [createIntent, materializeIntent] = journey.operator.intents;
  if (!createIntent || !materializeIntent) {
    throw new Error("ERR_FIXTURE_OPERATOR_INTENTS");
  }
  const registryAccountId = networkConfigs.TESTNET.registryAccountId;
  if (!registryAccountId) {
    throw new Error("ERR_TESTNET_REGISTRY_UNCONFIGURED");
  }

  return (
    <LiveWalletProvider>
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
          <nav className="journey-nav" aria-label="Primary">
            <a href="#live-registry">Live registry</a>
            <a href="#journey">Journey</a>
            <a href="#state-handling">State handling</a>
          </nav>
          <div className="header-actions">
            <a
              className="github-link"
              href="https://github.com/super-user-root/CommonsOps"
              aria-label="CommonsOps repository on GitHub"
              title="CommonsOps on GitHub"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="currentColor"
                focusable="false"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
            <span className="network-badge testnet">Testnet workspace</span>
            <HeaderWalletButton />
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
            <a className="button primary" href="#live-registry">
              Open the live registry
            </a>
            <span className="microcopy">
              The stages below stay read-only snapshots of the recorded live
              journey. Live testnet reads and wallet-signed transactions live in
              the live registry section.
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
                onchain data, imported in place. No clock, random value, or
                GitHub request is used.
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
              {networkConfigs.TESTNET.registryAccountId}): the live section
              below reads it over read-only RPC at final blocks, and connected
              wallets sign their own transactions. Mainnet stays isolated and
              unconfigured; mainnet attempts are refused in code.
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
                Registry deployed · live reads + wallet-signed transactions
              </span>
            </article>
            <article className="network-card muted-card">
              <div className="card-heading">
                <span className="dot muted" aria-hidden="true" />
                Mainnet
              </div>
              <strong>{mainnetState.status}</strong>
              <p>{networkConfigs.MAINNET.rpcUrl}</p>
              <span className="pill">Disabled · refused in code</span>
            </article>
          </div>
        </section>

        <LiveRegistrySection registryAccountId={registryAccountId} />

        <section
          className="journey-section section-shell"
          id="journey"
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
                    produce unsigned create and materialize intents. These
                    recorded stages stay immutable — the executed transactions
                    are recorded in docs/testnet-journey.md, and today's
                    operator methods remain display-only in the live section
                    above.
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
                    are the same account; the recorded intent previews remain
                    unsigned snapshots — the executed transactions are recorded
                    in docs/testnet-journey.md and today's live, wallet-signed
                    equivalents are in the live section above.
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
              Live testnet reads, wallet-signed transactions, recorded payout
              proof.
            </h2>
            <p>
              The workspace reads the deployed registry over testnet RPC and
              sends contributor transactions signed by the connected wallet.
              There are still no keys in the app, no custody, and no simulated
              success: the DAO keeps governance and payouts, and every submitted
              transaction links to the explorer.
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
              <dd>Your wallet, your signature (testnet)</dd>
            </div>
            <div>
              <dt>DAO payouts</dt>
              <dd>Out of the app, inside the DAO</dd>
            </div>
            <div>
              <dt>Current stage</dt>
              <dd>{siteMetadata.stage}</dd>
            </div>
          </dl>
        </section>

        <footer>
          <nav className="footer-columns" aria-label="Footer">
            <div>
              <p className="footer-heading">Explore</p>
              <a href="#live-registry">Live registry</a>
              <a href="#journey">Recorded journey</a>
              <a href="#state-handling">State handling</a>
              <a href="https://github.com/super-user-root/CommonsOps/blob/main/demo/README.md">
                Demo guide
              </a>
            </div>
            <div>
              <p className="footer-heading">Try it</p>
              <a href="https://github.com/super-user-root/CommonsOps">
                GitHub repository
              </a>
              <a href="https://explorer.testnet.near.org/accounts/commonsops.testnet">
                Registry on the explorer
              </a>
              <a href="https://github.com/super-user-root/CommonsOps/blob/main/docs/testnet-journey.md">
                Journey record
              </a>
            </div>
            <div>
              <p className="footer-heading">Project</p>
              <a href="https://github.com/super-user-root/CommonsOps/blob/main/LICENSE">
                MIT License
              </a>
              <a href="https://nearhackathon.com/HACKATHON.md">
                Live hackathon rules
              </a>
            </div>
          </nav>
          <div className="footer-legal">
            <span>Built at NEAR HACKATHON · NEAR testnet only</span>
            <span>
              No keys. No fabricated records. DAO payouts stay in the DAO.
            </span>
            <span>CommonsOps · Testnet-first workspace</span>
          </div>
        </footer>
      </main>
    </LiveWalletProvider>
  );
}
