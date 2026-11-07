"use client";

// React context for the live testnet wallet. The selector loads lazily on
// the first user action (dynamic imports only — the SSR build stays clean),
// account state mirrors the selector store, and every send is performed by
// the user's own wallet. No private keys exist in this application.

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  FinalExecutionOutcome,
  WalletSelector,
} from "@near-wallet-selector/core";
import { LIVE_NETWORK_ID } from "../../lib/live/network.ts";
import {
  contributorWalletTransaction,
  sendContributorIntent,
  toWalletSelectorTransaction,
  type SendOutcome,
  type WalletTransaction,
} from "../../lib/live/transactions.ts";
import {
  createTestnetWalletSelector,
  type WalletSelectorBundle,
} from "../../lib/live/wallet.ts";

export type LiveWalletPhase = "IDLE" | "INITIALIZING" | "READY" | "ERROR";

export interface LiveWalletContextValue {
  readonly phase: LiveWalletPhase;
  readonly error: string | null;
  readonly accountId: string | null;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly sendIntent: (
    intent: Parameters<typeof contributorWalletTransaction>[0],
    registryAccountId: string,
  ) => Promise<SendOutcome>;
}

const LiveWalletContext = createContext<LiveWalletContextValue | null>(null);

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "unknown wallet error");
}

export function LiveWalletProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<LiveWalletPhase>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const bundleRef = useRef<WalletSelectorBundle | null>(null);
  const initRef = useRef<Promise<WalletSelectorBundle> | null>(null);

  const syncAccounts = useCallback((selector: WalletSelector) => {
    const accounts = selector.store.getState().accounts;
    const active =
      accounts.find((account) => account.active) ??
      accounts.find((account) => account.accountId);
    setAccountId(
      typeof active?.accountId === "string" && active.accountId.length > 0
        ? active.accountId
        : null,
    );
  }, []);

  const ensureSelector =
    useCallback(async (): Promise<WalletSelectorBundle> => {
      if (bundleRef.current) return bundleRef.current;
      if (!initRef.current) {
        initRef.current = createTestnetWalletSelector(LIVE_NETWORK_ID)
          .then((bundle) => {
            bundleRef.current = bundle;
            syncAccounts(bundle.selector);
            bundle.selector.store.observable.subscribe(() => {
              syncAccounts(bundle.selector);
            });
            setPhase("READY");
            setError(null);
            return bundle;
          })
          .catch((initError) => {
            initRef.current = null;
            setPhase("ERROR");
            setError(failureMessage(initError));
            throw initError;
          });
        setPhase("INITIALIZING");
      }
      return initRef.current;
    }, [syncAccounts]);

  const connect = useCallback(async () => {
    try {
      const { modal } = await ensureSelector();
      modal.show();
    } catch {
      /* phase and error already recorded by ensureSelector */
    }
  }, [ensureSelector]);

  const disconnect = useCallback(async () => {
    try {
      const bundle = bundleRef.current;
      if (bundle) {
        const wallet = await bundle.selector.wallet();
        await wallet.signOut();
        syncAccounts(bundle.selector);
      }
    } catch (signOutError) {
      setError(failureMessage(signOutError));
    }
  }, [syncAccounts]);

  const sendIntent = useCallback(
    async (
      intent: Parameters<typeof contributorWalletTransaction>[0],
      registryAccountId: string,
    ): Promise<SendOutcome> => {
      const bundle = await ensureSelector();
      const wallet = await bundle.selector.wallet();
      return sendContributorIntent(
        async (transaction: WalletTransaction) => {
          const selectorTransaction =
            await toWalletSelectorTransaction(transaction);
          const result = await wallet.signAndSendTransactions({
            transactions: [selectorTransaction],
          });
          return result as readonly FinalExecutionOutcome[];
        },
        intent,
        registryAccountId,
      );
    },
    [ensureSelector],
  );

  useEffect(() => {
    return () => {
      initRef.current = null;
      bundleRef.current = null;
    };
  }, []);

  const value = useMemo<LiveWalletContextValue>(
    () => ({
      phase,
      error,
      accountId,
      connect,
      disconnect,
      sendIntent,
    }),
    [phase, error, accountId, connect, disconnect, sendIntent],
  );

  return (
    <LiveWalletContext.Provider value={value}>
      {children}
    </LiveWalletContext.Provider>
  );
}

export function useLiveWallet(): LiveWalletContextValue {
  const value = useContext(LiveWalletContext);
  if (!value) {
    throw new Error("useLiveWallet must be used inside LiveWalletProvider");
  }
  return value;
}
