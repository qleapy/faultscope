import { describe, expect, it } from "vitest";

import type { AnalysisBackend } from "../../../lib/analysis-backend";
import { analyzeRequest } from "./route";

describe("POST /api/analyze", () => {
  it("passes uploaded bytes to the configured backend", async () => {
    const form = new FormData();
    form.set("elf", new File(["elf"], "firmware.elf"));
    form.set("crash", new File(["crash"], "crash.json"));
    form.set("log", new File(["log"], "runtime.log"));
    const backend: AnalysisBackend = {
      async analyze(input) {
        expect(new TextDecoder().decode(input.elf)).toBe("elf");
        expect(new TextDecoder().decode(input.crash)).toBe("crash");
        expect(new TextDecoder().decode(input.log)).toBe("log");
        return { analyzed: true };
      },
    };

    const response = await analyzeRequest(new Request("http://localhost/api/analyze", {
      method: "POST",
      body: form,
    }), backend);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ analyzed: true });
  });

  it("rejects a request without required files", async () => {
    const backend: AnalysisBackend = { analyze: async () => ({}) };
    const response = await analyzeRequest(new Request("http://localhost/api/analyze", {
      method: "POST",
      body: new FormData(),
    }), backend);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "elf file is required" });
  });
});
