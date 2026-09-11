import type { OperationResultKind } from "./operation-result-routes.ts";

interface PurposeAwareOperation {
  readonly purpose?: "POSITION_TRACKING" | "COMPETITOR_SERP";
  readonly depth?: number;
}

interface KeywordResearchOperation {
  readonly source: "KEYS_SO" | "ARSENKIN_WORDSTAT" | "XMLSTOCK_WORDSTAT";
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

export function keywordResearchCollectionTitle(
  operation: KeywordResearchOperation
): "Анализ Keys.so" | "Парсинг Wordstat" {
  return operation.source === "KEYS_SO" ? "Анализ Keys.so" : "Парсинг Wordstat";
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

export function notificationOperationLabel(
  notificationTitle: string,
  fallback: string
): string {
  const match = /^(.*): (?:ошибка|требуется внимание|завершено частично|отменено|завершено)$/u.exec(
    notificationTitle.trim()
  );
  return match?.[1]?.trim() || fallback;
}

export function operationResultTitleFromNotification(
  kind: OperationResultKind,
  notificationTitle: string
): string {
  return notificationOperationLabel(notificationTitle, {
    frequency: "Сбор частотности",
    "ai-answer": "Сбор ИИ-ответов",
    clustering: "Кластеризация запросов",
    rank: "Проверка позиций",
    crawl: "Технический аудит",
    research: "Исследование запросов"
  }[kind]);
}
