# Testnet deployment preparation

This directory records public, non-secret deployment provenance for the reviewed CommonsOps registry artifact. No key, seed phrase, access-key file, signed transaction or submission PII belongs here.

## Safety boundary

Preparation and read-only smoke tools are committed. Creating/funding an account, signing the atomic deploy+init transaction, spending testnet NEAR and broadcasting require direct human confirmation of the exact network, signer, account, actions, deposit/gas and expected effect.

The deployment must be one atomic transaction to the contract account with ordered actions:

1. `DeployContract` with the reviewed WASM.
2. `FunctionCall` `new` with `{"manager_id":"<manager.testnet>","network":"TESTNET"}`, 50 Tgas, 0 NEAR deposit.

The constructor accepts only `signer == predecessor == current_account_id`, so the contract account's full-access key must sign this transaction. Do not deploy code separately and leave it uninitialized.

## Prepare

Use an existing funded named testnet account controlled by the human. The preparer queries its one full-access public key, next nonce, recent finalized block and pre-deployment account/code state read-only. It refuses multiple full-access keys so key selection cannot be implicit.

From repo root after a reviewed release build:

### Git Bash / POSIX

```text
export COMMONSOPS_SOURCE_HEAD=<reviewed-full-sha>
node --test scripts/deployment-lib.test.mjs
node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]
```

### PowerShell

```text
$env:COMMONSOPS_SOURCE_HEAD = '<reviewed-full-sha>'
node --test scripts/deployment-lib.test.mjs
node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]
```

The current preparer reads the checkout HEAD itself and fails unless it exactly equals the accepted source SHA; `COMMONSOPS_SOURCE_HEAD` is retained only as an operator cross-check in documentation and is not trusted by the script. It fails unless the local WASM exactly matches the reviewed hash and size, copies the bytes to a content-addressed ignored path, rehashes them, and builds both Bash and PowerShell `sign-later` commands against that immutable copy. Nonce is the selected full-access key's next nonce and the block hash is recent/pinned to the account pre-state.

The generated manifest is ignored and incomplete until a separately human-confirmed transaction is signed/broadcast and its finalized transaction/receipts/post-deployment block+code fields are added. `pnpm smoke:testnet -- <account.testnet>` rejects incomplete provenance and then verifies the exact finalized actions/bytes/receipts and pinned onchain code read-only.

## Read-only smoke after deployment

Record transaction/receipt IDs and deployed code hash in the manifest, then run the read-only smoke tool against the exact account. Verify the onchain code hash corresponds to the reviewed WASM and `foundation_status`/view methods respond. Gas and storage observations from the actual transaction belong in the final provenance report.
