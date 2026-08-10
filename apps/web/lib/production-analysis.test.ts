import { describe, expect, it, vi } from "vitest";

import { analysisSteps, decodeProductionAnalysis, pollAnalysis, queueAnalysis } from "./production-analysis";

const base = { incidentId: "incident", analysisId: "analysis", stage: "Artifact analysis" };

describe("production analysis", () => {
  it("retries only a temporarily unready incident", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Analysis could not be queued", retryable: true }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ analysisId: "analysis", status: "QUEUED" }, { status: 202 }));
    await expect(queueAnalysis("incident", { fetcher, intervalMs: 0 })).resolves.toBe("analysis");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a terminal queue failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Analysis could not be queued" }, { status: 409 }));
    await expect(queueAnalysis("incident", { fetcher, intervalMs: 0 })).rejects.toThrow("could not be queued");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("polls until a complete result is available", async () => {
    const states = [
      { ...base, status: "QUEUED" },
      { ...base, status: "ANALYZING" },
      { ...base, status: "COMPLETE", result: { frames: [] } },
    ];
    const fetcher = vi.fn(async () => Response.json(states.shift()));
    const updates: string[] = [];
    const result = await pollAnalysis("/status", (state) => updates.push(state.status), {
      fetcher,
      intervalMs: 0,
    });
    expect(updates).toEqual(["QUEUED", "ANALYZING", "COMPLETE"]);
    expect(result.result).toEqual({ frames: [] });
  });

  it("marks a failed analyzer stage and leaves result storage pending", () => {
    expect(analysisSteps({ ...base, status: "FAILED", reason: "Invalid artifacts" })).toEqual([
      { label: "Upload artifacts", state: "complete" },
      { label: "Queue analysis", state: "complete" },
      { label: "Run trusted analyzer", state: "failed" },
      { label: "Store results", state: "pending" },
    ]);
  });

  it("rejects malformed status responses", () => {
    expect(() => decodeProductionAnalysis({ status: "COMPLETE" })).toThrow("invalid");
  });
});
