# Testnet journey — live evidence record

This page records the first complete CommonsOps journey executed on NEAR
testnet: a recurring-work cycle registered, claimed, evidenced, paid through a
Sputnik DAO, and reconciled to **PAID** from causal chain data. Every
identifier is public onchain data; no keys or personal data appear here.

- Network: `testnet` (chain id `testnet`)
- Registry contract: `commonsops.testnet`
- Sputnik DAO: `commonsops-dao.sputnikv2.testnet` (factory `sputnikv2.testnet`, version `2.3.1`, code hash `AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH`)
- Roles: `commonsops.testnet` acted as registry manager, contributor (claimant = payout recipient), and DAO council — the MVP demo arrangement

## 1. Registry deployment

Atomic DeployContract + `new` signed by the contract account.

- Transaction: [`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`](https://explorer.testnet.near.org/transactions/DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R)
- WASM: 261,226 bytes, SHA-256 `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`
- Init: `{"manager_id":"commonsops.testnet","network":"TESTNET"}` — `registry_initialized` event in the init receipt

## 2. Recurring work registered

`create_template` — transaction
[`FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7`](https://explorer.testnet.near.org/transactions/FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7)

- Template `0`: 0.5 NEAR per cycle for `commonsops-dao.sputnikv2.testnet`, 7-day interval, 5-day work window, 2-day claim duration
- Storage deposit: 0.04096 NEAR (4,096 reserved bytes)

## 3. Cycle opened

`materialize_cycle` — transaction
[`3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt`](https://explorer.testnet.near.org/transactions/3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt)

- Cycle `0:0` OPEN: opens `1793910183011867400`, deadline `1794342183011867400`
- Storage deposit: 0.16384 NEAR (16,384 reserved bytes)

## 4. Claim — recipient bound

`claim_cycle` — transaction
[`8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe`](https://explorer.testnet.near.org/transactions/8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe)

- Claimant and payout recipient are the same account (`commonsops.testnet`); there is no recipient input
- Claim expiry: `1794083472509596599`

## 5. Immutable evidence submitted

`submit_evidence` — transaction
[`6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99`](https://explorer.testnet.near.org/transactions/6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99)

- Evidence: [`https://github.com/super-user-root/commonsops/pull/17`](https://github.com/super-user-root/commonsops/pull/17), commit `1032733c2115b9e9c038d50617f6e151ac8bd59d`
- Canonical digest recorded onchain: `09936627004b6e19664173302ff9d52613f5febef27ab34cfa488b54b83d71b8`
- Status became `SUBMITTED`; evidence, recipient, and amounts are now immutable

## 6. Real DAO Transfer proposal

`add_proposal` on the DAO — transaction
[`CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F`](https://explorer.testnet.near.org/transactions/CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F)

- Proposal `0`: native Transfer of exactly `500000000000000000000000` yoctoNEAR (0.5 NEAR) to `commonsops.testnet`, `msg: null`
- Policy: council = `commonsops.testnet` (1/1 threshold), proposal bond `0`

## 7. Council approval executes the payout

`act_proposal VoteApprove` — transaction
[`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`](https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7)

- Act receipt `kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro` succeeded; the DAO
  transferred the payout as a direct causal child receipt:
  `EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2` (predecessor = the DAO,
  receiver = `commonsops.testnet`, `SuccessValue`), block
  `5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6`
- A sibling `on_proposal_callback` receipt exists (Sputnik 2.3.1 behavior); it
  is a FunctionCall, not a Transfer, so it never affects the causal payout match

## 8. Registry link — immutable, replay-proof

`link_proposal` — transaction
[`FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2`](https://explorer.testnet.near.org/transactions/FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2)

- Onchain link: `(TESTNET, commonsops-dao.sputnikv2.testnet, 0)` → cycle `0:0`
- The key is globally unique onchain; replacement and replay are rejected by
  the contract

## 9. Reconciliation — PAID derived from chain data

`scripts/reconcile-live.mjs` runs the merged reconciliation read model
(`packages/near`) against the live RPC with the registry-linked expectations
and the candidate transaction hash. It issues one read-only
`EXPERIMENTAL_tx_status` call, requires finality, verifies the exact act
proposal and the causal payout receipt (predecessor, recipient, integer
amount, `SuccessValue`), and applies the verified attribution to the
fingerprinted store.

- Result: `APPLIED`, adapter state **`PAID`** — "verified attribution recorded"
- Payout receipt: `EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`
- Store snapshot fingerprint: `f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965`
- Local artifacts: `deployments/testnet/replay-record.json` and
  `deployments/testnet/reconciliation-snapshot.json` (generated, not committed)

`Approved` alone was never treated as payment: PAID is derived here from the
finalized causal receipt graph, matching the registry-linked DAO, proposal id,
recipient, and exact integer amount — and the proposal link above is one-time
onchain, so the same evidence can never back a second cycle. The local store
snapshot and its fingerprint are an advisory integrity aid only (they detect
local tampering, not forgery): the authoritative evidence remains the finalized
receipt graph above and the one-time onchain proposal link.

## Reproduce

```bash
node scripts/reconcile-live.mjs
```

Read-only: the script signs nothing and spends nothing. Each run re-derives
the attribution from the live chain: `APPLIED`/`PAID` with the same record and
an unchanged store fingerprint (`IDEMPOTENT` is the store-level status for
re-applying an identical record within one store instance).

## The workspace live surface (P5-T11)

The web workspace (`apps/web`) now has a live section alongside the recorded
journey stages:

- **Live reads (no wallet needed):** the browser performs read-only JSON-RPC
  `query` calls to `https://rpc.testnet.near.org` at final blocks, enumerates
  every registered template (sequential ids until the registry returns none,
  capped at 16), and renders each active template with its latest existing
  cycle and its next period — plus `foundation_status`. Every read failure is
  shown as a named error (per template, not a global failure); no fallback
  data is invented.
- **Wallet-signed contributor transactions:** with a testnet wallet connected
  (official `@near-wallet-selector` 10.1.4: MyNearWallet, Meteor, Here), the
  reviewed intent construction (`claim_cycle`, `submit_evidence`,
  `release_claim`, `expire_cycle_or_claim`) becomes sendable per active
  template against that template's newest live cycle — zero attached deposit
  and 100 TGas prepaid gas, the exact wire values of the recorded journey
  above. Submitted transactions link to
  `https://explorer.testnet.near.org/transactions/<hash>`, and a wallet
  dismissal is reported honestly as "no request sent".
- **Still out of the app:** operator (manager) methods stay display-only in
  the UI, no private keys exist in app code, mainnet is refused in code, and
  the DAO payout flow remains inside the DAO's own governance — the app never
  simulates a payout.
