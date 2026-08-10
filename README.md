# FaultScope

Architecture- and OS-agnostic post-mortem debugging platform.

> See what happened before the crash.

This repository has completed Phase 9: private artifacts are processed by a durable Vercel Workflow that runs the trusted Rust CLI in an isolated Vercel Sandbox.

```sh
cargo run -p faultscope-cli -- symbolicate --elf firmware.elf 0x08004567
cargo run -p faultscope-cli -- analyze --elf firmware.elf --crash crash.json --log runtime.log
```

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
