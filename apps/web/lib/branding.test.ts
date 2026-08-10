import { describe, expect, it } from "vitest";

import { productName, tagline } from "./branding";

describe("branding", () => {
  it("uses the product name and tagline", () => {
    expect([productName, tagline]).toEqual([
      "FaultScope",
      "See what happened before the crash.",
    ]);
  });
});
