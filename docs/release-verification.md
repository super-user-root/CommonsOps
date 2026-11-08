# Release-candidate verification — historical record

This record covers release head `82e1d68c92cbc3deded140ed924ea15e01e707d1`
(2026-11-06), not a certification of every later frontend or documentation change.
At that head, the contract source tree matched the deployed source tree; no
redeployment was performed. The recorded smoke checked exact deployed artifact
identity at the historical initialization block, not current provider uptime.

**Byte-equality scope:** clone/worktree/deployed equality was measured with the
original Windows Rust 1.98.0 toolchain environment. Later Linux Verify produced
261,082 bytes, SHA-256
`17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7`, different from
the deployed 261,226-byte artifact below. No cross-platform byte identity or
behavioral equivalence is established. Current local builds are structurally
checked; historical regressions use the checked immutable deployed fixture.
[Commands and fixture provenance](COMMANDS.md#fresh-build-versus-immutable-deployed-wasm).

- Release head (this record): `82e1d68c92cbc3deded140ed924ea15e01e707d1`
- Contract tree at release head: `979db78a521e045676db8dd0564b8d17d24ab8bc`
  (identical at the deployment source head `4145546fa4181b2e08c29fa78056bb266a5501cb`
  — no contract source changed between them; `git diff 4145546..82e1d68 -- contracts/`
  is empty)
- Reviewed WASM: SHA-256 `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`,
  261,226 bytes

## Onchain state (re-verified)

- Live smoke (`node scripts/smoke-testnet.mjs commonsops.testnet`, run at the
  release head): PASS — full result below.
- Onchain code hash: `Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP`, which
  decodes to exactly the reviewed WASM SHA-256 above.
- Pre-deployment code hash: `11111111111111111111111111111111` (empty), proving
  the contract was created by the recorded atomic deploy+init transaction
  [`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`](https://explorer.testnet.near.org/transactions/DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R).
- `foundation_status` view: `"foundation: no business behavior"` — an unchanged
  legacy scaffold literal, not a claim that lifecycle logic is missing, not a
  business-state check and not a funds-custody guarantee. The registry retains
  storage collateral but does not custody DAO payout funds. The implemented
  lifecycle is shown by source/tests and the [recorded journey](testnet-journey.md).

## Smoke result (re-run at the release head)

```json
{
  "network": "testnet",
  "rpcUrl": "https://rpc.testnet.near.org",
  "accountId": "commonsops.testnet",
  "sourceHead": "4145546fa4181b2e08c29fa78056bb266a5501cb",
  "transactionHash": "DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R",
  "receiptIds": [
    "BWdoEsMuBteB3gpo8ZiQ27oXguSLKZUwLjh6wyZV2YBY",
    "AfQXPKpb6mV6agZE9vjfTE2eyRv5ZbtKd4EMEpvXYBnx"
  ],
  "pinnedBlockHash": "8Ajt9XEfAJVjiSFTo2aTPALWQsZkDpNr4x575BV4uobA",
  "pinnedBlockHeight": 276385914,
  "preCodeHash": "11111111111111111111111111111111",
  "postCodeHash": "Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP",
  "wasmSha256": "9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c",
  "wasmBytes": 261226,
  "storageUsage": 261511,
  "amount": "9931831644455389400000000",
  "locked": "0",
  "foundationStatus": "foundation: no business behavior"
}
```

## Post-deployment history on the release candidate

The live contract has executed the full documented journey (template, cycle,
claim, immutable evidence, DAO proposal 0, approval, payout, immutable
proposal link) plus the end-to-end failure-path demonstrations (duplicate
claim rejected onchain, proposal reuse rejected onchain) — see
[testnet-journey.md](./testnet-journey.md). The dated agent-context findings and
public dispositions are summarized in [p4-t02-findings.md](./p4-t02-findings.md).
Failed-send hashes were not captured for the duplicate-claim/proposal-reuse
observations, so those are not independently explorer-verifiable here; the
public Rust/replay tests provide separate executable guard coverage. This record
is not an external security-audit certificate or a current release endorsement.

## Current read-only recheck

```text
node scripts/smoke-testnet.mjs commonsops.testnet --stdout-only
node scripts/reconcile-live.mjs --stdout-only
```

Both are bounded, provider-dependent historical checks. They add outer
`runProvenance` on success without rewriting the historical JSON above; failure
exits 1 with `FAILED` JSON on stderr. The recorded initialization block/artifact
identity is distinct from current registry availability. `--stdout-only`
preserves committed evidence; offline replay is a separate route, not a live
success fallback.
