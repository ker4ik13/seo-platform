export function shouldRefreshSemanticOperationMetrics(
  previousSignature: string,
  currentSignature: string,
  refreshInFlight: boolean
): boolean {
  return !refreshInFlight && previousSignature !== currentSignature;
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
