export type ProductionAnalysis = {
  incidentId: string;
  analysisId: string;
  status: "QUEUED" | "ANALYZING" | "COMPLETE" | "FAILED";
  stage: string;
  reason?: string;
  result?: unknown;
};

export type AnalysisStep = {
  label: string;
  state: "complete" | "current" | "pending" | "failed";
};

export async function queueAnalysis(
  incidentId: string,
  options: { signal?: AbortSignal; intervalMs?: number; attempts?: number; fetcher?: typeof fetch } = {},
): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const attempts = options.attempts ?? 10;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetcher(`/api/incidents/${incidentId}/analyze`, {
      method: "POST",
      signal: options.signal,
    });
    const value = await response.json() as { analysisId?: string; error?: string; retryable?: boolean };
    if (response.ok && value.analysisId) return value.analysisId;
    if (!value.retryable || attempt === attempts - 1) {
      throw new Error(value.error ?? "Analysis could not be queued");
    }
    await delay(options.intervalMs ?? 500, options.signal);
  }
  throw new Error("Analysis could not be queued");
}

export function analysisSteps(analysis: ProductionAnalysis): AnalysisStep[] {
  const failedQueue = analysis.status === "FAILED" && analysis.stage === "Queueing analysis";
  return [
    { label: "Upload artifacts", state: "complete" },
    {
      label: "Queue analysis",
      state: failedQueue ? "failed" : analysis.status === "QUEUED" ? "current" : "complete",
    },
    {
      label: "Run trusted analyzer",
      state: analysis.status === "ANALYZING" ? "current"
        : analysis.status === "COMPLETE" ? "complete"
          : analysis.status === "FAILED" && !failedQueue ? "failed" : "pending",
    },
    {
      label: "Store results",
      state: analysis.status === "COMPLETE" ? "complete" : "pending",
    },
  ];
}

export async function pollAnalysis(
  url: string,
  onUpdate: (analysis: ProductionAnalysis) => void,
  options: { signal?: AbortSignal; intervalMs?: number; fetcher?: typeof fetch } = {},
): Promise<ProductionAnalysis> {
  const fetcher = options.fetcher ?? fetch;
  for (;;) {
    const response = await fetcher(url, { cache: "no-store", signal: options.signal });
    const value = await response.json();
    if (!response.ok) {
      const reason = typeof value === "object" && value !== null && "error" in value
        ? String(value.error)
        : "Analysis status could not be loaded";
      throw new Error(reason);
    }
    const body = decodeProductionAnalysis(value);
    onUpdate(body);
    if (body.status === "COMPLETE" || body.status === "FAILED") return body;
    await delay(options.intervalMs ?? 1_000, options.signal);
  }
}

export function decodeProductionAnalysis(value: unknown): ProductionAnalysis {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Analysis status response is invalid");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.incidentId !== "string" || typeof record.analysisId !== "string" ||
      typeof record.stage !== "string" ||
      !["QUEUED", "ANALYZING", "COMPLETE", "FAILED"].includes(String(record.status))) {
    throw new Error("Analysis status response is invalid");
  }
  return record as ProductionAnalysis;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
