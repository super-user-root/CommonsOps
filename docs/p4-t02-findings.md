# P4-T02 — Findings resolution record and clean-clone reproducibility

This page is the public resolution record for the independent security review of
the integrated CommonsOps system (reviewed head `4145546f…`, private report
`.commonsops/reviews/P4-T01-security-review.md`, coordinator waivers in
`decisions/P4-T01-security-waivers.md`). It also records the fresh clean-clone
reproducibility proof and the secret/config/dependency audit performed for
P4-T02.

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
| F3  | Low (waived by design)       | WAIVED — ADR §10.6 boundary                | None                                         |
| F4  | Low (waive-with-decision)    | WAIVED — accepted design                   | None                                         |
| F5  | Low                          | ACCEPTED BEHAVIOR (fail-closed)            | None                                         |
| F6  | Observation                  | DEFERRED BY DESIGN (MVP scope)             | Post-hackathon note recorded here            |
| F7  | Observation                  | NO ACTION — unreachable on pinned profiles | Post-hackathon note recorded here            |
| F8  | Observation                  | DOCUMENT — contract unchanged              | Docs note added (this page)                  |
| F9  | Observation                  | DOCUMENT — artifact pins dominate          | None (already documented)                    |
| F10 | Observation                  | RECORDED — `pnpm audit` clean              | Result recorded here; CI step post-hackathon |
| F11 | Observation                  | ACCEPTED — ADR §9 retention                | None                                         |
| F12 | Observation                  | ACCEPTED — ADR §6 semantics                | None                                         |

**No release blockers remain.** F1-F4 are waived by the recorded coordinator
decision (`decisions/P4-T01-security-waivers.md`); F5-F12 are accepted-design,
documentation, or deliberate-scope items as detailed below. The review found
zero Critical and zero High findings.

### F1 — governance-status blindness (Medium) — WAIVED, condition discharged

Waived as accepted design by the coordinator decision: a status gate on
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

Waived as accepted design: ADR §10 (the local read-model persistence paragraph,
cited as "§10.6" in the waiver decision) defines the local store as an advisory,
deterministically rebuildable cache; onchain proposal links remain the global
authority and no funds or custody flow through the store. The forgery probe
(probe P3) proved a consistent snapshot can be imported — that is the documented
boundary, not a defect. Public docs must keep the advisory wording: a note to
this effect was added to `docs/testnet-journey.md` §9 in this task, and the
P5-T05 documentation task must preserve it.

### F3 — per-instance payout-receipt uniqueness (Low) — WAIVED

Waived per the ADR §10 read-model boundary: payout-receipt uniqueness
`(network, payout_receipt_id) -> cycle` is enforced within one canonical local
store instance; global uniqueness is not claimed for a local read model. The
onchain `(network, dao, proposal_id)` map is the global authority and is
one-time onchain. No action.

### F4 — single-request no-proposal-re-read replay (Low) — WAIVED

Waived per the accepted P3-T03 design: the receipt graph is the
cryptographically anchored input; the money properties survived every adversarial
probe. The proposal-kind attribution limitation is documented in code
(`packages/near/src/reconciliation.ts:1210-1214`). A chain-read proposal
cross-check remains possible as a future ADR if wanted. No action.

### F5 — U64 proposal ids above 2^53-1 (Low) — ACCEPTED BEHAVIOR

Proposal ids that cannot be represented exactly in JavaScript numbers fail
closed to INVALID/UNKNOWN (probes P1a-c); a false PAID is impossible. The web
reviewer already short-circuits with an explicit reason. No action.

### F6 — `cancel_cycle` and list views not implemented (Observation) — DEFERRED BY DESIGN

The implemented surface is deliberately smaller than the ADR §7 method table:
there is no `cancel_cycle` (the `CANCELLED` status is unreachable) and no
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

`foundation_status()` still returns `"foundation: no business behavior"` while
the full work-flow lifecycle is implemented. Coordinator disposition: **do not
change the contract**. The marker means _no funds-custody business behavior_ —
the contract has no transfer, withdraw, refund, or payout state surface and
treats deposits purely as bounded storage collateral; it does not mean the
contract lacks the work-flow logic. The full work-flow business behavior
(register → claim → evidence → DAO payout → immutable proposal link → PAID
reconciliation) is exercised end to end by the documented live journey
(`docs/testnet-journey.md`) and asserted read-only post-deploy by
`pnpm smoke:testnet`. Changing the returned string would change the onchain code
hash (deployed code `Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP`, transaction
`DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`), invalidating the live journey's
deployed-code evidence and requiring a full redeploy plus re-journey before the
deadline — rejected.

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

Per ADR §9 ("Storage policy — bounded operator-funded retention"), attached
storage deposits are collateral retained by the contract with no refund path;
reserves (4,096/template, 16,384/cycle) far exceed measured usage. The UI
enforces the minimum. Operator-error-only impact. No action.

### F12 — claim allowed on paused template's existing cycles (Observation) — ACCEPTED

Per ADR §6: "Pausing stops future cycle materialization but does not cancel
existing work." Existing cycles of a paused template remain claimable
(probe R2 confirmed). Documented semantics, deliberate. No action.

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
§4 for the measured, environment-only cause. All other checks of that clone were
not reached because the lint step aborted; the short-path clone above is the
authoritative end-to-end proof.

### Release WASM three-way byte-identity

| Artifact                                                                                                                           | SHA-256                                                            | Bytes   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| Reviewed/live artifact (`REVIEWED_WASM_SHA256` in `scripts/deployment-lib.mjs`; deployed onchain per `docs/testnet-journey.md` §1) | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |
| Fresh clone build (`pnpm verify:offline` → `cargo build --locked --offline --target wasm32-unknown-unknown --release`)             | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |
| Worktree build (same command)                                                                                                      | `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c` | 261,226 |

All three are byte-identical (`cmp` of the two local builds: identical). The
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

## 4. New observation — Windows command-line length sensitivity of the lint step

**P4-T02-V1 (Observation, verification harness, Windows-only; no product
impact; not a release blocker).** `tests/run.mjs` `lint()` invokes
`pnpm exec prettier --check` with the absolute paths of all 78 tracked source
files on one command line. On Windows the prettier shim chain (pnpm →
`prettier.cmd` → cmd.exe) hits the cmd.exe 8191-character command-line limit
once the checkout directory is deep: measured, the full 78-file list at
`C:\Users\tonym\AppData\Local\Temp\p4t02-clone-20261106T054351\repo` builds a
7,416-character argument string and fails with "The command line is too long.",
while 65 files (6,617 characters) pass and the identical full list at the
shorter worktree path (`T:\findings\CommonsOps\worktrees\P4-T02`, 5,640
characters) passes. Cloning to a short path (as the §2 proof does, from the
same `TEMP` root) avoids it entirely.

Characterization: environment-only, fail-visible (the harness aborts loudly
rather than skipping checks), Linux CI is unaffected (no cmd.exe, and GitHub
runners use short paths), and every current Windows checkout in this project
uses short paths. Recommended follow-up (post-hackathon, or whenever a task
legitimately touches `tests/run.mjs`): pass relative paths with the repo root
as working directory, or hand prettier a directory/glob, so the invocation is
path-length independent. This task changes no code, per its assignment.
