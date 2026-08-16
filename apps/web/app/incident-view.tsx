"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

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
import {
  type ArtifactKind,
  artifactContentTypes,
  artifactPath,
  multipartThreshold,
  validateArtifact,
} from "../lib/artifact-storage";
import {
  analysisSteps,
  pollAnalysis,
  queueAnalysis,
  type ProductionAnalysis,
} from "../lib/production-analysis";
import {
  type AIInvestigation,
  buildInvestigationInput,
  decodeAIInvestigation,
} from "../lib/investigation";

const fixtureAnalysis = decodeAnalysis(fixture);

export function IncidentView({ storageEnabled = false }: { storageEnabled?: boolean }) {
  const [analysis, setAnalysis] = useState(fixtureAnalysis);
  const [selectedEvent, setSelectedEvent] = useState(Math.max(0, analysis.events.length - 1));
  const [selectedFrame, setSelectedFrame] = useState(0);

  return (
    <main className="app-shell">
      <IncidentHeader analysis={analysis} />
      <AnalysisForm
        storageEnabled={storageEnabled}
        onComplete={(next) => {
          setAnalysis(next);
          setSelectedEvent(Math.max(0, next.events.length - 1));
          setSelectedFrame(0);
        }}
      />
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
      <AIInvestigatorPanel
        key={`${analysis.incident.id}:${analysis.timestamp}`}
        analysis={analysis}
      />
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

export function AIInvestigatorPanel({ analysis }: { analysis: Analysis }) {
  const [result, setResult] = useState<AIInvestigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function investigate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildInvestigationInput(analysis)),
      });
      const body = await response.json() as unknown;
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body
          ? String(body.error)
          : "AI investigation failed. Try again.";
        throw new Error(message);
      }
      setResult(decodeAIInvestigation(body));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI investigation failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel ai-panel" aria-labelledby="ai-investigator-title" aria-busy={loading}>
      <div className="ai-heading">
        <div>
          <p className="eyebrow">Optional AI explanation</p>
          <h2 id="ai-investigator-title">AI Investigator</h2>
        </div>
        <span className="interpretation-badge">Interpretation only</span>
      </div>
      <p className="ai-disclaimer">
        Generated explanation of the deterministic evidence above. It cannot change facts, symbols, fault classes, or timeline order.
      </p>
      {result ? (
        <div className="ai-result" aria-live="polite">
          <section>
            <h3>Summary</h3>
            <p>{result.summary}</p>
          </section>
          <section>
            <h3>Likely chain</h3>
            {result.likely_chain.length ? <ol>{result.likely_chain.map((item) => <li key={item}>{item}</li>)}</ol> : <p>Insufficient evidence to infer a chain.</p>}
          </section>
          <section>
            <h3>Recommended checks</h3>
            {result.recommended_checks.length ? <ul>{result.recommended_checks.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No additional checks suggested.</p>}
          </section>
          <section>
            <h3>Evidence IDs</h3>
            <div className="ai-evidence">
              {result.evidence_ids.length ? result.evidence_ids.map((id) => <code key={id}>{id}</code>) : <span>No valid evidence IDs cited.</span>}
            </div>
          </section>
        </div>
      ) : (
        <p className="ai-empty">Request a concise event-chain explanation and next checks only when you need them.</p>
      )}
      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      <button className="ai-action" type="button" onClick={investigate} disabled={loading}>
        {loading ? "Investigating…" : result ? "Run again" : "Explain deterministic findings"}
      </button>
    </section>
  );
}

