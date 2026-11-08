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

| Command                | Expected result                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`            | Pinned Prettier checks the same source/config/docs selection in bounded relative-file batches; Node checks runner syntax, and `cargo fmt --check` checks Rust. Any batch failure fails the check.                    |
| `pnpm typecheck`       | TypeScript checks domain, adapter, web, and tests (including JavaScript runner files); any type error fails.                                                                                                         |
| `pnpm test`            | Foundation tests plus portable-runner regressions (selection, batching, long/spaced Unicode paths, direct invocation, failure propagation). Domain/adapter/web tests run through recursive `pnpm typecheck`.         |
| `pnpm test:contract`   | Rust registry business/invariant unit tests, including initialization, claims, deadlines, storage and proposal guards. Uses `--locked --offline`.                                                                    |
| `pnpm build`           | Next.js creates a production build under `apps/web/.next`; the overview is statically generated with no remote data/fonts.                                                                                           |
| `pnpm build:contract`  | Rust builds fresh host WASM; Node validates its structure/exports/imports and reports its actual hash/size. Separate deployment/historical regressions use an immutable deployed fixture. Uses `--locked --offline`. |
| `pnpm test:production` | Starts the existing production build on an ephemeral loopback port; checks HTTP 200, live-surface/recorded-preview disclosures, metadata and HTTP 404; stops the server. Build first.                                |
| `pnpm verify:offline`  | Runs every check above in order and prints a final PASS only if all pass. No skipped WASM fallback.                                                                                                                  |
| `pnpm format`          | Applies Prettier to project files; use when deliberately fixing formatting, not to bypass checks.                                                                                                                    |

The formatter is launched with `process.execPath` and the installed, exact-pinned
Prettier JavaScript CLI resolved through `createRequire`, never a Windows `.cmd`
shim or shell. It uses the repository root as `cwd`, the unchanged source-file
selection/exclusions, relative filenames, and deterministic batches capped at
7,000 conservative command-size units including executable, CLI and quoting/UTF-8
overhead. An individually oversized argument is an error, not a skipped file.
No drive mapping, shortened-root recipe or `--preserve-symlinks` flag is needed.
`tests/run.test.mjs` exercises real direct Prettier execution in a long/spaced
Unicode temporary root; the complete gate must still be run in each checkout.

`verify:offline` disables Next telemetry and sets Cargo offline mode. It does not call NEAR RPC, GitHub, an indexer, a wallet, or another external service. The production smoke uses loopback HTTP, not a public network endpoint. Dependencies, platform-specific pnpm packages, Rust toolchain, and WASM target must already be available. Run setup again on a new host. This profile proves offline unit/invariant behavior, compilation, WASM structure and local HTTP behavior. It does **not** by itself prove NEAR VM execution, deployed state, treasury integration, browser interaction or signing safety; use the separate recorded evidence and checks for those boundaries.

### Fresh build versus immutable deployed WASM

`tests/wasm.test.mjs` always reads the freshly built
`contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm`.
It checks valid WASM, exact exported registry methods and allowed host imports,
and prints that build's actual `WASM_SHA256` and `WASM_BYTES`. This is a structural
build check, **not** proof that every host reproduces deployed bytes.

Historical deployment/smoke test inputs instead use the immutable public fixture
`tests/fixtures/deployment/9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c.wasm`.
It was copied from the preserved Windows Rust1.98.0 release build of unchanged
contract tree `979db78a521e045676db8dd0564b8d17d24ab8bc`, after independent byte
length/SHA-256 checks against production pins and
`deployments/testnet/prepared-deployment.json`. Its identity is:

- SHA-256 `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`
- Size **261,226 bytes**
- NEAR code hash `Avdrs3wmsssxb3nDDAJsMyFqc137NaSSpF4JNuXGP4zP`
- Deployed transaction `DTkNwnhsF73z4umYgSQgauCLdpPzgtnxeuTb7TE5Dd7R`, post-init
  block `8Ajt9XEfAJVjiSFTo2aTPALWQsZkDpNr4x575BV4uobA`, height276385914.

The read-only historical smoke on 2026-11-08 verified matching archival
`view_code` bytes at that block. This fixture is the verified local build copy,
not a newly fetched response and not a live-RPC fallback. The test-only loader
checks its exact hash, size and code hash against the unchanged production pins
and deployed manifest on every load. Mutation/length-change tests, including
structurally valid WASM with different bytes, must still fail historical checks.
Do not regenerate this fixture from an arbitrary host build.

Linux Verify at commit `a0c7c7d6e94235e17d2af5fa6bc7933516b0dabe` produced
**261,082 bytes**, SHA-256
`17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7`.
Its structural test passed, but using those different bytes as the deployed test
fixture correctly failed the strict deployment pin. Pinned Rust alone did not
establish cross-host byte identity. The cause of the binary difference and
behavioral equivalence are not established here. Production artifact pins,
manifest, receipts and code verification are not relaxed to accept that digest.

## Prepare a testnet deployment without signing — operator-only reference

This is not needed for the hosted demo or judge verification. Deployment remains
a separately authorized operator action. The preparer enforces exact source and
artifact pins; a structurally valid but different host build is not accepted.
Before an operator invokes it, provide a real reviewed source head and account
locally. The following are **argument templates, not a judge-tour command**.

Git Bash/POSIX:

```sh
export COMMONSOPS_SOURCE_HEAD='replace-with-reviewed-full-sha'
CONTRACT_ACCOUNT='replace-with-contract-account.testnet'
node scripts/prepare-testnet-deployment.mjs "$CONTRACT_ACCOUNT"
```

PowerShell:

```powershell
$env:COMMONSOPS_SOURCE_HEAD = 'replace-with-reviewed-full-sha'
$ContractAccount = 'replace-with-contract-account.testnet'
node scripts/prepare-testnet-deployment.mjs $ContractAccount
```

The preparer only reads public account/key/block state and writes ignored unsigned
provenance if its checks pass. Its `near ... sign-later` output describes atomic
DeployContract + FunctionCall:new, 50 TGas and zero deposit on initialization;
preparation does not authorize signing or broadcasting. Never commit generated
unsigned transactions. No deployment or state-changing command is part of the
read-only verification route below. For the existing deployment, use its fixed
historical smoke command rather than provisioning another account.

## Historical read-only verification (no wallet or artifact writes)

Use the public recorded deployment and payout identifiers, without altering their
committed evidence. Node 24 executes the shared TypeScript modules directly.

```text
node scripts/smoke-testnet.mjs commonsops.testnet --stdout-only
node scripts/reconcile-live.mjs --stdout-only
node --test tests/e2e/e2e-replay.test.ts
```

- **Smoke:** verifies the final atomic deployment transaction, exact receipt list
  and initialization receipt block, then `view_account`, `view_code` and
  `foundation_status` at the recorded post-initialization block hash **and height**.
  Checks the reviewed 261,226-byte WASM SHA-256 and NEAR code hash, not just a legacy
  foundation marker. Four logical reads share one context and at most 16 attempts.
- **Reconcile:** re-derives the fixed recorded proposal-0 payout using the production
  `reconcilePayment` adapter, not a newly discovered registry link or payment.
  One historical transaction lookup has at most four attempts. Success is
  `reconciliationStatus: "APPLIED"`, `adapterState: "PAID"`, `recordCount: 1` and
  `snapshotFingerprint: "f1eed9bbbb82e63c2f96a5321b53dd85b9e7395bd54f556a93eccd8482719965"`.
  The original response envelope/numeric types and immutable record provenance
  remain intact; transport endpoint changes must not change this fingerprint.
- **Replay:** five fully offline tests exercise the committed payout fixture and
  fixed expectations, including idempotency and replay conflicts. A replay PASS
  does not establish current RPC availability.

Both live commands use `packages/near/src/read-only-rpc.ts`, the same bounded
transport/scanner as the browser. Only `https://rpc.testnet.near.org` and
`https://archival-rpc.testnet.near.org` are allowed; redirects and arbitrary
endpoints are refused. The browser context still permits only `block`/`query`.
The explicit historical context permits only exact scoped `EXPERIMENTAL_tx_status`
and pinned query requests, never broadcast/sign methods. Every run disposes its
context. Bounds remain four active HTTP requests including bodies, two attempts
per endpoint per call, 250ms backoff, 6s attempt deadline and 40s total deadline.
The stream cap is 2 MiB with fatal UTF-8 and duplicate-safe JSON; depth64,
300,000 nodes and 4 MiB scanner work. `call_function` decoded JSON is capped at
64 KiB; `view_code` base64 WASM uses the larger response bound instead.

