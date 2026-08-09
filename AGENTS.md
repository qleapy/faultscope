# FaultScope

## Project rules

- Use Ponytail for applicable implementation, modification, review, and restructuring work.
- Use UI/UX Pro Max before significant UI/UX design or implementation work.
- FaultScope core must remain processor-, OS-, RTOS-, and bare-metal agnostic.
- Cortex-M is the first architecture provider, not a core assumption.
- Bare-metal is a first-class execution environment, not the absence of an OS.
- Keep architecture, environment, artifact, snapshot, symbol, unwind, and trace logic behind provider interfaces.
- Adding a processor or OS must not require redesigning generic incident, event, or finding types.
- Rust is the source of truth for crash analysis; do not parse ELF or DWARF in TypeScript.
- Keep analysis code independent from UI and Vercel-specific code.
- Treat uploaded artifacts as untrusted input and never execute uploaded firmware.
- Never invent symbols, source locations, stack frames, or evidence.
- Findings must reference evidence. New parsers and public Rust APIs require tests.
- Do not add AI analysis before deterministic analysis exists.
- Implement one development phase at a time.

## Required validation

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build
```
