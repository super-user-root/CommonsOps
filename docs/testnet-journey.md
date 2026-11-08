# Testnet journey — live evidence record

This page records the first complete CommonsOps journey executed on NEAR
testnet: a recurring-work cycle registered, claimed, evidenced, paid through a
Sputnik DAO, and reconciled to **PAID** from causal chain data. Every
identifier is public onchain data; no keys or personal data appear here.

- Network: `testnet` (chain id `testnet`)
- Registry contract: `commonsops.testnet`
- Sputnik DAO: `commonsops-dao.sputnikv2.testnet` (factory `sputnikv2.testnet`, version `2.3.1`, code hash `AA4nA45vauiac3jdVwJTzSdUP3oj2r1fDaPAb2mHdgcH`)
- Roles: `commonsops.testnet` acted as registry manager, contributor (claimant = payout recipient), and DAO council — the MVP demo arrangement

This is a historical record, not a current live-slot or provider-availability
claim. Evidence identifies a public PR and SHA; it does not automatically verify
authorship, merge status, commit membership or work quality. Public security-fix
PRs are supported only after coordinated disclosure, not confidential-report
intake. The DAO retains payout funds; registry deposits are retained storage
collateral. The deployed artifact is exact; [release verification](release-verification.md)
separates historical Windows byte equality from differing Linux local builds.

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

The public unsigned proposal builder supports the pinned Sputnik 2.0.0 request
profile, not this 2.3.1 DAO. The recorded `add_proposal` was an external DAO
handoff. The payout verifier separately supports this observed 2.3.1 profile.

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

`scripts/reconcile-live.mjs` runs the production reconciliation read model
(`packages/near`) against a historical RPC response, using the fixed recorded
registry-linked expectations and candidate transaction below. It does not query
current registry linkage or discover new payouts. One logical read-only
`EXPERIMENTAL_tx_status` lookup has bounded primary/archival attempts. The adapter
requires finality, exact act-proposal identity and the causal payout receipt
(predecessor, recipient, integer amount, `SuccessValue`), then applies verified
attribution to the fingerprinted store.

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

```text
node scripts/reconcile-live.mjs --stdout-only
node scripts/smoke-testnet.mjs commonsops.testnet --stdout-only
node --test tests/e2e/e2e-replay.test.ts
```

Read-only: the historical scripts sign nothing, spend nothing and, with
`--stdout-only`, write no artifacts. Successful re-derivation returns
`APPLIED`/`PAID` and the unchanged record fingerprint; `IDEMPOTENT` is the
store-level result for applying the identical record again in one store instance.
Actual attempt endpoints/timings are outer `runProvenance`, separate from the
immutable evidence source. A failed check exits 1 with `FAILED` JSON on stderr;
recorded proof is never substituted for a failed live read. The final command is
fully offline and repeatable. [Setup, deadlines and output semantics](COMMANDS.md).

## The workspace live surface

Hosted at <https://super-user-root.github.io/CommonsOps/>:

- **Live reads:** no wallet needed. Each refresh pins all views to one final
  block, using bounded official primary/archival RPC. Templates are discovered in
  order up to 16, with named per-template errors or a finite infrastructure
  error/Retry. Prior data is labelled stale and cannot authorize signing. The
  unavailable card links explicitly to recorded proof, not a fabricated live result.
- **Selected template:** compact summaries use `deriveContributorCycleView`, not
  status-only OPEN assertions. Prefer the connected active claimant, otherwise a
  supported open/in-window cycle, otherwise the first summary. Each group remains
  discoverable; only selected detail/actions expand. Selection/hiding, account,
  evidence or snapshot changes invalidate pending preparation before signing.
- **Wallet-signed contributor actions:** official wallet selector 10.1.4
  (MyNearWallet, Meteor, Here), reviewed `claim_cycle`, `submit_evidence`,
  `release_claim`, `expire_cycle_or_claim` construction, zero attached deposit and
  100 TGas prepaid. Gas still costs testnet NEAR. Last-await checks bind the
  current signer. Wallet-reported transaction hashes survive refresh/selection,
  but do not certify execution success or payment.
