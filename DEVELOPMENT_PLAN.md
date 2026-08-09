# FaultScope
## Codex Development Guide

> **FaultScope** — Architecture- and OS-agnostic post-mortem debugging platform  
> First reference implementation: **ARM Cortex-M + bare-metal**  
> Tagline: **See what happened before the crash.**

---

## 1. Purpose

The official project and product name is **FaultScope**.

Use these names consistently:

```text
Product:       FaultScope
Repository:    faultscope
CLI command:   faultscope
Rust crates:   faultscope-*
Web app:       FaultScope
```

FaultScope is a general-purpose post-mortem debugging and execution-analysis platform.

It must support multiple combinations of:

- processor architectures
- bare-metal firmware
- RTOS environments
- general-purpose operating systems
- executable/debug artifact formats
- crash-dump formats
- runtime trace formats
- symbol/debug-information providers

The first vertical slice is ARM Cortex-M + bare-metal, but **no architecture-neutral core model or API may assume Cortex-M, an RTOS, or any specific OS**.

Typical analysis inputs include:

- executable/debug artifacts such as ELF / DWARF
- crash dumps
- runtime logs and traces
- register state
- architecture-specific exception/fault state
- OS/RTOS process, thread, task, scheduler, and synchronization metadata
- source and build information

The long-term goal is to reconstruct what happened before a crash and present the result as an interactive timeline.

```text
ELF / DWARF / MAP
        +
Crash Dump
        +
Runtime Trace / Logs
        +
Git / Source
        │
        ▼
Canonical Analysis Model
        │
        ├── Symbolication
        ├── Fault Decode
        ├── Stack Reconstruction
        ├── Timeline Reconstruction
        ├── Deterministic Findings
        └── Optional AI Explanation
        │
        ▼
Interactive Crash Timeline
```

The product must behave primarily as a **deterministic debugging tool**, not as an AI log summarizer.

---

#
# 2. Mandatory Development Skills

The following skills are mandatory project-level development rules.

## 2.1 Ponytail

Use the **Ponytail** skill for applicable FaultScope development work.

```text
[@ponytail](plugin://ponytail@ponytail)
```

Ponytail must be used when implementing, modifying, reviewing, or restructuring the application unless the task is clearly outside its scope.

Development agents must:

1. use Ponytail before beginning applicable implementation work,
2. preserve the architecture and phase boundaries in this document,
3. apply Ponytail guidance together with `AGENTS.md`,
4. never bypass deterministic-analysis, parser-safety, evidence, or security requirements,
5. report conflicts rather than silently changing architecture.

Ponytail does not override the hard rules in this document.

## 2.2 UI/UX Pro Max

All significant UI/UX work must use the **UI/UX Pro Max** skill.

```text
[@ui-ux-pro-max](plugin://ui-ux-pro-max@ui-ux-pro-max-skill)
```

This requirement applies to:

- page and dashboard layout
- information architecture
- visual hierarchy
- component composition
- timeline interaction
- navigation
- responsive behavior
- accessibility
- loading, empty, failure, and retry states
- visual polish

Before a substantial UI change:

1. use UI/UX Pro Max,
2. inspect the existing design system and screens,
3. define the information hierarchy,
4. implement consistently with existing FaultScope UI,
5. validate responsive behavior and accessibility,
6. ensure technical evidence remains easy to inspect.

The UI must clearly distinguish:

```text
Fact
Interpretation
Confidence
Evidence
Unknown / unavailable information
```

FaultScope is a debugging product. Clarity and evidence traceability take precedence over decoration.

## 2.3 Skill Precedence

For normal implementation work:

```text
AGENTS.md
    +
DEVELOPMENT_PLAN.md
    +
Ponytail
    +
task-specific requirements
```

For UI/UX work:

```text
AGENTS.md
    +
DEVELOPMENT_PLAN.md
    +
Ponytail
    +
UI/UX Pro Max
    +
task-specific requirements
```

If skill guidance conflicts with a hard architectural or security requirement, preserve the hard requirement and report the conflict.

---

# 3. Fundamental Design Principle

The most important rule in this project is:

> **AI must never be the source of truth for crash analysis.**

Analysis must be performed in this order:

```text
raw artifacts
    ↓
parsers
    ↓
canonical data model
    ↓
deterministic analysis
    ↓
evidence-backed findings
    ↓
optional AI explanation
```

AI may:

- summarize findings
- explain technical information
- suggest investigation steps
- correlate already-established evidence

AI must not determine:

- register values
- fault classification
- symbol names
- source locations
- timeline ordering
- stack frames
- memory addresses

---

# 4. MVP Scope

The first usable version intentionally implements one narrow vertical slice, while the underlying architecture must remain generic.

## 3.1 Supported

### First Reference Target

- ARM Cortex-M
- bare-metal execution environment

This is a reference backend, not a limitation of the core architecture.

### Artifacts

- ELF
- DWARF
- text runtime log
- JSON crash dump

### Analysis

- PC symbolication
- LR symbolication
- source file / line resolution
- Cortex-M fault register decoding
- PC/LR display
- deterministic findings
- timestamped log timeline

### UI

- incident overview
- interactive timeline
- findings
- registers
- fault decode
- source location
- PC/LR frames
- artifact information

---

## 3.2 Explicitly Out of Scope for MVP

Do **not** implement these until the MVP is complete:

- full FreeRTOS support
- Zephyr support
- Linux process/core-dump support
- other OS adapters
- ETM trace
- SWO trace
- CAN trace
- PCAP
- production AArch64 backend
- production RISC-V backend
- production x86_64 backend
- full stack unwinding
- DWARF CFI unwinding
- `.ARM.exidx` unwinding
- device auto-upload
- billing
- public multi-tenant SaaS
- AI root-cause determination
- cross-clock synchronization

---


# 5. Generic Target Architecture

FaultScope must be structured as a **platform plus adapters**, not as a Cortex-M debugger with later special cases.

The core must distinguish at least these dimensions:

