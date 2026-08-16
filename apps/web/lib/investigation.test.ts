import { describe, expect, it } from "vitest";

import fixture from "../fixtures/analysis.json";
import { decodeAnalysis } from "./analysis";
import {
  buildInvestigationInput,
  decodeAIInvestigation,
  decodeInvestigationInput,
  filterEvidenceIds,
  validEvidenceIds,
} from "./investigation";

describe("AI investigation contract", () => {
  const input = buildInvestigationInput(decodeAnalysis(fixture));

  it("sends only compact deterministic evidence", () => {
    expect(input.events.length).toBeLessThanOrEqual(20);
    expect(input.frames[0]).toEqual(expect.objectContaining({
      address: expect.any(Number),
      origin: expect.any(String),
    }));
    expect(JSON.stringify(input)).not.toContain("sourceContext");
    expect(() => decodeInvestigationInput(input)).not.toThrow();
  });

  it("removes hallucinated and duplicate evidence ids", () => {
    const allowed = validEvidenceIds(input);
    const valid = [...allowed][0];
    expect(filterEvidenceIds({
      summary: "Summary",
      likely_chain: [],
      recommended_checks: [],
      evidence_ids: [valid, "invented", valid],
    }, allowed).evidence_ids).toEqual([valid]);
  });

  it("rejects malformed model output", () => {
    expect(() => decodeAIInvestigation({ summary: "Summary", likely_chain: "not an array" })).toThrow();
  });
});
