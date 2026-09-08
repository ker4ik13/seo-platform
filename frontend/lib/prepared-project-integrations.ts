import type { PrepareSystemConnectorsResult, ProjectConnectorSettings } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "./browser-api.ts";

const prepared = new Map<string, number>();
export async function preparedProjectIntegrations(projectId: string, signal?: AbortSignal): Promise<ProjectConnectorSettings> {
  const base = `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`;
  if ((prepared.get(projectId) ?? 0) < Date.now()) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const result = await browserApiRequest<PrepareSystemConnectorsResult>(`${base}/prepare-system`, { method: "POST", body: {}, ...(signal ? { signal } : {}) });
        if (!result.pending) {
          if (result.configured) { if (prepared.size >= 100) prepared.delete(prepared.keys().next().value!); prepared.set(projectId, Date.now() + 300_000); }
          break;
        }
        if (attempt < 9) await pause(signal);
      } catch (error) {
        // Members may use connections prepared by a workspace administrator.
        if (error instanceof BrowserApiError && error.status === 403) break;
        throw error;
      }
    }
  }
  return browserApiRequest<ProjectConnectorSettings>(base, signal ? { signal } : {});
}
function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const aborted = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, 1500);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}
