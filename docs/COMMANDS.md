# Local commands

Run these from the repository root in PowerShell, Git Bash, or a POSIX shell. Paths below are repository-relative. Use Node **24.18.0**, pnpm **11.25.0**, and Rust/cargo **1.98.0**. On Windows the Rust host requires the Visual Studio C++ build tools/linker. `package.json` enforces exact Node/pnpm engines; `contracts/registry/rust-toolchain.toml` pins Rust. The check runner invokes `cargo +1.98.0` explicitly even from the root.

## Setup (network allowed)

Install the pinned Node and pnpm releases using your normal trusted tool installation method. With rustup already installed:

```text
rustup toolchain install 1.98.0 --profile minimal --component rustfmt
rustup target add wasm32-unknown-unknown --toolchain 1.98.0
pnpm install --frozen-lockfile
cargo +1.98.0 fetch --locked --manifest-path contracts/registry/Cargo.toml
```

See installed toolchains and cached dependencies. The first setup requires npm/crates.io/toolchain network access; `verify:offline` is not an installer. Do not regenerate either lockfile for a reproduction run. A fresh offline install can use `pnpm install --offline --frozen-lockfile` once its store has been populated.

## Checks: do X — see Y

| Command                | Expected result                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`            | Prettier checks actual source/config/docs, Node checks runner syntax, and `cargo fmt --check` checks Rust. Formatting errors fail.                                                                                        |
| `pnpm typecheck`       | TypeScript checks domain, adapter, web, and tests (including JavaScript runner files); any type error fails.                                                                                                              |
| `pnpm test`            | Three foundation tests check immutable configuration and shell metadata. Domain/adapter/web tests run through recursive `pnpm typecheck`.                                                                                 |
| `pnpm test:contract`   | Rust registry business/invariant unit tests, including initialization, claims, deadlines, storage and proposal guards. Uses `--locked --offline`.                                                                         |
| `pnpm build`           | Next.js creates a production build under `apps/web/.next`; the overview is statically generated with no remote data/fonts.                                                                                                |
| `pnpm build:contract`  | Rust creates `contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm`; Node validates WASM, exact method exports, and absence of transfer/promise-creation imports. Uses `--locked --offline`. |
| `pnpm test:production` | Starts the existing production build on an ephemeral loopback port; checks HTTP 200, live-surface/recorded-preview disclosures, metadata and HTTP 404; stops the server. Build first.                                     |
| `pnpm verify:offline`  | Runs every check above in order and prints a final PASS only if all pass. No skipped WASM fallback.                                                                                                                       |
| `pnpm format`          | Applies Prettier to project files; use when deliberately fixing formatting, not to bypass checks.                                                                                                                         |

`verify:offline` disables Next telemetry and sets Cargo offline mode. It does not call NEAR RPC, GitHub, an indexer, a wallet, or another external service. The production smoke uses loopback HTTP, not a public network endpoint. Dependencies, platform-specific pnpm packages, Rust toolchain, and WASM target must already be available. Run setup again on a new host. This profile proves offline unit/invariant behavior, compilation, WASM structure and local HTTP behavior. It does **not** by itself prove NEAR VM execution, deployed state, treasury integration, browser interaction or signing safety; use the separate recorded evidence and checks for those boundaries.

## Prepare a testnet deployment without signing

Build and verify the reviewed artifact first. Then use an actual existing named testnet account supplied by the human. The preparer checks the current checkout and artifact against the accepted source/hash/size, queries only public account/key/block state, and writes ignored unsigned provenance.

Git Bash/POSIX:

```text
export COMMONSOPS_SOURCE_HEAD=<reviewed-full-sha>
pnpm build:contract
node --test scripts/deployment-lib.test.mjs
node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]
```

PowerShell:

```text
$env:COMMONSOPS_SOURCE_HEAD = '<reviewed-full-sha>'
pnpm build:contract
node --test scripts/deployment-lib.test.mjs
node scripts/prepare-testnet-deployment.mjs <contract-account.testnet> [manager-account.testnet]
```

The preparer verifies the reviewed source SHA and WASM hash/size, writes an ignored content-addressed artifact, and outputs shell-specific `near ... sign-later` commands for one atomic `DeployContract` + `FunctionCall:new` transaction with 50 Tgas and 0 NEAR attached to initialization. It does not sign or broadcast. Do not commit the generated manifest, artifact copy, or unsigned transaction.

After a human explicitly authorizes and signs/broadcasts that exact transaction, fill the public non-secret transaction/receipt/code-hash provenance and run:

```text
pnpm smoke:testnet -- <contract-account.testnet>
```

This satisfies the frozen `pnpm smoke:testnet` required check through the accepted narrow `package.json` scope exception. The smoke command is read-only RPC verification, not deployment authorization.

## View the workspace

```text
pnpm dev
```

Open `http://127.0.0.1:3000` — see the workspace rendering the recorded testnet journey (registry `commonsops.testnet`, template 0, cycle 0:0, real proposal-0 payout). Stop with Ctrl+C.

