# FaultScope

Architecture- and OS-agnostic post-mortem debugging platform.

> See what happened before the crash.

This repository has completed Phase 13: private artifacts are processed by a durable Vercel Workflow, the trusted Rust CLI produces evidence-backed deterministic findings, and canonical FreeRTOS task/ISR events render as an execution-lane timeline.

```sh
cargo run -p faultscope-cli -- symbolicate --elf firmware.elf 0x08004567
cargo run -p faultscope-cli -- analyze --elf firmware.elf --crash crash.json --log runtime.log
```

Canonical environment events can share the runtime log:

```text
0.101200 [EVENT] task_switch task.sensor SensorTask scheduled
2.180000 [EVENT] isr_enter isr.adc ADC interrupt entered
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