function AnalysisForm({
  onComplete,
  storageEnabled,
}: {
  onComplete: (analysis: Analysis) => void;
  storageEnabled: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [productionAnalysis, setProductionAnalysis] = useState<ProductionAnalysis | null>(null);
  const polling = useRef<AbortController | null>(null);

  useEffect(() => () => polling.current?.abort(), []);

  async function startStoredAnalysis(incidentId: string): Promise<boolean> {
    polling.current?.abort();
    const controller = new AbortController();
    polling.current = controller;
    const analysisId = await queueAnalysis(incidentId, { signal: controller.signal });
    setProductionAnalysis({
      incidentId,
      analysisId,
      status: "QUEUED",
      stage: "Queueing analysis",
    });
    const final = await pollAnalysis(
      `/api/incidents/${incidentId}/analyze?analysisId=${analysisId}`,
      setProductionAnalysis,
      { signal: controller.signal },
    );
    if (final.status === "FAILED") return false;
    if (final.result == null) throw new Error("Analysis completed without a result");
    onComplete(decodeAnalysis(final.result));
    setNotice(`Incident ${incidentId} analysis is complete.`);
    return true;
  }

  async function retryAnalysis() {
    if (!productionAnalysis) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await startStoredAnalysis(productionAnalysis.incidentId);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "Analysis failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel analysis-form-panel" aria-labelledby="analyze-title">
      <div>
        <p className="eyebrow">Deterministic analysis</p>
        <h2 id="analyze-title">Analyze artifacts</h2>
        <p className="form-help">Uploaded firmware is parsed as data and never executed.</p>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          setLoading(true);
          setError(null);
          setNotice(null);
          setProductionAnalysis(null);
          setProgress(0);
          try {
            if (storageEnabled) {
              const files = artifactFiles(new FormData(form));
              for (const item of files) {
                const problem = validateArtifact(item.kind, item.file);
                if (problem) throw new Error(problem);
              }
              const response = await fetch("/api/incidents", { method: "POST" });
              const incident = (await response.json()) as { id?: string; error?: string };
              if (!response.ok || !incident.id) throw new Error(incident.error ?? "Incident creation failed");

              const total = files.reduce((sum, item) => sum + item.file.size, 0);
              let completed = 0;
              for (const item of files) {
                const metadata = {
                  incidentId: incident.id,
                  kind: item.kind,
                  filename: item.file.name,
                  size: item.file.size,
                };
                await upload(artifactPath(metadata), item.file, {
                  access: "private",
                  handleUploadUrl: "/api/artifacts/upload",
                  clientPayload: JSON.stringify(metadata),
                  contentType: artifactContentTypes[item.kind],
                  multipart: item.file.size >= multipartThreshold,
                  onUploadProgress: ({ loaded }) =>
                    setProgress(Math.round(((completed + loaded) / total) * 100)),
                });
                completed += item.file.size;
              }
              setProgress(100);
              if (await startStoredAnalysis(incident.id)) form.reset();
              return;
            }
            const response = await fetch("/api/analyze", {
              method: "POST",
              body: new FormData(form),
            });
            const result = (await response.json()) as unknown;
            if (!response.ok) {
              const message = typeof result === "object" && result !== null && "error" in result
                ? String(result.error)
                : "Analysis failed";
              throw new Error(message);
            }
            onComplete(decodeAnalysis(result));
          } catch (reason) {
            if (!(reason instanceof DOMException && reason.name === "AbortError")) {
              setError(reason instanceof Error ? reason.message : "Analysis failed");
            }
          } finally {
            setLoading(false);
          }
        }}
        aria-busy={loading}
      >
        <label>
          <span>Firmware ELF</span>
          <input name="elf" type="file" required accept=".elf,application/octet-stream" />
        </label>
        <label>
          <span>Crash JSON</span>
          <input name="crash" type="file" required accept=".json,application/json" />
        </label>
        <label>
          <span>Runtime log <small>optional</small></span>
          <input name="log" type="file" accept=".log,.txt,text/plain" />
        </label>
        <button type="submit" disabled={loading}>
          {loading
            ? storageEnabled
              ? productionAnalysis
                ? productionAnalysis.status === "QUEUED" ? "Queued…" : "Analyzing…"
                : `Uploading ${progress}%`
              : "Analyzing…"
            : storageEnabled ? "Analyze artifacts" : "Run analysis"}
        </button>
      </form>
      {error ? <p className="form-error" role="alert">{error} Check the files and try again.</p> : null}
      {notice ? <p className="form-success" role="status">{notice}</p> : null}
      {productionAnalysis ? (
        <AnalysisProgress analysis={productionAnalysis} loading={loading} onRetry={retryAnalysis} />
      ) : null}
    </section>
  );
}

