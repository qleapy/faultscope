import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  attachWorkflowRun: vi.fn(),
  createQueuedAnalysis: vi.fn(),
  failAnalysis: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("../../../../../lib/artifact-repository", () => ({
  attachWorkflowRun: mocks.attachWorkflowRun,
  createQueuedAnalysis: mocks.createQueuedAnalysis,
  failAnalysis: mocks.failAnalysis,
}));

import { POST } from "./route";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";

describe("POST /api/incidents/:id/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ runId: "wrun_123" });
    mocks.failAnalysis.mockResolvedValue(undefined);
  });

  it("atomically queues an incident and starts its durable workflow", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: incidentId }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ workflowRunId: "wrun_123", status: "QUEUED" });
    expect(mocks.createQueuedAnalysis).toHaveBeenCalledWith(incidentId, body.analysisId);
    expect(mocks.attachWorkflowRun).toHaveBeenCalledWith(body.analysisId, "wrun_123");
  });

  it("rejects an incident that cannot transition to queued", async () => {
    mocks.createQueuedAnalysis.mockRejectedValue(new Error("not ready"));
    const response = await POST(request(), { params: Promise.resolve({ id: incidentId }) });
    expect(response.status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request(`https://faultscope.example.test/api/incidents/${incidentId}/analyze`, {
    method: "POST",
    headers: { origin: "https://faultscope.example.test" },
  });
}
