# CommonsOps demo assets

This folder contains the screenshot set for the public demo post. Everything
here is derived from the repository itself: the web workspace render, and two
read-only commands run against NEAR testnet (their actual output is recorded
below).

- Screenshots: `screenshots/01-…` through `screenshots/08-…` (PNG).

## What the demo shows

One complete action-to-visible-result journey: an operator defines recurring
documentation work as deterministic cycles, a contributor claims a cycle with
the payout recipient bound to the claimant, submits immutable GitHub evidence,
a Sputnik DAO transfer proposal is created and linked one-time onchain, council
approval executes the payout, and the payment state `PAID` is derived from the
finalized causal receipt graph — never from a client-supplied flag.

## Screenshot map

Each screenshot shows the recorded-journey web workspace (`pnpm start`, build
of this repository). Stages 1–3 are separate immutable snapshots of the
recorded live journey, as the app's own banners state; the reviewer stage
pairs the registry cycle with the recorded proposal-0 payout receipt graph
(`apps/web/lib/fixtures/proposal-0-paid.json` — the recorded
`EXPERIMENTAL_tx_status` response for transaction `ApRvPUsw…`) imported in
place.

| File                                        | Journey step                                                                                                                                                                                                                                                                                                                                                                                                                               | Live testnet evidence in `docs/testnet-journey.md`                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screenshots/01-hero.png`                   | Product hero and the recorded-live-journey banner (journey stages 1–3 render immutable recorded snapshots)                                                                                                                                                                                                                                                                                                                                 | Journey overview (network `testnet`, registry `commonsops.testnet`, DAO `commonsops-dao.sputnikv2.testnet`)                                                                                                                                                                                                                                                                |
| `screenshots/02-network-boundary.png`       | Connection boundary: testnet registry deployed (`commonsops.testnet`), mainnet isolated and unconfigured                                                                                                                                                                                                                                                                                                                                   | Same network facts; live operations stay in scripts (below)                                                                                                                                                                                                                                                                                                                |
| `screenshots/03-operator.png`               | Stage 1 — operator defines the recurring work: unsigned `create_template` and `materialize_cycle` intent previews with the exact recorded template-0 wire values, signing disabled                                                                                                                                                                                                                                                         | Journey steps 2–3: template `0` registration ([`FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7`](https://explorer.testnet.near.org/transactions/FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7)) and cycle `0:0` opened ([`3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt`](https://explorer.testnet.near.org/transactions/3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt))        |
| `screenshots/04-contributor.png`            | Stage 2 — contributor claims and binds evidence: recorded `CLAIMED` cycle `0:0` with claimant = payout recipient (`commonsops.testnet`), recipient-binding panel, canonical GitHub evidence preview                                                                                                                                                                                                                                        | Journey steps 4–5: claim binds recipient ([`8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe`](https://explorer.testnet.near.org/transactions/8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe)) and immutable evidence submission ([`6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99`](https://explorer.testnet.near.org/transactions/6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99)) |
| `screenshots/05-reviewer-approved-only.png` | Stage 3 — reviewer boundary: "Approved alone is not payment" (`PENDING_PAYMENT_EVIDENCE` without a finalized causal receipt graph), trust/authorization boundary                                                                                                                                                                                                                                                                           | Journey steps 6–7: DAO transfer proposal ([`CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F`](https://explorer.testnet.near.org/transactions/CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F)) and council approval ([`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`](https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7))              |
| `screenshots/06-reviewer-paid.png`          | Stage 3 — verified cycle: real `SUBMITTED` + `LINKED_IMMUTABLE` proposal 0, derived payment state `PAID` with full provenance (transaction hash, action receipt, payout receipt, evidence key, payout block)                                                                                                                                                                                                                               | Journey steps 7–9: payout receipt `EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`, registry link ([`FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2`](https://explorer.testnet.near.org/transactions/FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2)), reconciliation `APPLIED` / `PAID`                                                                                         |
| `screenshots/07-state-gallery.png`          | Honest state handling patterns (loading, empty/unconfigured, pending, error, verified fixture)                                                                                                                                                                                                                                                                                                                                             | Design invariant: failed/unknown states never render as paid                                                                                                                                                                                                                                                                                                               |
| `screenshots/08-truth-panel.png`            | "Implemented today" facts panel: journey data = recorded live journey, live registry `commonsops.testnet` — deployed                                                                                                                                                                                                                                                                                                                       | The live journey lives in `scripts/` and `docs/testnet-journey.md`, not in the browser                                                                                                                                                                                                                                                                                     |
| `screenshots/09-live-registry.png`          | The clearly labeled live section ("Live registry · NEAR testnet — connect a wallet to interact"): live read-only RPC reads enumerate every registered template with its latest and next cycles plus foundation status (including the judge-demo template 2 with its OPEN, claimable cycle 2:0); with a connected testnet wallet each active template's contributor actions become sendable and submitted transactions link to the explorer | Same registry as every step above (`commonsops.testnet`); live reads are verifiable with `node scripts/smoke-testnet.mjs commonsops.testnet`, and `docs/testnet-journey.md` documents what is sendable vs display-only                                                                                                                                                     |

## Provenance statement

- The web workspace shown in screenshots 01–08 was captured before the live
  registry surface landed (P5-T11); those frames render the recorded live
  journey **by design**: no RPC, no wallet signature, no GitHub request.
  Every displayed value is the exact recorded onchain data imported in place,
  and the app's own honesty banners are visible in the frames and were not
  cropped away. The workspace has since gained the clearly labeled live
  section above; its screenshot will be added when the set is re-captured.
- The command output recorded in the next section is verbatim from real
  read-only commands run while producing this folder (see "Reproduce" below).
  It is not a mockup; re-running the commands re-derives the same values
  from the live chain.
- Screenshot `06-reviewer-paid.png` renders the recorded proposal-0 payout
  receipt graph (`apps/web/lib/fixtures/proposal-0-paid.json`, the recorded
  `EXPERIMENTAL_tx_status` response for transaction `ApRvPUsw…`) through the
  production `buildReviewerModel` path; its provenance line in the UI states
  this explicitly and names `node scripts/reconcile-live.mjs` as the
  re-derivation command. The same recorded journey is documented in
  `docs/testnet-journey.md`.

## Actual command output recorded for the demo

`node scripts/reconcile-live.mjs` (read-only, live testnet RPC) ended with:

```json
  "reconciliationStatus": "APPLIED",
  "adapterState": "PAID",
  "adapterReason": "verified attribution recorded"