Historical HTTP408 and explicit `NOT_OBSERVED`, `UNKNOWN_TRANSACTION` or
`TRANSACTION_UNAVAILABLE` tx-status responses can fail over, along with the
existing transport/timeout/429/5xx/explicit transient classes. HTTP403, parse,
schema, finality, contract and provenance mismatches are not retried. Unknown or
inaccessible historical data terminates as failure, not fake success or a fixture
fallback. No external timeout or repeated polling is required.

Success prints one JSON object with the previous fields plus outer
`runProvenance: { startedAt, elapsedMs, attemptedEndpoints, validatedEndpoints,
attempts }`. Each attempt contains `{ endpoint, method, elapsedMs, httpStatus,
outcome, code }`; this is execution evidence, not a cryptographic RPC proof.
The smoke `rpcUrl` remains the configured primary for compatibility; use
`runProvenance` for actual attempted/validated endpoints. Reconciliation attribution
records and snapshots never contain timing/endpoint data. Failure exits1, prints
`{ status: "FAILED", error: { code, message }, runProvenance }` to stderr and prints
no success JSON to stdout. Argument/preflight errors have null run provenance.
Do not relabel a live failure as PASS because the recorded replay passed.

`--stdout-only` writes no smoke result, replay record or reconciliation snapshot.
Without the flag, the old artifact paths remain:
`deployments/testnet/smoke-result.json`, `replay-record.json` and
`reconciliation-snapshot.json`. They are written only after successful verification,
using individual same-directory atomic replacements (the two reconciliation files
are not a multi-file filesystem transaction). Failed verification leaves existing
successful artifacts unchanged. Unknown/duplicate flags or extra arguments fail;
there is no endpoint override, signing or retry-loop CLI flag.

