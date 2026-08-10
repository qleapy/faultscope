import { Sandbox } from "@vercel/sandbox";

import type { AnalysisArtifact } from "./artifact-repository";

const paths = {
  elf: "/tmp/faultscope/firmware.elf",
  crash: "/tmp/faultscope/crash.json",
  log: "/tmp/faultscope/runtime.log",
} as const;

export async function analyzeInSandbox(artifacts: AnalysisArtifact[]): Promise<unknown> {
  const snapshotId = requiredEnv("FAULTSCOPE_SANDBOX_SNAPSHOT_ID");
  const blobToken = requiredEnv("BLOB_READ_WRITE_TOKEN");
  const byKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  if (!byKind.has("elf") || !byKind.has("crash")) throw new Error("Required analysis artifacts are missing");

  const hosts = [...new Set(artifacts.map((artifact) => new URL(artifact.blobUrl).hostname))];
  const allow = Object.fromEntries(hosts.map((host) => [host, [{
    transform: [{ headers: { authorization: `Bearer ${blobToken}` } }],
  }]]));
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: 10 * 60 * 1_000,
    resources: { vcpus: 2 },
    networkPolicy: { allow },
  });

  try {
    await sandbox.runCommand("mkdir", ["-p", "/tmp/faultscope"]);
    for (const artifact of artifacts) {
      const download = await sandbox.runCommand("curl", [
        "--fail", "--silent", "--show-error", "--location",
        "--output", paths[artifact.kind], artifact.blobUrl,
      ], { timeoutMs: 5 * 60 * 1_000 });
      if (download.exitCode !== 0) throw new Error(await safeCommandError(download, "Artifact download failed"));
    }

    const args = ["analyze", "--elf", paths.elf, "--crash", paths.crash];
    if (byKind.has("log")) args.push("--log", paths.log);
    const command = await sandbox.runCommand("/usr/local/bin/faultscope", args, { timeoutMs: 5 * 60 * 1_000 });
    if (command.exitCode !== 0) throw new Error(await safeCommandError(command, "Analysis failed"));
    return JSON.parse(await command.stdout()) as unknown;
  } finally {
    await sandbox.stop().catch((error: unknown) => console.error("Failed to stop analysis sandbox", error));
  }
}

async function safeCommandError(command: { stderr(): Promise<string> }, fallback: string): Promise<string> {
  const stderr = (await command.stderr()).trim();
  return (stderr || fallback).slice(0, 2_000);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
