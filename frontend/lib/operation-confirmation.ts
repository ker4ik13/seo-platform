import type { OperationEstimate } from "@seo-platform/contracts";
export interface OperationConfirmationRequest { readonly quote: OperationEstimate; readonly refresh: () => Promise<OperationEstimate>; readonly signal?: AbortSignal | undefined }
type Handler = (request: OperationConfirmationRequest) => Promise<OperationEstimate | null>;
let handler: Handler | undefined;

/** Browser-only UI registration; no React or per-user state on the server. */
export function registerOperationConfirmation(next: Handler): () => void { handler = next; return () => { if (handler === next) handler = undefined; }; }
export function hasOperationConfirmation(): boolean { return typeof window !== "undefined" && handler !== undefined; }
export async function confirmPaidOperation(request: OperationConfirmationRequest): Promise<OperationEstimate | null> { return !request.signal?.aborted && handler ? handler(request) : null; }

export function quotedOperationRoute(path: string): { projectId: string; kind: OperationEstimate["kind"] } | undefined {
  const match = /^\/app\/api\/(?:v1\/)?projects\/([0-9a-f-]{36})\/(frequency-collections|ai-answer-collections|clustering-runs|keyword-research-runs)$/iu.exec(path);
  if (!match?.[1] || !match[2]) return undefined;
  const kinds = { "frequency-collections": "FREQUENCY_COLLECTION", "ai-answer-collections": "AI_ANSWER_COLLECTION", "clustering-runs": "CLUSTERING_RUN", "keyword-research-runs": "KEYWORD_RESEARCH" } as const;
  return { projectId: match[1], kind: kinds[match[2] as keyof typeof kinds] };
}
