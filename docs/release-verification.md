# Release-candidate verification

The live testnet deployment at `commonsops.testnet` **is** the release
candidate. No contract source changed after the reviewed build: the contract
tree at the release head is byte-identical to the tree that produced the
deployed artifact, so instead of redeploying an identical contract, this
release re-verifies the live deployment against the release head.

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
- `foundation_status` view: `"foundation: no business behavior"` — the stage
  marker means the contract holds no funds-custody business behavior; the full
  work-flow logic it does implement is exercised by the documented
  [testnet journey](./testnet-journey.md), which reconciled a real DAO payout
  to PAID from causal chain data.

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
[testnet-journey.md](./testnet-journey.md). All security-review findings were
resolved or coordinator-waived with a fresh clean-clone reproduction (see
[p4-t02-findings.md](./p4-t02-findings.md)); none touched the contract source.
