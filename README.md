# CommonsOps

CommonsOps pays for recurring public work — like keeping documentation
maintained — with proof. A NEAR smart-contract registry tracks recurring work
cycles, binds a claimant to the payout recipient, freezes immutable evidence
of the work, and links one-time onchain to a Sputnik DAO proposal. Payment is
never assumed from an approval: a reconciliation layer derives **PAID** from
the finalized causal receipt graph of the real DAO transfer.

The registry is **live on NEAR testnet**, and a complete work cycle — claim,
evidence, DAO approval, payout, onchain link, and PAID reconciliation — has
been executed and independently reviewed. This repository contains the
contract, the reconciliation tooling, a truthful web workspace, and the public
evidence for all of it.

- **Track:** Social Money (`social`)
- **Network:** NEAR testnet only (no mainnet deployment)
- **License:** [MIT](LICENSE)

## The problem

Community maintenance work (docs, triage, small fixes) is recurring and easy
to promise but hard to prove. Treasuries pay without verification; work is
claimed without receipts; approval and payment get conflated. CommonsOps makes
each cycle a first-class onchain object with deterministic deadlines, a
single claimant, frozen evidence, and a payment that must be _derived from
chain data_ before anyone calls it paid.

## How it works

1. **Operator** creates a recurring template: fixed payout, interval, work
   window, and claim duration, targeting an existing Sputnik DAO.
2. **Cycle materialization** opens one deterministic cycle per period
   (storage-deposit funded, capacity-bounded).
3. **A contributor claims** the cycle — the claimant and payout recipient are
   the same account by construction; there is no recipient input to attack.
4. **The contributor freezes evidence**: repository, pull request number, and
   commit SHA are canonicalized, hashed, and stored immutably.
5. **The DAO pays**: a native Transfer proposal is approved through the
   existing Sputnik DAO governance and treasury — CommonsOps never custody
   funds.
6. **The registry links** the proposal id to the cycle — globally unique
   onchain, replay-proof.
7. **Reconciliation derives PAID** from chain data: the finalized transaction
   must contain the exact `act_proposal` call, and a direct causal child
   receipt must be a Transfer from the DAO of the exact amount to the exact
   recipient with a successful outcome. Approval alone is never payment.

## Live onchain evidence (testnet)

Every step below is a real, finalized transaction on NEAR testnet — see
[docs/testnet-journey.md](docs/testnet-journey.md) for the full record with
explorer links.

