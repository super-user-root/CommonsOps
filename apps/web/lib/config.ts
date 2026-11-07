import type { AccountId, Cycle, Network, Template } from "@commonsops/domain";
import type { PaymentState } from "@commonsops/near";

export interface AdapterFoundationMetadata {
  readonly stage: "foundation";
  readonly networkConfigured: false;
  readonly walletConnected: false;
  readonly liveReadsEnabled: false;
  readonly transactionsEnabled: false;
}

export const adapterFoundationMetadata: AdapterFoundationMetadata =
  Object.freeze({
    stage: "foundation",
    networkConfigured: false,
    walletConnected: false,
    liveReadsEnabled: false,
    transactionsEnabled: false,
  });

export interface AppNetworkConfig {
  readonly network: Network;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly registryAccountId: AccountId | null;
  readonly deployed: boolean;
}

// The testnet registry is deployed and the full journey is recorded in
// docs/testnet-journey.md. The live registry section performs read-only
// JSON-RPC reads against the pinned testnet RPC and sends contributor
// transactions signed by the connected wallet (see lib/live/). Mainnet stays
// isolated and unconfigured, so its reads and signing keep failing closed.
export const networkConfigs: Readonly<Record<Network, AppNetworkConfig>> =
  Object.freeze({
    TESTNET: Object.freeze({
      network: "TESTNET",
      rpcUrl: "https://rpc.testnet.near.org",
      explorerUrl: "https://testnet.nearblocks.io",
      registryAccountId: "commonsops.testnet",
      deployed: true,
    }),
    MAINNET: Object.freeze({
      network: "MAINNET",
      rpcUrl: "https://rpc.mainnet.near.org",
      explorerUrl: "https://nearblocks.io",
      registryAccountId: null,
      deployed: false,
    }),
  });

export interface RegistryReadState {
  readonly network: Network;
  readonly contractAccountId: AccountId | null;
  readonly status: "UNCONFIGURED" | "LOADING" | "READY" | "ERROR";
  readonly templates: readonly Template[];
  readonly cycles: readonly Cycle[];
  readonly paymentStates: Readonly<Record<string, PaymentState>>;
  readonly error: string | null;
}

export function emptyRegistryReadState(network: Network): RegistryReadState {
  const config = networkConfigs[network];
  return Object.freeze({
    network,
    contractAccountId: config.registryAccountId,
    status: config.deployed ? "LOADING" : "UNCONFIGURED",
    templates: Object.freeze([]),
    cycles: Object.freeze([]),
    paymentStates: Object.freeze({}),
    error: null,
  });
}
