# CommonsOps

CommonsOps is being built for recurring public GitHub documentation maintenance. Community work needs a clear link between a task, submitted evidence, and treasury execution. The intended NEAR role is a work registry alongside an existing Sputnik DAO: the DAO retains governance and custody, and future application code must verify exact finalized proposal-to-transfer execution rather than treat approval as payment.

## Current implementation

**Foundation only; not a working registry or payment application.**

- `apps/web`: a static Next.js overview explicitly showing no live data or transactions. No wallet, RPC, indexer, network configuration, credentials, or remote fonts are used.
- `packages/domain` and `packages/near`: typed, immutable placeholder metadata. No cycle, claim, evidence, or reconciliation behavior.
- `contracts/registry`: a minimal near-sdk contract with `new` and a read-only `foundation_status`, plus the SDK-generated NEP-330 `contract_source_metadata` view. No transfer, claim, proposal, custody, or payment methods. It has not been deployed.
- `tests`: deterministic metadata tests, Rust unit tests, release-WASM validation/export checks, and a local production HTTP smoke check.

Intended product workflows are not implemented. This foundation is not a demonstration of paid work, and an approved DAO proposal is not proof of payment. Registry business rules remain subject to independent architecture/security acceptance.

## Reproduce: do X — see Y

Use **Node 24.18.0**, **pnpm 11.25.0**, and **Rust/cargo 1.98.0** with `rustfmt` and `wasm32-unknown-unknown`. Versions are pinned in `package.json` and `contracts/registry/rust-toolchain.toml`. Next.js **16.4.4**, React/React DOM **19.3.1**, TypeScript **7.0.2**, and near-sdk **5.30.0** are exact registry-verified stable pins. Both lockfiles are committed.

Run from the repository root; no environment file, account, key, or faucet is needed.

1. Run `pnpm install --frozen-lockfile` — see all workspace dependencies installed without lockfile changes.
2. Run `cargo +1.98.0 fetch --locked --manifest-path contracts/registry/Cargo.toml` — populate the Rust dependency cache from the committed lockfile.
3. Run `pnpm verify:offline` — see real format/syntax checks, strict TypeScript checks, three JavaScript metadata tests, Rust unit tests, the production web build, release WASM checks, and a loopback HTTP smoke test pass. This command uses no external application services; it needs dependencies and toolchains installed first.
4. Run `pnpm start` after verification — open `http://127.0.0.1:3000` and see **Foundation / not live**, **Not connected**, and **Disabled**, not fabricated records or wallet controls. Stop with Ctrl+C.

For development run `pnpm dev`. For individual checks, setup requirements, and artifact paths see [docs/COMMANDS.md](docs/COMMANDS.md). CI performs the same locked setup and verification, without secrets or deployment permissions.

## Inputs, baseline, and license

- This is new CommonsOps scaffold code written during the eligible hackathon window beginning 2026-10-19. The initial repository seed contains a short README, ignore patterns, and a standard MIT license; it contains no pre-hackathon product implementation. Initial seed commit: `52a9425eb1ce84071f28d63a763edbc71d42f967`.
- **AI disclosure:** ZCode AI assisted the initial repository setup and this scaffold, including code, tests, CI, and documentation. AI output is subject to independent review; it does not establish product correctness or security.
- No external application template or tutorial was copied. The minimal Next.js and near-sdk setup uses their conventional framework boilerplate/API patterns. Direct libraries/tools are Next.js, React, React DOM, TypeScript, Node/React type definitions, Prettier, and near-sdk. Transitive inputs are inventoried by `pnpm-lock.yaml` and `contracts/registry/Cargo.lock`; those dependencies retain their upstream licenses. The existing project [LICENSE](LICENSE) is standard MIT text, not original product code.
- This is an **initial** input disclosure, not a final submission inventory. Future libraries, templates, reused code, AI inputs, and any earlier baseline changes must be disclosed before publication/submission.
- No other hackathon project has been declared by the project lead; update this disclosure if that changes.

## Boundaries and publication

No new DAO/multisig, token/points issuance, AI payment approval, cross-chain payments, or custody of DAO funds is implemented or included in this scaffold.

The repository may remain private during development. The live [official NEAR Hackathon rules](https://nearhackathon.com/HACKATHON.md) require publication by 2026-11-14T23:59:00Z and continued public access through judging; recheck live rules before relying on these dates. Pushes, publication, deployment, signing/spending, demo posts, and final submission require separate direct human confirmation. This scaffold task performed none of them. A live/testnet product demo, public demo video/post, and final submission are not provided here.
