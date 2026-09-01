export const apiDocSections = [
  {
    slug: "quick-start",
    title: "Быстрый старт",
    description: "Первый запрос, базовый URL и формат ответа.",
    group: "Начало",
    keywords: ["curl", "base url", "первый запрос", "ключ"]
  },
  {
    slug: "authentication",
    title: "Авторизация и права",
    description: "Bearer-токен, scopes, заголовки и ограничения проектов.",
    group: "Начало",
    keywords: ["authorization", "bearer", "scope", "if-match", "idempotency"]
  },
  {
    slug: "projects",
    title: "Проекты",
    description: "Получение списка, чтение и изменение проекта.",
    group: "Основное API",
    keywords: ["workspace", "project", "archive", "restore"]
  },
  {
    slug: "semantics",
    title: "Семантика",
    description: "Ключи, папки, массовые команды, импорт и экспорт.",
    group: "Основное API",
    keywords: ["keywords", "keyword-groups", "bulk", "imports", "exports"]
  },
  {
    slug: "positions",
    title: "Съём позиций",
    description: "Контекст, оценка, запуск, статус и результат.",
    group: "Сбор данных",
    keywords: ["tracking context", "rank estimate", "rank run", "serp", "xmlstock", "arsenkin"]
  },
  {
    slug: "frequency",
    title: "Частотность",
    description: "Запуск Wordstat, состояние и постраничный результат.",
    group: "Сбор данных",
    keywords: ["wordstat", "frequency", "base", "exact", "fixed"]
  },
  {
    slug: "automations",
    title: "Расписания",
    description: "Регулярные и отложенные запуски позиций.",
    group: "Сбор данных",
    keywords: ["automation", "once", "daily", "weekly", "schedule"]
  },
  {
    slug: "jobs",
    title: "Задания и пагинация",
    description: "Жизненный цикл, polling, курсоры, отмена и повторы.",
    group: "Справочник",
    keywords: ["job", "status", "polling", "cursor", "retry", "cancel"]
  },
  {
    slug: "errors",
    title: "Ошибки",
    description: "Единый error envelope и правила повторов.",
    group: "Справочник",
    keywords: ["error", "request id", "401", "403", "409", "429", "5xx"]
  },
  {
    slug: "reference",
    title: "Маршруты API",
    description: "Полный каталог методов, путей и требуемых прав.",
    group: "Справочник",
    keywords: ["endpoint", "route", "method", "справочник"]
  }
] as const;

export type ApiDocSectionSlug = (typeof apiDocSections)[number]["slug"];

export interface ApiEndpointDoc {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly scope: string;
  readonly description: string;
  readonly section: ApiDocSectionSlug;
}

