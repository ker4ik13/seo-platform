import { operationResultDefaultPageSize } from "@seo-platform/contracts";

export const operationResultKinds = [
  "frequency",
  "ai-answer",
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
  page?: Readonly<{ cursor?: string; limit?: number }>
): string {
  if (!isOperationResultId(projectId) || !isOperationResultId(operationId)) {
    throw new TypeError("Invalid operation result scope");
  }
  const base = `/app/api/projects/${encodeURIComponent(projectId)}`;
  const id = encodeURIComponent(operationId);
  if (kind === "research") {
    return `${base}/keyword-research-runs/${id}`;
  }
  const query = new URLSearchParams({
    limit: String(
      page?.limit ??
        (kind === "crawl" ? 1_000 : operationResultDefaultPageSize)
    )
  });
  if (page?.cursor) query.set("cursor", page.cursor);
  const suffix = `?${query.toString()}`;
  if (kind === "frequency") {
    return `${base}/frequency-collections/${id}/result${suffix}`;
  }
  if (kind === "ai-answer") {
    return `${base}/ai-answer-collections/${id}/result${suffix}`;
  }
  if (kind === "rank") return `${base}/jobs/${id}/result${suffix}`;
  return `${base}/crawls/${id}/result${suffix}`;
}

export function mergeOperationResultRows<
  Row extends Readonly<{ sequence: number }>
>(
  current: readonly Row[],
  incoming: readonly Row[]
): readonly Row[] {
  const rows = new Map<number, Row>(
    current.map((row) => [row.sequence, row])
  );
  for (const row of incoming) rows.set(row.sequence, row);
  return [...rows.values()].sort((left, right) => left.sequence - right.sequence);
}
