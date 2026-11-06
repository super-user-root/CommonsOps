# CommonsOps demo assets

This folder contains the demo walkthrough video and the screenshot set for the
public demo post. Everything here is derived from the repository itself: the
web workspace render, and two read-only commands run against NEAR testnet.

- Video: `demo-walkthrough.mp4` — 1280x720, h264/yuv420p, 25 fps, about 43 s,
  no audio.
- Screenshots: `screenshots/01-…` through `screenshots/08-…` (PNG).

## What the demo shows

One complete action-to-visible-result journey: an operator defines recurring
documentation work as deterministic cycles, a contributor claims a cycle with
the payout recipient bound to the claimant, submits immutable GitHub evidence,
a Sputnik DAO transfer proposal is created and linked one-time onchain, council
approval executes the payout, and the payment state `PAID` is derived from the
finalized causal receipt graph — never from a client-supplied flag.

## Screenshot map

Each screenshot shows the fixture-backed web workspace (`pnpm start`, build of
this repository). Stages 1–3 are separate immutable fixture snapshots of one
journey, as the app's own banners state; the reviewer stage pairs the registry
data with the authentic Sputnik proposal-63 RPC fixture
(`tests/fixtures/sputnik/proposal-63-paid.json`) imported in place.

| File | Journey step | Live testnet evidence in `docs/testnet-journey.md` |
| --- | --- | --- |
| `screenshots/01-hero.png` | Product hero and the unsigned-fixture-preview banner (stages 1–3 are immutable snapshots; no wallet, RPC, or GitHub request) | Journey overview (network `testnet`, registry `commonsops.testnet`, DAO `commonsops-dao.sputnikv2.testnet`) |
| `screenshots/02-network-boundary.png` | Connection boundary: testnet and mainnet are separate configurations, both unconfigured, reads and signing fail closed | Same network facts; live operations stay in scripts (below) |
| `screenshots/03-operator.png` | Stage 1 — operator defines the recurring work: unsigned `create_template` and `materialize_cycle` intent previews with exact integer wire values, signing disabled | Journey steps 2–3: template `0` registration ([`FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7`](https://explorer.testnet.near.org/transactions/FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7)) and cycle `0:0` opened ([`3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt`](https://explorer.testnet.near.org/transactions/3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt)) |
| `screenshots/04-contributor.png` | Stage 2 — contributor claims and binds evidence: `CLAIMED` cycle with claimant = payout recipient (`chloe.testnet` fixture), recipient-binding panel, canonical GitHub evidence preview | Journey steps 4–5: claim binds recipient ([`8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe`](https://explorer.testnet.near.org/transactions/8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe)) and immutable evidence submission ([`6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99`](https://explorer.testnet.near.org/transactions/6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99)) |
| `screenshots/05-reviewer-approved-only.png` | Stage 3 — reviewer boundary: "Approved alone is not payment" (`PENDING_PAYMENT_EVIDENCE` without a finalized causal receipt graph), trust/authorization boundary | Journey steps 6–7: DAO transfer proposal ([`CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F`](https://explorer.testnet.near.org/transactions/CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F)) and council approval ([`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`](https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7)) |
| `screenshots/06-reviewer-paid.png` | Stage 3 — verified cycle: `SUBMITTED` + `LINKED_IMMUTABLE` proposal, derived payment state `PAID` with full provenance (transaction hash, action receipt, payout receipt, evidence key, payout block) | Journey steps 7–9: payout receipt `EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`, registry link ([`FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2`](https://explorer.testnet.near.org/transactions/FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2)), reconciliation `APPLIED` / `PAID` |
| `screenshots/07-state-gallery.png` | Honest state handling patterns (loading, empty/unconfigured, pending, error, verified fixture) — no live request ran | Design invariant: failed/unknown states never render as paid |
| `screenshots/08-truth-panel.png` | "Implemented today" facts panel: journey data fixture-only, live registry not deployed in the web app, wallet signing disabled | The live journey lives in `scripts/` and `docs/testnet-journey.md`, not in the browser |

## Provenance statement

- The web workspace shown in every screenshot is fixture-backed **by design**:
  it performs no RPC, no wallet signature, no GitHub request. The app's own
  honesty banners are visible in the frames and were not cropped away.
- The two text cards in the video are verbatim final status lines from real
  read-only commands run while producing this folder (see "Reproduce" below).
  They are not mockups; re-running the commands re-derives the same values
  from the live chain.
- Screenshot `06-reviewer-paid.png` renders the authentic proposal-63 RPC
  fixture (`tests/fixtures/sputnik/proposal-63-paid.json`) through the
  production `buildReviewerModel` path; its provenance line in the UI states
  this explicitly. The recorded live journey that the same adapter logic
  reconciled to `PAID` is documented in `docs/testnet-journey.md`.

## Actual output used in the video text cards

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
pnpm start                                         # the fixture-backed web workspace on http://127.0.0.1:3000
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

## Video structure

Title card, the eight screenshots in journey order (slow zoom or vertical
pan, crossfade transitions, honesty banners visible), the two verbatim
command-output cards, and a closing card with the repository URL and the
reproduce command. All cards use a dark background with monospace text.

There is no hosted demo deployment; per the hackathon rules this video is the
public demo artifact for judges, with the screenshots as secondary evidence
and the repository as the reproducible source.
