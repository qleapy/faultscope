import { analysisBackend, type AnalysisBackend } from "../../../lib/analysis-backend";

export async function POST(request: Request) {
  return analyzeRequest(request, analysisBackend());
}

export async function analyzeRequest(request: Request, backend: AnalysisBackend) {
  try {
    const form = await request.formData();
    const elf = requiredFile(form, "elf");
    const crash = requiredFile(form, "crash");
    const log = optionalFile(form, "log");
    const result = await backend.analyze({
      elf: new Uint8Array(await elf.arrayBuffer()),
      crash: new Uint8Array(await crash.arrayBuffer()),
      log: log ? new Uint8Array(await log.arrayBuffer()) : undefined,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}

function requiredFile(form: FormData, name: string): File {
  const file = optionalFile(form, name);
  if (!file) throw new Error(`${name} file is required`);
  return file;
}

function optionalFile(form: FormData, name: string): File | undefined {
  const value = form.get(name);
  if (value == null || value === "") return undefined;
  if (!(value instanceof File) || value.size === 0) throw new Error(`${name} must be a non-empty file`);
  return value;
}
