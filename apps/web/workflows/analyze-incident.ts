import {
  beginAnalysis,
  completeAnalysis,
  failAnalysis,
} from "../lib/artifact-repository";
import { analyzeInSandbox } from "../lib/sandbox-analysis";

export async function analyzeIncidentWorkflow(analysisId: string) {
  "use workflow";

  try {
    await processAnalysis(analysisId);
  } catch (error) {
    await recordFailure(analysisId, errorMessage(error));
    throw error;
  }
}

async function processAnalysis(analysisId: string) {
  "use step";

  const artifacts = await beginAnalysis(analysisId);
  const result = await analyzeInSandbox(artifacts);
  await completeAnalysis(analysisId, result);
}
processAnalysis.maxRetries = 2;

async function recordFailure(analysisId: string, error: string) {
  "use step";
  await failAnalysis(analysisId, error);
}
recordFailure.maxRetries = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Analysis failed";
}
