import { competitorSerpOperationResultDepth } from "@seo-platform/contracts";

interface PurposeAwareOperation {
  readonly purpose?: "POSITION_TRACKING" | "COMPETITOR_SERP";
}

export function isCompetitorCollection(
  operation: PurposeAwareOperation
): boolean {
  return operation.purpose === "COMPETITOR_SERP";
}

export function rankCollectionTitle(operation: PurposeAwareOperation): string {
  return isCompetitorCollection(operation)
    ? `Выдача конкурентов · Топ-${competitorSerpOperationResultDepth}`
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
    return `Топ-${competitorSerpOperationResultDepth}`;
  }
  return configuredDepth === undefined ? undefined : `Топ-${configuredDepth}`;
}
