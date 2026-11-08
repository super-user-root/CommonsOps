# Contract hardening measurements

This historical P1-T05 record measures the original Windows Rust 1.98.0 release
build. Values are local toolchain evidence, not NEAR runtime acceptance or a
cross-platform byte-equality promise. Later Linux Verify produced 261,082 bytes,
SHA-256 `17266c2ad8f0da768dc8716730cf3ef70157ebe8fe62973d6259e195856300c7`,
which differs from the deployed Windows artifact below. Cause and behavioral
equivalence are unestablished; [COMMANDS](COMMANDS.md#fresh-build-versus-immutable-deployed-wasm)
separates fresh structural checks from the exact historical deployment fixture.

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

Run `pnpm verify:offline` after the documented toolchain/cache setup to inspect
your host's actual structural build result and hash. Compare like-for-like host
builds separately; do not overwrite the immutable historical deployment fixture
with an arbitrary local build or infer deployed-byte identity from structure.
