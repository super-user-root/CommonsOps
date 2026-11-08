# P4-T02 — Findings resolution record and clean-clone reproducibility

This is the **dated 2026-11-05/06** public disposition summary of an independent
agent-context review of the integrated CommonsOps system at
`4145546fa4181b2e08c29fa78056bb266a5501cb`. Review topics included contract
initialization/authorization, claim/evidence immutability, proposal/receipt reuse,
causal payout attribution, local-store integrity and dependency/configuration
checks. Implementation and review used separate agent contexts; this is not an
external audit-firm certificate, a claim of independent human authorship, or a
current whole-repository security endorsement. Public rationale and reproducible
source/fixture checks are given below; inaccessible private reports are not proof.

Historical counts, commands and results below apply only to those measured
heads/environments. For current setup/gates see [COMMANDS](COMMANDS.md). The later
Windows runner repair and Linux-versus-Windows artifact mismatch are described
in §4 and the artifact section; neither changes the recorded evidence pins.

- Task: P4-T02 v1 ("Resolve findings and prove clean-clone reproducibility")
- Base: `5a2c7bf545464e537a51b61ad12e229945177220` (current `main` at task time)
- Worktree: `worktrees/P4-T02`, branch `task/P4-T02-resolve-and-reproduce`, clean
  before and after
- Scope: verification and documentation only — no product code was changed
- Rules status at task time: canonical `https://nearhackathon.com/HACKATHON.md`
  checked `2026-11-05T20:36:09.054Z`, SHA-256
  `86654c13521fe629493bf498d41c0f7573047867d67fcdd8c2543411fc13062f`,
  `pendingChange: null`

## 1. Disposition of P4-T01 findings F1-F12

| ID  | Severity (P4-T01)            | Disposition                                | Action in this task                          |
| --- | ---------------------------- | ------------------------------------------ | -------------------------------------------- |
| F1  | Medium (waive-with-decision) | WAIVED — accepted design                   | Condition discharged; no code change         |
| F2  | Medium (waive-with-decision) | WAIVED — accepted design                   | Advisory wording note added to public docs   |
| F3  | Low (waived by design)       | WAIVED — scoped read-model boundary        | None                                         |
| F4  | Low (waive-with-decision)    | WAIVED — accepted design                   | None                                         |
| F5  | Low                          | ACCEPTED BEHAVIOR (fail-closed)            | None                                         |
| F6  | Observation                  | DEFERRED BY DESIGN (MVP scope)             | Post-hackathon note recorded here            |
| F7  | Observation                  | NO ACTION — unreachable on pinned profiles | Post-hackathon note recorded here            |
| F8  | Observation                  | DOCUMENT — contract unchanged              | Docs note added (this page)                  |
| F9  | Observation                  | DOCUMENT — artifact pins dominate          | None (already documented)                    |
| F10 | Observation                  | RECORDED — `pnpm audit` clean              | Result recorded here; CI step post-hackathon |
| F11 | Observation                  | ACCEPTED — storage retention               | None                                         |
| F12 | Observation                  | ACCEPTED — pause semantics                 | None                                         |

**Historical disposition only:** no release blocker was retained by that bounded
review, which reported zero Critical/High findings. F1–F4 were accepted trade-offs;
F5–F12 were accepted behavior, documentation or scope items. The public rationale
below explains each limitation; it is not a promise of no vulnerabilities in later
code. Current suite results and release checks must be assessed at their own heads.

### F1 — governance-status blindness (Medium) — WAIVED, condition discharged

Accepted with an explicit trust boundary: a status gate on
caller-supplied proposal views would be bypassable, and the reconciliation
predicate enforces the money properties (recipient, exact integer amount,
causality, finality, success) directly on the receipt graph. The carried-forward
condition — the live journey record must ship raw RPC `EXPERIMENTAL_tx_status`
evidence so attributions are independently re-derivable — is **discharged**: the
complete raw finalized RPC response for the real payout (act receipt
`kBH4oqQh8mMy6oGW727XZmQgVobUv1r8r11ExMrsPro`, payout receipt
`EnL1wpFNdEsrvJtEP3Uh7cn9CsFpYTmwSX3HDyzYquW2`) ships in the repository as
`tests/fixtures/sputnik/dao-proposal-0-231-paid.json`, and the journey record
(`docs/testnet-journey.md` §7/§9) plus the P3-T06 live results
(`tests/e2e/live-e2e-results.json`, ten transaction hashes) make every
identifier independently verifiable. Anyone can re-derive the attribution from
live chain data with the read-only `node scripts/reconcile-live.mjs`.

