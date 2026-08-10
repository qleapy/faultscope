import { head } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { incidentExists, recordArtifact } from "../../../../lib/artifact-repository";
import {
  artifactContentTypes,
  artifactLimits,
  artifactPath,
  parseUploadMetadata,
} from "../../../../lib/artifact-storage";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        assertSameOrigin(request);
        const metadata = parseUploadMetadata(clientPayload);
        if (pathname !== artifactPath(metadata)) throw new Error("Artifact pathname does not match metadata");
        if (!(await incidentExists(metadata.incidentId))) throw new Error("Incident is not accepting uploads");
        return {
          allowedContentTypes: [artifactContentTypes[metadata.kind]],
          maximumSizeInBytes: artifactLimits[metadata.kind],
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify(metadata),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = parseUploadMetadata(tokenPayload ?? null);
        if (blob.pathname !== artifactPath(metadata)) throw new Error("Completed artifact pathname does not match metadata");
        const stored = await head(blob.url);
        await recordArtifact(metadata, stored);
      },
    });
    return Response.json(result);
  } catch (error) {
    console.error("Artifact upload failed", error);
    return Response.json({ error: "Artifact upload failed" }, { status: 400 });
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin request rejected");
}
