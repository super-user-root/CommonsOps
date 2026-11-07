"use client";

// Header connect/disconnect control for the live testnet surface. When no
// wallet is connected the button opens the wallet selector modal; when
// connected it shows the real account id and offers disconnect. Every phase
// is labeled truthfully — the workspace never pretends a wallet is present.

import { useLiveWallet } from "./live-wallet-provider.tsx";

export function HeaderWalletButton() {
  const wallet = useLiveWallet();

  if (wallet.phase === "ERROR") {
    return (
      <span className="wallet-error-note" role="status">
        Wallet failed to load: {wallet.error}
      </span>
    );
  }

  if (wallet.accountId) {
    return (
      <span className="header-wallet-connected">
        <span className="account-chip" title="Connected testnet account">
          {wallet.accountId}
        </span>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            void wallet.disconnect();
          }}
        >
          Disconnect
        </button>
      </span>
    );
  }

  return (
    <button
      className="button primary"
      type="button"
      id="wallet-connect-button"
      aria-haspopup="dialog"
      disabled={wallet.phase === "INITIALIZING"}
      onClick={() => {
        void wallet.connect();
      }}
    >
      {wallet.phase === "INITIALIZING"
        ? "Preparing wallet…"
        : "Connect testnet wallet"}
    </button>
  );
}