```text
Target
├── Processor Architecture
│   ├── ARM / Thumb
│   ├── AArch64
│   ├── RISC-V 32 / 64
│   ├── x86_64
│   └── future architectures
│
├── Execution Environment
│   ├── Bare Metal
│   ├── RTOS
│   │   ├── FreeRTOS
│   │   ├── Zephyr
│   │   └── future RTOSes
│   └── General-Purpose OS
│       ├── Linux
│       └── future OSes
│
├── Artifact Format
│   ├── ELF / DWARF
│   ├── MAP
│   ├── raw image
│   └── future formats
│
├── Crash / Snapshot Format
│   ├── canonical FaultScope JSON
│   ├── architecture-specific dump
│   ├── OS core dump
│   └── vendor-specific dump
│
└── Runtime Trace Source
    ├── text log
    ├── scheduler trace
    ├── CPU trace
    ├── protocol trace
    └── user-defined trace
```

No single dimension may be used as a proxy for another.

Examples:

- ARM does not imply Cortex-M.
- Cortex-M does not imply FreeRTOS.
- RISC-V does not imply bare-metal.
- ELF does not imply Linux.
- Linux does not imply x86_64.

---

## 5.1 Target Descriptor

Represent the target explicitly.

Conceptual model:

```rust
pub struct TargetDescriptor {
    pub architecture: ArchitectureId,
    pub execution_environment: ExecutionEnvironmentId,
    pub endian: Endianness,
    pub pointer_width: PointerWidth,
    pub abi: Option<AbiId>,
    pub machine: Option<String>,
}
```

Examples:

```text
arm.cortex-m4 + baremetal
arm.cortex-m7 + freertos
aarch64 + linux
riscv32 + baremetal
riscv64 + zephyr
x86_64 + linux
```

Do not encode these combinations as a single giant enum.

---

## 5.2 Architecture Provider Interface

Architecture-specific logic belongs behind an interface.

Conceptual interface:

```rust
pub trait ArchitectureProvider: Send + Sync {
    fn id(&self) -> ArchitectureId;

    fn normalize_address(
        &self,
        address: TargetAddress,
        context: &AddressContext,
    ) -> Result<TargetAddress, ArchitectureError>;

    fn decode_exception(
        &self,
        snapshot: &TargetSnapshot,
    ) -> Result<Vec<Fact>, ArchitectureError>;

    fn initial_frames(
        &self,
        snapshot: &TargetSnapshot,
    ) -> Result<Vec<StackFrame>, ArchitectureError>;

    fn register_schema(&self) -> RegisterSchema;
}
```

Architecture providers must contain:

- register semantics
- exception/trap decoding
- instruction-set-specific address normalization
- architecture-specific initial-frame extraction
- optional architecture-specific unwind support

They must not contain:

- UI behavior
- database code
- Vercel code
- RTOS task decoding
- Linux process semantics

---

## 5.3 Execution Environment Provider Interface

OS/RTOS/bare-metal knowledge belongs behind a separate interface.

```rust
pub trait EnvironmentProvider: Send + Sync {
    fn id(&self) -> ExecutionEnvironmentId;

    fn reconstruct_entities(
        &self,
        context: &AnalysisContext,
    ) -> Result<Vec<ExecutionEntity>, EnvironmentError>;

    fn decode_events(
        &self,
        input: &TraceInput,
    ) -> Result<Vec<Event>, EnvironmentError>;

    fn analyze(
        &self,
        context: &AnalysisContext,
    ) -> Result<Vec<Finding>, EnvironmentError>;
}
```

An execution entity may represent:

```text
CPU
core
process
thread
RTOS task
ISR / exception context
bare-metal main context
user-defined execution lane
```

Bare-metal must be a first-class execution environment, not a special case represented by `None`.

---

## 5.4 Artifact and Dump Providers

Parsing must also be extensible.

Conceptual interfaces:

```rust
pub trait ArtifactProvider: Send + Sync {
    fn probe(&self, bytes: &[u8]) -> ProbeResult;
    fn load(&self, input: ArtifactInput) -> Result<DebugArtifact, ArtifactError>;
}

pub trait SnapshotProvider: Send + Sync {
    fn probe(&self, input: &SnapshotInput) -> ProbeResult;
    fn parse(&self, input: SnapshotInput) -> Result<TargetSnapshot, SnapshotError>;
}
```

This allows FaultScope to support new artifact and dump formats without modifying the central analyzer.

---

## 5.5 Symbol and Unwind Providers

Symbolication and unwinding are capabilities, not architecture identities.

```rust
pub trait SymbolProvider: Send + Sync {
    fn resolve(
        &self,
        address: TargetAddress,
    ) -> Result<SymbolizedAddress, SymbolError>;
}

pub trait UnwindProvider: Send + Sync {
    fn unwind(
        &self,
        context: &UnwindContext,
    ) -> Result<Vec<StackFrame>, UnwindError>;
}
```

Possible future implementations include:

```text
DWARF symbols
ELF symbol table
MAP symbols
DWARF CFI
ARM EHABI / .ARM.exidx
frame-pointer unwind
OS core-dump unwind
heuristic stack scan
```

The core may combine multiple providers while retaining provenance and confidence.

---

## 5.6 Capability-Based Analysis

Do not branch the central analyzer with large chains such as:

```rust
match architecture {
    CortexM => ...
    RiscV => ...
    X86_64 => ...
}
```

Prefer capability discovery and provider dispatch.

Conceptually:

```text
AnalysisSession
    │
    ├── ArchitectureProvider
    ├── EnvironmentProvider
    ├── ArtifactProvider(s)
    ├── SnapshotProvider
    ├── SymbolProvider(s)
    ├── UnwindProvider(s)
    ├── TraceProvider(s)
    └── AnalysisRule(s)
```

The central analysis pipeline operates on normalized models and provider capabilities.

---

## 5.7 Generic Address and Register Types

Do not assume:

- 32-bit addresses
- little-endian targets
- ARM register names
- PC/LR/SP as universal registers

Use generic types.

```rust
pub struct TargetAddress {
    pub value: u64,
    pub address_space: AddressSpaceId,
}

pub struct RegisterValue {
    pub register: RegisterId,
    pub value: RegisterBits,
}
```

Architecture providers may expose semantic roles:

```text
instruction_pointer
stack_pointer
frame_pointer
return_address
status_register
exception_cause
fault_address
```

The UI should primarily consume semantic roles and labels from the provider rather than hard-coded `PC`, `LR`, or `CFSR` fields.

