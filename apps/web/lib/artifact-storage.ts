export const artifactKinds = ["elf", "dump", "log", "crash"] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

export const artifactLimits: Record<ArtifactKind, number> = {
  elf: 1024 * 1024 * 1024,
  dump: 1024 * 1024 * 1024,
  log: 500 * 1024 * 1024,
  crash: 1024 * 1024,
};

export const artifactContentTypes: Record<ArtifactKind, string> = {
  elf: "application/octet-stream",
  dump: "application/octet-stream",
  log: "text/plain",
  crash: "application/json",
};

export const multipartThreshold = 100 * 1024 * 1024;

export type UploadMetadata = {
  incidentId: string;
  kind: ArtifactKind;
  filename: string;
  size: number;
};

export function parseUploadMetadata(value: string | null): UploadMetadata {
  if (!value) throw new Error("Upload metadata is required");
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Upload metadata must be an object");
  }
  const metadata = parsed as Record<string, unknown>;
  if (typeof metadata.incidentId !== "string" || !isUuid(metadata.incidentId)) {
    throw new Error("A valid incident ID is required");
  }
  if (typeof metadata.kind !== "string" || !isArtifactKind(metadata.kind)) {
    throw new Error("A valid artifact kind is required");
  }
  if (typeof metadata.filename !== "string") throw new Error("A filename is required");
  if (typeof metadata.size !== "number" || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw new Error("Artifact size must be a positive integer");
  }
  if (metadata.size > artifactLimits[metadata.kind]) {
    throw new Error(`${metadata.kind} exceeds its upload limit`);
  }
  return {
    incidentId: metadata.incidentId,
    kind: metadata.kind,
    filename: safeFilename(metadata.filename),
    size: metadata.size,
  };
}

export function artifactPath(metadata: UploadMetadata): string {
  return `incidents/${metadata.incidentId}/${metadata.kind}/${safeFilename(metadata.filename)}`;
}

export function validateArtifact(kind: ArtifactKind, file: File): string | null {
  if (file.size <= 0) return `${label(kind)} is empty.`;
  if (file.size > artifactLimits[kind]) {
    return `${label(kind)} exceeds the ${formatBytes(artifactLimits[kind])} limit.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${bytes / (1024 * 1024 * 1024)} GB`;
  return `${bytes / (1024 * 1024)} MB`;
}

function isArtifactKind(value: string): value is ArtifactKind {
  return artifactKinds.includes(value as ArtifactKind);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeFilename(value: string): string {
  const basename = value.split(/[\\/]/).at(-1) ?? "artifact.bin";
  const safe = basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 180);
  return safe || "artifact.bin";
}

function label(kind: ArtifactKind): string {
  return kind === "elf" ? "Firmware ELF" : kind === "crash" ? "Crash JSON" : kind === "log" ? "Runtime log" : "Memory dump";
}
