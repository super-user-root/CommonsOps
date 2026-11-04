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

export const networkConfigs: Readonly<Record<Network, AppNetworkConfig>> =
  Object.freeze({
    TESTNET: Object.freeze({
      network: "TESTNET",
      rpcUrl: "https://rpc.testnet.near.org",
      explorerUrl: "https://testnet.nearblocks.io",
      registryAccountId: null,
      deployed: false,
    }),
    MAINNET: Object.freeze({
      network: "MAINNET",
      rpcUrl: "https://rpc.mainnet.near.org",
      explorerUrl: "https://nearblocks.io",
      registryAccountId: null,
      deployed: false,
    }),
  });

export type WalletState =
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | { readonly status: "DISCONNECTED"; readonly network: Network }
  | {
      readonly status: "CONNECTED";
      readonly network: Network;
      readonly accountId: AccountId;
    };

export interface WalletBoundary {
  readonly state: WalletState;
  readonly canRead: boolean;
  readonly canSign: boolean;
  readonly connect: () => Promise<never>;
  readonly sign: () => Promise<never>;
}

export function createWalletBoundary(network: Network): WalletBoundary {
  const config = networkConfigs[network];
  const reason = config.deployed
    ? "No supported wallet connector is configured."
    : `No ${network.toLowerCase()} registry deployment is configured.`;
  const reject = () => Promise.reject(new Error(`WALLET_DISABLED: ${reason}`));
  return Object.freeze({
    state: Object.freeze({ status: "UNAVAILABLE" as const, reason }),
    canRead: false,
    canSign: false,
    connect: reject,
    sign: reject,
  });
}

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
