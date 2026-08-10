import { describe, expect, it, vi } from "vitest";

import { analysisSteps, decodeProductionAnalysis, pollAnalysis } from "./production-analysis";

const base = { incidentId: "incident", analysisId: "analysis", stage: "Artifact analysis" };

describe("production analysis", () => {
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