---

## 5.8 Generic Incident Model

The architecture-neutral `Incident` must not contain Cortex-M-specific fields.

Prefer:

```rust
pub struct Incident {
    pub id: IncidentId,
    pub target: TargetDescriptor,
    pub build: BuildInfo,
    pub snapshot: TargetSnapshot,
    pub execution_entities: Vec<ExecutionEntity>,
    pub events: Vec<Event>,
    pub findings: Vec<Finding>,
}
```

Architecture/environment-specific data may be attached as typed facts or namespaced attributes.

For example:

```text
arch.arm.cortex_m.cfsr
arch.riscv.mcause
os.linux.signal
rtos.freertos.task_state
```

The core model remains unchanged when a new architecture or OS is added.

---

## 5.9 Plugin / Registry Model

Provider registration must be explicit.

Conceptually:

```rust
registry.register_architecture(ArmCortexMProvider::new());
registry.register_environment(BareMetalProvider::new());
registry.register_artifact(ElfDwarfProvider::new());
registry.register_snapshot(FaultScopeJsonSnapshotProvider::new());
```

The first implementation may use static Rust registration.

Dynamic plugins are not required for MVP, but the API must not prevent them later.

---

## 5.10 Genericity Acceptance Criteria

Before the Cortex-M vertical slice is considered architecturally acceptable, tests must prove that the core can represent at least these synthetic target descriptors without changing its data model:

```text
ARM Cortex-M + bare-metal
ARM Cortex-M + FreeRTOS
AArch64 + Linux
RISC-V 32 + bare-metal
RISC-V 64 + Zephyr
x86_64 + Linux
```

Actual full analysis support is not required for all of them in MVP.

The requirement is that:

- serialization works,
- target descriptors work,
- generic events work,
- execution entities work,
- findings/evidence work,
- architecture-specific facts do not leak into generic types.

This is a hard acceptance criterion.

---

# 6. High-Level Architecture

```text
                        Browser
                           │
              ┌────────────┴────────────┐
              │                         │
         Next.js UI                Artifact Upload
              │                         │
              │                    Vercel Blob
              │                         │
              └────────────┬────────────┘
                           │
                           ▼
                    Analysis Request
                           │
                           ▼
                  Vercel Workflow
                           │
                           ▼
                   Vercel Sandbox
                           │
                           ▼
                     faultscope-cli
                           │
              ┌────────────┼────────────┐
              │            │            │
        faultscope-core   faultscope-cortex-m  faultscope-model
              │            │            │
              └────────────┼────────────┘
                           │
                           ▼
                    Analysis Result
                           │
                  ┌────────┴────────┐
                  │                 │
             PostgreSQL       Vercel Blob
                  │                 │
                  └────────┬────────┘
                           │
                           ▼
                         UI
```

---

# 7. Repository Structure

Use a monorepo.

```text
faultscope/
├── AGENTS.md
├── DEVELOPMENT_PLAN.md
├── README.md
├── Cargo.toml
├── package.json
├── pnpm-workspace.yaml
│
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── public/
│
├── crates/
│   ├── faultscope-model/
│   ├── faultscope-core/
│   ├── faultscope-registry/
│   ├── faultscope-artifact-elf/
│   ├── faultscope-arch-cortex-m/
│   ├── faultscope-env-baremetal/
│   └── faultscope-cli/
│
├── packages/
│   └── schema/
│
├── fixtures/
│   ├── crashes/
│   ├── logs/
│   ├── elf/
│   ├── analysis/
│   └── demo/
│
├── docs/
│   ├── architecture.md
│   ├── crash-format.md
│   ├── event-model.md
│   ├── symbolication.md
│   └── adr/
│
└── .github/
    └── workflows/
```

---

# 8. Technology Stack

## Web

- Next.js
- TypeScript
- React
- Tailwind CSS
- shadcn/ui
- Canvas 2D

## Backend

- Next.js Route Handlers
- PostgreSQL
- Drizzle ORM
- Vercel Blob
- Vercel Workflow
- Vercel Sandbox

## Analysis Core

- Rust
- `object`
- `gimli`
- `addr2line`
- `serde`
- `serde_json`
- `thiserror`
- `clap`

## Required Development Skills

- Ponytail — mandatory for applicable implementation, modification, and review work
- UI/UX Pro Max — mandatory for significant UI/UX design and implementation

## Testing

- `cargo test`
- Vitest
- Playwright

Use compatible stable package versions at implementation time.

---

# 9. Component Responsibilities

## 7.1 `faultscope-model`

Contains shared deterministic domain types.

Examples:

- `Incident`
- `CrashInfo`
- `RegisterSet`
- `FaultRegisters`
- `Event`
- `Finding`
- `Evidence`
- `StackFrame`
- `SymbolizedAddress`

This crate must not depend on UI or Vercel.

---

## 8.2 `faultscope-core`

Architecture-, OS-, RTOS-, and deployment-independent analysis orchestration.

Responsibilities:

- canonical analysis session
- provider capability dispatch
- generic log/event normalization
- finding infrastructure
- evidence graph
- analysis orchestration
- provider-independent error model

It must not directly decode Cortex-M, RISC-V, Linux, FreeRTOS, ELF, or other target-specific formats.

---

## 8.3 Provider Crates

Target-specific behavior is split into provider crates.

Initial providers:

```text
faultscope-artifact-elf
faultscope-arch-cortex-m
faultscope-env-baremetal
```

Future providers may include:

```text
faultscope-arch-aarch64
faultscope-arch-riscv
faultscope-arch-x86_64
faultscope-env-freertos
faultscope-env-zephyr
faultscope-env-linux
```

Architecture providers contain architecture semantics.

Environment providers contain OS/RTOS/bare-metal semantics.

Artifact providers contain executable/debug-file parsing.

No provider crate may contain web or Vercel code.

---

## 8.4 `faultscope-registry`

Provider registration and capability lookup.

Responsibilities:

- architecture provider registration
- environment provider registration
- artifact provider registration
- snapshot provider registration
- symbol provider registration
- unwind provider registration
- explicit capability lookup

MVP may use static registration.

---

## 8.5 `faultscope-cli`

CLI frontend for the Rust analysis engine.

