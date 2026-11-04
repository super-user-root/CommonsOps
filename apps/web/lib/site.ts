import { foundationMetadata } from "@commonsops/domain";
import { adapterFoundationMetadata } from "@commonsops/near";

export const siteMetadata = Object.freeze({
  title: `${foundationMetadata.name} | Testnet workspace`,
  description:
    "A testnet-first workspace for recurring community documentation maintenance with an existing NEAR Sputnik DAO. Wallet signing remains disabled until a reviewed deployment and connector are configured.",
  stage: "workspace foundation" as const,
  liveData: adapterFoundationMetadata.liveReadsEnabled,
  transactions: adapterFoundationMetadata.transactionsEnabled,
});