### F2 — fingerprint is integrity-only, not authenticity (Medium) — WAIVED

Accepted design: the local read-model store is an advisory,
deterministically rebuildable cache; onchain proposal links remain the global
authority and no funds or custody flow through the store. The forgery probe
(probe P3) proved a consistent snapshot can be imported — that is the documented
boundary, not a defect. Public docs must keep the advisory wording: a note to
this effect was added to `docs/testnet-journey.md` §9 in this task, and the
P5-T05 documentation task must preserve it.

### F3 — per-instance payout-receipt uniqueness (Low) — WAIVED

Accepted read-model boundary: payout-receipt uniqueness
`(network, payout_receipt_id) -> cycle` is enforced within one canonical local
store instance; global uniqueness is not claimed for a local read model. The
onchain `(network, dao, proposal_id)` map is the global authority and is
one-time onchain. No action.

### F4 — single-request no-proposal-re-read replay (Low) — WAIVED

Accepted historical single-request design: the receipt graph is the
source graph supplied from RPC is not a client-trusted payment flag, but still
has an RPC/verified-adapter trust boundary. The historical adversarial
probes targeted these money properties. The proposal-kind attribution limitation
is documented alongside `reconcilePayment` in
[`packages/near/src/reconciliation.ts`](../packages/near/src/reconciliation.ts).
A current registry/proposal cross-check is not performed by the fixed historical
script. Do not interpret this accepted limitation as generalized autonomous
reconciliation or a trustless light-client proof.

### F5 — U64 proposal ids above 2^53-1 (Low) — ACCEPTED BEHAVIOR

Proposal ids that cannot be represented exactly in JavaScript numbers fail
closed to INVALID/UNKNOWN (probes P1a-c); a false PAID is impossible. The web
reviewer already short-circuits with an explicit reason. No action.

### F6 — `cancel_cycle` and list views not implemented (Observation) — DEFERRED BY DESIGN

The implemented public surface deliberately has no `cancel_cycle` (the `CANCELLED`
status is unreachable) and no
pagination views; the UI operates via direct `get_*` reads. A mistaken
OPEN/CLAIMED cycle deterministically expires. Smaller surface, no security
impact. Post-hackathon: reconsider `cancel_cycle` and list views if operator
ergonomics demand them.

### F7 — malformed matching sibling (Observation) — NO ACTION

A crafted caller-supplied graph with a malformed-but-matching-amount sibling
does not downgrade a single clean causal match to AMBIGUOUS. Unreachable under
the pinned Sputnik 2.0.0 onchain shapes (payout and bond refund are always
separate single-transfer receipts). The shipped 2.3.1 pin records the observed
`DIRECT_CHILD_WITH_CALLBACK` graph, where a non-Transfer sibling callback never
affects the match. The P3-T07 review's first INFO item records that a _failing_
sibling `on_proposal_callback` does not flip PAID to FAILED for the 2.3.1 graph
and that callback-gated failure modeling is explicitly future work.
Post-hackathon: model callback-failure semantics for the 2.3.1 profile.

### F8 — stale `foundation_status` wording (Observation) — DOCUMENT (contract unchanged)

`foundation_status()` still returns `"foundation: no business behavior"`. It is
legacy scaffold text, not a business-state check, a statement that lifecycle
logic is missing, or a guarantee about custody. The registry retains operator
storage collateral but never custody of DAO payout funds. Source and tests show
register/claim/release/submit/link behavior; the [recorded journey](testnet-journey.md)
separately shows a DAO payout and offchain attribution.

The literal is preserved to avoid changing the historical deployed-code identity
(SHA-256 `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`,
code `Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP`, transaction
`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`). That preservation is not an
interpretation of the marker as a security property. Current historical smoke
verifies exact code/receipts at the pinned block, not only this string.

### F9 — `sourceHead` vs `reviewedSourceHead` (Observation) — DOCUMENT

Deployment manifests record both heads without requiring equality; artifact
identity is enforced by the reviewed contract tree hash, the exact WASM
SHA-256 and byte length, pinned Rust/SDK/CLI versions, and the clean-worktree
gate (`scripts/deployment-lib.mjs` `REVIEWED_*` constants,
`scripts/prepare-testnet-deployment.mjs`). A head difference would be visible in
the manifest, never hidden. This is already documented in
`deployments/testnet/README.md`. No action.

### F10 — no CI dependency-vulnerability audit (Observation) — RECORDED

