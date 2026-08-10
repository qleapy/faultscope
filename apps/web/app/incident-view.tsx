"use client";

import { useEffect, useRef, useState } from "react";

import fixture from "../fixtures/analysis.json";
import {
  type Analysis,
  type TimelineEvent,
  type TimelineViewport,
  decodeAnalysis,
  formatTimestamp,
  initialViewport,
  nextEventIndex,
  timelinePosition,
  zoomViewport,
} from "../lib/analysis";

const fixtureAnalysis = decodeAnalysis(fixture);

export function IncidentView() {
  const analysis = fixtureAnalysis;
  const [selectedEvent, setSelectedEvent] = useState(Math.max(0, analysis.events.length - 1));
  const [selectedFrame, setSelectedFrame] = useState(0);

  return (
    <main className="app-shell">
      <IncidentHeader analysis={analysis} />
      <Timeline
        events={analysis.events}
        selected={selectedEvent}
        onSelect={setSelectedEvent}
        parsedLines={analysis.logDiagnostics.parsedLines}
        ignoredLines={analysis.logDiagnostics.ignoredLines}
      />
      <section className="dashboard-grid" aria-label="Crash analysis details">
        <FindingsPanel analysis={analysis} />
        <RegistersPanel analysis={analysis} />
        <FaultPanel analysis={analysis} />
      </section>
      <StackFramePanel analysis={analysis} selected={selectedFrame} onSelect={setSelectedFrame} />
      <section className="bottom-grid">
        <SourceLocationPanel analysis={analysis} selectedFrame={selectedFrame} />
        <ArtifactPanel analysis={analysis} />
      </section>
      <footer>
        Deterministic analysis only · Symbols, addresses, and fault facts come from parsed artifacts.
      </footer>
    </main>
  );
}

function IncidentHeader({ analysis }: { analysis: Analysis }) {
  return (
    <header className="incident-header">
      <div>
        <p className="eyebrow">FaultScope / Incident {analysis.incident.id}</p>
        <h1>{analysis.incident.label}</h1>
        <p className="header-meta">
          {String(analysis.target.machine ?? analysis.target.architecture)} · {analysis.timestamp} ·
          Build {analysis.build.id ?? "Unavailable"}
        </p>
      </div>
      <div className="header-status" aria-label="Incident status">
        <span className="status-dot" aria-hidden="true" />
        <span>{analysis.fault.fault_classes.map(label).join(" + ")}</span>
        <strong>{analysis.incident.status.toUpperCase()}</strong>
      </div>
    </header>
  );
}

function Timeline({
  events,
  selected,
  onSelect,
  parsedLines,
  ignoredLines,
}: {
  events: TimelineEvent[];
  selected: number;
  onSelect: (index: number) => void;
  parsedLines: number;
  ignoredLines: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseViewport = initialViewport(events);
  const [viewport, setViewport] = useState(baseViewport);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => drawTimeline(canvas, events, viewport, selected);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [events, selected, viewport]);

  const event = events[selected];
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading timeline-heading">
        <div>
          <p className="eyebrow">Execution history</p>
          <h2 id="timeline-title">Timeline</h2>
        </div>
        <div className="timeline-tools" aria-label="Timeline controls">
          <span>{parsedLines} parsed · {ignoredLines} ignored</span>
          <button type="button" onClick={() => setViewport(zoomViewport(viewport, "in", events, event?.timestampNs))}>
            Zoom in
          </button>
          <button type="button" onClick={() => setViewport(zoomViewport(viewport, "out", events, event?.timestampNs))}>
            Zoom out
          </button>
          <button type="button" onClick={() => setViewport(zoomViewport(viewport, "reset", events))}>
            Reset
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="timeline-canvas"
        height={156}
        role="img"
        aria-label={`${events.length} runtime events from ${formatTimestamp(baseViewport.startNs)} to ${formatTimestamp(baseViewport.endNs)}`}
      />
      <div className="event-strip" aria-label="Timeline events">
        {events.map((item, index) => (
          <button
            key={item.id}
            type="button"
            id={`timeline-event-${index}`}
            className={index === selected ? "event-chip selected" : "event-chip"}
            aria-pressed={index === selected}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              const next = nextEventIndex(index, event.key, events.length);
              if (next !== index) {
                event.preventDefault();
                onSelect(next);
                document.getElementById(`timeline-event-${next}`)?.focus();
              }
            }}
          >
            <span className={`severity-mark ${item.severity}`} aria-hidden="true" />
            <span>{formatTimestamp(item.timestampNs)}</span>
            <strong>{item.message}</strong>
          </button>
        ))}
      </div>
      <div className="selected-event" aria-live="polite">
        <span className={`severity-pill ${event?.severity ?? "info"}`}>{event?.severity ?? "unknown"}</span>
        <code>{event?.text ?? "No event selected"}</code>
      </div>
    </section>
  );
}

