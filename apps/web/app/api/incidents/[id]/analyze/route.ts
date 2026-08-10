import { start } from "workflow/api";

import { analyzeIncidentWorkflow } from "../../../../../workflows/analyze-incident";
import {
  attachWorkflowRun,
  createQueuedAnalysis,
  failAnalysis,
  getAnalysis,
} from "../../../../../lib/artifact-repository";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const analysisId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    if (!isUuid(id)) return Response.json({ error: "Invalid incident ID" }, { status: 400 });
    await createQueuedAnalysis(id, analysisId);
    const run = await start(analyzeIncidentWorkflow, [analysisId]);
    await attachWorkflowRun(analysisId, run.runId);
    return Response.json({ analysisId, workflowRunId: run.runId, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    await failAnalysis(analysisId, error instanceof Error ? error.message : "Analysis could not be queued").catch(() => {});
    return Response.json({ error: "Analysis could not be queued" }, { status: 409 });
  }
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const analysisId = new URL(request.url).searchParams.get("analysisId") ?? "";
  if (!isUuid(id) || !isUuid(analysisId)) {
    return Response.json({ error: "Invalid analysis ID" }, { status: 400 });
  }
  let analysis: Awaited<ReturnType<typeof getAnalysis>>;
  try {
    analysis = await getAnalysis(id, analysisId);
  } catch (error) {
    console.error("Failed to load analysis status", error);
    return Response.json({ error: "Analysis status could not be loaded" }, { status: 500 });
  }
  if (!analysis) return Response.json({ error: "Analysis not found" }, { status: 404 });

  const body: Record<string, unknown> = {
    incidentId: id,
    analysisId,
    status: analysis.status,
    stage: stage(analysis.status, analysis.workflowRunId),
  };
  if (analysis.status === "FAILED") {
    body.reason = "The artifacts could not be analyzed. Verify the ELF and crash JSON, then retry.";
  }
  if (analysis.status === "COMPLETE") {
    body.result = presentResult(analysis.result, id, analysis.artifact);
  }
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function stage(status: string, workflowRunId: string | null): string {
  if (status === "QUEUED" || (status === "FAILED" && !workflowRunId)) return "Queueing analysis";
  if (status === "COMPLETE") return "Complete";
  return "Artifact analysis";
}

function presentResult(result: unknown, incidentId: string, artifact: { filename: string; sizeBytes: number } | null) {
  const analysis = typeof result === "object" && result !== null && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};
  const frames = Array.isArray(analysis.frames) ? analysis.frames : [];
  const symbols = frames.some((frame) => field(frame, "symbol") != null) ? "available" : "unavailable";
  const dwarf = frames.some((frame) => field(frame, "source") != null) ? "available" : "unavailable";
  const buildId = field(analysis.build, "id");
  return {
    ...analysis,
    incident: { id: incidentId, status: "complete", label: "Production crash analysis" },
    artifact: {
      name: artifact?.filename ?? "firmware.elf",
      kind: "ELF / DWARF",
      size_bytes: artifact?.sizeBytes ?? null,
      build_id: typeof buildId === "string" ? buildId : null,
      symbols,
      dwarf,
    },
  };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : null;
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin request rejected");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
