import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IncidentView } from "./incident-view";

describe("incident view", () => {
  it("renders facts, interpretation, confidence, evidence, frames, and unavailable state", () => {
    const html = renderToStaticMarkup(<IncidentView />);
    for (const text of [
      "Timeline",
      "Findings",
      "Possible null pointer access",
      "Confidence",
      "Evidence",
      "Registers",
      "Fault decode",
      "Frames",
      "Unavailable",
      "Artifact",
    ]) {
      expect(html).toContain(text);
    }
  });
});