export function AnalysisProgress({
  analysis,
  loading,
  onRetry,
}: {
  analysis: ProductionAnalysis;
  loading: boolean;
  onRetry: () => void;
}) {
  const failed = analysis.status === "FAILED";
  return (
    <div className="analysis-progress" aria-live="polite" aria-atomic="true">
      <div className="progress-heading">
        <div>
          <p className="eyebrow">Production workflow</p>
          <h3>{failed ? "Analysis failed" : analysis.status === "COMPLETE" ? "Analysis complete" : "Analyzing incident…"}</h3>
        </div>
        <code>{analysis.analysisId.slice(0, 8)}</code>
      </div>
      <ol className="analysis-steps" aria-label="Analysis progress">
        {analysisSteps(analysis).map((step) => (
          <li key={step.label} data-state={step.state}>
            <span aria-hidden="true" />
            <span>{step.label}</span>
            <small>{step.state}</small>
          </li>
        ))}
      </ol>
      {failed ? (
        <div className="analysis-failure" role="alert">
          <dl>
            <div><dt>Stage</dt><dd>{analysis.stage}</dd></div>
            <div><dt>Reason</dt><dd>{analysis.reason ?? "Analysis could not be completed."}</dd></div>
          </dl>
          <button type="button" onClick={onRetry} disabled={loading}>Retry analysis</button>
        </div>
      ) : null}
    </div>
  );
}

function artifactFiles(form: FormData): Array<{ kind: ArtifactKind; file: File }> {
  const required: Array<[ArtifactKind, string]> = [["elf", "elf"], ["crash", "crash"]];
  const result = required.map(([kind, name]) => ({ kind, file: requiredFile(form, name) }));
  const log = form.get("log");
  if (log instanceof File && log.size > 0) result.push({ kind: "log", file: log });
  return result;
}

function requiredFile(form: FormData, name: string): File {
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) throw new Error(`${name} file is required`);
  return file;
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
      <div className="header-status" role="status" aria-label="Incident status">
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
        <div className="timeline-tools" role="group" aria-label="Timeline controls">
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
      <div className="event-strip" role="group" aria-label="Timeline events">
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
                    <code>{evidenceReference(evidence)}</code>
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

export function evidenceReference(
  evidence: Analysis["findings"][number]["evidence"][number],
): string {
  if (evidence.fact) return evidence.fact;
  if (evidence.event) return evidence.event;
  if (evidence.register) return evidence.register;
  if (evidence.frame !== undefined) return `Frame #${evidence.frame}`;
  return "Recorded evidence";
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
  const matchesFixture = analysis.sourceContext && frame?.source?.file === analysis.sourceContext.file;
  return (
    <section className="panel source-panel" aria-labelledby="source-title">
      <PanelTitle eyebrow="Source location" title={frame?.source?.file ?? "Unavailable"} id="source-title" />
      {matchesFixture && analysis.sourceContext ? (
        <pre className="source-code" role="region" tabIndex={0} aria-label={`Source around line ${analysis.sourceContext.focusLine}`}>
          {analysis.sourceContext.lines.map((line) => (
            <span key={line.number} className={line.number === analysis.sourceContext?.focusLine ? "focus-line" : ""}>
              <b>{line.number}</b><code>{line.text}</code>{line.number === analysis.sourceContext?.focusLine ? <em>PC</em> : null}
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
    ["Size", analysis.artifact.size_bytes == null ? null : `${Math.round(analysis.artifact.size_bytes / 1024)} KiB`],
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
