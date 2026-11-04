import {
  createWalletBoundary,
  emptyRegistryReadState,
  networkConfigs,
} from "../lib/config.ts";
import { siteMetadata } from "../lib/site.ts";

const testnetWallet = createWalletBoundary("TESTNET");
const walletReason =
  testnetWallet.state.status === "UNAVAILABLE"
    ? testnetWallet.state.reason
    : "Wallet signing is not available.";
const testnetState = emptyRegistryReadState("TESTNET");
const mainnetState = emptyRegistryReadState("MAINNET");

export default function HomePage() {
  return (
    <main>
      <header className="masthead">
        <a
          className="wordmark"
          href="#workspace"
          aria-label="CommonsOps workspace"
        >
          <span className="mark" aria-hidden="true">
            C
          </span>
          CommonsOps
        </a>
        <div className="header-actions">
          <span className="network-badge testnet">Testnet workspace</span>
          <button
            className="button secondary"
            type="button"
            disabled
            title={walletReason}
          >
            Wallet unavailable
          </button>
        </div>
      </header>

      <section
        className="hero compact"
        id="workspace"
        aria-labelledby="heading"
      >
        <p className="eyebrow">Social Money · recurring maintenance</p>
        <h1 id="heading">
          Make essential work
          <br />
          <em>visible and fundable.</em>
        </h1>
        <p className="intro">
          CommonsOps coordinates recurring public documentation work, freezes
          contributor evidence on NEAR, and keeps approval and funds inside an
          existing Sputnik DAO.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="#network-status">
            Inspect workspace
          </a>
          <span className="microcopy">
            No wallet signature or transaction is available yet.
          </span>
        </div>
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
            Testnet and mainnet remain separate configurations. Neither has a
            deployed CommonsOps registry account, so reads and signing fail
            closed.
          </p>
        </div>
        <div className="network-grid">
          <article className="network-card selected">
            <div className="card-heading">
              <span className="dot" />
              Testnet
            </div>
            <strong>{testnetState.status}</strong>
            <p>{networkConfigs.TESTNET.rpcUrl}</p>
            <span className="pill">Development target</span>
          </article>
          <article className="network-card muted-card">
            <div className="card-heading">
              <span className="dot muted" />
              Mainnet
            </div>
            <strong>{mainnetState.status}</strong>
            <p>{networkConfigs.MAINNET.rpcUrl}</p>
            <span className="pill">Disabled</span>
          </article>
        </div>
      </section>

      <section className="workspace-grid" aria-label="Workspace status">
        <article className="workspace-card">
          <p className="eyebrow">Operator</p>
          <h3>Recurring templates</h3>
          <p>
            Create, pause, and materialize fixed-interval documentation cycles
            after the reviewed contract is deployed.
          </p>
          <div className="empty-state">No registry configured</div>
        </article>
        <article className="workspace-card">
          <p className="eyebrow">Contributor</p>
          <h3>Claim and evidence</h3>
          <p>
            A claimant will submit a canonical GitHub pull request and commit
            SHA. Recipient identity stays bound to the claimant.
          </p>
          <div className="empty-state">No active cycles</div>
        </article>
        <article className="workspace-card">
          <p className="eyebrow">DAO reviewer</p>
          <h3>Payment evidence</h3>
          <p>
            Proposal approval alone is not payment. The adapter verifies the
            proposal and causal transfer receipt before showing PAID.
          </p>
          <div className="state-row">
            <span>Verifier</span>
            <strong>Fixture-tested</strong>
          </div>
        </article>
      </section>

      <section className="truth-panel" aria-labelledby="truth-heading">
        <div>
          <p className="eyebrow">Implemented today</p>
          <h2 id="truth-heading">
            Contract and verifier foundations are real. Live operations are not.
          </h2>
        </div>
        <dl className="facts">
          <div>
            <dt>Contract methods</dt>
            <dd>Locally verified</dd>
          </div>
          <div>
            <dt>Live registry</dt>
            <dd>Not deployed</dd>
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
  );
}
