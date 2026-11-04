import type { StatePattern } from "../../lib/fixture-journey.ts";

interface StatePatternGalleryProps {
  readonly patterns: readonly StatePattern[];
}

export function StatePatternGallery({ patterns }: StatePatternGalleryProps) {
  return (
    <section
      className="state-gallery section-shell"
      id="state-handling"
      aria-labelledby="state-handling-heading"
    >
      <div className="section-intro split-intro">
        <div>
          <p className="eyebrow">State handling</p>
          <h2 id="state-handling-heading">Honest states before live reads.</h2>
        </div>
        <p>
          These are semantic rendering patterns for future integrations. Except
          for the explicitly verified fixture example, they do not describe a
          current network result. No live request ran.
        </p>
      </div>
      <div className="state-pattern-grid">
        {patterns.map((pattern) => (
          <article
            className={`state-pattern state-${pattern.key.toLowerCase()}`}
            key={pattern.key}
          >
            <p className="state-kicker">{pattern.key.replaceAll("_", " / ")}</p>
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
    </section>
  );
}