- **External handoffs:** operator provisioning/linking stays display-only; DAO
  review/governance/payout remains in the DAO. No keys in app code. Mainnet is
  refused and requires code/configuration/operational validation.
- **Legacy marker:** `foundation_status` is the scaffold literal
  `foundation: no business behavior`, not evidence of missing lifecycle code,
  a no-custody guarantee or a business-state check.

## Shared demo slot

### Historical provisioning — 2026-11-08

The operator created template 2, "Judge demo - claim a live work cycle", targeting
`commonsops-dao.sputnikv2.testnet`, with interval/work window/claim duration of 14
days each and a 0.5 NEAR proposed payout. Start:
2026-11-07T21:05:40.385722126Z. Storage deposit: 0.04096 NEAR.
`materialize_cycle {"template_id":"2"}` then opened cycle 2:0 with a 0.16384 NEAR
storage deposit and recorded deadline `1795295140385722126` ns
(2026-11-21T21:05:40.385722126Z). OPEN/no claim describes that historical observation.

The provisioning transaction hashes were not captured in this public record;
there is no explorer transaction proof for those two invocations here. Current
public `get_template`/`get_cycle` reads can verify resulting state, not reconstruct
uncaptured transaction provenance. No private record is needed to interpret the
public payloads below, and no new provisioning is part of this tour.

### Current availability and release limits

**2:0 is one global shared slot, not one per visitor.** Availability is only at
the last verified block; the first claimant occupies it. A claimant may release
only their active **unsubmitted** claim. Evidence submission is immutable and
prevents release; an elapsed claim/work deadline may require settlement instead.
There is no automatic reset and no guaranteed DAO payout. Recorded proof and
`node --test tests/e2e/e2e-replay.test.ts` remain repeatable for all subsequent
visitors without an available cycle, wallet or live RPC.

### Bounded read-only view

Requires Node 24 + curl and this checkout. Git Bash/POSIX example; use `curl.exe`
and PowerShell quoting in PowerShell. The checked helper decodes the RPC
`result.result` UTF-8 byte array into JSON (object/string/null), rejects errors,
invalid bytes/UTF-8/JSON and exits nonzero. A raw byte array is not a decoded cycle.

```sh
set -o pipefail
curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 15 https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"cycle","method":"query","params":{"request_type":"call_function","account_id":"commonsops.testnet","method_name":"get_cycle","args_base64":"eyJjeWNsZV9rZXkiOnsidGVtcGxhdGVfaWQiOiIyIiwicGVyaW9kX2luZGV4IjoiMCJ9fQ==","finality":"final"}}' | node tests/decode-rpc-view.ts
```

Decoded arguments must be nested:
`{"cycle_key":{"template_id":"2","period_index":"0"}}`. `null` means no record;
OPEN alone is insufficient without checking the work window at the observed
block. Use the website's validated summary rather than assuming availability.

### Unsigned claim/release examples — not signing instructions

Optional near-cli-rs 0.30.1, Git Bash/POSIX. Assign your own account locally, read
the current state, then inspect an unsigned intent if needed. **These end in
`sign-later`; they do not sign or broadcast.** No keychain/send command is part of
this guide. Any eventual signature/spend needs a separate explicit human decision.

```sh
CLAIMANT_ACCOUNT='replace-with-your-account.testnet'
near contract call-function as-transaction commonsops.testnet claim_cycle json-args '{"cycle_key":{"template_id":"2","period_index":"0"}}' prepaid-gas '100 TGas' attached-deposit '0 NEAR' sign-as "$CLAIMANT_ACCOUNT" network-config testnet sign-later
near contract call-function as-transaction commonsops.testnet release_claim json-args '{"cycle_key":{"template_id":"2","period_index":"0"}}' prepaid-gas '100 TGas' attached-deposit '0 NEAR' sign-as "$CLAIMANT_ACCOUNT" network-config testnet sign-later
```

Claim binds your account as claimant **and** recipient. Release clears both, only
before submission and within the active claim/work window. The live website can
prepare evidence submission with field validation and an immutable-submission
warning. Do not submit a dummy PR merely to test the slot. All executed
contributor methods consume gas even with zero attached deposit; the signer must
review the exact network, receiver, method, arguments and 100 TGas allowance.
