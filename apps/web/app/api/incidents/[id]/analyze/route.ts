import { start } from "workflow/api";

import { analyzeIncidentWorkflow } from "../../../../../workflows/analyze-incident";
import {
  attachWorkflowRun,
  createQueuedAnalysis,
  failAnalysis,
} from "../../../../../lib/artifact-repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin request rejected");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
