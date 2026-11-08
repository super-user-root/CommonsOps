import type { StatePattern } from "../../lib/fixture-journey.ts";

interface StatePatternGalleryProps {
  readonly patterns: readonly StatePattern[];
}

export function StatePatternGallery({ patterns }: StatePatternGalleryProps) {
  return (
    <section
      className="state-gallery section-shell"
      id="state-handling"
      tabIndex={-1}
      aria-labelledby="state-handling-heading"
    >
      <div className="section-intro split-intro">
        <div>
          <p className="eyebrow">State handling</p>
          <h2 id="state-handling-heading">
            Honest states, not assumed success.
          </h2>
        </div>
        <p>
          Live errors stay errors; stale snapshots cannot authorize signing.
          Approval is not payment. The expandable examples below are
          illustrative, not current network results; no live request ran for
          these examples.
        </p>
      </div>
      <details className="proof-details">
        <summary>
          Illustrative loading, empty, pending, error and verified-fixture
          states
        </summary>
        <div className="state-pattern-grid">
          {patterns.map((pattern) => (
            <article
              className={`state-pattern state-${pattern.key.toLowerCase()}`}
              key={pattern.key}
            >
              <p className="state-kicker">
                {pattern.key.replaceAll("_", " / ")}
              </p>
              <h3>{pattern.label}</h3>
              <div
                className="state-message"
                role={pattern.role}
                aria-live={pattern.role === "alert" ? "assertive" : "polite"}
                aria-atomic="true"
              >
                <span className="state-symbol" aria-hidden="true">
                  {pattern.role === "alert" ? "!" : "•"}
                </span>
                <span>{pattern.detail}</span>
              </div>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