export const apiEndpointCatalog: readonly ApiEndpointDoc[] = [
  endpoint("access-discovery", "GET", "/access", "token:discover", "Рабочая область, проекты и права текущего API-ключа", "quick-start"),
  endpoint("projects-list", "GET", "/workspaces/{workspaceId}/projects", "projects:read", "Список доступных ключу проектов", "projects"),
  endpoint("projects-capabilities", "GET", "/workspaces/{workspaceId}/project-capabilities", "projects:read", "Доступность создания и общего порядка проектов", "projects"),
  endpoint("projects-create", "POST", "/workspaces/{workspaceId}/projects", "projects:write", "Создать проект в рабочей области", "projects"),
  endpoint("projects-order", "PUT", "/workspaces/{workspaceId}/projects/order", "projects:write", "Сохранить общий порядок проектов", "projects"),
  endpoint("project-get", "GET", "/projects/{projectId}", "projects:read", "Карточка проекта", "projects"),
  endpoint("project-update", "PATCH", "/projects/{projectId}", "projects:write", "Изменить настройки проекта", "projects"),
  endpoint("project-archive", "POST", "/projects/{projectId}/archive", "projects:write", "Архивировать проект", "projects"),
  endpoint("project-restore", "POST", "/projects/{projectId}/restore", "projects:write", "Восстановить проект", "projects"),
  endpoint("project-delete", "DELETE", "/projects/{projectId}", "projects:write", "Запустить безопасное удаление проекта", "projects"),
  endpoint("groups-list", "GET", "/projects/{projectId}/keyword-groups", "semantics:read", "Дерево папок семантики", "semantics"),
  endpoint("groups-create", "POST", "/projects/{projectId}/keyword-groups", "semantics:write", "Создать папку", "semantics"),
  endpoint("groups-bulk", "POST", "/projects/{projectId}/keyword-groups/bulk", "semantics:write", "Создать несколько папок", "semantics"),
  endpoint("group-delete", "DELETE", "/projects/{projectId}/keyword-groups/{groupId}", "semantics:write", "Удалить папку с выбранной стратегией для дочерних папок и запросов", "semantics"),
  endpoint("keywords-list", "GET", "/projects/{projectId}/keywords", "semantics:read", "Ключевые слова с фильтрами и курсором", "semantics"),
  endpoint("keywords-create", "POST", "/projects/{projectId}/keywords", "semantics:write", "Создать ключевое слово", "semantics"),
  endpoint("keywords-bulk", "POST", "/projects/{projectId}/keywords/bulk", "semantics:write", "Пакетное создание ключей", "semantics"),
  endpoint("keyword-update", "PATCH", "/projects/{projectId}/keywords/{keywordId}", "semantics:write", "Изменить ключевое слово", "semantics"),
  endpoint("keyword-delete", "DELETE", "/projects/{projectId}/keywords/{keywordId}", "semantics:write", "Переместить запрос в корзину или окончательно очистить его данные", "semantics"),
  endpoint("bulk-command", "POST", "/projects/{projectId}/bulk-commands", "semantics:write", "Массовое изменение выбранных ключей", "semantics"),
  endpoint("import-get", "GET", "/projects/{projectId}/imports/{importId}", "semantics:read", "Состояние импорта", "semantics"),
  endpoint("imports-create", "POST", "/projects/{projectId}/imports", "semantics:write", "Создать импорт", "semantics"),
  endpoint("exports", "GET", "/projects/{projectId}/exports", "semantics:read", "История экспортов", "semantics"),
  endpoint("exports-create", "POST", "/projects/{projectId}/exports", "semantics:write", "Создать экспорт", "semantics"),
  endpoint("clustering", "POST", "/projects/{projectId}/clustering-runs", "semantics:write", "Запустить кластеризацию", "semantics"),
  endpoint("contexts-list", "GET", "/projects/{projectId}/tracking-contexts", "positions:read", "Контексты съёма позиций", "positions"),
  endpoint("contexts-create", "POST", "/projects/{projectId}/tracking-contexts", "positions:run", "Создать контекст съёма", "positions"),
  endpoint("context-update", "PATCH", "/projects/{projectId}/tracking-contexts/{contextId}", "positions:run", "Изменить контекст", "positions"),
  endpoint("context-keywords", "PUT", "/projects/{projectId}/tracking-contexts/{contextId}/keywords", "positions:run", "Заменить точный набор ключей контекста", "positions"),
  endpoint("rank-estimate", "POST", "/projects/{projectId}/rank-estimates", "positions:run", "Рассчитать неизменяемую оценку запуска", "positions"),
  endpoint("rank-runs-list", "GET", "/projects/{projectId}/rank-runs", "positions:read", "История запусков позиций", "positions"),
  endpoint("rank-run", "POST", "/projects/{projectId}/rank-runs", "positions:run", "Подтвердить оценку и создать задание", "positions"),
  endpoint("rank-job", "GET", "/projects/{projectId}/jobs/{jobId}", "positions:read", "Текущее состояние задания", "positions"),
  endpoint("rank-result", "GET", "/projects/{projectId}/jobs/{jobId}/result", "positions:read", "Постраничный результат позиций", "positions"),
  endpoint("rank-cancel", "POST", "/projects/{projectId}/jobs/{jobId}/cancel", "positions:run", "Запросить отмену задания", "positions"),
  endpoint("frequency-list", "GET", "/projects/{projectId}/frequency-collections", "frequency:read", "История съёмов частотности", "frequency"),
  endpoint("frequency-create", "POST", "/projects/{projectId}/frequency-collections", "frequency:run", "Создать съём частотности", "frequency"),
  endpoint("frequency-get", "GET", "/projects/{projectId}/frequency-collections/{jobId}", "frequency:read", "Состояние съёма частотности", "frequency"),
  endpoint("frequency-result", "GET", "/projects/{projectId}/frequency-collections/{jobId}/result", "frequency:read", "Постраничный результат частотности", "frequency"),
  endpoint("frequency-cancel", "POST", "/projects/{projectId}/frequency-collections/{jobId}/cancel", "frequency:run", "Отменить съём частотности", "frequency"),
  endpoint("frequency-retry", "POST", "/projects/{projectId}/frequency-collections/{jobId}/retry-failed", "frequency:run", "Повторить только неуспешные элементы", "frequency"),
  endpoint("automations-list", "GET", "/projects/{projectId}/automations", "automations:read", "Список расписаний позиций", "automations"),
  endpoint("automations-create", "POST", "/projects/{projectId}/automations", "automations:manage", "Создать расписание", "automations"),
  endpoint("automation-update", "PATCH", "/projects/{projectId}/automations/{automationId}", "automations:manage", "Изменить расписание", "automations"),
  endpoint("automation-runs", "GET", "/projects/{projectId}/automations/{automationId}/runs", "automations:read", "История запусков расписания", "automations"),
  endpoint("automation-run", "POST", "/projects/{projectId}/automations/{automationId}/runs", "automations:manage", "Запустить расписание сейчас", "automations"),
  endpoint("automation-pause", "POST", "/projects/{projectId}/automations/{automationId}/pause", "automations:manage", "Поставить расписание на паузу", "automations"),
  endpoint("automation-resume", "POST", "/projects/{projectId}/automations/{automationId}/resume", "automations:manage", "Возобновить расписание", "automations"),
  endpoint("ai-answers", "GET", "/projects/{projectId}/ai-answer-collections", "ai:read", "История съёмов ответов ИИ", "reference"),
  endpoint("ai-answers-create", "POST", "/projects/{projectId}/ai-answer-collections", "ai:run", "Создать съём ответов ИИ", "reference"),
  endpoint("research", "GET", "/projects/{projectId}/keyword-research-runs", "research:read", "История подбора ключей", "reference"),
  endpoint("research-create", "POST", "/projects/{projectId}/keyword-research-runs", "research:run", "Создать подбор ключей", "reference"),
  endpoint("crawls", "GET", "/projects/{projectId}/crawls", "audits:read", "История технических аудитов", "reference"),
  endpoint("crawls-create", "POST", "/projects/{projectId}/crawls", "audits:run", "Запустить технический аудит", "reference"),
  endpoint("pages", "GET", "/projects/{projectId}/pages", "pages:read", "Страницы проекта", "reference"),
  endpoint("pages-create", "POST", "/projects/{projectId}/pages", "pages:write", "Создать страницу", "reference"),
  endpoint("notes", "GET", "/projects/{projectId}/notes", "notes:read", "Заметки проекта", "reference"),
  endpoint("notes-create", "POST", "/projects/{projectId}/notes", "notes:write", "Создать заметку", "reference"),
  endpoint("integration-settings", "GET", "/projects/{projectId}/integration-settings", "integrations:read", "Маршрутизация интеграций проекта", "reference"),
  endpoint("integration-settings-update", "PATCH", "/projects/{projectId}/integration-settings/{bindingId}", "integrations:write", "Изменить привязку интеграции", "reference"),
  endpoint("crawl-automations", "GET", "/projects/{projectId}/crawl-automations", "automations:read", "Расписания аудитов", "reference"),
  endpoint("crawl-automations-create", "POST", "/projects/{projectId}/crawl-automations", "automations:manage", "Создать расписание аудита", "reference")
];

export function apiDocSection(
  value: string
): (typeof apiDocSections)[number] | undefined {
  return apiDocSections.find(({ slug }) => slug === value);
}

export function apiDocHref(slug: ApiDocSectionSlug): string {
  return slug === "quick-start" ? "/docs/api" : `/docs/api/${slug}`;
}

export function apiDocSectionsByGroup(): readonly Readonly<{
  group: string;
  sections: readonly (typeof apiDocSections)[number][];
}>[] {
  return [...new Set(apiDocSections.map(({ group }) => group))].map((group) => ({
    group,
    sections: apiDocSections.filter((section) => section.group === group)
  }));
}

function endpoint(
  id: string,
  method: ApiEndpointDoc["method"],
  path: string,
  scope: string,
  description: string,
  section: ApiDocSectionSlug
): ApiEndpointDoc {
  return { id, method, path, scope, description, section };
}
