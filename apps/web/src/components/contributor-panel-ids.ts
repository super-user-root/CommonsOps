import type { ContributorMethod } from "../features/contributor/contributor.ts";

export interface ContributorPanelIds {
  readonly scope: string;
  readonly heading: string;
  readonly bindingHeading: string;
  readonly evidenceReason: string;
  readonly commitShaLabel: string;
  readonly actionReasons: Readonly<Record<ContributorMethod, string>>;
}

function safeIdPart(value: string, field: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const safe = normalized.replace(/^-+|-+$/g, "");
  if (!safe) throw new Error(`${field}: nonempty ID scope required`);
  return safe;
}

export function contributorPanelIds(idScope: string): ContributorPanelIds {
  const scope = safeIdPart(idScope, "idScope");
  return Object.freeze({
    scope,
    heading: `${scope}-heading`,
    bindingHeading: `${scope}-binding-heading`,
    evidenceReason: `${scope}-evidence-disabled-reason`,
    commitShaLabel: `${scope}-commit-sha-label`,
    actionReasons: Object.freeze({
      claim_cycle: `${scope}-disabled-claim_cycle`,
      release_claim: `${scope}-disabled-release_claim`,
      expire_cycle_or_claim: `${scope}-disabled-expire_cycle_or_claim`,
      submit_evidence: `${scope}-disabled-submit_evidence`,
    }),
  });
}
