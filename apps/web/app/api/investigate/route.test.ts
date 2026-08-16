import { describe, expect, it } from "vitest";

import fixture from "../../../fixtures/analysis.json";
import { decodeAnalysis } from "../../../lib/analysis";
import { buildInvestigationInput } from "../../../lib/investigation";
import { investigateRequest } from "./route";

const input = buildInvestigationInput(decodeAnalysis(fixture));

describe("POST /api/investigate", () => {
  it("returns explanation and filters unknown evidence ids", async () => {
    const valid = input.events[0].id;
    const response = await investigateRequest(request(input), async () => ({
      summary: "The fault follows the recorded runtime warning.",
      likely_chain: ["Warning, then fault"],
      recommended_checks: ["Inspect the referenced source line"],
      evidence_ids: [valid, "hallucinated"],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ evidence_ids: [valid] });
  });

  it("rejects malformed input without calling the model", async () => {
    let called = false;
    const response = await investigateRequest(request({}), async () => {
      called = true;
      throw new Error("should not run");
    });
    expect(response.status).toBe(422);
    expect(called).toBe(false);
  });

  it("turns provider quota errors into a safe retryable response", async () => {
    const error = Object.assign(new Error("billing detail"), { statusCode: 402 });
    const response = await investigateRequest(request(input), async () => { throw error; });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "AI investigation is temporarily unavailable." });
  });
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/investigate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
