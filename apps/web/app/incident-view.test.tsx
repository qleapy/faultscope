import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AIInvestigatorPanel, AnalysisProgress, IncidentView, evidenceReference } from "./incident-view";
import fixture from "../fixtures/analysis.json";
import { decodeAnalysis } from "../lib/analysis";

describe("incident view", () => {
  it("renders facts, interpretation, confidence, evidence, frames, and unavailable state", () => {
    const html = renderToStaticMarkup(<IncidentView />);
    for (const text of [
      "Timeline",
      "FreeRTOS",
      "Findings",
      "Possible null pointer access",
      "Confidence",
      "Evidence",
      "Registers",
      "Fault decode",
      "Frames",
      "Unavailable",
      "Artifact",
      "Analyze artifacts",
      "Firmware ELF",
      "Crash JSON",
      "Run analysis",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("offers private artifact storage when configured", () => {
    const html = renderToStaticMarkup(<IncidentView storageEnabled />);
    expect(html).toContain("Analyze artifacts");
    expect(html).not.toContain("Run analysis");
  });

  it("labels AI output as optional interpretation before any model call", () => {
    const html = renderToStaticMarkup(<AIInvestigatorPanel analysis={decodeAnalysis(fixture)} />);
    expect(html).toContain("Optional AI explanation");
    expect(html).toContain("Interpretation only");
    expect(html).toContain("Explain deterministic findings");
    expect(html).toContain("cannot change facts");
  });

  it("shows a safe failure reason and retry action", () => {
    const html = renderToStaticMarkup(<AnalysisProgress
      analysis={{
        incidentId: "incident",
        analysisId: "analysis",
        status: "FAILED",
        stage: "Artifact analysis",
        reason: "Verify the ELF and crash JSON.",
      }}
      loading={false}
      onRetry={() => {}}
    />);
    expect(html).toContain("Analysis failed");
    expect(html).toContain("Artifact analysis");
    expect(html).toContain("Verify the ELF and crash JSON.");
    expect(html).toContain("Retry analysis");
    expect(html).not.toContain("stack");
  });

  it("labels rule evidence by its actual reference type", () => {
    expect(evidenceReference({ id: "frame", description: "PC", frame: 0 })).toBe("Frame #0");
    expect(evidenceReference({ id: "register", description: "SP", register: "arm.sp" })).toBe("arm.sp");
  });
});
