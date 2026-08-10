import { createIncident } from "../../../lib/artifact-repository";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json({ id: await createIncident() }, { status: 201 });
  } catch (error) {
    console.error("Failed to create incident", error);
    return Response.json({ error: "Incident creation failed" }, { status: 500 });
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Cross-origin request rejected");
}
