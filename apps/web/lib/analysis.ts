export type TimelineEvent = {
  id: string;
  timestampNs: bigint;
  severity: string;
  message: string;
  text: string;
};

export type TimelineViewport = { startNs: bigint; endNs: bigint };

export type Analysis = {
  incident: { id: string; status: string; label: string };
  target: Record<string, unknown>;
  timestamp: string;
  build: { id: string | null; timestamp: string | null };
  snapshot: {
    registers: Array<{ id: string; value: string }>;
    facts: Record<string, unknown>;
  };
  frames: Array<{
    address: { value: number; role: string };
    symbol: string | null;
    source: { file: string; line: number; column: number | null } | null;
    origin: string;
    confidence: number;
  }>;
  fault: {
    fault_classes: string[];
    facts: Array<{ id: string; description: string; value: unknown }>;
  };
  events: TimelineEvent[];
  logDiagnostics: { parsedLines: number; ignoredLines: number };
  findings: Array<{
    id: string;
    severity: string;
    confidence: number;
    title: string;
    description: string;
    evidence: Array<{
      id: string;
      description: string;
      fact?: string;
      event?: string;
      register?: string;
      frame?: number;
    }>;
  }>;
  artifact: {
    name: string;
    kind: string;
    size_bytes: number | null;
    build_id: string | null;
    symbols: string;
    dwarf: string;
  };
  sourceContext: {
    file: string;
    focusLine: number;
    lines: Array<{ number: number; text: string }>;
  } | null;
};

export function decodeAnalysis(value: unknown): Analysis {
  const root = record(value, "analysis");
  const incident = optionalRecord(root.incident);
  const snapshot = record(root.snapshot, "snapshot");
  const fault = record(root.fault, "fault");
  const diagnostics = record(root.log_diagnostics, "log_diagnostics");
  const source = optionalRecord(root.source_context);
  const build = record(root.build, "build") as Analysis["build"];
  const frames = list(root.frames, "frames") as Analysis["frames"];
  const artifact = optionalRecord(root.artifact);

  return {
    incident: {
      id: incident ? text(incident.id, "incident.id") : "LOCAL",
      status: incident ? text(incident.status, "incident.status") : "crash",
      label: incident ? text(incident.label, "incident.label") : "Local crash analysis",
    },
    target: record(root.target, "target"),
    timestamp: root.timestamp == null ? "Unavailable" : text(root.timestamp, "timestamp"),
    build,
    snapshot: {
      registers: list(snapshot.registers, "registers") as Analysis["snapshot"]["registers"],
      facts: record(snapshot.facts, "facts"),
    },
    frames,
    fault: {
      fault_classes: list(fault.fault_classes, "fault classes").map((item) =>
        text(item, "fault class"),
      ),
      facts: list(fault.facts, "fault facts") as Analysis["fault"]["facts"],
    },
    events: list(root.events, "events").map((item, index) => {
      const event = record(item, `event ${index + 1}`);
      const attributes = record(event.attributes, `event ${index + 1} attributes`);
      return {
        id: text(event.id, "event.id"),
        timestampNs: nanoseconds(event.timestamp_ns),
        severity: text(attributes.severity, "event severity"),
        message: text(attributes.message, "event message"),
        text: text(attributes.text, "event text"),
      };
    }),
    logDiagnostics: {
      parsedLines: integer(diagnostics.parsed_lines, "parsed_lines"),
      ignoredLines: integer(diagnostics.ignored_lines, "ignored_lines"),
    },
    findings: list(root.findings, "findings") as Analysis["findings"],
    artifact: artifact
      ? (artifact as Analysis["artifact"])
      : {
          name: "firmware.elf",
          kind: "ELF / DWARF",
          size_bytes: null,
          build_id: build.id,
          symbols: frames.some((frame) => frame.symbol) ? "available" : "unavailable",
          dwarf: frames.some((frame) => frame.source) ? "available" : "unavailable",
        },
    sourceContext: source
      ? {
          file: text(source.file, "source file"),
          focusLine: integer(source.focus_line, "focus line"),
          lines: list(source.lines, "source lines") as NonNullable<Analysis["sourceContext"]>["lines"],
        }
      : null,
  };
}

export function initialViewport(events: TimelineEvent[]): TimelineViewport {
  if (events.length === 0) return { startNs: 0n, endNs: 1n };
  const timestamps = events.map((event) => event.timestampNs);
  const startNs = timestamps.reduce((left, right) => (left < right ? left : right));
  const last = timestamps.reduce((left, right) => (left > right ? left : right));
  return { startNs, endNs: last > startNs ? last : startNs + 1n };
}

export function timelinePosition(
  timestampNs: bigint,
  viewport: TimelineViewport,
  width: number,
): number {
  const duration = viewport.endNs - viewport.startNs;
  if (duration <= 0n || width <= 0) return 0;
  const offset = timestampNs <= viewport.startNs ? 0n : timestampNs - viewport.startNs;
  const millionths = (offset * 1_000_000n) / duration;
  return Math.min(width, Math.max(0, (Number(millionths) / 1_000_000) * width));
}

export function zoomViewport(
  viewport: TimelineViewport,
  direction: "in" | "out" | "reset",
  events: TimelineEvent[],
  focusNs?: bigint,
): TimelineViewport {
  if (direction === "reset") return initialViewport(events);
  const duration = viewport.endNs - viewport.startNs;
  const nextDuration = direction === "in" ? duration / 2n : duration * 2n;
  if (nextDuration < 1n) return viewport;
  const center = focusNs ?? viewport.startNs + duration / 2n;
  const half = nextDuration / 2n;
  return { startNs: center > half ? center - half : 0n, endNs: center + half };
}

export function nextEventIndex(current: number, key: string, length: number): number {
  if (length === 0) return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(length - 1, current + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current - 1);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return current;
}

export function formatTimestamp(timestampNs: bigint): string {
  const seconds = timestampNs / 1_000_000_000n;
  const micros = ((timestampNs % 1_000_000_000n) / 1_000n).toString().padStart(6, "0");
  return `${seconds}.${micros}s`;
}

function nanoseconds(value: unknown): bigint {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error("timestamp_ns must be a non-negative safe integer or decimal string");
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value == null ? null : record(value, "optional value");
}

function list(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
