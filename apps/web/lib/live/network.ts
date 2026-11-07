// Network boundary for the live testnet surface. Testnet is the only network
// this workspace configures; every other network id (including mainnet)
// resolves to null and any attempt to use it throws. No private keys, seeds,
// or signing material exist anywhere in this module or the app.

export type LiveNetworkId = "testnet";

export interface LiveNetworkConfig {
  readonly networkId: LiveNetworkId;
  readonly nodeUrl: string;
  readonly helperUrl: string;
  readonly explorerUrl: string;
  readonly indexerUrl: string;
}

export const LIVE_NETWORK_ID: LiveNetworkId = "testnet";

// Pinned full NEAR wallet-selector network object. The selector's "testnet"
// preset points at a third-party fallback RPC, so the node URL is pinned
// explicitly to the official testnet RPC endpoint.
const TESTNET_CONFIG: LiveNetworkConfig = Object.freeze({
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  helperUrl: "https://helper.testnet.near.org",
  explorerUrl: "https://testnet.nearblocks.io",
  indexerUrl: "https://test.api.fastnear.com/v0",
});

// Mainnet is deliberately unconfigured: null means "refuse", and every
// code path that would touch a network must go through assertTestnet().
const MAINNET_CONFIG: null = null;

export function liveNetworkConfigFor(
  networkId: string,
): LiveNetworkConfig | null {
  if (networkId === LIVE_NETWORK_ID) {
    return TESTNET_CONFIG;
  }
  // mainnet — and anything that is not testnet — stays null and unusable.
  return MAINNET_CONFIG;
}

export class MainnetRefusedError extends Error {
  readonly code = "ERR_MAINNET_REFUSED";
  readonly networkId: string;

  constructor(networkId: string) {
    super(
      `ERR_MAINNET_REFUSED: network '${networkId}' is not configured. This workspace is testnet-only; mainnet is refused by design.`,
    );
    this.name = "MainnetRefusedError";
    this.networkId = networkId;
  }
}

export function assertTestnet(networkId: string): LiveNetworkConfig {
  const config = liveNetworkConfigFor(networkId);
  if (!config) {
    throw new MainnetRefusedError(networkId);
  }
  return config;
}

const transactionHashPattern = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export function isValidTransactionHash(value: unknown): value is string {
  return typeof value === "string" && transactionHashPattern.test(value);
}

export function explorerTransactionUrl(transactionHash: string): string {
  if (!isValidTransactionHash(transactionHash)) {
    throw new Error("ERR_INVALID_TX_HASH: not a NEAR transaction hash");
  }
  return `https://explorer.testnet.near.org/transactions/${transactionHash}`;
}

export function explorerAccountUrl(accountId: string): string {
  if (!/^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(accountId)) {
    throw new Error("ERR_INVALID_ACCOUNT_ID: not a NEAR account id");
  }
  return `https://explorer.testnet.near.org/accounts/${accountId}`;
}
