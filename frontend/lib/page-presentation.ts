import type { PageIndexability, PageType, PageContentStatus } from "@seo-platform/contracts";

const INDEXABILITY_LABELS: Readonly<Record<PageIndexability, string>> = {
  UNKNOWN: "Не проверено",
  INDEXABLE: "Нет ограничений",
  NOINDEX: "Noindex",
  BLOCKED_ROBOTS: "Закрыта robots",
  CANONICALIZED: "Canonical на другую",
  REDIRECTED: "Редирект",
  ERROR: "Ошибка"
};

export function pageIndexabilityLabel(value: PageIndexability): string {
  return INDEXABILITY_LABELS[value];
}

const PAGE_TYPE_LABELS: Readonly<Record<PageType, string>> = {
  EXISTING: "Существующая",
  PLANNED: "План",
  REDIRECTED: "Редирект",
  DELETED: "Удалённая",
  EXTERNAL: "Внешняя",
  UNKNOWN: "Не определён"
};



const CONTENT_STATUS_LABELS: Readonly<Record<PageContentStatus, string>> = {
  IDEA: "Идея",
  RESEARCH: "Исследование",
  BRIEF: "Бриф",
  WRITING: "Написание",
  REVIEW: "Проверка",
  APPROVED: "Согласовано",
  PUBLISHING: "Публикация",
  PUBLISHED: "Опубликовано",
  OPTIMIZATION: "Оптимизация",
  PAUSED: "Пауза",
  REJECTED: "Отклонено",
  ARCHIVED: "Архив"
};

export function pageTypeLabel(value: PageType): string {
  return PAGE_TYPE_LABELS[value];
}



export function contentStatusLabel(value: PageContentStatus): string {
  return CONTENT_STATUS_LABELS[value];
}
