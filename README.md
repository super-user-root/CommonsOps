# CommonsOps

**Work evidence and DAO payout attribution for recurring public maintenance.**
A NEAR registry gives each work cycle one claimant, binds that account as payout
recipient, freezes a public GitHub PR + commit reference, and links one Sputnik
DAO proposal. The existing DAO decides whether to pay. CommonsOps derives
**PAID** offchain from finalized, causally linked transfer receipts — never from
an approval or browser flag. It does **not** automatically verify work quality,
merge status, authorship, or that a commit belongs to a PR.

**[Live app](https://super-user-root.github.io/CommonsOps/)** ·
[AI/code index](llms.txt) · [MIT](LICENSE) · Social Money (`social`) · NEAR testnet only

## Choose your route

| Route                  | Do this                                                                                                                                  | What you can establish                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live app               | [Open the live registry](https://super-user-root.github.io/CommonsOps/#live-registry)                                                    | Current finalized registry reads if RPC is reachable; optional wallet-signed contributor actions. Availability is at the displayed block, not a reservation. |
| Recorded proof, no RPC | [Open the three-stage tour](https://super-user-root.github.io/CommonsOps/#journey) or read the [journey record](docs/testnet-journey.md) | The recorded cycle 0:0, public PR #17 and **0.5 NEAR payout**, with expandable exact intents, hashes and receipts. Not a fresh live result.                  |
| Offline verification   | Follow [setup](#run-locally), then `pnpm verify:offline`; replay with `node --test tests/e2e/e2e-replay.test.ts`                         | Local invariant/negative tests, build, historical fixture checks and repeatable payout derivation without a wallet or available slot.                        |
| Historical bounded RPC | `node scripts/smoke-testnet.mjs commonsops.testnet --stdout-only` and `node scripts/reconcile-live.mjs --stdout-only`                    | Recheck fixed historical deployment/payout identities, with finite primary/archival attempts and explicit failure. Not a live payout indexer.                |
| Code and AI discovery  | [Canonical repository llms.txt](llms.txt) or [website llms.txt](https://super-user-root.github.io/CommonsOps/llms.txt)                   | Absolute public source links, commands and scope. Both index endpoints derive from one source file.                                                          |

Live RPC can fail. The unavailable card keeps its real error and Retry, plus a
labelled **recorded evidence — not a live result** route. Recorded proof and
replay remain useful when RPC is down or the shared cycle is occupied.
[Demo guide, current captures and archive](demo/README.md) explain capture
provenance. The [compact desktop overview](demo/screenshots/10-compact-overview-desktop.png)
and [mobile overview](demo/screenshots/13-compact-overview-mobile.png) show the
new tour; older screenshots are explicitly archival, not current-state proof.

## How it works

1. **Operator handoff:** outside this app, the manager registers a fixed reward,
   interval and work window, then materializes a due cycle with storage collateral.
2. **Contributor:** claim a live cycle (claimant = payout recipient), then submit
   immutable canonical public PR + commit evidence. A live, unsubmitted claim can
   be released; submitted evidence and its recipient cannot be changed.
3. **DAO handoff and proof:** the existing Sputnik DAO creates and votes on a
   Transfer proposal. The registry links it one-time. The adapter checks finality,
   exact DAO/proposal action, recipient, integer amount, successful outcome and
   causal transfer receipt before deriving PAID.

`Approved` without verified receipts is **PENDING_PAYMENT_EVIDENCE**, not payment.
Look-alike transfers, failed payouts and ambiguous attribution do not qualify.
The onchain proposal map is globally one-time; receipt-reuse checks operate in
one canonical offchain store. Its fingerprint is an integrity aid, not an
authenticity certificate or a trustless global receipt ledger.

## One shared demo slot

**Cycle 2:0 is one global slot, not one per visitor.** It was opened on 2026-11-08
with a work deadline of 2026-11-21T21:05:40.385722126Z. This is historical
provisioning, not a promise that it is OPEN now. The live summary uses validated
cycle state and the observed block time. The first claimant occupies it.

Only that claimant's **active, unsubmitted** claim can be released. Submission is
immutable and prevents release; expiry may require settlement. Claiming or
submitting evidence never guarantees a DAO payout. Subsequent visitors can always
inspect the recorded journey and run the offline replay above. There is no
self-service provisioning, automatic reset or identity collection.

Release CLI preview (Git Bash/POSIX, optional near-cli-rs 0.30.1). Replace the
quoted placeholder locally with your own account. This ends in **sign-later**:
it prepares an unsigned transaction, not a signature or broadcast. Read the live
state first; do not run state-changing commands without explicit human approval.

```sh
CLAIMANT_ACCOUNT='replace-with-your-account.testnet'
near contract call-function as-transaction commonsops.testnet release_claim json-args '{"cycle_key":{"template_id":"2","period_index":"0"}}' prepaid-gas '100 TGas' attached-deposit '0 NEAR' sign-as "$CLAIMANT_ACCOUNT" network-config testnet sign-later
```

If later authorized and signed, gas still costs testnet NEAR even though the
attached deposit is zero. [Full shared-slot and CLI guide](docs/testnet-journey.md#shared-demo-slot).

## Run locally

From the repository root, use **Node 24.18.0**, **pnpm 11.25.0**, **Rust/cargo
1.98.0**, rustfmt and `wasm32-unknown-unknown`. Windows requires Visual Studio C++
build tools/linker. Setup needs network access; the verification gate is not an
installer. Do not regenerate the lockfiles.

```text
rustup toolchain install 1.98.0 --profile minimal --component rustfmt
rustup target add wasm32-unknown-unknown --toolchain 1.98.0
pnpm install --frozen-lockfile
cargo +1.98.0 fetch --locked --manifest-path contracts/registry/Cargo.toml
pnpm verify:offline
node --test tests/e2e/e2e-replay.test.ts
pnpm start
```

Open `http://127.0.0.1:3000`. Recorded stages work without RPC; the separate live
section reads testnet from the browser. `pnpm dev` is the development alternative.
[COMMANDS](docs/COMMANDS.md) lists every gate, static-export and read-only command.
Default and static builds must run **sequentially**; rebuild default before
`pnpm start` if you last built the Pages export.

The ordinary gate uses bounded direct Prettier batches and supports native
Windows paths, including spaces — no drive mappings or short-path workaround.
Domain/adapter/web suites run through recursive `pnpm typecheck`; root `pnpm test`
covers foundation and runner tests. The suite output, not a hand-maintained total,
is the current test inventory. Controller/source/HTML tests do not replace
separate browser keyboard, layout or wallet verification.

### Read-only current view with a checked decoder

Prerequisites: **Node 24 + curl**, this checkout, Git Bash/POSIX shell (PowerShell:
use `curl.exe` and its quoting syntax). RPC `result.result` is a UTF-8 **byte
array**, not the decoded cycle. This helper validates the envelope, bytes, UTF-8
and JSON; errors exit nonzero. `null` means no record was returned, not an open slot.

```sh
set -o pipefail
curl --fail-with-body --silent --show-error --connect-timeout 5 --max-time 15 https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"cycle","method":"query","params":{"request_type":"call_function","account_id":"commonsops.testnet","method_name":"get_cycle","args_base64":"eyJjeWNsZV9rZXkiOnsidGVtcGxhdGVfaWQiOiIyIiwicGVyaW9kX2luZGV4IjoiMCJ9fQ==","finality":"final"}}' | node tests/decode-rpc-view.ts
```

The encoded argument is `{"cycle_key":{"template_id":"2","period_index":"0"}}`,
not flattened IDs. An OPEN literal alone does not prove the current work window
is live; use the app's block-time-derived availability. Curl's finite timeout
or an RPC error is a failure, never a fixture fallback.

## Public evidence and verification scope

- [Recorded journey](docs/testnet-journey.md): all successful transaction links,
  exact recipient/amount and payout receipts. The demo used one account as
  manager, contributor and DAO council; it does not demonstrate broad adoption.
- [Raw payout fixture](tests/fixtures/sputnik/dao-proposal-0-231-paid.json) and
  [offline replay](tests/e2e/e2e-replay.test.ts): fixed source data and executable
  derivation, reuse-conflict and idempotency tests.
- [Historical findings](docs/p4-t02-findings.md): dated agent-context review scope,
  findings and public rationale — not an external audit certificate or current
  release endorsement.
- [Deployment manifest](deployments/testnet/prepared-deployment.json) and
  [release verification](docs/release-verification.md): deployed Windows artifact
  **261,226 bytes**, SHA-256 `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`.
  Historical clone/worktree byte equality was measured on Windows. Linux produced
  **261,082 bytes**, SHA-256 `17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7`.
  No cross-platform byte identity or behavioral equivalence is claimed. Fresh
  local WASM structure and the exact historical deployed fixture are separate checks.

Historical read-only commands were verified once each on 2026-11-08 at
`9264cf3b14d408dff5d3e71990d9a41934406abd`: smoke 26.416s and reconciliation
15.549s, each after two primary 6s timeouts and official archival success.
That observation is not a provider uptime promise or a current-slot check.
Success adds outer `runProvenance` without changing the recorded fingerprint.
Failure exits 1 with a `FAILED` JSON object on stderr; `--stdout-only` preserves
stored evidence. See [bounded historical APIs](docs/COMMANDS.md#historical-read-only-verification-no-wallet-or-artifact-writes).

## Boundaries

- **No custody of DAO payout funds.** Governance and treasury remain in Sputnik;
  the registry retains operator-funded storage collateral, including excess, with
  no refund path. It is not a new treasury or multisig.
- **Public evidence identity only.** PR/SHA canonicalization does not query GitHub
  or verify authorship, merge status or quality. DAO reviewers still assess the work.
  Published security-fix PRs fit only **after coordinated disclosure**; confidential
  vulnerability reports and embargoed intake are unsupported.
- **Pinned integration.** The unsigned proposal builder constructs `add_proposal`
  for Sputnik **2.0.0**. The payout verifier separately supports the recorded
  **2.3.1** profile and checks `act_proposal` receipts. The 2.3.1 recorded reviewer
  can verify payment but cannot enable that unsigned request builder.
- **Testnet-only.** Mainnet attempts are refused in code. Mainnet needs code,
  configuration, artifact/profile and operational checks; switching an RPC URL
  or redeploying alone is insufficient.
- **Legacy marker.** `foundation_status` returns the historical literal
  `foundation: no business behavior`. It is scaffold text, not a claim of missing
  contract logic, a custody guarantee or business-state proof.
- No token/points, AI approvals, automatic work verification, autonomous scheduler,
  generalized live payout indexer, reputation system, Trezu integration or cross-chain
  payments. Operator and DAO actions stay outside the app. No keys in application code.

## Inputs and disclosures

- **Baseline:** new code in the eligible hackathon window (from 2026-10-19).
  Seed `52a9425eb1ce84071f28d63a763edbc71d42f967` contained only a README,
  ignore patterns and MIT license, not pre-hackathon product code.
- **AI:** built with AI assistance under human direction and supervision.
  Implementation and review used separate agent contexts. This is not a claim
  that a human authored or independently audited every change; tests and public
  source/chain identities are evidence, not automatic quality certification.
- **Libraries:** Next.js 16.4.4, React/React DOM 19.3.1, TypeScript 7.0.2,
  Prettier 3.9.10, near-sdk 5.30.0, official @near-wallet-selector
  core/modal-ui/my-near-wallet/meteor-wallet/here-wallet 10.1.4 (MIT OR Apache-2.0).
  Exact transitive inputs are in `pnpm-lock.yaml` and `contracts/registry/Cargo.lock`.
  No application template or tutorial was copied.
- **Track/other projects:** Social Money (`social`); the lead declared no other
  hackathon project for this submission.
- **Publication:** the repository is committed to remaining public through judging.
  The public X demo post is **pending human publication**; no post URL has been
  supplied. The Pages URL is not a substitute for that post or a saved submission.
  Hosting retention, publication, consent and submission remain human obligations
  under the [live official rules](https://nearhackathon.com/HACKATHON.md).
