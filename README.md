# FaultScope

Architecture- and OS-agnostic post-mortem debugging platform.

> See what happened before the crash.

This repository has completed Phase 1: the Rust workspace includes an architecture-neutral canonical data model, but analysis functionality is intentionally not implemented yet.

## Requirements

- Rust stable
- Node.js 24 or later
- pnpm 11

## Validation

```sh
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build
```
