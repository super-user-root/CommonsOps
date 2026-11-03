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
| `pnpm test`            | Three deterministic tests prove immutable placeholder exports and accurate shell metadata.                                                                                                                                |
| `pnpm test:contract`   | Rust unit tests round-trip initialized scaffold state and reject implicit default initialization. Uses `--locked --offline`.                                                                                              |
| `pnpm build`           | Next.js creates a production build under `apps/web/.next`; the overview is statically generated with no remote data/fonts.                                                                                                |
| `pnpm build:contract`  | Rust creates `contracts/registry/target/wasm32-unknown-unknown/release/commonsops_registry.wasm`; Node validates WASM, exact method exports, and absence of transfer/promise-creation imports. Uses `--locked --offline`. |
| `pnpm test:production` | Starts the existing production build on an ephemeral loopback port, checks HTTP 200, foundation disclosures, metadata, absence of transaction controls, and HTTP 404; stops the server. Build first.                      |
| `pnpm verify:offline`  | Runs every check above in order and prints a final PASS only if all pass. No skipped WASM fallback.                                                                                                                       |
| `pnpm format`          | Applies Prettier to project files; use when deliberately fixing formatting, not to bypass checks.                                                                                                                         |

`verify:offline` disables Next telemetry and sets Cargo offline mode. It does not call NEAR RPC, GitHub, an indexer, a wallet, or another external service. The production smoke uses loopback HTTP, not a public network endpoint. Dependencies, platform-specific pnpm packages, Rust toolchain, and WASM target must already be available. Run setup again on a new host. This profile proves scaffold compilation and local shell behavior, **not** NEAR VM execution, deployment safety, treasury integration, or registry business correctness.

## View the shell

```text
pnpm dev
```

Open `http://127.0.0.1:3000` — see a static CommonsOps overview labeled **Foundation / not live**. Stop with Ctrl+C.

For a production preview:

```text
pnpm build
pnpm start
```

Open the same loopback URL — see the production foundation page, no live records, wallet prompts, or transaction buttons. No secret environment defaults exist. `NEXT_TELEMETRY_DISABLED=1` is supplied by the verification runner/CI, not a credential. No deployment commands are provided.

## CI

`.github/workflows/verify.yaml` runs on `pull_request` and `push` with only `contents: read`. Third-party actions are pinned to full SHAs verified against actual upstream refs on 2026-11-03: checkout v6.0.2, setup-node v6.0.0, pnpm/action-setup v5.0.0, and dtolnay/rust-toolchain stable (the input still pins Rust 1.98.0). Checkout does not persist credentials. CI installs locked dependencies, then runs the same local offline profile. There are no deployment keys, secret references, `pull_request_target` events, or publish steps. A local pass is not a claim that hosted CI has run.
