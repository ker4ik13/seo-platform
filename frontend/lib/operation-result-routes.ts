export const operationResultKinds = [
  "frequency",
  "rank",
  "crawl",
  "research"
] as const;

export type OperationResultKind = (typeof operationResultKinds)[number];

const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function operationResultKind(value: string): OperationResultKind | undefined {
  return operationResultKinds.find((kind) => kind === value);
}

export function isOperationResultId(value: string): boolean {
  return OPERATION_ID_PATTERN.test(value);
}

export function operationResultHref(
  kind: OperationResultKind,
  operationId: string
): string {
  if (!isOperationResultId(operationId)) {
    throw new TypeError("Invalid operation result ID");
  }
  return `/app/tasks/${kind}/${operationId}`;
}

export function parseOperationResultHref(
  value: string
): Readonly<{ kind: OperationResultKind; operationId: string }> | undefined {
  if (!value.startsWith("/")) return undefined;
  const pathname = value.split(/[?#]/u, 1)[0] ?? "";
  const match = /^\/app\/tasks\/([^/]+)\/([^/]+)\/?$/u.exec(pathname);
  if (!match) return undefined;
  const kind = operationResultKind(match[1] ?? "");
  const operationId = match[2] ?? "";
  return kind && isOperationResultId(operationId)
    ? { kind, operationId }
    : undefined;
}

export function operationResultApiPath(
  projectId: string,
  kind: OperationResultKind,
  operationId: string,
  cursor?: string
): string {
  if (!isOperationResultId(projectId) || !isOperationResultId(operationId)) {
    throw new TypeError("Invalid operation result scope");
  }
  const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
  const id = encodeURIComponent(operationId);
  if (kind === "frequency") {
    return `${base}/frequency-collections/${id}/result`;
  }
  if (kind === "rank") return `${base}/jobs/${id}/result`;
  if (kind === "research") {
    return `${base}/keyword-research-runs/${id}`;
  }
  const query = new URLSearchParams({ limit: "1000" });
  if (cursor) query.set("cursor", cursor);
  return `${base}/crawls/${id}/result?${query.toString()}`;
}
