# Contract hardening measurements

This file is updated by P1-T05 after a reproducible release build. Values are local toolchain evidence, not deployment or NEAR runtime acceptance.

- Rust: 1.98.0
- near-sdk: 5.30.0
- Target: wasm32-unknown-unknown, release profile in Cargo.toml
- Reproducibility result: two consecutive release artifacts, including one after deleting the generated release directory, matched exactly.
- WASM SHA-256: `9376a482c740711803ce30b708221823721fdaef8e24196ca5b78976f8f9410c`.
- WASM size: 261,226 bytes.
- Unit storage fixture (near-sdk mock trie, maximum configured fields): template growth 1,410 bytes; cycle plus proposal index growth 1,127 bytes. These are below 4,096-byte template and 16,384-byte cycle reserve budgets, but they are not NEAR VM/sandbox measurements.
- Adversarial sequence: four periods with alternating claimants, one release/reassignment, canonical evidence, and unique proposal links preserves all record/index invariants.
- Failed-action check: unauthorized replacement/link and reclaim attempts preserve serialized in-memory contract state under the unit harness.
- Gas: no reliable NEAR VM gas benchmark is claimed by native unit tests. Testnet/sandbox gas observations remain P1-T06/P3-T05 evidence.

Reproduce with `pnpm verify:offline`, remove only `contracts/registry/target/wasm32-unknown-unknown/release`, run `pnpm build:contract`, and compare the emitted SHA-256.
