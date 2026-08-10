import type { HandleUploadOptions } from "@vercel/blob/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleUpload: vi.fn(),
  head: vi.fn(),
  incidentExists: vi.fn(),
  recordArtifact: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ head: mocks.head }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("../../../../lib/artifact-repository", () => ({
  incidentExists: mocks.incidentExists,
  recordArtifact: mocks.recordArtifact,
}));

import { POST } from "./route";

const incidentId = "123e4567-e89b-42d3-a456-426614174000";
const metadata = { incidentId, kind: "crash", filename: "crash.json", size: 128 };
const pathname = `incidents/${incidentId}/crash/crash.json`;

describe("POST /api/artifacts/upload", () => {
  afterEach(() => vi.clearAllMocks());

  it("limits a direct upload and records trusted Blob metadata", async () => {
    mocks.incidentExists.mockResolvedValue(true);
    const stored = {
      url: "https://store.private.blob.vercel-storage.com/path",
      pathname,
      contentType: "application/json",
      size: 128,
      uploadedAt: new Date("2026-08-10T00:00:00Z"),
    };
    mocks.head.mockResolvedValue(stored);
    mocks.handleUpload.mockImplementation(async (options: HandleUploadOptions) => {
      const token = await options.onBeforeGenerateToken(pathname, JSON.stringify(metadata), false);
      expect(token).toMatchObject({
        allowedContentTypes: ["application/json"],
        maximumSizeInBytes: 1_048_576,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      await options.onUploadCompleted?.({
        blob: {
          url: stored.url,
          downloadUrl: `${stored.url}?download=1`,
          pathname,
          contentType: stored.contentType,
          contentDisposition: "attachment",
          etag: "etag",
        },
        tokenPayload: token.tokenPayload,
      });
      return { type: "blob.upload-completed", response: "ok" };
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.recordArtifact).toHaveBeenCalledWith(metadata, stored);
  });

  it("rejects a pathname that does not match signed metadata", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.incidentExists.mockResolvedValue(true);
    mocks.handleUpload.mockImplementation(async (options: HandleUploadOptions) => {
      await options.onBeforeGenerateToken(`incidents/${incidentId}/crash/replaced.json`, JSON.stringify(metadata), false);
    });

    const response = await POST(request());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Artifact upload failed" });
    expect(mocks.recordArtifact).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("http://localhost/api/artifacts/upload", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", payload: {} }),
  });
}
