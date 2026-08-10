# Architecture

FaultScope keeps processor logic behind `faultscope-core::ArchitectureProvider`. The generic model stores register roles, decoded fault classes, and evidence-ready facts without assuming a processor or execution environment.

The first provider, `faultscope-arch-cortex-m`, currently supplies:

- PC, LR, SP, and xPSR register semantics
- Thumb address normalization for instruction and return addresses
- evidence-backed PC and LR initial frames
- deterministic CFSR, HFSR, MMFAR, and BFAR decoding

An exception-return LR is control state rather than a caller address, so it is not emitted as a frame.

`faultscope-core::Analyzer` combines selected architecture, environment, and symbol providers. Provider selection is isolated in `faultscope-registry`; the CLI and core do not branch on processor-specific fault semantics.

## Deterministic finding engine

`faultscope-core::IncidentRule` runs against an architecture-neutral `AnalysisContext` after frame resolution and fault decoding. The default rules execute in a stable order:

1. decoded fault-register state
2. low semantic fault address (possible null-based access)
3. resolved instruction pointer
4. unresolved instruction pointer
5. stack pointer outside an explicitly recorded range

Every finding contains non-empty evidence linked to a fact, frame, or register. Cortex-M exposes valid MMFAR/BFAR values as semantic fault addresses; the core does not inspect Cortex-M fact names. Stack bounds are read only from `memory.stack.start` and `memory.stack.end`, so the engine never guesses a target memory map.
