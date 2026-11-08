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
  guardedWalletSend,
  activeSelectorAccount,
  SendAuthority,
  type SendToken,
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
    token: SendToken,
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
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const sendAuthority = useMemo(() => new SendAuthority(), []);

  const syncAccounts = useCallback(
    (selector: WalletSelector) => {
      const accounts = selector.store.getState().accounts;
      const active = activeSelectorAccount(accounts);
      sendAuthority.update(active ?? "disconnected");
      setAccountId(active);
    },
    [sendAuthority],
  );

  const ensureSelector =
    useCallback(async (): Promise<WalletSelectorBundle> => {
      if (bundleRef.current) return bundleRef.current;
      if (!initRef.current) {
        initRef.current = createTestnetWalletSelector(LIVE_NETWORK_ID)
          .then((bundle) => {
            if (!mountedRef.current) {
              bundle.chooser.dispose();
              throw new Error("ERR_WALLET_UNMOUNTED");
            }
            bundleRef.current = bundle;
            syncAccounts(bundle.selector);
            const subscription = bundle.selector.store.observable.subscribe(
              () => {
                syncAccounts(bundle.selector);
              },
            );
            unsubscribeRef.current = () => subscription.unsubscribe();
            setPhase("READY");
            setError(null);
            return bundle;
          })
          .catch((initError) => {
            initRef.current = null;
            if (mountedRef.current) {
              setPhase("ERROR");
              setError(failureMessage(initError));
            }
            throw initError;
          });
        setPhase("INITIALIZING");
      }
      return initRef.current;
    }, [syncAccounts]);

  const connect = useCallback(async () => {
    // Save the actual trigger before lazy initialization can move focus to BODY.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    try {
      const { chooser } = await ensureSelector();
      if (mountedRef.current) chooser.show(opener);
    } catch (connectError) {
      if (mountedRef.current) {
        setError(failureMessage(connectError));
        setPhase("ERROR");
      }
    }
  }, [ensureSelector]);

  const disconnect = useCallback(async () => {
    sendAuthority.invalidate();
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
      token: SendToken,
    ): Promise<SendOutcome> => {
      const guardedToken = sendAuthority.capture(token.signerId, token.valid);
      return sendContributorIntent(
        (transaction: WalletTransaction) =>
          guardedWalletSend(transaction, guardedToken, {
            prepare: ensureSelector,
            select: (bundle) => bundle.selector.wallet(),
            convert: toWalletSelectorTransaction,
            currentSigner: (bundle) =>
              activeSelectorAccount(bundle.selector.store.getState().accounts),
            sign: async (wallet, converted, signerId) => {
              const result = await wallet.signAndSendTransactions({
                transactions: [{ ...converted, signerId }],
              });
              return result as readonly FinalExecutionOutcome[];
            },
          }),
        intent,
        registryAccountId,
      );
    },
    [ensureSelector, sendAuthority],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendAuthority.invalidate();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      bundleRef.current?.chooser.dispose();
      initRef.current = null;
      bundleRef.current = null;
    };
  }, [sendAuthority]);

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
