# Architecture

FaultScope keeps processor logic behind `faultscope-core::ArchitectureProvider`. The generic model stores register roles, decoded fault classes, and evidence-ready facts without assuming a processor or execution environment.

The first provider, `faultscope-arch-cortex-m`, currently supplies:

- PC, LR, SP, and xPSR register semantics
- Thumb address normalization for instruction and return addresses
- evidence-backed PC and LR initial frames
- deterministic CFSR, HFSR, MMFAR, and BFAR decoding

An exception-return LR is control state rather than a caller address, so it is not emitted as a frame. Finding generation and integrated CLI analysis belong to later phases.

`faultscope-core::Analyzer` combines selected architecture, environment, and symbol providers. Provider selection is isolated in `faultscope-registry`; the CLI and core do not branch on processor-specific fault semantics.
