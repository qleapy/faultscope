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
]);

console.log("Artifact metadata schema is ready.");
