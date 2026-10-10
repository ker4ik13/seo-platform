import type {
  SemanticRankDimension,
  SemanticSavedViewColumnKey,
  SemanticSystemColumnKey,
} from "@seo-platform/contracts";
import { rankColumnLabel } from "./rank-dimension-presentation.ts";

export const semanticSystemColumns: readonly Readonly<{
  key: SemanticSystemColumnKey;
  label: string;
}>[] = [
  { key: "query", label: "Запрос" },
  { key: "frequency", label: "База" },
  { key: "frequencyExact", label: '""' },
  { key: "frequencyFixed", label: '"!"' },
  { key: "wordCount", label: "WS" },
  { key: "yandexPosition", label: "Позиция Яндекс" },
  { key: "yandexRelevantUrl", label: "URL из съёма Яндекс" },
  { key: "googlePosition", label: "Позиция Google" },
  { key: "googleRelevantUrl", label: "URL из съёма Google" },
  { key: "yandexAiPosition", label: "ИИ позиция Яндекс" },
  { key: "yandexAiRelevantUrl", label: "URL ИИ-выдачи Яндекс" },
  { key: "googleAiPosition", label: "ИИ позиция Google" },
  { key: "googleAiRelevantUrl", label: "URL ИИ-выдачи Google" },
  { key: "yandexCheckedAt", label: "Дата съёма Яндекс" },
  { key: "googleCheckedAt", label: "Дата съёма Google" },
  { key: "yandexAiCheckedAt", label: "Дата съёма ИИ Яндекс" },
  { key: "googleAiCheckedAt", label: "Дата съёма ИИ Google" },
  { key: "visibility", label: "Видимость" },
  { key: "group", label: "Группа" },
  { key: "cluster", label: "Кластер" },
  { key: "targetUrl", label: "Целевой URL" },
  { key: "tags", label: "Теги" },
  { key: "intent", label: "Интент" },
  { key: "priority", label: "Приоритет" },
  { key: "source", label: "Источник" },
  { key: "updatedAt", label: "Обновлён" },
];

export function semanticColumnLabel(
  column: SemanticSavedViewColumnKey,
  customColumns: readonly Readonly<{ id: string; name: string }>[] = [],
  rankDimensions: readonly SemanticRankDimension[] = [],
  locale = "ru",
): string {
  const rankLabel = rankColumnLabel(column, rankDimensions, locale);
  if (rankLabel) return rankLabel;
  if (column.startsWith("custom:")) {
    return (
      customColumns.find(({ id }) => `custom:${id}` === column)?.name ??
      "Удалённая колонка"
    );
  }
  return (
    semanticSystemColumns.find(({ key }) => key === column)?.label ?? column
  );
}
