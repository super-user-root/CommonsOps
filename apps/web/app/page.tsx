import { siteMetadata } from "../lib/site.ts";

export default function HomePage() {
  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#about" aria-label="CommonsOps overview">
          <span className="mark" aria-hidden="true">
            C
          </span>
          CommonsOps
        </a>
        <span className="status">Foundation / not live</span>
      </header>

      <section className="hero" id="about" aria-labelledby="heading">
        <p className="eyebrow">Community infrastructure · NEAR</p>
        <h1 id="heading">
          Keep the commons
          <br />
          <em>worth maintaining.</em>
        </h1>
        <p className="intro">
          Public documentation needs recurring care. CommonsOps is being built
          to connect that work to evidence and an existing Sputnik DAO treasury
          — without replacing community governance.
        </p>
        <a className="text-link" href="#foundation">
          What exists today <span aria-hidden="true">↘</span>
        </a>
      </section>

      <section
        className="foundation"
        id="foundation"
        aria-labelledby="foundation-heading"
      >
        <div>
          <p className="eyebrow">Current implementation</p>
          <h2 id="foundation-heading">A foundation, not a working registry.</h2>
          <p>
            This page is a static project overview. The repository contains a
            typed package scaffold, a minimal compilable NEAR contract, and
            local verification checks. Product workflows are not implemented.
          </p>
        </div>
        <dl className="facts">
          <div>
            <dt>Build stage</dt>
            <dd>{siteMetadata.stage}</dd>
          </div>
          <div>
            <dt>Live data</dt>
            <dd>{siteMetadata.liveData ? "Enabled" : "Not connected"}</dd>
          </div>
          <div>
            <dt>Transactions</dt>
            <dd>{siteMetadata.transactions ? "Enabled" : "Disabled"}</dd>
          </div>
        </dl>
      </section>

      <section className="boundaries" aria-labelledby="boundaries-heading">
        <p className="eyebrow" id="boundaries-heading">
          Intended boundaries · not implemented
        </p>
        <div className="cards">
          <article>
            <span className="number">01</span>
            <h3>Recurring care</h3>
            <p>
              Focus on public GitHub documentation maintenance, not a generic
              work marketplace.
            </p>
          </article>
          <article>
            <span className="number">02</span>
            <h3>Evidence before labels</h3>
            <p>
              Future work must verify exact onchain execution. A proposal
              approval alone is not payment proof.
            </p>
          </article>
          <article>
            <span className="number">03</span>
            <h3>Governance stays put</h3>
            <p>
              The existing Sputnik DAO keeps approval authority and custody.
              CommonsOps does not hold treasury funds.
            </p>
          </article>
        </div>
      </section>
      <footer>
        <span>CommonsOps · Foundation scaffold</span>
        <span>No wallet. No live records. No transactions.</span>
      </footer>
    </main>
  );
}