Typical command:

```bash
faultscope analyze \
  --elf firmware.elf \
  --crash crash.json \
  --log runtime.log \
  --output result.json
```

The web service eventually executes this CLI in Vercel Sandbox.

The CLI must therefore remain usable independently from the web application.

---

# 10. Trust Boundaries

Every uploaded artifact is untrusted.

Never execute an uploaded firmware ELF.

```text
BAD:

./uploaded-firmware.elf
```

ELF files must only be parsed as data.

All parsers must:

- enforce input size limits
- avoid panics on malformed files
- avoid unchecked indexing
- return structured errors
- tolerate unknown or optional fields where appropriate

Avoid `unwrap()` in code paths that process user input.

---

# 11. Canonical Data Model

## 9.1 Incident

```rust
pub struct Incident {
    pub id: IncidentId,
    pub target: TargetDescriptor,
    pub build: BuildInfo,
    pub snapshot: TargetSnapshot,
    pub execution_entities: Vec<ExecutionEntity>,
    pub events: Vec<Event>,
    pub findings: Vec<Finding>,
}
```

---

## 9.2 Event

```rust
pub struct Event {
    pub id: EventId,

    /// Nanoseconds relative to incident origin.
    pub timestamp_ns: u64,

    pub source: EventSource,
    pub kind: EventKind,

    pub cpu: Option<u16>,
    pub task_id: Option<u32>,
    pub address: Option<u64>,

    pub attributes: serde_json::Value,
}
```

Initial event types:

```rust
pub enum EventKind {
    Log,
    Fault,
    Exception,
    UserMarker,
}
```

Future event types may include:

```text
TaskSwitch
TaskCreate
TaskDelete
IsrEnter
IsrExit
MutexWait
MutexLock
MutexUnlock
WatchdogFeed
MemoryAlloc
MemoryFree
IoBegin
IoEnd
```

---

# 12. Findings and Evidence

A finding is an interpretation produced by deterministic analysis.

```rust
pub struct Finding {
    pub id: FindingId,
    pub severity: Severity,
    pub confidence: f32,
    pub kind: FindingKind,
    pub title: String,
    pub description: String,
    pub evidence: Vec<Evidence>,
}
```

A finding must always reference evidence.

Example:

```text
Possible null pointer access

Severity: High
Confidence: 0.97

Evidence:
- CFSR indicates a precise data bus fault
- BFAR is valid
- BFAR = 0x00000004
- PC resolves to sensor_update()
```

Do not state uncertain interpretations as facts.

Prefer:

```text
Possible null pointer access
```

over:

```text
Definite null pointer dereference
```

unless the evidence actually proves it.

---

# 13. Stack Frame Policy

Never invent stack frames.

Every frame must indicate its origin.

```rust
pub enum FrameOrigin {
    ExceptionFrame,
    LinkRegister,
    DwarfCfi,
    ArmExidx,
    FramePointer,
    Heuristic,
}
```

Recommended model:

```rust
pub struct StackFrame {
    pub address: u64,
    pub symbol: Option<String>,
    pub source: Option<SourceLocation>,
    pub origin: FrameOrigin,
    pub confidence: f32,
}
```

For the MVP:

- PC becomes frame 0
- LR may be shown as a candidate frame
- LR must not automatically be called the caller
- full stack unwinding is deferred

Example:

```text
#0 sensor_update()
   sensor.c:184
   origin: exception-frame
   confidence: 100%

#1 main_loop()
   main.c:91
   origin: link-register
   confidence: 60%
```

---

# 14. Crash Dump Format v1

Define one standard JSON format first.

Example:

```json
{
  "format": "faultscope-crash-v1",

  "target": {
    "architecture": "arm.cortex-m",
    "execution_environment": "baremetal",
    "endian": "little",
    "pointer_width": 32,
    "abi": "aapcs"
  },

  "timestamp": "2026-08-10T00:00:00Z",
  "build_id": "example-build-001",

  "registers": [
    { "id": "arm.r0", "value": "0x00000000" },
    { "id": "arm.r1", "value": "0x20001000" },
    { "id": "arm.r2", "value": "0x00000004" },
    { "id": "arm.r3", "value": "0x00000000" },
    { "id": "arm.r12", "value": "0x00000000" },
    { "id": "arm.lr", "value": "0x08001235" },
    { "id": "arm.pc", "value": "0x08004567" },
    { "id": "arm.xpsr", "value": "0x21000000" },
    { "id": "arm.sp", "value": "0x20003f80" }
  ],

  "facts": {
    "arch.arm.cortex_m.cfsr": "0x00008200",
    "arch.arm.cortex_m.hfsr": "0x40000000",
    "arch.arm.cortex_m.mmfar": "0x00000000",
    "arch.arm.cortex_m.bfar": "0x00000004"
  }
}
```

Create a JSON Schema for this format.

---

# 15. Analysis Output Format v1

The CLI must produce machine-readable JSON.

Example:

```json
{
  "format": "faultscope-analysis-v1",

  "crash": {
    "architecture": "arm-cortex-m",

    "pc": {
      "address": "0x08004567",
      "symbol": "sensor_update",
      "file": "src/sensor.c",
      "line": 184
    },

    "lr": {
      "address": "0x08001235",
      "symbol": "main_loop",
      "file": "src/main.c",
      "line": 91
    }
  },

  "frames": [],
  "events": [],
  "findings": []
}
```

Rules:

- stdout is reserved for structured output
- diagnostics go to stderr
- unavailable information must use `null`
- missing symbols are not fatal errors

---

# 16. Runtime Log Format v1

Start with one canonical text format.

```text
0.000100 [INFO] system boot
0.101200 [INFO] sensor task start
2.203100 [WARN] sensor timeout
2.204300 [ERROR] invalid sample
2.205000 [FAULT] hardfault
```

Each valid line becomes an `Event`.

Malformed lines must not cause the entire import to fail.

Diagnostics should expose counts such as:

```text
Parsed lines: 921
Ignored lines: 3
```

---

# 17. Timeline Rendering Model

The timeline may eventually contain millions of events.

Do not model every visible event as a React DOM element.

For the MVP:

- React handles controls and panels
- Canvas 2D handles timeline rendering

Viewport model:

