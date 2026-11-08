// Client-only loader for the NEAR wallet selector. The wallet packages are
// imported dynamically inside the factory so the server/SSR bundle never
// evaluates them and no network, key, or wallet code runs until a live
// section actually asks for it. No private keys are handled in app code:
// signing happens entirely inside the user's chosen wallet.

import { assertTestnet, type LiveNetworkConfig } from "./network.ts";
import {
  accessibleWalletChooser,
  WALLET_MODAL_ROOT_ID,
  type WalletChooser,
} from "./wallet-modal-accessibility.ts";

export interface WalletSelectorBundle {
  readonly selector: import("@near-wallet-selector/core").WalletSelector;
  readonly modal: import("@near-wallet-selector/modal-ui").WalletSelectorModal;
  readonly chooser: WalletChooser;
}

export async function createTestnetWalletSelector(
  networkId: string,
): Promise<WalletSelectorBundle> {
  // Mainnet (and any non-testnet id) is refused before any package loads.
  const config: LiveNetworkConfig = assertTestnet(networkId);

  const [core, myNearWallet, meteorWallet, hereWallet, modalUi] =
    await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/my-near-wallet"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/here-wallet"),
      import("@near-wallet-selector/modal-ui"),
    ]);

  const selector = await core.setupWalletSelector({
    // Full network object: pins the official testnet RPC endpoint instead of
    // the selector's third-party fallback preset.
    network: {
      networkId: config.networkId,
      nodeUrl: config.nodeUrl,
      helperUrl: config.helperUrl,
      explorerUrl: config.explorerUrl,
      indexerUrl: config.indexerUrl,
    },
    modules: [
      myNearWallet.setupMyNearWallet(),
      meteorWallet.setupMeteorWallet(),
      hereWallet.setupHereWallet(),
    ],
  });
  const modal = modalUi.setupModal(selector, {});
  const root = document.getElementById(WALLET_MODAL_ROOT_ID);
  if (!root)
    throw new Error(
      "ERR_WALLET_MODAL_ROOT: wallet chooser could not be initialized",
    );
  const chooser = accessibleWalletChooser(modal, root);
  return Object.freeze({ selector, modal, chooser });
}
