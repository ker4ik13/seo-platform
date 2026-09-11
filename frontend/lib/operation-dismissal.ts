import { isOperationResultId } from "./operation-result-routes.ts";

const dismissibleStatuses = new Set([
  "FAILED",
  "FAILED_FINAL",
  "ACTION_REQUIRED",
  "EXPIRED"
]);

export function isDismissibleOperationStatus(status: string): boolean {
  return dismissibleStatuses.has(status);
}

export function operationDismissalPath(
  projectId: string,
  jobId: string
): string {
  if (!isOperationResultId(projectId) || !isOperationResultId(jobId)) {
    throw new TypeError("Invalid operation dismissal scope");
  }
  return `/app/api/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(jobId)}`;
}
