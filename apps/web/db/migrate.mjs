import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

const sql = neon(process.env.DATABASE_URL);
await sql.transaction([
  sql`
    create table if not exists incidents (
      id uuid primary key,
      status varchar(32) not null,
      created_at timestamptz not null default now()
    )
  `,
  sql`
    create table if not exists artifacts (
      id uuid primary key,
      incident_id uuid not null references incidents(id) on delete cascade,
      kind varchar(16) not null,
      filename text not null,
      blob_url text not null,
      blob_pathname text not null,
      content_type text not null,
      size_bytes bigint not null,
      sha256 char(64),
      created_at timestamptz not null default now(),
      unique (incident_id, kind)
    )
  `,
  sql`create index if not exists artifacts_incident_id_idx on artifacts (incident_id)`,
  sql`
    create table if not exists analysis_runs (
      id uuid primary key,
      incident_id uuid not null references incidents(id) on delete cascade,
      workflow_run_id text,
      status varchar(32) not null,
      result jsonb,
      error text,
      created_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `,
  sql`create index if not exists analysis_runs_incident_id_idx on analysis_runs (incident_id, created_at desc)`,
  sql`
    create unique index if not exists analysis_runs_active_incident_idx
    on analysis_runs (incident_id) where status in ('QUEUED', 'ANALYZING')
  `,
]);

console.log("FaultScope metadata schema is ready.");
