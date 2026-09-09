interface PurposeAwareOperation {
  readonly purpose?: "POSITION_TRACKING" | "COMPETITOR_SERP";
  readonly depth?: number;
}

export function isCompetitorCollection(
  operation: PurposeAwareOperation
): boolean {
  return operation.purpose === "COMPETITOR_SERP";
}

export function rankCollectionTitle(operation: PurposeAwareOperation): string {
  return isCompetitorCollection(operation)
    ? `Выдача конкурентов · Топ-${operation.depth ?? 10}`
    : "Проверка позиций";
}

export function aiAnswerCollectionTitle(
  operation: PurposeAwareOperation
): string {
  return isCompetitorCollection(operation)
    ? "ИИ-выдача конкурентов"
    : "Сбор ИИ-ответов";
}

export function rankCollectionDepthLabel(
  operation: PurposeAwareOperation,
  configuredDepth: number | undefined
): string | undefined {
  if (isCompetitorCollection(operation)) {
    return `Топ-${configuredDepth ?? operation.depth ?? 10}`;
  }
  return configuredDepth === undefined ? undefined : `Топ-${configuredDepth}`;
}
