import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: mocks.create } }));

import { analyzeInSandbox } from "./sandbox-analysis";

describe("sandbox analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FAULTSCOPE_SANDBOX_SNAPSHOT_ID", "snap_trusted");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "private-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("downloads private artifacts and executes only the trusted CLI", async () => {
    const stop = vi.fn(async () => ({}));
    const runCommand = vi.fn(async (command: string) => command === "/usr/local/bin/faultscope"
      ? result(0, JSON.stringify({ frames: [] }))
      : result(0));
    mocks.create.mockResolvedValue({ runCommand, stop });

    await expect(analyzeInSandbox([
      { kind: "elf", blobUrl: "https://private.example.test/firmware" },
      { kind: "crash", blobUrl: "https://private.example.test/crash" },
    ])).resolves.toEqual({ frames: [] });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      source: { type: "snapshot", snapshotId: "snap_trusted" },
      networkPolicy: {
        allow: {
          "private.example.test": [{
            transform: [{ headers: { authorization: "Bearer private-token" } }],
          }],
        },
      },
    }));
    expect(runCommand).toHaveBeenLastCalledWith(
      "/usr/local/bin/faultscope",
      ["analyze", "--elf", "/tmp/faultscope/firmware.elf", "--crash", "/tmp/faultscope/crash.json"],
      { timeoutMs: 300_000 },
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it("rejects missing required artifacts before creating a sandbox", async () => {
    await expect(analyzeInSandbox([
      { kind: "elf", blobUrl: "https://private.example.test/firmware" },
    ])).rejects.toThrow("Required analysis artifacts are missing");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

function result(exitCode: number, stdout = "", stderr = "") {
  return {
    exitCode,
    stdout: async () => stdout,
    stderr: async () => stderr,
  };
}