Focused offline checks (deployment/historical tests use the checked-in deployed
fixture; `pnpm build:contract` also builds and structurally checks fresh host WASM):

```text
node --test tests/run.test.mjs
pnpm --filter @commonsops/near typecheck
pnpm build:contract
node --test scripts/deployment-lib.test.mjs scripts/historical-reads.test.mjs
```

These runner/transport/script regressions also run in `pnpm verify:offline`.

Current web and test-package gates additionally cover selection/hiding authority,
shared-slot time/claim/submission semantics, the checked CLI decoder and public
link/ABI/index consistency. No total count is maintained here; inspect suite
output for the actual head. Replay remains the explicit command above.

## Checked current-view decoding

Requires Node 24 and curl (PowerShell: `curl.exe`) plus this checkout. The examples
in [README](../README.md#read-only-current-view-with-a-checked-decoder) and
[testnet journey](testnet-journey.md#bounded-read-only-view) use finite curl
connect/max timeouts and pipe the response into `node tests/decode-rpc-view.ts`.
NEAR's outer `result.result` is a UTF-8 byte array. The helper uses the existing
bounded, duplicate-safe RPC envelope parser and fatal UTF-8 result decoder; it
prints decoded JSON objects, strings or null, rejects RPC errors/invalid bytes/
invalid UTF-8/invalid JSON, and exits 1 with FAILED JSON on stderr. No network
request or chain mutation is made by the decoder. Set `pipefail` in Git Bash/POSIX
so curl failures cannot be hidden by a pipeline's last exit code.

`get_cycle` arguments are nested `cycle_key` (template_id and period_index decimal
strings), not flattened IDs. A returned OPEN literal is not an in-window or
current-slot promise; use the app's canonical block-time derivation. Unsigned
claim/release examples use a quoted assigned account placeholder and `sign-later`;
never paste shell angle-bracket account tokens or replace that with signing as
part of verification. All executed contributor actions cost gas despite zero
deposit. Syntax checking is limited to `--help`/argument parsing, never executing
the claim/release/submit examples.

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

Open the same loopback URL — see the recorded journey in production mode, with
initially-closed native proof disclosures and a separate live registry section.
Read-only testnet RPC runs in the browser; connecting a wallet allows eligible
contributor actions. Operator and DAO governance/payout stay outside the app.
No secret environment defaults exist. `NEXT_TELEMETRY_DISABLED=1` is build/test
plumbing, not a credential. `foundation_status` is a legacy scaffold literal,
not proof of missing business logic or a custody guarantee. The app refuses
mainnet; migration requires code/configuration/operational validation.

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
cycles; transaction evidence survives refresh/selection/hiding. The state-pattern
gallery's ERROR is an intentional example outside this region and behind a native
disclosure. Scope header wallet checks to `#wallet-connect-button`. The official
selector has no supported ARIA/focus options in 10.1.4; a small adapter observes
only its owned `#near-wallet-selector-modal` root, names the dialog and close button,
places/traps focus, and restores the opener after the library removes its delayed
close transition. It uses the library onHide lifecycle, disconnects observers and
listeners on cleanup, and leaves Escape to the official chooser. Tests use owned-root
stubs, not a mounted DOM harness. Verify no-provider opening/Tab/Shift+Tab/close/
delayed Escape and restoration separately in the official browser. Do not select,
connect or sign a wallet for a no-signing check. Native recorded disclosures must
work with keyboard and without JavaScript; their full SHA/ARIA proof remains in
HTML. These are testing instructions, not a claim they ran on the current head.

## CI

`.github/workflows/verify.yaml` runs on `pull_request` and `push` with only `contents: read`. Third-party actions are pinned to full SHAs verified against actual upstream refs on 2026-11-03: checkout v6.0.2, setup-node v6.0.0, pnpm/action-setup v5.0.0, and dtolnay/rust-toolchain stable (the input still pins Rust 1.98.0). Checkout does not persist credentials. CI installs locked dependencies, then runs the same local offline profile. There are no deployment keys, secret references, `pull_request_target` events, or publish steps. A local pass is not a claim that hosted CI has run.

## GitHub Pages static export

The web workspace also builds as a fully static export for GitHub Pages.
The default `pnpm build` / `pnpm start` path is unchanged and remains
server-rendered; export mode only activates when the build environment sets
`COMMONSOPS_STATIC_EXPORT=1`, which adds `output: "export"`, the
`/CommonsOps` base path, and trailing slashes. Local check:

```sh
COMMONSOPS_STATIC_EXPORT=1 pnpm --filter @commonsops/web exec next build
node --test tests/static-export.test.mjs
```

Run this **after** default production tests finish, not concurrently with a
normal build. Both modes use `apps/web/.next`; rebuild default before `pnpm start`.
The one canonical repository `llms.txt` is read at build time by the forced-static
GET route (`apps/web/app/llms.txt/route.ts`). The footer uses the current base path.
Normal production HTTP checks assert `/llms.txt` bytes and `text/plain` content type;
the static check asserts `apps/web/out/llms.txt` byte equality, the exported footer
link and preserved recorded proof. No copied `public/llms.txt` is maintained.

Pages is hosted at <https://super-user-root.github.io/CommonsOps/> and its index at
<https://super-user-root.github.io/CommonsOps/llms.txt>. The Pages workflow asserts
export/index equality immediately after `next build`. Publishing is gated by
`ENABLE_PAGES=true`; upload/deploy use built-in GITHUB_TOKEN permissions, with
`pages: write` and `id-token: write` only in the deploy job. A local export pass
is not evidence that a new head was published; deployed content must be verified
separately after release. No hosting uptime promise is implied.
