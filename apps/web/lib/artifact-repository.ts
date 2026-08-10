import { neon } from "@neondatabase/serverless";

import type { UploadMetadata } from "./artifact-storage";

type StoredBlob = {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
};

export type AnalysisArtifact = {
  kind: "elf" | "crash" | "log";
  blobUrl: string;
};

export type StoredAnalysis = {
  status: "QUEUED" | "ANALYZING" | "COMPLETE" | "FAILED";
  workflowRunId: string | null;
  result: unknown;
  artifact: {
    filename: string;
    sizeBytes: number;
  } | null;
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

export async function createQueuedAnalysis(incidentId: string, analysisId: string): Promise<void> {
  const rows = await sql()`
    with ready_incident as (
      update incidents set status = 'QUEUED'
      where id = ${incidentId} and status in ('READY', 'FAILED')
      returning id
    )
    insert into analysis_runs (id, incident_id, status)
    select ${analysisId}, id, 'QUEUED' from ready_incident
    returning id
  `;
  if (rows.length !== 1) throw new Error("Incident is not ready for analysis");
}

export async function getAnalysis(incidentId: string, analysisId: string): Promise<StoredAnalysis | null> {
  const rows = await sql()`
    select runs.status, runs.workflow_run_id, runs.result,
      artifact.filename, artifact.size_bytes
    from analysis_runs runs
    left join artifacts artifact
      on artifact.incident_id = runs.incident_id and artifact.kind = 'elf'
    where runs.id = ${analysisId} and runs.incident_id = ${incidentId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status as StoredAnalysis["status"],
    workflowRunId: row.workflow_run_id == null ? null : String(row.workflow_run_id),
    result: row.result,
    artifact: row.filename == null ? null : {
      filename: String(row.filename),
      sizeBytes: Number(row.size_bytes),
    },
  };
}

export async function attachWorkflowRun(analysisId: string, workflowRunId: string): Promise<void> {
  await sql()`
    update analysis_runs set workflow_run_id = ${workflowRunId}
    where id = ${analysisId}
  `;
}

export async function beginAnalysis(analysisId: string): Promise<AnalysisArtifact[]> {
  const database = sql();
  await database`
    update analysis_runs set status = 'ANALYZING'
    where id = ${analysisId} and status in ('QUEUED', 'ANALYZING')
  `;
  await database`
    update incidents set status = 'ANALYZING'
    where id = (select incident_id from analysis_runs where id = ${analysisId})
      and status in ('QUEUED', 'ANALYZING')
  `;
  const rows = await database`
    select kind, blob_url
    from artifacts
    where incident_id = (select incident_id from analysis_runs where id = ${analysisId})
      and kind in ('elf', 'crash', 'log')
  `;
  return rows.map((row) => ({
    kind: row.kind as AnalysisArtifact["kind"],
    blobUrl: String(row.blob_url),
  }));
}

export async function completeAnalysis(analysisId: string, result: unknown): Promise<void> {
  const database = sql();
  await database.transaction([
    database`
      update analysis_runs
      set status = 'COMPLETE', result = ${JSON.stringify(result)}::jsonb, error = null, completed_at = now()
      where id = ${analysisId} and status in ('QUEUED', 'ANALYZING')
    `,
    database`
      update incidents set status = 'COMPLETE'
      where id = (select incident_id from analysis_runs where id = ${analysisId})
        and status in ('QUEUED', 'ANALYZING')
    `,
  ]);
}

export async function failAnalysis(analysisId: string, error: string): Promise<void> {
  const database = sql();
  const message = error.slice(0, 2_000);
  await database.transaction([
    database`
      update analysis_runs
      set status = 'FAILED', error = ${message}, completed_at = now()
      where id = ${analysisId} and status in ('QUEUED', 'ANALYZING')
    `,
    database`
      update incidents set status = 'FAILED'
      where id = (select incident_id from analysis_runs where id = ${analysisId})
        and status in ('QUEUED', 'ANALYZING')
    `,
  ]);
}

function sql() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  return neon(connectionString);
}