```ts
type TimelineViewport = {
  startNs: bigint;
  endNs: bigint;
};
```

Avoid storing absolute nanosecond values directly as JavaScript `number`.

For rendering calculations, convert values relative to the viewport origin.

Initial interactions:

- mouse wheel: zoom
- drag: pan
- click event: select
- double-click: zoom to event
- Home: fit all

Initial performance target:

> 10,000 events should remain interactive.

WebGL and LOD optimization are post-MVP work.

---

# 18. Database Model

Do not store large binary artifacts directly in PostgreSQL.

Suggested tables:

```text
projects
builds
incidents
artifacts
analysis_runs
findings
```

Example `artifacts` fields:

```text
id
incident_id
kind
filename
blob_url
size
sha256
created_at
```

Large event streams should eventually live in Blob/object storage, not one huge SQL `events` table.

---

# 19. Incident State Machine

Use explicit analysis states.

```text
UPLOADING
    ↓
READY
    ↓
QUEUED
    ↓
ANALYZING
    ↓
COMPLETE
```

Failure may occur from queueing or analysis:

```text
FAILED
```

Transitions must be explicit and validated.

---

# 20. Development Phases

The project must be implemented phase by phase.

Do **not** ask Codex to implement the full plan in one task.

---

## Phase 0 — Repository Bootstrap

### Goal

Create the project skeleton and validation pipeline.

### Implement

1. monorepo
2. Next.js application
3. Cargo workspace
4. `faultscope-model`
5. `faultscope-core`
6. `faultscope-registry`
7. `faultscope-artifact-elf`
8. `faultscope-arch-cortex-m`
9. `faultscope-env-baremetal`
10. `faultscope-cli`
11. lint/test scripts
12. GitHub Actions
13. `AGENTS.md`
14. document the mandatory Ponytail development rule
15. document the mandatory UI/UX Pro Max rule for UI work

### Web placeholder

Display:

```text
FaultScope
Development build
```

### Acceptance Criteria

These must pass:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build
```

Do not implement analysis functionality yet.

---

## Phase 1 — Canonical Data Model

### Goal

Create stable shared domain types that are independent of processor architecture and execution environment.

Before implementing Cortex-M-specific fields, define:

- `TargetDescriptor`
- `ArchitectureId`
- `ExecutionEnvironmentId`
- `TargetSnapshot`
- `ExecutionEntity`
- `RegisterId`
- `RegisterValue`
- `TargetAddress`
- provider-neutral fact/evidence types

The generic model must be able to serialize synthetic ARM, AArch64, RISC-V, and x86_64 targets without changing the schema.

### Implement

- `Incident`
- `CrashInfo`
- `RegisterSet`
- `FaultRegisters`
- `Event`
- `Finding`
- `Evidence`
- `StackFrame`
- `SymbolizedAddress`

Use newtypes for identifiers.

Example:

```rust
pub struct EventId(pub u64);
```

### Tests

Cover at least:

- valid crash JSON
- missing PC
- invalid hexadecimal register
- unknown architecture
- extra fields
- serialization round trip

### Acceptance Criteria

```text
crash.json
    ↓
deserialize
    ↓
serialize
    ↓
equivalent model
```

---

## Phase 2 — ELF / DWARF Symbolication

### Goal

Resolve machine addresses to functions and source locations.

### Interface

```rust
pub trait SymbolResolver {
    fn resolve(
        &self,
        address: u64,
    ) -> Result<SymbolizedAddress, SymbolError>;
}
```

Implement the generic `SymbolProvider` contract and an ELF/DWARF-backed implementation. ELF/DWARF is one artifact/symbol provider, not a core assumption.

### Resolve

- address
- symbol
- source file
- line
- column where available

### CLI

```bash
faultscope symbolicate \
  --elf firmware.elf \
  0x08004567
```

Example output:

```json
{
  "address": "0x08004567",
  "symbol": "sensor_update",
  "file": "src/sensor.c",
  "line": 184
}
```

### Behavior

DWARF missing:

- symbol resolution may still succeed

Symbols missing:

```json
{
  "address": "0x08004567",
  "symbol": null,
  "file": null,
  "line": null
}
```

This is not a fatal error.

### Tests

- ELF with symbols
- ELF with DWARF
- stripped ELF
- invalid ELF
- truncated ELF
- address outside image

---

## Phase 3 — First Architecture Provider: Cortex-M

### Goal

Implement the first `ArchitectureProvider` using Cortex-M and decode Cortex-M fault state deterministically.

### Inputs

- PC
- LR
- SP
- xPSR
- CFSR
- HFSR
- MMFAR
- BFAR

### Model

```rust
pub struct FaultDecode {
    pub fault_classes: Vec<FaultClass>,
    pub facts: Vec<FaultFact>,
}
```

### Example chain

```text
CFSR
  ↓
BusFault
  ↓
Precise data bus error
  ↓
BFAR valid
  ↓
BFAR = 0x00000004
```

### Initial heuristic finding

A limited evidence-backed rule may be added:

```text
memory access fault
+
valid fault address below 0x100
```

may produce:

```text
Possible null pointer access
```

with confidence.

It must not claim certainty.

---

## Phase 4 — Integrated Crash Analyzer

### Goal

Combine crash dump, symbolication, and Cortex-M decoding.

### Interface

```rust
pub struct Analyzer {
    // dependencies
}

impl Analyzer {
    pub fn analyze(
        &self,
        request: AnalysisRequest,
    ) -> Result<AnalysisResult, AnalysisError>;
}
```

### Pipeline

```text
load snapshot
    ↓
resolve target descriptor
    ↓
select architecture/environment providers
    ↓
extract semantic instruction/return addresses
    ↓
resolve symbols/source
    ↓
decode provider-specific exception state
    ↓
generate normalized facts/findings
    ↓
AnalysisResult
```

### CLI

```bash
faultscope analyze \
  --elf firmware.elf \
  --crash crash.json
```

### Milestone

At the end of Phase 4, the analysis engine must already be useful without any web application.

---

## Phase 5 — Runtime Log Parser

### Goal

Convert canonical runtime logs into timeline events.

### Pipeline

```text
text log
    ↓
parser
    ↓
