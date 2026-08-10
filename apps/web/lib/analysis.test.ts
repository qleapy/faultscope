import { describe, expect, it } from "vitest";

import fixture from "../fixtures/analysis.json";
import {
  decodeAnalysis,
  initialViewport,
  nextEventIndex,
  timelinePosition,
  zoomViewport,
} from "./analysis";

describe("analysis fixture", () => {
  it("decodes timeline timestamps as bigint", () => {
    const analysis = decodeAnalysis(fixture);
    expect(analysis.events).toHaveLength(5);
    expect(analysis.events[4].timestampNs).toBe(2_205_000_000n);
    expect(analysis.findings[0].evidence).toHaveLength(3);
  });

  it("rejects unsafe timestamp numbers", () => {
    const invalid = structuredClone(fixture);
    invalid.events[0].timestamp_ns = Number.MAX_SAFE_INTEGER + 1;
    expect(() => decodeAnalysis(invalid)).toThrow("timestamp_ns");
  });

  it("decodes the canonical Rust result without fixture-only display metadata", () => {
    const canonical = structuredClone(fixture) as Record<string, unknown>;
    delete canonical.incident;
    delete canonical.artifact;
    delete canonical.source_context;
    canonical.timestamp = null;
    const analysis = decodeAnalysis(canonical);
    expect(analysis.incident.label).toBe("Local crash analysis");
    expect(analysis.sourceContext).toBeNull();
    expect(analysis.artifact.symbols).toBe("available");
  });

  it("converts time to pixels and zooms without Number nanosecond storage", () => {
    const events = decodeAnalysis(fixture).events;
    const viewport = initialViewport(events);
    expect(timelinePosition(viewport.startNs, viewport, 1000)).toBe(0);
    expect(timelinePosition(viewport.endNs, viewport, 1000)).toBe(1000);
    const focus = events.at(-1)?.timestampNs;
    const zoomed = zoomViewport(viewport, "in", events, focus);
    expect(zoomed.endNs - zoomed.startNs).toBe((viewport.endNs - viewport.startNs) / 2n);
    expect(zoomed.startNs <= focus!).toBe(true);
    expect(zoomed.endNs >= focus!).toBe(true);
    expect(zoomViewport(zoomed, "reset", events)).toEqual(viewport);
  });

  it("keeps keyboard selection inside the event list", () => {
    expect(nextEventIndex(0, "ArrowLeft", 5)).toBe(0);
    expect(nextEventIndex(0, "ArrowRight", 5)).toBe(1);
    expect(nextEventIndex(1, "End", 5)).toBe(4);
  });
});