| Step                                 | Transaction                                                                                                                                   | Result                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Registry deploy (atomic deploy+init) | [`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`](https://explorer.testnet.near.org/transactions/DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R) | onchain code hash = SHA-256 of the reviewed WASM |
| Template 0 created                   | [`FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7`](https://explorer.testnet.near.org/transactions/FWqT2A6oT8xXRuVkmdxFQbigcLwG9Jao2DfGmie92WH7) | 0.5 NEAR per cycle                               |
| Cycle 0:0 opened                     | [`3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt`](https://explorer.testnet.near.org/transactions/3MV5x4hUjC8Z7uQmcdRJebiyUR4sq67dFJcnUo2nXJCt) | deterministic deadlines                          |
| Claimed                              | [`8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe`](https://explorer.testnet.near.org/transactions/8LB4W2qWxaKsRRJMyfyw1NYWiDK6bDjh7ejyRKQ42tYe) | claimant = recipient                             |
| Evidence frozen                      | [`6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99`](https://explorer.testnet.near.org/transactions/6sqUZaFfoLacYihADUmBSqKbMS7mxvBsQKcUbzfAWz99) | PR #17, digest `09936627…`                       |
| DAO proposal 0                       | [`CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F`](https://explorer.testnet.near.org/transactions/CAX6EJvvN71BxTP8NDdwmrPiryYeRKcJXK3tPhfp591F) | Transfer 0.5 NEAR                                |
| Approved — payout executed           | [`ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7`](https://explorer.testnet.near.org/transactions/ApRvPUsw2d5gn3N4SxTe7Wbv7nPcJRDTtWc7j9LwAoP7) | causal payout receipt `EnL1wpFN…`                |
| Proposal linked                      | [`FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2`](https://explorer.testnet.near.org/transactions/FkT3cB5KQpVHZYoXp7cMb3eWhQPYyvqeeXfbcT33yMX2) | immutable one-time link                          |

Failure paths were demonstrated onchain too: a duplicate claim on a
non-open cycle and a proposal-reuse `link_proposal` both **fail onchain with
no state change** (see [docs/p4-t02-findings.md](docs/p4-t02-findings.md) and
[docs/release-verification.md](docs/release-verification.md)).

## Do X — see Y

Use **Node 24.18.0**, **pnpm 11.25.0**, and **Rust/cargo 1.98.0** with
`rustfmt` and the `wasm32-unknown-unknown` target. Versions are pinned in
`package.json` and `contracts/registry/rust-toolchain.toml`. Both lockfiles
are committed. Run from the repository root; no environment file, key, or
faucet is needed.

1. Run `pnpm install --frozen-lockfile` — see all workspace dependencies
   installed without lockfile changes.
2. Run `pnpm verify:offline` — see format checks, strict TypeScript, all
   TypeScript/Rust unit tests, the production web build, release-WASM checks,
   and a loopback HTTP smoke test pass. No external application services are
   contacted.
3. Run `node scripts/smoke-testnet.mjs commonsops.testnet` — see the **live
   onchain deployment** verified read-only against the reviewed artifact:
   transaction, receipts, onchain code hash, and contract views, straight
   from NEAR testnet RPC.
4. Run `node scripts/reconcile-live.mjs` — see the recorded live payout
   reconciled through the causal verification adapter to
   **`APPLIED` / adapter state `PAID`**, with the store snapshot written under
   `deployments/testnet/`. Read-only: signs nothing, spends nothing; re-runs
   re-derive the same record from chain data.
5. Run `pnpm start` and open `http://127.0.0.1:3000` — see the fixture-backed
   workspace that renders the same journey (operator, contributor, reviewer)
   with unsigned intent previews and honest state handling. The web workspace
   performs no live RPC and no transactions by design.
6. Run `node --test tests/e2e/e2e-replay.test.ts` — see the offline
   end-to-end replay suite pass: happy path, proposal/evidence-reuse
   conflicts, duplicate-apply idempotency, and deterministic store
   convergence.

For development, `pnpm dev`. For per-command setup details and artifact paths
see [docs/COMMANDS.md](docs/COMMANDS.md).

## What is onchain vs offchain

- **Onchain (this repo's contract, deployed):** templates, deterministic
  cycles, single claimant bound to recipient, immutable canonical evidence,
  globally unique proposal links, storage-deposit accounting. No token, no
  custody, no approval-driven payment state.
- **Offchain (this repo's tooling):** causal payout reconciliation against
  final transactions and receipt graphs, with a fingerprinted local store for
  audit. The store is advisory; onchain proposal links are the replay guard.
- **Sputnik DAO (existing contracts, not this repo):** governance, proposal
  policy, and treasury custody remain entirely with the DAO.

## Verification and review

- 58 Rust contract tests, 125 TypeScript tests (domain, adapter,
  reconciliation, web, e2e replay), production build, release-WASM checks,
  and an offline verification gate (`pnpm verify:offline`) all pass.
- An independent security review (threat model, adversarial probes) found no
  critical/high issues; all findings are resolved or waived with recorded
  rationale in [docs/p4-t02-findings.md](docs/p4-t02-findings.md).
- A fresh clean clone reproduces `pnpm verify:offline` and the release WASM
  byte-for-byte (three-way identical: fresh clone = worktree = deployed
  artifact).
- The live deployment is the release candidate: no contract source changed
  after the reviewed build — see
  [docs/release-verification.md](docs/release-verification.md).

## Inputs and disclosures

- **Baseline:** new code written during the eligible hackathon window
  (from 2026-10-19). The initial repository seed (commit
  `52a9425eb1ce84071f28d63a763edbc71d42f967`) contained only a README,
  ignore patterns, and the MIT license — no pre-hackathon product code.
- **AI disclosure:** ZCode AI implemented the repository (contract, tests,
  tooling, web workspace, and documentation) under human direction, with
  every task independently reviewed by a separate AI reviewer agent before
  merge; AI output does not establish correctness or security — the tests,
  reviews, and onchain evidence in this repository do.
- **Libraries:** Next.js 16.4.4, React/React DOM 19.3.1, TypeScript 7.0.2,
  Prettier 3.9.10, near-sdk 5.30.0 (exact pins; transitive inputs in
  `pnpm-lock.yaml` and `contracts/registry/Cargo.lock`). No application
  template or tutorial was copied.
- **Track:** Social Money (`social`). The project lead has declared no other
  hackathon project for this submission.
- **Publication:** this repository is committed to remaining public through
  judging, per the live [official rules](https://nearhackathon.com/HACKATHON.md)
  (recheck the live file before relying on dates).

## Boundaries

No new token or points system, no AI-driven payment approval, no cross-chain
payments, no custody of DAO funds, no autonomous scheduler, and no
browser-controlled payment state. The DAO always retains governance and
treasury custody; CommonsOps is the evidence and verification layer around
it. The web workspace performs no live RPC and executes no transactions.

## License

[MIT](LICENSE)