Event[]
```

### Requirements

- relative timestamps
- preserved original text
- parsed severity
- tolerant of malformed lines
- diagnostics for skipped lines

### Milestone

After Phase 5:

```text
ELF
+
crash JSON
+
runtime log
    ↓
faultscope analyze
    ↓
complete deterministic MVP analysis JSON
```

This is the first major project milestone.

---

## Phase 6 — Fixture-Driven Web UI

> **Mandatory:** Use Ponytail and `[@ui-ux-pro-max](plugin://ui-ux-pro-max@ui-ux-pro-max-skill)` before designing or implementing this phase.

### Goal

Build the complete incident UI without production infrastructure.

Use fixture analysis JSON only.

### Components

```text
IncidentHeader
Timeline
TimelineLane
TimelineEvent
FindingsPanel
RegistersPanel
FaultPanel
StackFramePanel
SourceLocationPanel
ArtifactPanel
```

### Suggested layout

```text
┌─────────────────────────────────────────────────────┐
│ Incident #001                 HardFault      CRASH  │
├─────────────────────────────────────────────────────┤
│ Timeline                                            │
│                                                     │
│ Logs    ──●────●────────●──────●────X               │
│                                     ↑               │
│                                   crash             │
├───────────────────────┬─────────────────────────────┤
│ Findings              │ Registers                   │
│                       │                             │
│ Possible NULL access  │ PC    0x08004567           │
│ confidence 97%        │ LR    0x08001235           │
│                       │ CFSR  0x00008200           │
├───────────────────────┴─────────────────────────────┤
│ Frames                                              │
│                                                     │
│ #0 sensor_update() sensor.c:184                    │
│ #1 LR candidate    main.c:91                       │
├─────────────────────────────────────────────────────┤
│ Source                                              │
│                                                     │
│ 182 ...                                             │
│ 183 ...                                             │
│ 184 value = sensor->sample->raw;  ← PC             │
└─────────────────────────────────────────────────────┘
```

---

## Phase 7 — Local End-to-End Integration

### Goal

Connect the Next.js app to the Rust CLI locally.

Development-only flow:

```text
Browser
    ↓
POST /api/analyze
    ↓
temporary directory
    ↓
faultscope analyze
    ↓
analysis JSON
    ↓
Browser
```

Define an abstraction:

```ts
interface AnalysisBackend {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
```

Implement:

```text
LocalCliAnalysisBackend
VercelAnalysisBackend
```

The UI must not know which backend is active.

### Milestone

The application is fully usable locally.

---

## Phase 8 — Artifact Storage

### Goal

Introduce production artifact upload.

Flow:

```text
Browser
   │
   ├── firmware.elf
   ├── crash.json
   └── runtime.log
   │
   ▼
Vercel Blob
   │
   ▼
PostgreSQL metadata
```

Large files must not be proxied unnecessarily through application memory.

Initial configurable limits:

```text
ELF         1 GB
dump        1 GB
log       500 MB
crash JSON  1 MB
```

Keep limits in one central configuration.

---

## Phase 9 — Vercel Sandbox Analysis

### Goal

Run production analysis outside the main web runtime.

Flow:

```text
Incident
   ↓
Analysis requested
   ↓
Workflow
   ↓
Create Sandbox
   ↓
Fetch artifacts
   ↓
run faultscope-cli
   ↓
store result
   ↓
update incident
   ↓
terminate Sandbox
```

The Sandbox must execute the trusted `faultscope-cli`.

It must never execute the uploaded firmware.

LLVM/binutils integration can be added later if necessary.

---

## Phase 10 — Production Analysis UX

> **Mandatory:** Use Ponytail and UI/UX Pro Max for this production UX phase.

### Goal

Expose analysis progress and failure states.

Example progress:

```text
Analyzing incident...

✓ Validate artifacts
✓ Parse crash dump
✓ Load ELF
● Resolve DWARF
○ Analyze fault
○ Generate timeline
```

Failure example:

```text
Analysis failed

Stage:
DWARF parsing

Reason:
Malformed .debug_info section

[Retry analysis]
```

Never expose internal server stack traces directly to end users.

---

## Phase 11 — Finding Engine

### Goal

Formalize deterministic rule-based analysis.

### Interface

```rust
pub trait IncidentRule: Send + Sync {
    fn analyze(
        &self,
        context: &AnalysisContext,
    ) -> Vec<Finding>;
}
```

Initial rules:

```text
FaultRegisterRule
NullAddressRule
PcResolutionRule
InvalidExecutionAddressRule
StackPointerRangeRule
```

Rules must be:

- deterministic
- independently testable
- independent from UI
- independent from Vercel

---

## Phase 12 — AI Investigator

### Goal

Add optional natural-language explanation after deterministic analysis is stable.

AI input:

```text
CrashInfo
SymbolicatedAddress
FaultDecode
Findings
Relevant Events
```

Do not send an uncontrolled giant raw trace by default.

### AI responsibilities

- summarize findings
- explain likely event chains
- recommend next checks

### AI non-responsibilities

- register decoding
- symbol resolution
- fault classification
- timeline ordering
- stack reconstruction

### Output

```json
{
  "summary": "The processor entered HardFault while executing sensor_update.",
  "likely_chain": [
    "A precise bus fault occurred",
    "The fault address was 0x00000004",
    "This is consistent with a possible NULL-based access"
  ],
  "recommended_checks": [
    "Inspect the pointer used at sensor.c:184",
    "Check ownership of the sensor sample object"
  ],
  "evidence_ids": [
    "finding-1",
    "event-921"
  ]
}
```

Validate all referenced evidence IDs.

Reject or ignore hallucinated IDs.

---

## Phase 13 — RTOS Timeline

### Goal

Move from crash viewer to execution-history debugger.

Add event kinds such as:

```text
TaskSwitch
TaskCreate
TaskDelete
IsrEnter
IsrExit
MutexWait
MutexLock
MutexUnlock
WatchdogFeed
```

Example visualization:

```text
CPU0

SensorTask █████████───────████████████──────X
CommTask           ████████
Idle       ████████                ███████

ISR                    ██       ██
```

Potential deterministic analyses:

- task starvation
- priority inversion
- mutex contention
- watchdog chains
- ISR storms

---

## Phase 14 — Multi-Clock Synchronization

### Goal

Combine events from different clock domains.

Examples:

```text
CPU cycle counter
RTOS tick
UART timestamp
CAN timestamp
host timestamp
```

Model:

```text
global_time = scale × local_time + offset
```

Anchor events may be used to estimate:

- offset
- clock drift

This belongs after the single-clock timeline is stable.

---

# 21. Architecture and Environment Expansion

After the Cortex-M + bare-metal reference implementation, add providers without changing the generic model or central analyzer.

Expected architecture providers:

```text
faultscope-arch-cortex-m
faultscope-arch-aarch64
faultscope-arch-riscv
faultscope-arch-x86_64
```

Expected execution-environment providers:

```text
faultscope-env-baremetal
faultscope-env-freertos
faultscope-env-zephyr
faultscope-env-linux
```

Examples of valid combinations:

```text
Cortex-M + bare-metal
Cortex-M + FreeRTOS
Cortex-M + Zephyr
AArch64 + Linux
RISC-V 32 + bare-metal
RISC-V 64 + Zephyr
RISC-V 64 + Linux
x86_64 + Linux
```

Adding one of these must not require adding target-specific fields to `Incident`, `Event`, `Finding`, or other core domain types.

For RISC-V, an architecture provider may expose trap facts such as:

```text
mcause
mepc
mtval
```

For Linux, an environment/snapshot provider may expose:

```text
signal
process
thread
core-dump mappings
auxv
loaded modules
```

These remain provider-specific facts represented through generic contracts.

---

# 22. Future Trace SDK

A future lightweight target-side trace library may expose APIs such as:

```c
TRACE_TASK_SWITCH(task_id);
TRACE_ISR_ENTER(irq);
TRACE_ISR_EXIT(irq);

TRACE_MUTEX_WAIT(mutex);
TRACE_MUTEX_LOCK(mutex);
TRACE_MUTEX_UNLOCK(mutex);

TRACE_EVENT(EVENT_SENSOR_RX, value);

TRACE_WATCHDOG_FEED();
```

Use compact fixed-size binary records where practical.

Example conceptual record:

```text
timestamp   32 bits
type         8 bits
cpu          8 bits
arg0        32 bits
arg1        32 bits
```

A ring buffer can preserve the most recent execution history before a fault.

---

# 23. Security Requirements

Before public production use, implement:

- private artifact storage
- authenticated incident access
- upload authorization
- filename sanitization
- magic-number validation
- parser size limits
- analysis timeouts
- artifact retention policy
- delete-incident functionality
- rate limiting
- structured logging
- no production secrets inside analysis Sandboxes unless strictly required
- malformed ELF regression tests

Primary parser safety goal:

```text
malformed artifact
        ↓
structured analysis error
```

Never:

```text
malformed artifact
        ↓
panic
        ↓
service crash
```

---

# 24. Testing Strategy

## Rust

Use:

- unit tests
- fixture tests
- malformed-input tests
- golden tests
- property tests where useful
- fuzzing later

## Frontend

Test:

- analysis JSON decoding
- timeline coordinate conversion
- viewport behavior
- panel rendering
- selection state

## E2E

Required happy path:

```text
upload fixture
    ↓
analysis
    ↓
incident view
    ↓
PC symbol visible
    ↓
fault finding visible
```

---

# 25. Golden Demo Fixture

Maintain at least one deterministic reference incident:

```text
fixtures/demo/
├── firmware.elf
├── crash.json
├── runtime.log
└── expected-analysis.json
```

This fixture should be used for:

- CLI regression tests
- UI demos
- E2E tests
- screenshots
- documentation

---

# 26. CI Requirements

Every pull request must run:

```bash
cargo fmt --check

cargo clippy \
  --workspace \
  --all-targets \
  -- \
  -D warnings

cargo test --workspace

pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
```

A phase is not complete while required CI validation fails.

---

# 27. Documentation Requirements

Keep these documents updated:

```text
docs/architecture.md
docs/crash-format.md
docs/event-model.md
docs/symbolication.md
```

Record major decisions in ADRs:

```text
docs/adr/
├── 0001-rust-analysis-core.md
├── 0002-canonical-event-model.md
├── 0003-sandbox-analysis.md
└── 0004-no-ai-in-deterministic-analysis.md
```

---

# 28. Recommended `AGENTS.md`

Create the repository root `AGENTS.md` with rules similar to:

```md
# FaultScope

## Project rules

- Use Ponytail for applicable implementation, modification, review, and restructuring work.
- Use UI/UX Pro Max for significant UI/UX design or implementation work.
- For substantial UI work, use UI/UX Pro Max before making UI changes.
- FaultScope core must remain processor-, OS-, RTOS-, and bare-metal agnostic.
- Cortex-M is the first architecture provider, not a core assumption.
- Bare-metal is a first-class execution environment, not the absence of an OS.
- Never encode architecture-specific registers or fault fields directly into generic core types.
- Architecture, environment, artifact, snapshot, symbol, unwind, and trace logic must live behind provider interfaces.
- Adding a new processor or OS must not require redesigning `Incident`, `Event`, or `Finding`.
- Rust is the source of truth for crash analysis.
- Do not implement ELF/DWARF parsing in TypeScript.
- Keep analysis code independent from UI code.
- Keep analysis code independent from Vercel-specific code.
- Uploaded artifacts are untrusted input.
- Never execute uploaded firmware.
- Never invent symbols, source locations, or stack frames.
- Findings must reference evidence.
- New parsers require malformed-input tests.
- Public Rust APIs require tests.
- Do not introduce AI analysis until deterministic analysis exists.
- Do not implement features assigned to later phases without an explicit task.

## Required validation

Before completing a task run:

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build
```

---

# 29. Definition of MVP Complete

Version `v0.1` uses Cortex-M + bare-metal as its first fully supported vertical slice, but the generic provider architecture is part of the MVP definition.

Before `v0.1` is complete, the core model and provider registry must pass synthetic compatibility tests for multiple architecture/environment combinations.

Version `v0.1` is functionally complete when a user can upload:

```text
firmware.elf
crash.json
runtime.log
```

and the system deterministically produces:

- PC
- LR
- Cortex-M fault classification
- symbol names
- source locations
- runtime log events
- findings with evidence

The browser must display:

- crash timeline
- registers
- fault information
- findings
- PC source
- LR candidate source
- events

The production deployment must perform analysis successfully through the intended Vercel architecture.

AI is **not** required for `v0.1`.

---

# 30. Recommended Development Milestones

```text
Phase 0   Repository bootstrap
   ↓
Phase 1   Data model
   ↓
Phase 2   ELF / DWARF
   ↓
Phase 3   Cortex-M
   ↓
Phase 4   Integrated analyzer
   ↓
Phase 5   Log parser

══════════════════════════════════════
Milestone A:
faultscope analyze is independently useful
══════════════════════════════════════

   ↓
Phase 6   Timeline UI
   ↓
Phase 7   Local integration

══════════════════════════════════════
Milestone B:
complete local application
══════════════════════════════════════

   ↓
Phase 8   Artifact storage
   ↓
Phase 9   Sandbox analysis
   ↓
Phase 10  Production UX
   ↓
Phase 11  Finding engine

══════════════════════════════════════
v0.1:
practical FaultScope
══════════════════════════════════════

   ↓
Phase 12  AI Investigator
   ↓
Phase 13  RTOS timeline
   ↓
Phase 14  Multi-clock synchronization
```

---

# 31. Codex Execution Policy

Codex must work on **one phase at a time**.

For every phase:

1. read `AGENTS.md`
2. read this development plan
3. use Ponytail for the development task
4. if the phase contains significant UI/UX work, also use UI/UX Pro Max
5. inspect current repository state
6. verify previous-phase acceptance criteria
7. explain the proposed change
8. list expected modified files
9. implement the phase
10. add tests
11. run validation
12. fix regressions caused by the change
13. summarize results
14. stop

Codex must not automatically begin the next phase.

---

# 32. Initial Codex Prompt — Phase 0

Use this prompt to start the project:

```text
You are implementing FaultScope.

Read these files completely before making changes:

- AGENTS.md
- DEVELOPMENT_PLAN.md
- README.md
- Cargo.toml
- package.json

We will implement this project phase by phase.

Mandatory development skills:

- Use [@ponytail](plugin://ponytail@ponytail) for applicable development work.
- For significant UI/UX work, use [@ui-ux-pro-max](plugin://ui-ux-pro-max@ui-ux-pro-max-skill).
- If a required skill cannot be used, report that explicitly before proceeding with an alternative.

Do NOT attempt to implement the entire DEVELOPMENT_PLAN.md.

For this task, implement Phase 0 only.

Before modifying files:

1. Inspect the repository.
2. Produce a concise implementation plan.
3. Identify conflicts or missing prerequisites.
4. List files you expect to create or modify.

Then implement Phase 0.

Architectural constraints:

- Rust is the source of truth for crash analysis.
- Do not implement ELF/DWARF parsing in TypeScript.
- Uploaded artifacts must always be treated as untrusted.
- Never execute uploaded firmware.
- Do not introduce AI functionality.
- Do not implement RTOS support yet.
- Do not implement full stack unwinding yet.
- Keep analysis code independent from UI code.
- Keep analysis code independent from Vercel-specific code.

After implementation, run:

cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm test
pnpm build

Fix all errors caused by your changes.

Finally report:

- files created
- files modified
- architectural decisions made
- tests added
- commands executed and results
- remaining TODOs for Phase 1

Do not begin Phase 1.
```

---

# 33. Generic Codex Prompt for Later Phases

Use the following template for Phase 1 onward:

```text
Read AGENTS.md and DEVELOPMENT_PLAN.md completely.

Use [@ponytail](plugin://ponytail@ponytail) for this development task.

If Phase <N> contains significant UI/UX design or implementation, also use
[@ui-ux-pro-max](plugin://ui-ux-pro-max@ui-ux-pro-max-skill) before making UI changes.

If a required skill cannot be used, report that explicitly.

Implement Phase <N> only.

First inspect the current repository and verify that the previous phase's
acceptance criteria are satisfied.

Before editing code, explain:

1. what already exists,
2. what this phase requires,
3. your proposed implementation,
4. which files will change,
5. major technical risks.

Then implement the phase.

Do not implement features assigned to later phases.

Preserve all architectural constraints in AGENTS.md.

Add appropriate tests.

Run all relevant Rust and TypeScript validation commands.

Do not mark the phase complete unless required tests and builds pass.

At the end, provide:

- implementation summary
- files changed
- test summary
- validation command results
- known limitations
- recommended next task

Stop after this phase.
```

---

# 34. Important Engineering Priorities

When trade-offs are necessary, use this priority order:

1. correctness of deterministic crash analysis
2. trustworthy evidence
3. parser robustness
4. stable data model
5. reproducible CLI behavior
6. test coverage
7. useful UI
8. production infrastructure
9. AI features
10. advanced trace features

A beautiful UI must never hide uncertainty in analysis.

A sophisticated AI explanation must never compensate for missing deterministic evidence.

---

# 35. Product Direction After MVP

The MVP can evolve into a broader embedded engineering observability platform.

Potential product family:

```text
Embedded Engineering Observatory
        │
        ├── FaultScope
        ├── Build / Binary Explorer
        ├── Binary Size Detective
        ├── Runtime Trace Explorer
        ├── Protocol Explorer
        └── Git / Build History
```

A future crash investigation could connect:

```text
crash PC
    ↓
symbol
    ↓
source function
    ↓
Git commit that changed it
    ↓
binary size / stack change
    ↓
runtime events before crash
```

The architecture of `faultscope-core` should therefore remain reusable outside the web application.

---

# 36. Final Guideline

Do not start by building the dashboard.

Start by making this command trustworthy:

```bash
faultscope analyze \
  --elf firmware.elf \
  --crash crash.json \
  --log runtime.log
```

If that command produces accurate, reproducible, evidence-backed results, every later frontend and SaaS feature becomes much easier.

The Rust analysis engine is the FaultScope product core.

That core is a **generic analysis platform**. Cortex-M, bare-metal, FreeRTOS, Zephyr, Linux, AArch64, RISC-V, x86_64, ELF/DWARF, and future formats are providers around the core—not identities baked into it.

The web application is the visualization and workflow layer around that generic platform.