function FindingsPanel({ analysis }: { analysis: Analysis }) {
  return (
    <section className="panel findings-panel" aria-labelledby="findings-title">
      <PanelTitle eyebrow="Interpretation" title="Findings" id="findings-title" />
      {analysis.findings.length === 0 ? (
        <p className="unknown">No evidence-backed findings available.</p>
      ) : (
        analysis.findings.map((finding) => (
          <article className="finding" key={finding.id}>
            <div className="finding-title">
              <span className={`severity-pill ${finding.severity}`}>{finding.severity}</span>
              <h3>{finding.title}</h3>
            </div>
            <p>{finding.description}</p>
            <div className="confidence-row">
              <span>Confidence</span>
              <progress value={finding.confidence} max={1} aria-label={`${Math.round(finding.confidence * 100)} percent confidence`} />
              <strong>{Math.round(finding.confidence * 100)}%</strong>
            </div>
            <p className="evidence-label">Evidence</p>
            <ul className="evidence-list">
              {finding.evidence.map((evidence) => (
                <li key={evidence.id}>
                  <span aria-hidden="true" />
                  <div>
                    {evidence.description}
                    <code>{evidence.fact ?? "No fact reference"}</code>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}

function RegistersPanel({ analysis }: { analysis: Analysis }) {
  return (
    <section className="panel" aria-labelledby="registers-title">
      <PanelTitle eyebrow="Fact" title="Registers" id="registers-title" />
      <dl className="data-list">
        {analysis.snapshot.registers.map((register) => (
          <div key={register.id}>
            <dt>{register.id.replace("arm.", "").toUpperCase()}</dt>
            <dd>{register.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FaultPanel({ analysis }: { analysis: Analysis }) {
  return (
    <section className="panel" aria-labelledby="fault-title">
      <PanelTitle eyebrow="Fact" title="Fault decode" id="fault-title" />
      <div className="class-row">
        {analysis.fault.fault_classes.map((faultClass) => <span key={faultClass}>{label(faultClass)}</span>)}
      </div>
      <ul className="fact-list">
        {analysis.fault.facts.map((fact) => (
          <li key={fact.id}>
            <span>{fact.description}</span>
            <code>{fact.value === true ? "SET" : String(fact.value)}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StackFramePanel({
  analysis,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <section className="panel" aria-labelledby="frames-title">
      <PanelTitle eyebrow="Evidence-backed addresses" title="Frames" id="frames-title" />
      <div className="frame-list">
        {analysis.frames.map((frame, index) => (
          <button
            key={`${frame.origin}-${frame.address.value}`}
            type="button"
            className={index === selected ? "frame selected" : "frame"}
            aria-pressed={index === selected}
            onClick={() => onSelect(index)}
          >
            <span className="frame-index">#{index}</span>
            <span>
              <strong>{frame.symbol ?? "Unavailable symbol"}</strong>
              <small>{label(frame.origin)} · {Math.round(frame.confidence * 100)}% confidence</small>
            </span>
            <code>0x{frame.address.value.toString(16).padStart(8, "0")}</code>
            <span>{frame.source ? `${frame.source.file}:${frame.source.line}` : "Source unavailable"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SourceLocationPanel({ analysis, selectedFrame }: { analysis: Analysis; selectedFrame: number }) {
  const frame = analysis.frames[selectedFrame];
  const matchesFixture = frame?.source?.file === analysis.sourceContext.file;
  return (
    <section className="panel source-panel" aria-labelledby="source-title">
      <PanelTitle eyebrow="Source location" title={frame?.source?.file ?? "Unavailable"} id="source-title" />
      {matchesFixture ? (
        <pre className="source-code" aria-label={`Source around line ${analysis.sourceContext.focusLine}`}>
          {analysis.sourceContext.lines.map((line) => (
            <span key={line.number} className={line.number === analysis.sourceContext.focusLine ? "focus-line" : ""}>
              <b>{line.number}</b><code>{line.text}</code>{line.number === analysis.sourceContext.focusLine ? <em>PC</em> : null}
            </span>
          ))}
        </pre>
      ) : (
        <p className="unknown">Source preview unavailable for this frame.</p>
      )}
    </section>
  );
}

function ArtifactPanel({ analysis }: { analysis: Analysis }) {
  const fields = [
    ["File", analysis.artifact.name],
    ["Format", analysis.artifact.kind],
    ["Size", `${Math.round(Number(analysis.artifact.size_bytes) / 1024)} KiB`],
    ["Build ID", analysis.artifact.build_id],
    ["Build time", analysis.build.timestamp],
    ["Symbols", analysis.artifact.symbols],
    ["DWARF", analysis.artifact.dwarf],
  ];
  return (
    <section className="panel" aria-labelledby="artifact-title">
      <PanelTitle eyebrow="Input artifact" title="Artifact" id="artifact-title" />
      <dl className="artifact-list">
        {fields.map(([name, value]) => (
          <div key={String(name)}><dt>{String(name)}</dt><dd>{value == null ? "Unavailable" : String(value)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function PanelTitle({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return <div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></div></div>;
}

function drawTimeline(
  canvas: HTMLCanvasElement,
  events: TimelineEvent[],
  viewport: TimelineViewport,
  selected: number,
) {
  const width = Math.max(320, canvas.clientWidth);
  const height = 156;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return;
  const tokens = getComputedStyle(document.documentElement);
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = tokens.getPropertyValue("--border");
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(42, 78.5);
  context.lineTo(width - 24, 78.5);
  context.stroke();
  context.fillStyle = tokens.getPropertyValue("--text-muted");
  context.font = "12px ui-monospace, monospace";
  context.fillText("LOG", 0, 82);
  events.forEach((event, index) => {
    const x = 42 + timelinePosition(event.timestampNs, viewport, width - 66);
    const fault = event.severity === "fault";
    context.fillStyle = fault
      ? tokens.getPropertyValue("--danger")
      : index === selected
        ? tokens.getPropertyValue("--accent")
        : tokens.getPropertyValue("--positive");
    context.beginPath();
    if (fault) {
      context.moveTo(x, 67);
      context.lineTo(x + 10, 78);
      context.lineTo(x, 89);
      context.lineTo(x - 10, 78);
      context.closePath();
    } else {
      context.arc(x, 78, index === selected ? 7 : 5, 0, Math.PI * 2);
    }
    context.fill();
    if (index === selected) {
      context.strokeStyle = tokens.getPropertyValue("--text");
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = tokens.getPropertyValue("--text");
      context.fillText(formatTimestamp(event.timestampNs), Math.max(42, Math.min(width - 120, x - 38)), 118);
    }
  });
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