The audit performed for this task (§3 below) found **no known vulnerabilities**
(`pnpm audit` at this head, 2026-11-05). Lockfile integrity is additionally
proven by `pnpm install --frozen-lockfile` succeeding end to end in a fresh
clone (§2). Adding an automated dependency-audit step (and a scheduled run) to
`.github/workflows/verify.yaml` is recorded as post-hackathon hardening; the
current CI is deliberately read-only and offline-hermetic.

### F11 — excess storage deposit retained (Observation) — ACCEPTED

The bounded operator-funded retention policy keeps attached
storage deposits are collateral retained by the contract with no refund path;
reserves (4,096/template, 16,384/cycle) far exceed measured usage. The UI
enforces the minimum. Operator-error-only impact. No action.

### F12 — claim allowed on paused template's existing cycles (Observation) — ACCEPTED

Contract pause semantics stop future materialization without cancelling existing
work. Existing cycles of a paused template remain claimable at contract level
when otherwise eligible (historical probe R2). The current browser deliberately
does not read paused cycles or offer their actions; that UI limit is not a change
to contract semantics.

## 2. Fresh clean-clone reproducibility proof

Performed 2026-11-05 (UTC) on Windows 11 (win32, Git Bash), Node
`v24.18.0`, pnpm `11.25.0`, Rust `1.98.0` with `wasm32-unknown-unknown`.
Clone target was a fresh directory under the OS `TEMP` environment path,
never the worktree or any existing checkout.

| Step            | Command                                                                          | Start (UTC)   | Duration | Result                                                                     |
| --------------- | -------------------------------------------------------------------------------- | ------------- | -------- | -------------------------------------------------------------------------- |
| Clone           | `git clone https://github.com/super-user-root/CommonsOps.git "$TEMP/p4t02/repo"` | 23:48:55.873Z | ~2s      | PASS                                                                       |
| HEAD check      | `git rev-parse HEAD`                                                             | —             | —        | `5a2c7bf545464e537a51b61ad12e229945177220` (equals base and remote `main`) |
| Clean check     | `git status --porcelain`                                                         | —             | —        | empty                                                                      |
| Install         | `pnpm install --frozen-lockfile`                                                 | 23:48:59.140Z | 21.3s    | PASS (29 packages, exact lockfile versions)                                |
| Offline profile | `pnpm verify:offline`                                                            | 23:49:29.773Z | 3m 22.9s | PASS, exit 0                                                               |

The `verify:offline` profile in the fresh clone passed every stage:
Prettier format check (78 files), Node `--check` syntax (3 scripts), `cargo
+1.98.0 fmt --check`, recursive TypeScript typecheck with unit tests
(`@commonsops/domain` 8/8, `@commonsops/near` 61/61, web 56/56),
`tests/foundation.test.ts` 3/3, Rust suite `cargo +1.98.0 test --locked
--offline` **58 passed / 0 failed**, Next.js production build (compiled, 3/3
static pages), WASM release build with export-allowlist/imports test 1/1, and
the production HTTP smoke (testnet workspace, disabled wallet, metadata, 404).

A second independent clone under a long Windows temp path
(`p4t02-clone-20261106T054351`) reproduced clone (2.4s) and install (44.2s cold
store, 29 packages downloaded) and failed only at the Prettier lint step — see
§4 for the original harness defect and later repair. All other checks of that clone were
not reached because the lint step aborted; the short-path clone above is the
dated successful end-to-end measurement, not a universal short-path guarantee.

### Historical Windows release WASM three-way byte-identity

