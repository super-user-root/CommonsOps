# Recorded receipt-graph fixture

`proposal-0-paid.json` is the exact `EXPERIMENTAL_tx_status` JSON-RPC response
for the executed CommonsOps testnet payout — transaction
`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`, the `act_proposal
VoteApprove` call on proposal `0` of `commonsops-dao.sputnikv2.testnet`
(recorded in `docs/testnet-journey.md`, steps 7 and 9). Its causal receipt
graph contains the act receipt `kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro`
and the direct-child payout Transfer receipt
`EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2` with payout block
`5ukLMpiXjTW9y9bojhM2cPRgD25v9fMa7MkKxFat1Se6`.

Origin and fidelity:

- Captured read-only from NEAR testnet (`EXPERIMENTAL_tx_status`, one RPC
  read; nothing was signed, spent, or mutated) and written here verbatim —
  no field was added, removed, or edited.
- The file is a bare RPC envelope on purpose: `apps/web/lib/fixture-journey.ts`
  imports it and passes it unchanged to the production
  `buildReviewerModel`/adapter path, which parses it strictly.
- Re-derive the same attribution from the live chain with
  `node scripts/reconcile-live.mjs` (read-only). A successful run reports
  `APPLIED` / adapter state `PAID` with payout receipt
  `EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2` and writes
  `deployments/testnet/replay-record.json`.

This file is data captured from the public chain; it contains no keys or
personal data.
