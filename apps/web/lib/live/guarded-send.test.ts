import assert from "node:assert/strict";
import test from "node:test";
import {
  SendAuthority,
  guardedWalletSend,
  sendContributorIntent,
  type WalletTransaction,
} from "./transactions.ts";
import type { ContributorTransactionIntent } from "../../src/features/contributor/contributor.ts";
const tx: WalletTransaction = { receiverId: "commonsops.testnet", actions: [] };
const intent = {
  receiverId: "commonsops.testnet",
  method: "claim_cycle",
  args: { cycle_key: { template_id: "2", period_index: "0" } },
  attachedDepositYocto: "0",
  network: "TESTNET",
  actionAllowed: true,
  signingEnabled: false,
  disabledReason: "preview",
} satisfies ContributorTransactionIntent;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
test("deferred init/selection/conversion never signs after input, refresh, account or unmount invalidation", async () => {
  for (const phase of ["init", "selection", "conversion"]) {
    for (const change of [
      "input",
      "refresh",
      "account",
      "unmount",
      "freshness",
    ]) {
      const authority = new SendAuthority();
      authority.update("snapshot/account-A/input-X");
      const gate = deferred<void>();
      const entered = deferred<void>();
      let currentSigner = "alice.testnet";
      let signs = 0;
      let fresh = true;
      const token = authority.capture("alice.testnet", () => fresh);
      const pause = async (step: string) => {
        if (step === phase) {
          entered.resolve();
          await gate.promise;
        }
      };
      const send = sendContributorIntent(
        (transaction) =>
          guardedWalletSend(transaction, token, {
            prepare: async () => {
              await pause("init");
              return "selector";
            },
            select: async () => {
              await pause("selection");
              return "wallet";
            },
            convert: async (transaction) => {
              await pause("conversion");
              return transaction;
            },
            currentSigner: () => currentSigner,
            sign: async () => {
              signs++;
              return [];
            },
          }),
        intent,
        "commonsops.testnet",
      );
      await entered.promise;
      if (change === "account") currentSigner = "bob.testnet";
      else if (change === "freshness") fresh = false;
      else authority.invalidate();
      gate.resolve();
      const outcome = await send;
      assert.equal(outcome.kind, "ERROR");
      assert.equal(signs, 0, `${phase}/${change}`);
    }
  }
});
test("generation prevents switch-back reuse; valid preparation binds intended signer and signs once", async () => {
  const authority = new SendAuthority();
  authority.update("X");
  const obsolete = authority.capture("alice.testnet", () => true);
  authority.update("Y");
  authority.update("X");
  assert.equal(obsolete.valid(), false);
  let checks = 0;
  let accountChecks = 0;
  const token = authority.capture("alice.testnet", () => {
    checks++;
    return true;
  });
  let signs = 0;
  await guardedWalletSend(tx, token, {
    prepare: async () => "selector",
    select: async () => "wallet",
    convert: async (transaction) => transaction,
    currentSigner: () => {
      accountChecks++;
      return "alice.testnet";
    },
    sign: async (_wallet, transaction, signerId) => {
      assert.strictEqual(transaction, tx);
      assert.equal(signerId, "alice.testnet");
      signs++;
      return [];
    },
  });
  assert.equal(signs, 1);
  assert.equal(checks, 4); // Entry + after each of three preparation awaits.
  assert.equal(accountChecks, 3);
});
