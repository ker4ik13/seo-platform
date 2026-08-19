export function shouldRefreshSemanticOperationMetrics(
  previousSignature: string,
  currentSignature: string,
  refreshInFlight: boolean
): boolean {
  return !refreshInFlight && previousSignature !== currentSignature;
}
