import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type AnalysisInput = {
  elf: Uint8Array;
  crash: Uint8Array;
  log?: Uint8Array;
};

export interface AnalysisBackend {
  analyze(input: AnalysisInput): Promise<unknown>;
}

type CliRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export class LocalCliAnalysisBackend implements AnalysisBackend {
  constructor(
    private readonly runner: CliRunner = runCli,
    private readonly workspaceRoot = process.env.FAULTSCOPE_WORKSPACE_ROOT ??
      path.resolve(process.cwd(), "../.."),
    private readonly cliPath = process.env.FAULTSCOPE_CLI_PATH,
  ) {}

  async analyze(input: AnalysisInput): Promise<unknown> {
    const directory = await mkdtemp(path.join(tmpdir(), "faultscope-"));
    try {
      const elf = path.join(directory, "firmware.elf");
      const crash = path.join(directory, "crash.json");
      const log = path.join(directory, "runtime.log");
      await Promise.all([
        writeFile(elf, input.elf),
        writeFile(crash, input.crash),
        input.log ? writeFile(log, input.log) : Promise.resolve(),
      ]);
      const analyzeArgs = ["analyze", "--elf", elf, "--crash", crash];
      if (input.log) analyzeArgs.push("--log", log);
      const command = this.cliPath ?? "cargo";
      const args = this.cliPath
        ? analyzeArgs
        : ["run", "--quiet", "--package", "faultscope-cli", "--", ...analyzeArgs];
      const { stdout } = await this.runner(command, args, { cwd: this.workspaceRoot });
      return JSON.parse(stdout) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local analysis failed";
      throw new Error(message.replaceAll(directory, "<temporary directory>").slice(0, 2_000));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class VercelAnalysisBackend implements AnalysisBackend {
  constructor(private readonly endpoint = process.env.FAULTSCOPE_VERCEL_ANALYSIS_URL) {}

  async analyze(input: AnalysisInput): Promise<unknown> {
    if (!this.endpoint) throw new Error("Vercel analysis backend is not configured");
    const body = new FormData();
    body.set("elf", blob(input.elf), "firmware.elf");
    body.set("crash", blob(input.crash), "crash.json");
    if (input.log) body.set("log", blob(input.log), "runtime.log");
    const response = await fetch(this.endpoint, { method: "POST", body });
    const result = await response.json();
    if (!response.ok) throw new Error("Vercel analysis failed");
    return result;
  }
}

export function analysisBackend(): AnalysisBackend {
  return process.env.FAULTSCOPE_ANALYSIS_BACKEND === "vercel"
    ? new VercelAnalysisBackend()
    : new LocalCliAnalysisBackend();
}

function blob(bytes: Uint8Array): Blob {
  return new Blob([Uint8Array.from(bytes).buffer]);
}

function runCli(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || "Local analysis failed"));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
