import { foundationMetadata } from "@commonsops/domain";
import { adapterFoundationMetadata } from "@commonsops/near";

export const siteMetadata = Object.freeze({
  title: `${foundationMetadata.name} | Foundation`,
  description:
    "A foundation for recurring community documentation maintenance with an existing NEAR Sputnik DAO. No live data or transactions.",
  stage: foundationMetadata.stage,
  liveData: adapterFoundationMetadata.liveReadsEnabled,
  transactions: adapterFoundationMetadata.transactionsEnabled,
});
