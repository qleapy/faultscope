import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  attachWorkflowRun: vi.fn(),
  createQueuedAnalysis: vi.fn(),
  failAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
}));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("../../../../../lib/artifact-repository", () => ({
  attachWorkflowRun: mocks.attachWorkflowRun,
  createQueuedAnalysis: mocks.createQueuedAnalysis,
  failAnalysis: mocks.failAnalysis,
  getAnalysis: mocks.getAnalysis,
}));

import { GET, POST } from "./route";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";

describe("POST /api/incidents/:id/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ runId: "wrun_123" });
    mocks.failAnalysis.mockResolvedValue(undefined);
  });

  it("returns a completed analysis without exposing internal errors", async () => {
    mocks.getAnalysis.mockResolvedValue({
      status: "COMPLETE",
      workflowRunId: "wrun_123",
      result: { frames: [], build: {} },
      artifact: { filename: "firmware.elf", sizeBytes: 336 },
    });
    const response = await GET(new Request(
      `https://faultscope.example.test/api/incidents/${incidentId}/analyze?analysisId=${incidentId}`,
    ), { params: Promise.resolve({ id: incidentId }) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.result.incident).toEqual({
      id: incidentId,
      status: "complete",
      label: "Production crash analysis",
    });
    expect(body.result.artifact.size_bytes).toBe(336);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a recoverable public failure reason", async () => {
    mocks.getAnalysis.mockResolvedValue({
      status: "FAILED",
      workflowRunId: "wrun_123",
      result: null,
      artifact: null,
    });
    const response = await GET(new Request(
      `https://faultscope.example.test/api/incidents/${incidentId}/analyze?analysisId=${incidentId}`,
    ), { params: Promise.resolve({ id: incidentId }) });
    const body = await response.json();
    expect(body).toMatchObject({ status: "FAILED", stage: "Artifact analysis" });
    expect(body.reason).toContain("Verify the ELF and crash JSON");
  });

  it("hides status lookup failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAnalysis.mockRejectedValue(new Error("database stack and secret"));
    const response = await GET(new Request(
      `https://faultscope.example.test/api/incidents/${incidentId}/analyze?analysisId=${incidentId}`,
    ), { params: Promise.resolve({ id: incidentId }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Analysis status could not be loaded" });
    consoleError.mockRestore();
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