For a production preview:

```text
pnpm build
pnpm start
```

Open the same loopback URL — see the same recorded journey in production mode, plus the live registry section: read-only testnet RPC reads run in the browser, and connecting a testnet wallet enables wallet-signed contributor transactions. The recorded stages stay immutable imported onchain data; the DAO payout flow stays out of the app. No secret environment defaults exist. `NEXT_TELEMETRY_DISABLED=1` is supplied by the verification runner/CI, not a credential. No deployment commands are provided.

### Browser snapshot and recovery checks (no signing)

The browser selects one final block hash per refresh, validates every query's
block identity and preserves exact header timestamp digits. Primary/archival
`near.org` testnet RPC reads share max4 HTTP requests, 96 attempts, 6s per
fetch/body, two attempts per endpoint and a 40s overall deadline. Null-terminated
template discovery is ordered and capped at16, followed by a four-worker cycle
pool. Transport/timeouts/429/5xx/explicit transient RPC failures retry; schema,
method/account/argument and contract failures do not blindly retry. Streams
are bounded at 2 MiB, decoded contract results at 64 KiB, JSON depth at64,
scanner nodes at300,000 and scanner work at4 MiB. Duplicate decoded JSON keys
and ambiguous result/error envelopes are refused. Monotonic deadlines are
checked after awaits/validation and before publication. Endpoint provenance
lists only actual validated responses. Guarded sends revalidate snapshot/input/
account generations and current selector accounts after each preparation await,
bind signerId, and never automatically retry a transaction.

Run `pnpm --filter @commonsops/web test` to exercise body failures, cancellation,
retry classification, budgets, block pinning, lossless U64 parsing, ordered
partial reads and async latest-input controllers. There is no installed React
DOM test harness: source-wiring checks supplement controller tests, not a full
rendering test. Browser verification must separately check `#live-registry`:
Reading disabled; bounded success or one infrastructure alert/Retry; prior data
marked stale and non-sendable; template-specific errors never imply absent
cycles; transaction evidence survives refresh. The state-pattern gallery's
ERROR alert is an intentional example outside this region. Scope header wallet
checks to `#wallet-connect-button`; the library selector overlay may not expose
`role=dialog`. Do not select/sign a wallet transaction for a no-signing check.
Recorded-preview reasons refer only to those unsigned panels, not a globally
unavailable wallet. These are testing instructions, not a claim they ran.

## CI

`.github/workflows/verify.yaml` runs on `pull_request` and `push` with only `contents: read`. Third-party actions are pinned to full SHAs verified against actual upstream refs on 2026-11-03: checkout v6.0.2, setup-node v6.0.0, pnpm/action-setup v5.0.0, and dtolnay/rust-toolchain stable (the input still pins Rust 1.98.0). Checkout does not persist credentials. CI installs locked dependencies, then runs the same local offline profile. There are no deployment keys, secret references, `pull_request_target` events, or publish steps. A local pass is not a claim that hosted CI has run.

## GitHub Pages static export

The web workspace also builds as a fully static export for GitHub Pages.
The default `pnpm build` / `pnpm start` path is unchanged and remains
server-rendered; export mode only activates when the build environment sets
`COMMONSOPS_STATIC_EXPORT=1`, which adds `output: "export"`, the
`/CommonsOps` base path, and trailing slashes. Local check:

```text
COMMONSOPS_STATIC_EXPORT=1 pnpm --filter @commonsops/web exec next build
```

See `apps/web/out/` — pre-rendered HTML with `/CommonsOps/`-prefixed assets.
`.github/workflows/pages.yaml` runs this export build on every push to
`main` (and on manual `workflow_dispatch` runs) so Pages compatibility is
verified continuously. Publishing is gated on the `ENABLE_PAGES` repository
variable: after enabling Pages (Settings → Pages → Source: GitHub Actions)
and setting `ENABLE_PAGES=true`, the next push to `main` — or a manual
workflow run — uploads the artifact and deploys to
`https://<owner>.github.io/CommonsOps/`. The workflow has no secrets beyond
the built-in `GITHUB_TOKEN`, which the deploy job scopes to `pages: write`
and `id-token: write`.