This table is the measured original Windows toolchain result, not a promise of
cross-platform reproducibility. Linux Verify later produced 261,082 bytes,
SHA-256 `17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7`,
which differs from the exact deployed artifact below. The cause and behavioral
equivalence are not established. Current tests distinguish fresh structural/API
build checks from the immutable deployed fixture; production pins are unchanged.
See [COMMANDS](COMMANDS.md#fresh-build-versus-immutable-deployed-wasm).

| Artifact                                                                                                                           | SHA-256                                                            | Bytes   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| Reviewed/live artifact (`REVIEWED_WASM_SHA256` in `scripts/deployment-lib.mjs`; deployed onchain per `docs/testnet-journey.md` §1) | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |
| Fresh clone build (`pnpm verify:offline` → `cargo build --locked --offline --target wasm32-unknown-unknown --release`)             | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |
| Worktree build (same command)                                                                                                      | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |

All three were byte-identical in that Windows measurement (`cmp` of the two local builds: identical). The
worktree's own `pnpm install --frozen-lockfile` (8.2s) and
`pnpm verify:offline` (2m 52s, exit 0) also passed at the task head, proving the
worktree itself still satisfies the required checks.

## 3. Secret/config/dependency audit

All scans were run against tracked content at the task head (`git grep`/`git
ls-files`), extended with a full-history scan; the worktree and the local main
checkout were additionally checked on disk. **Result: no secrets, no leaked
credentials, no suspicious dependencies.**

### Secrets and credentials — clean

- `ed25519:` occurrences: 3 unique 44-character public keys
  (`public_key`/`signer_public_key` fields and the manifest public-key
  validation regex) and 7 88-character values, all in `"signature"` fields —
  signatures are public onchain data. No private-key material anywhere.
- `PRIVATE_KEY`/`MNEMONIC`/`SECRET`/seed-phrase scans over all tracked files:
  only prose matches (test descriptions) and one negative assertion —
  `packages/near/src/proposal-builder.test.ts:473` asserts that `secretKey` is
  an absent forbidden field. No `.env` files tracked. No nearcredentials
  folders in the worktree or the local checkout.
- `git ls-files | grep -iE "credential|secret|key|env"`: zero hits.
- Full-history scan (`git log --all -p -S` for `PRIVATE_KEY`, `mnemonic`,
  `nearcredentials`): no commit ever added such content.
- Environment variables read by code: only the `COMMONSOPS_E2E_KEY === "1"`
  execute gate (a boolean flag, not a secret) plus build plumbing
  (`NEXT_TELEMETRY_DISABLED`, `npm_execpath`).
- `.gitignore` coverage confirmed: root ignores `.env`/`.env.*` (except
  `.env.example`), `*.pem`, `*.key`, `.commonsops/`, `AGENTS.local.md`;
  `deployments/testnet/.gitignore` ignores `prepared-deployment.json`,
  `unsigned-deploy.transaction`, `smoke-result.json`, `artifacts/`. The local
  deployment artifacts present in the main checkout (including the `DEPLOYED`
  manifest, which contains only public data — account ids, the public key,
  hashes, nonce — and the content-addressed WASM copy) are exactly the ignored
  paths; both worktree and checkout report clean status.

### Dependencies — clean

- `pnpm audit` (network, 2026-11-05): **"No known vulnerabilities found"**.
  This discharges the F10 record; a CI audit step remains post-hackathon.
- Lockfile integrity independently proven by `pnpm install --frozen-lockfile`
  in the fresh clone (twice, including a cold-store download of all 29
  packages).
- Direct external npm dependencies (8, all exact-pinned, `saveExact: true`):
  root dev `@types/node` 24.19.2, `prettier` 3.9.10, `typescript` 7.0.2; web
  `next` 16.4.4, `react` 19.3.1, `react-dom` 19.3.1; web dev `@types/react`
  19.3.0, `@types/react-dom` 19.3.0. Workspace packages `@commonsops/domain`
  and `@commonsops/near` have zero dependencies (Node stdlib + `node:test`
  only). Nothing suspicious.
- Rust: exactly one runtime dependency, `near-sdk =5.30.0` (exact pin, equal to
  the reviewed `REVIEWED_NEAR_SDK`), plus the same crate as dev-dependency with
  the `unit-testing` feature. `Cargo.lock` is committed; all builds run
  `--locked` with `CARGO_NET_OFFLINE=true`. `cargo audit` is not installed on
  this host and was therefore not run (recorded honestly; covered by the
  post-hackathon CI item).

## 4. Historical Windows lint command-length defect — repaired 2026-11-08

The original P4-T02-V1 observation concerned `pnpm exec prettier --check` with
all absolute filenames in one Windows shim command. At the then-current file
count, a deep TEMP checkout failed with "The command line is too long." while a
shorter path passed. The old conclusion that short paths avoided the defect was
too broad: the 2026-11-08 mock screening reproduced failure even in a short path
as the source set grew. That was a verification-harness defect, not merely a
host configuration issue; the original failed run did not execute later phases.

The P5-T13 repair in public main `9264cf3b14d408dff5d3e71990d9a41934406abd`
uses the exact pinned installed Prettier JS entry through Node, shell disabled,
relative filenames and complete bounded batches. Oversized individual arguments
or any failed batch fail visibly. Source coverage and other phases are preserved.
Ordinary `pnpm verify:offline` was verified on native Windows normal and
long/spaced paths without drive mappings, and Linux Verify/Pages passed. The
[runner regressions](../tests/run.test.mjs) and [current command reference](COMMANDS.md)
are reproducible public evidence; current reproduction still needs the pinned
toolchain and populated dependency caches.

This addendum supersedes the old short-path workaround/deferral, not the dated
2026-11-05 results, artifact hashes or prior failure evidence above.
