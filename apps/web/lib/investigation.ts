import type { Analysis } from "./analysis";

export type InvestigationInput = {
  crash: {
    timestamp: string;
    target: { machine?: string; architecture?: string };
    registers: Array<{ id: string; value: string }>;
    facts: Record<string, string | number | boolean | null>;
  };
  frames: Array<{
    address: number;
    symbol: string | null;
    source: string | null;
    origin: string;
    confidence: number;
  }>;
  fault: {
    classes: string[];
    facts: Array<{ id: string; description: string; value: string | number | boolean | null }>;
  };
  findings: Array<{
    id: string;
    severity: string;
    confidence: number;
    title: string;
    description: string;
    evidence: Array<{ id: string; description: string; reference: string }>;
  }>;
  events: Array<{ id: string; timestamp_ns: string; severity: string; message: string }>;
};

export type AIInvestigation = {
  summary: string;
  likely_chain: string[];
  recommended_checks: string[];
  evidence_ids: string[];
};

const limits = { text: 2_000, items: 20, registers: 64, facts: 64 } as const;

export function buildInvestigationInput(analysis: Analysis): InvestigationInput {
  return {
    crash: {
      timestamp: analysis.timestamp,
      target: {
        machine: optionalString(analysis.target.machine),
        architecture: optionalString(analysis.target.architecture),
      },
      registers: analysis.snapshot.registers.slice(0, limits.registers),
      facts: scalarRecord(analysis.snapshot.facts),
    },
    frames: analysis.frames.slice(0, limits.items).map((frame) => ({
      address: frame.address.value,
      symbol: frame.symbol,
      source: frame.source ? `${frame.source.file}:${frame.source.line}` : null,
      origin: frame.origin,
      confidence: frame.confidence,
    })),
    fault: {
      classes: analysis.fault.fault_classes.slice(0, limits.items),
      facts: analysis.fault.facts.slice(0, limits.facts).map((fact) => ({
        ...fact,
        value: scalar(fact.value),
      })),
    },
    findings: analysis.findings.slice(0, limits.items).map((finding) => ({
      ...finding,
      evidence: finding.evidence.slice(0, limits.items).map((evidence) => ({
        id: evidence.id,
        description: evidence.description,
        reference: evidence.fact ?? evidence.event ?? evidence.register ??
          (evidence.frame === undefined ? "recorded evidence" : `frame:${evidence.frame}`),
      })),
    })),
    events: analysis.events.slice(-limits.items).map((event) => ({
      id: event.id,
      timestamp_ns: event.timestampNs.toString(),
      severity: event.severity,
      message: event.message,
    })),
  };
}

export function decodeInvestigationInput(value: unknown): InvestigationInput {
  const root = object(value, "request");
  const crash = object(root.crash, "crash");
  const target = object(crash.target, "target");
  const fault = object(root.fault, "fault");
  return {
    crash: {
      timestamp: string(crash.timestamp, "timestamp"),
      target: {
        machine: optionalText(target.machine, "machine"),
        architecture: optionalText(target.architecture, "architecture"),
      },
      registers: array(crash.registers, limits.registers, "registers").map((item) => {
        const register = object(item, "register");
        return { id: string(register.id, "register id"), value: string(register.value, "register value") };
      }),
      facts: decodeScalarRecord(crash.facts, "crash facts"),
    },
    frames: array(root.frames, limits.items, "frames").map((item) => {
      const frame = object(item, "frame");
      return {
        address: finiteNumber(frame.address, "frame address"),
        symbol: nullableText(frame.symbol, "frame symbol"),
        source: nullableText(frame.source, "frame source"),
        origin: string(frame.origin, "frame origin"),
        confidence: probability(frame.confidence, "frame confidence"),
      };
    }),
    fault: {
      classes: array(fault.classes, limits.items, "fault classes").map((item) => string(item, "fault class")),
      facts: array(fault.facts, limits.facts, "fault facts").map((item) => {
        const fact = object(item, "fault fact");
        return {
          id: string(fact.id, "fact id"),
          description: string(fact.description, "fact description"),
          value: decodeScalar(fact.value, "fact value"),
        };
      }),
    },
    findings: array(root.findings, limits.items, "findings").map((item) => {
      const finding = object(item, "finding");
      return {
        id: string(finding.id, "finding id"),
        severity: string(finding.severity, "finding severity"),
        confidence: probability(finding.confidence, "finding confidence"),
        title: string(finding.title, "finding title"),
        description: string(finding.description, "finding description"),
        evidence: array(finding.evidence, limits.items, "evidence").map((entry) => {
          const evidence = object(entry, "evidence");
          return {
            id: string(evidence.id, "evidence id"),
            description: string(evidence.description, "evidence description"),
            reference: string(evidence.reference, "evidence reference"),
          };
        }),
      };
    }),
    events: array(root.events, limits.items, "events").map((item) => {
      const event = object(item, "event");
      return {
        id: string(event.id, "event id"),
        timestamp_ns: decimal(event.timestamp_ns, "event timestamp"),
        severity: string(event.severity, "event severity"),
        message: string(event.message, "event message"),
      };
    }),
  };
}

export function decodeAIInvestigation(value: unknown): AIInvestigation {
  const root = object(value, "AI investigation");
  return {
    summary: string(root.summary, "summary"),
    likely_chain: stringList(root.likely_chain, "likely_chain"),
    recommended_checks: stringList(root.recommended_checks, "recommended_checks"),
    evidence_ids: stringList(root.evidence_ids, "evidence_ids"),
  };
}

export function validEvidenceIds(input: InvestigationInput): Set<string> {
  return new Set([
    ...input.findings.flatMap((finding) => [finding.id, ...finding.evidence.map((item) => item.id)]),
    ...input.events.map((event) => event.id),
  ]);
}

export function filterEvidenceIds(result: AIInvestigation, allowed: Set<string>): AIInvestigation {
  return { ...result, evidence_ids: [...new Set(result.evidence_ids.filter((id) => allowed.has(id)))] };
}

function stringList(value: unknown, name: string): string[] {
  return array(value, limits.items, name).map((item) => string(item, name));
}

function scalarRecord(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(value).slice(0, limits.facts).map(([key, item]) => [key, scalar(item)]));
}

function decodeScalarRecord(value: unknown, name: string): Record<string, string | number | boolean | null> {
  const record = object(value, name);
  const entries = Object.entries(record);
  if (entries.length > limits.facts) throw new Error(`${name} has too many entries`);
  return Object.fromEntries(entries.map(([key, item]) => [string(key, `${name} key`), decodeScalar(item, name)]));
}

function scalar(value: unknown): string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ? value : String(value);
}

function decodeScalar(value: unknown, name: string): string | number | boolean | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return string(value, name);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  if (value.length > maximum) throw new Error(`${name} has too many items`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > limits.text) {
    throw new Error(`${name} must be a non-empty string of at most ${limits.text} characters`);
  }
  return value;
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, limits.text) : undefined;
}

function nullableText(value: unknown, name: string): string | null {
  return value === null ? null : string(value, name);
}

function decimal(value: unknown, name: string): string {
  const result = string(value, name);
  if (!/^\d+$/.test(result)) throw new Error(`${name} must be decimal nanoseconds`);
  return result;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function probability(value: unknown, name: string): number {
  const result = finiteNumber(value, name);
  if (result > 1) throw new Error(`${name} must be between zero and one`);
  return result;
}
