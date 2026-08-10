import { neon } from "@neondatabase/serverless";

import type { UploadMetadata } from "./artifact-storage";

type StoredBlob = {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
};

export async function createIncident(): Promise<string> {
  const id = crypto.randomUUID();
  await sql()`insert into incidents (id, status) values (${id}, 'UPLOADING')`;
  return id;
}

export async function incidentExists(id: string): Promise<boolean> {
  const rows = await sql()`select 1 from incidents where id = ${id} and status = 'UPLOADING' limit 1`;
  return rows.length === 1;
}

export async function recordArtifact(metadata: UploadMetadata, blob: StoredBlob): Promise<void> {
  const database = sql();
  const id = crypto.randomUUID();
  await database.transaction([
    database`
      insert into artifacts (
        id, incident_id, kind, filename, blob_url, blob_pathname, content_type, size_bytes, created_at
      ) values (
        ${id}, ${metadata.incidentId}, ${metadata.kind}, ${metadata.filename}, ${blob.url},
        ${blob.pathname}, ${blob.contentType}, ${blob.size}, ${blob.uploadedAt}
      )
      on conflict (incident_id, kind) do update set
        filename = excluded.filename,
        blob_url = excluded.blob_url,
        blob_pathname = excluded.blob_pathname,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        created_at = excluded.created_at
    `,
    database`
      update incidents set status = 'READY'
      where id = ${metadata.incidentId}
        and exists (select 1 from artifacts where incident_id = ${metadata.incidentId} and kind = 'elf')
        and exists (select 1 from artifacts where incident_id = ${metadata.incidentId} and kind = 'crash')
    `,
  ]);
}

function sql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return neon(connectionString);
}