```

with `transactionHash`
`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7` and payout receipt
`EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`.

`node scripts/smoke-testnet.mjs commonsops.testnet` (read-only, live testnet
RPC) exited 0 (the script throws on any mismatch) and reported:

```json
  "transactionHash": "DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R",
  "pinnedBlockHash": "8Ajt9XEfAJVjiSFTo2aTPALWQsZkDpNr4x575BV4uobA",
  "postCodeHash": "Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP",
  "foundationStatus": "foundation: no business behavior"
```

## How a judge reproduces this

```bash
pnpm install --frozen-lockfile
pnpm verify:offline                                # format/syntax, TypeScript, unit tests, Rust tests, production build, WASM, local HTTP
node scripts/reconcile-live.mjs                    # read-only live RPC: APPLIED / PAID
node scripts/smoke-testnet.mjs commonsops.testnet  # read-only live RPC: onchain deployment checks
pnpm start                                         # the recorded-journey web workspace on http://127.0.0.1:3000
```

The two scripts sign nothing and spend nothing; each run re-derives its
results from the live chain. See `docs/testnet-journey.md` and
`docs/COMMANDS.md` for the full journey record and command reference.

## Journey transactions on NEAR testnet explorer

1. Registry deployment: [`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`](https://explorer.testnet.near.org/transactions/DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R)
2. `create_template` (recurring work registered): [`FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7`](https://explorer.testnet.near.org/transactions/FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7)
3. `materialize_cycle` (cycle opened): [`3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt`](https://explorer.testnet.near.org/transactions/3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt)
4. `claim_cycle` (recipient bound): [`8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe`](https://explorer.testnet.near.org/transactions/8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe)
5. `submit_evidence` (immutable evidence): [`6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99`](https://explorer.testnet.near.org/transactions/6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99)
6. `add_proposal` (DAO transfer proposal): [`CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F`](https://explorer.testnet.near.org/transactions/CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F)
7. `act_proposal` VoteApprove (payout executed): [`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`](https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7)
8. `link_proposal` (immutable registry link): [`FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2`](https://explorer.testnet.near.org/transactions/FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2)

## Demo for judges

There is no hosted demo deployment. The public demo artifacts are the
screenshots in this folder — attached to the demo post — and the repository
itself: the README's do-X steps let a judge open and run the working demo
without credentials — the recorded-journey workspace (`pnpm start`) and the
two read-only live verification commands above.
