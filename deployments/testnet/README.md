# Testnet deployment preparation

This directory records public, non-secret deployment provenance for the reviewed CommonsOps registry artifact. No key, seed phrase, access-key file, signed transaction or submission PII belongs here.

## Safety boundary

Preparation and read-only smoke tools are committed. Creating/funding an account, signing the atomic deploy+init transaction, spending testnet NEAR and broadcasting require direct human confirmation of the exact network, signer, account, actions, deposit/gas and expected effect.

The deployment must be one atomic transaction to the contract account with ordered actions:

1. `DeployContract` with the reviewed WASM.
2. `FunctionCall` `new` with `{"manager_id":"<manager.testnet>","network":"TESTNET"}`, 50 Tgas, 0 NEAR deposit.

The constructor accepts only `signer == predecessor == current_account_id`, so the contract account's full-access key must sign this transaction. Do not deploy code separately and leave it uninitialized.

## Prepare

From repo root after a reviewed release build:

```text
set COMMONSOPS_SOURCE_HEAD=<reviewed-full-sha>
node --test scripts/deployment-lib.test.mjs
node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]
```

This validates named testnet accounts, hashes the local WASM and writes `prepared-deployment.json`. It prints a `near ... sign-later` command requiring a fresh public key nonce and block hash. Running that command only creates an unsigned transaction file; it still requires the human's direct confirmation before any later signing/broadcast.

## Read-only smoke after deployment

Record transaction/receipt IDs and deployed code hash in the manifest, then run the read-only smoke tool against the exact account. Verify the onchain code hash corresponds to the reviewed WASM and `foundation_status`/view methods respond. Gas and storage observations from the actual transaction belong in the final provenance report.
