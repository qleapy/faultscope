import { describe, expect, it } from "vitest";

import { productName, status } from "./branding";

describe("branding", () => {
  it("uses the Phase 0 placeholder copy", () => {
    expect([productName, status]).toEqual(["FaultScope", "Development build"]);
  });
});
