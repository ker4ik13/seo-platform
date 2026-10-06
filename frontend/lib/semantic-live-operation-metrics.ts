export const semanticMetricRefreshMinIntervalMs = 10_000;
export const semanticActiveOperationPollIntervalMs = 5_000;

export function shouldRefreshSemanticOperationMetrics(
  previousSignature: string,
  currentSignature: string,
  refreshInFlight: boolean,
  state: Readonly<{
    active: boolean;
    visible: boolean;
    now: number;
    lastAttemptAt: number;
  }>
): boolean {
  return state.visible && !refreshInFlight && previousSignature !== currentSignature &&
    (!state.active || state.now - state.lastAttemptAt >= semanticMetricRefreshMinIntervalMs);
}

export function semanticResearchImportSignature(
  runs: readonly Readonly<{
    id: string;
    importedKeywords: number;
    status: string;
    updatedAt: string;
    version: number;
  }>[]
): string {
  return JSON.stringify(
    runs
      .filter(({ importedKeywords, status }) =>
        status === "COMPLETED" && importedKeywords > 0
      )
      .map(({ id, importedKeywords, updatedAt, version }) => ({
        id,
        importedKeywords,
        updatedAt,
        version
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

export function shouldRefreshSemanticResearchImport(
  previousSignature: string,
  currentSignature: string
): boolean {
  return previousSignature !== currentSignature;
}
