import { describe, expect, it } from "vitest";

import { artifactLimits, artifactPath, parseUploadMetadata, validateArtifact } from "./artifact-storage";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";

describe("artifact storage policy", () => {
  it("keeps upload limits centralized", () => {
    expect(artifactLimits).toEqual({
      elf: 1_073_741_824,
      dump: 1_073_741_824,
      log: 524_288_000,
      crash: 1_048_576,
    });
  });

  it("validates and sanitizes client metadata", () => {
    const metadata = parseUploadMetadata(JSON.stringify({
      incidentId,
      kind: "elf",
      filename: "../my firmware.elf",
      size: 12,
    }));
    expect(metadata.filename).toBe("my-firmware.elf");
    expect(artifactPath(metadata)).toBe(`incidents/${incidentId}/elf/my-firmware.elf`);
  });

  it("rejects oversized artifacts before upload", () => {
    const file = new File(["{}"], "crash.json");
    Object.defineProperty(file, "size", { value: artifactLimits.crash + 1 });
    expect(validateArtifact("crash", file)).toContain("1 MB limit");
    expect(() => parseUploadMetadata(JSON.stringify({
      incidentId,
      kind: "crash",
      filename: "crash.json",
      size: artifactLimits.crash + 1,
    }))).toThrow("upload limit");
  });
});
