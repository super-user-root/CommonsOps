import { foundationMetadata } from "@commonsops/domain";

export const siteMetadata = Object.freeze({
  title: `${foundationMetadata.name} | Testnet workspace`,
  description:
    "A testnet-first workspace for recurring community documentation maintenance with an existing NEAR Sputnik DAO. The live registry section reads the deployed testnet registry over read-only RPC, and a connected wallet signs its own transactions; CommonsOps never holds keys or funds and the DAO keeps payouts.",
  stage: "live testnet workspace" as const,
  liveData: true,
  transactions: true,
});
