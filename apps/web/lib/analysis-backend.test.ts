import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalCliAnalysisBackend, VercelAnalysisBackend } from "./analysis-backend";

describe("analysis backends", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs the Rust CLI with temporary files and removes them", async () => {
    let directory = "";
    const backend = new LocalCliAnalysisBackend(async (command, args, options) => {
      expect(command).toBe("cargo");
      expect(options.cwd).toBe("C:\\repo");
      const elf = args[args.indexOf("--elf") + 1];
      const crash = args[args.indexOf("--crash") + 1];
      const log = args[args.indexOf("--log") + 1];
      directory = path.dirname(elf);
      expect(await readFile(elf, "utf8")).toBe("elf");
      expect(await readFile(crash, "utf8")).toBe("crash");
      expect(await readFile(log, "utf8")).toBe("log");
      return { stdout: JSON.stringify({ target: "ok" }), stderr: "" };
    }, "C:\\repo", undefined);

    await expect(backend.analyze({
      elf: new TextEncoder().encode("elf"),
      crash: new TextEncoder().encode("crash"),
      log: new TextEncoder().encode("log"),
    })).resolves.toEqual({ target: "ok" });
    await expect(access(directory)).rejects.toThrow();
  });

  it("requires a configured Vercel endpoint", async () => {
    await expect(new VercelAnalysisBackend(undefined).analyze({
      elf: new Uint8Array(),
      crash: new Uint8Array(),
    })).rejects.toThrow("not configured");
  });

  it("forwards inputs to the configured Vercel endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(await (body.get("elf") as Blob).text()).toBe("elf");
      expect(await (body.get("crash") as Blob).text()).toBe("crash");
      return Response.json({ remote: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new VercelAnalysisBackend("https://analysis.example.test").analyze({
      elf: new TextEncoder().encode("elf"),
      crash: new TextEncoder().encode("crash"),
    });
    expect(result).toEqual({ remote: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
