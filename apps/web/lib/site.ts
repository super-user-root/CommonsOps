import { foundationMetadata } from "@commonsops/domain";

export const siteMetadata = Object.freeze({
  title: `${foundationMetadata.name} | Testnet workspace`,
  description:
    "Work evidence and DAO payout attribution for recurring public maintenance on NEAR testnet. Recorded proof is separate from live reads and wallet-signed contributor actions. No keys in app code. The DAO keeps payout funds; the registry retains storage collateral. No automatic work-quality verification.",
  stage: "live testnet workspace" as const,
  liveData: true,
  transactions: true,
});
