import type { AdminOperationSummary } from "@seo-platform/contracts";
import { rankSearchSystemLabel } from "./rank-jobs.ts";

export function adminOperationName(operation: Pick<AdminOperationSummary, "type" | "frequencyMode">): string {
  if (operation.type === "FREQUENCY_COLLECTION") {
    if (operation.frequencyMode === "SEASONALITY") return "Сезонность Wordstat";
    if (operation.frequencyMode === "FREQUENCY") return "Сбор частотности";
    return "Частотность и сезонность";
  }
  return ({
    MANUAL_RANK_CHECK: "Проверка позиций",
    CLUSTERING_RUN: "Кластеризация запросов",
    TECHNICAL_CRAWL: "Обход сайта",
    KEYWORD_RESEARCH: "Исследование запросов",
    SEMANTIC_IMPORT: "Импорт семантики",
    SEMANTIC_EXPORT: "Экспорт семантики"
  } as Record<string, string>)[operation.type] ?? operation.type.toLocaleLowerCase("ru-RU").replaceAll("_", " ");
}

export function adminSearchProductLabel(operation: Pick<AdminOperationSummary,
  "type" | "provider" | "searchEngine" | "searchSource" | "yandexLiveMode">): string | undefined {
  if (operation.type === "FREQUENCY_COLLECTION" || operation.type === "KEYWORD_RESEARCH") return "Яндекс Wordstat";
  if (!operation.searchEngine) return undefined;
  if (operation.type !== "MANUAL_RANK_CHECK") {
    return operation.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  }
  return rankSearchSystemLabel(operation.searchEngine, operation.searchSource,
    operation.yandexLiveMode, operation.provider === "XMLSTOCK" || operation.provider === "ARSENKIN"
      ? operation.provider : undefined);
}

export function operationFailureLabel(code: string): string {
  return ({
    PROVIDER_LOW_BALANCE: "Недостаточно средств на балансе провайдера",
    ITEMS_FAILED: "Часть запросов не собрана — подробности в логе",
    PROVIDER_RATE_LIMITED: "Ожидает лимит запросов провайдера",
    PROVIDER_CONCURRENCY_LIMITED: "Ожидает свободный слот"
  } as Record<string, string>)[code] ?? `Код: ${code}`;
}
