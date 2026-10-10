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
    slug: "project-data",
    title: "Страницы и заметки",
    description: "Страницы, файлы заметок, папки и цветовая легенда проекта.",
    group: "Основное API",
    keywords: ["pages", "notes", "markdown", "csv", "tsv", "json", "colors", "legend", "папки"]
  },
  {
    slug: "positions",
    title: "Позиции и конкуренты",
    description: "Контекст, оценка, запуск позиций и сбор обычной выдачи.",
    group: "Сбор данных",
    keywords: ["tracking context", "rank estimate", "rank run", "serp", "competitors", "конкуренты", "xmlstock", "arsenkin"]
  },
  {
    slug: "ai-answers",
    title: "ИИ-ответы и ИИ-выдача",
    description: "Сбор ответов, источников и конкурентов в ИИ-выдаче Arsenkin.",
    group: "Сбор данных",
    keywords: ["ai serp", "ai answer", "ии-ответы", "ии-выдача", "конкуренты", "arsenkin"]
  },
  {
    slug: "frequency",
    title: "Частотность",
    description: "Запуск Wordstat, состояние и постраничный результат.",
    group: "Сбор данных",
    keywords: ["wordstat", "frequency", "base", "exact", "fixed"]
  },
  {
    slug: "research",
    title: "Подбор ключей",
    description: "Расширение Wordstat, строки результата и импорт выбранных фраз.",
    group: "Сбор данных",
    keywords: ["keyword research", "wordstat expansion", "подбор", "import"]
  },
  {
    slug: "audits",
    title: "Технический аудит",
    description: "Запуски обхода, проблемы, изменения, дубли и отсутствующие страницы.",
    group: "Сбор данных",
    keywords: ["crawl", "audit", "issues", "duplicates", "pages"]
  },
  {
    slug: "automations",
    title: "Расписания",
    description: "Регулярные и отложенные запуски позиций.",
    group: "Сбор данных",
    keywords: ["automation", "once", "daily", "weekly", "schedule"]
  },
  {
    slug: "integrations",
    title: "Интеграции",
    description: "Безопасные метаданные подключений и маршруты провайдеров.",
    group: "Настройки",
    keywords: ["credentials", "routing", "xmlstock", "arsenkin", "keys.so"]
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
  readonly requestFormat: string;
  readonly responseFormat: string;
}

interface ApiEndpointFormats {
  readonly request?: string;
  readonly response?: string;
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
  endpoint("groups-list", "GET", "/projects/{projectId}/keyword-groups", "semantics:read", "Дерево папок семантики с цветами", "semantics", {
    request: "Path: projectId (UUID). Тело и query отсутствуют.",
    response: "200 · data: [{ id, parentId?, name, path, color?, position, keywordCount, systemKind?, version, createdAt, updatedAt }]."
  }),
  endpoint("groups-create", "POST", "/projects/{projectId}/keyword-groups", "semantics:write", "Создать папку", "semantics"),
  endpoint("groups-bulk", "POST", "/projects/{projectId}/keyword-groups/bulk", "semantics:write", "Создать несколько папок", "semantics"),
  endpoint("group-delete", "DELETE", "/projects/{projectId}/keyword-groups/{groupId}", "semantics:write", "Удалить папку с выбранной стратегией для дочерних папок и запросов", "semantics", {
    request: "Headers: If-Match. Optional JSON: { deleteKeywords?: boolean, promoteChildren?: boolean }.",
    response: "204 No Content."
  }),
  endpoint("keywords-list", "GET", "/projects/{projectId}/keywords", "semantics:read", "Ключевые слова с фильтрами, примечаниями и курсором", "semantics", {
    request: "Query: limit, cursor?, search?, groupId/groupIds?, filters?, sort?, includeNotes=true|false. Полный note возвращается только при includeNotes=true; в этом режиме limit <= 200.",
    response: "200 · data: SemanticKeywordListItem[] с groupPath, optional groupMembershipCount для нескольких папок, targetUrl, tags, frequencies, positions, aiAnswers, hasNote и optional note; page: { hasNext, nextCursor?, totalApprox? }."
  }),
  endpoint("keywords-operation-scope", "POST", "/projects/{projectId}/keywords/operation-scope", "semantics:read", "Облегчённая выборка запросов для большой операции", "semantics", {
    request: "JSON: { groupIds?: UUID[], cursor?: UUID }. Без groupIds выбираются все активные запросы проекта; до 20 000 уникальных папок образуют один union.",
    response: "200 · до 10 000 строк { id, version, isTracked }; первая страница содержит totalApprox, следующая — UUID cursor. Табличные метрики, теги и custom values не загружаются."
  }),
  endpoint("position-summary", "GET", "/projects/{projectId}/keywords/position-summary", "semantics:read", "Текущая средняя позиция и число запросов в Топ-3/5/10/30/50", "positions", {
    request: "Query: rankDimensionKey? — точный поисковик, город и устройство; includeUntracked? — учитывать неотслеживаемые запросы."
  }),
  endpoint("position-history", "GET", "/projects/{projectId}/keywords/position-history", "semantics:read", "До 100 последних проектных срезов; includeUntracked=true включает активные неотслеживаемые запросы", "positions"),
  endpoint("keywords-create", "POST", "/projects/{projectId}/keywords", "semantics:write", "Создать ключевое слово", "semantics"),
  endpoint("keywords-bulk", "POST", "/projects/{projectId}/keywords/bulk", "semantics:write", "Пакетное создание ключей", "semantics", {
    request: "JSON: { duplicatePolicy, items[] }; row-level ADD_TO_GROUP добавляет существующую canonical keyword identity в duplicateGroupId (либо groupId), сохраняя прежние папки. groupId по-прежнему задаёт папку для новой строки.",
    response: "200 · data содержит indexed outcomes CREATED, LINKED_EXISTING, RESTORED, SKIPPED_EXISTING, REJECTED_EXISTING или FAILED."
  }),
  endpoint("keyword-update", "PATCH", "/projects/{projectId}/keywords/{keywordId}", "semantics:write", "Изменить ключевое слово", "semantics"),
  endpoint("keyword-merge", "POST", "/projects/{projectId}/keywords/merge", "semantics:write", "Объединить запросы с сохранением истории у выбранного основного запроса", "semantics", {
    request: "JSON: { keeper: { id, version }, sources: [{ id, version }] }. Все запросы должны принадлежать одному проекту и иметь один язык.",
    response: "200 · data: { keeperKeywordId, keeperVersion, mergedKeywordIds, mergedAt }. Immutable history остаётся доступной через keeper."
  }),
  endpoint("keyword-merge-suggestions", "GET", "/projects/{projectId}/keywords/merge-suggestions", "semantics:read", "Найти повреждённые названия и ближайшие варианты для ручного объединения", "semantics"),
  endpoint("keyword-delete", "DELETE", "/projects/{projectId}/keywords/{keywordId}", "semantics:write", "Переместить запрос в корзину или окончательно очистить его данные", "semantics", {
    request: "Headers: If-Match. Optional JSON: { permanent?: boolean }; permanent=true допустим только для ключа в корзине.",
    response: "204 No Content."
  }),
  endpoint("bulk-command", "POST", "/projects/{projectId}/bulk-commands", "semantics:write", "Массовое изменение выбранных ключей", "semantics"),
  endpoint("import-get", "GET", "/projects/{projectId}/imports/{importId}", "semantics:read", "Состояние импорта", "semantics"),
  endpoint("import-preview-rows", "GET", "/projects/{projectId}/imports/{importId}/preview-rows", "semantics:read", "Строки предпросмотра импорта", "semantics"),
  endpoint("imports-create", "POST", "/projects/{projectId}/imports", "semantics:write", "Создать импорт", "semantics"),
  endpoint("exports", "GET", "/projects/{projectId}/exports", "semantics:read", "История экспортов", "semantics"),
  endpoint("exports-create", "POST", "/projects/{projectId}/exports", "semantics:write", "Создать экспорт", "semantics"),
  endpoint("clustering", "POST", "/projects/{projectId}/clustering-runs", "semantics:write", "Запустить кластеризацию", "semantics"),
  endpoint("contexts-list", "GET", "/projects/{projectId}/tracking-contexts", "positions:read", "Контексты съёма позиций", "positions"),
  endpoint("contexts-create", "POST", "/projects/{projectId}/tracking-contexts", "positions:run", "Создать контекст съёма", "positions"),
  endpoint("context-update", "PATCH", "/projects/{projectId}/tracking-contexts/{contextId}", "positions:run", "Изменить контекст", "positions"),
  endpoint("context-materialize", "POST", "/projects/{projectId}/tracking-contexts/{contextId}/materialize", "positions:run", "Пересчитать актуальные запросы сохранённого контекста", "positions", {
    request: "Пустой JSON: {}. Сервер использует сохранённый scope и не принимает keyword IDs от клиента.",
    response: "200 · data: { contextId, assignedKeywordCount, addedKeywordCount, removedKeywordCount, unchangedKeywordCount, keywordSetHash, version, changedAt }."
  }),
  endpoint("context-keywords", "PUT", "/projects/{projectId}/tracking-contexts/{contextId}/keywords", "positions:run", "Заменить точный набор ключей контекста", "positions"),
  endpoint("rank-estimate", "POST", "/projects/{projectId}/rank-estimates", "positions:run", "Рассчитать неизменяемую оценку позиций или выдачи конкурентов", "positions"),
  endpoint("rank-runs-list", "GET", "/projects/{projectId}/rank-runs", "positions:read", "История запусков позиций и выдачи конкурентов", "positions"),
  endpoint("rank-run", "POST", "/projects/{projectId}/rank-runs", "positions:run", "Подтвердить оценку и создать задание", "positions"),
  endpoint("rank-job", "GET", "/projects/{projectId}/jobs/{jobId}", "positions:read", "Текущее состояние задания", "positions"),
  endpoint("rank-result", "GET", "/projects/{projectId}/jobs/{jobId}/result", "positions:read", "Постраничный результат позиций", "positions"),
  endpoint("rank-cancel", "POST", "/projects/{projectId}/jobs/{jobId}/cancel", "positions:run", "Запросить отмену задания", "positions"),
  endpoint("operation-dismiss", "DELETE", "/projects/{projectId}/operations/{operationId}", "projects:write", "Убрать завершившуюся с ошибкой или истёкшую операцию из пользовательского журнала", "jobs", {
    request: "Path: projectId, operationId (UUID). Тело отсутствует. Допустимы только terminal statuses FAILED_FINAL, ACTION_REQUIRED и EXPIRED.",
    response: "200 · data: { operationId, dismissedAt }. Результаты, биллинг и audit history не удаляются."
  }),
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
  endpoint("automation-delete", "DELETE", "/projects/{projectId}/automations/{automationId}", "automations:manage", "Удалить расписание", "automations"),
  endpoint("ai-answers", "GET", "/projects/{projectId}/ai-answer-collections", "ai:read", "История съёмов ответов и выдачи ИИ", "ai-answers"),
  endpoint("ai-answers-create", "POST", "/projects/{projectId}/ai-answer-collections", "ai:run", "Создать съём ответов или конкурентов ИИ", "ai-answers"),
  endpoint("ai-answers-get", "GET", "/projects/{projectId}/ai-answer-collections/{jobId}", "ai:read", "Состояние съёма ИИ", "ai-answers"),
  endpoint("ai-answers-result", "GET", "/projects/{projectId}/ai-answer-collections/{jobId}/result", "ai:read", "Постраничный результат съёма ИИ", "ai-answers"),
  endpoint("ai-answers-cancel", "POST", "/projects/{projectId}/ai-answer-collections/{jobId}/cancel", "ai:run", "Отменить съём ИИ", "ai-answers"),
  endpoint("research", "GET", "/projects/{projectId}/keyword-research-runs", "research:read", "История подбора ключей", "research"),
  endpoint("research-create", "POST", "/projects/{projectId}/keyword-research-runs", "research:run", "Создать подбор ключей", "research"),
  endpoint("crawls", "GET", "/projects/{projectId}/crawls", "audits:read", "История технических аудитов", "audits"),
  endpoint("crawls-create", "POST", "/projects/{projectId}/crawls", "audits:run", "Запустить технический аудит", "audits"),
  endpoint("pages", "GET", "/projects/{projectId}/pages", "pages:read", "Страницы проекта", "project-data"),
  endpoint("pages-create", "POST", "/projects/{projectId}/pages", "pages:write", "Создать страницу", "project-data"),
  endpoint("notes", "GET", "/projects/{projectId}/notes", "notes:read", "Файлы заметок проекта с содержимым", "project-data", {
    request: "Path: projectId (UUID). Тело и query отсутствуют.",
    response: "200 · data: { notes: ProjectNote[] }; ProjectNote содержит id, title, format, markdown, visibility, version, createdAt и updatedAt. Поле markdown хранит текст выбранного формата."
  }),
  endpoint("notes-create", "POST", "/projects/{projectId}/notes", "notes:write", "Создать заметку", "project-data", {
    request: "JSON: { title: string, markdown: string, visibility: PROJECT_MEMBERS | PUBLIC, format?: MARKDOWN | TEXT | CSV | TSV | JSON }. По умолчанию MARKDOWN.",
    response: "201 · data: ProjectNote; заголовок ETag содержит актуальную version."
  }),
  endpoint("integration-settings", "GET", "/projects/{projectId}/integration-settings", "integrations:read", "Маршрутизация интеграций проекта", "integrations"),
  endpoint("integration-settings-update", "PATCH", "/projects/{projectId}/integration-settings/{bindingId}", "integrations:write", "Изменить привязку интеграции", "integrations"),
  endpoint("crawl-automations", "GET", "/projects/{projectId}/crawl-automations", "automations:read", "Расписания аудитов", "automations"),
  endpoint("crawl-automations-create", "POST", "/projects/{projectId}/crawl-automations", "automations:manage", "Создать расписание аудита", "automations"),
  endpoint("group-duplicate", "POST", "/projects/{projectId}/keyword-groups/{groupId}/duplicate", "semantics:write", "Дублировать папку и выбранное содержимое", "semantics"),
  endpoint("group-update", "PATCH", "/projects/{projectId}/keyword-groups/{groupId}", "semantics:write", "Изменить название, родителя, цвет или позицию папки", "semantics", {
    request: "Headers: If-Match. JSON: { name?: string, parentId?: UUID | null, color?: paletteColor | null, position?: integer }.",
    response: "200 · data: SemanticKeywordGroup с id, parentId, name, path, color, position, keywordCount и version."
  }),
  endpoint("group-color-legend", "GET", "/projects/{projectId}/semantic-group-color-legend", "semantics:read", "Примечания к цветам папок", "project-data", {
    request: "Path: projectId (UUID). Тело и query отсутствуют.",
    response: "200 · data: { entries: [{ color, note }], version, unread, updatedAt?, updatedByUserId?, access: { canManage } }."
  }),
  endpoint("group-color-legend-update", "PATCH", "/projects/{projectId}/semantic-group-color-legend", "semantics:write", "Заменить примечания цветовой легенды", "project-data", {
    request: "Headers: If-Match. JSON: { entries: [{ color: paletteColor, note: string(1..240) }] }.",
    response: "200 · data: SemanticGroupColorLegend; ETag содержит новую version."
  }),
  endpoint("group-color-legend-seen", "POST", "/projects/{projectId}/semantic-group-color-legend/seen", "semantics:read", "Отметить текущую версию цветовой легенды просмотренной", "project-data", {
    request: "JSON: { version: non-negative integer }.",
    response: "200 · data: SemanticGroupColorLegend с unread=false для текущего пользователя."
  }),
  endpoint("keywords-search", "POST", "/projects/{projectId}/keywords/search", "semantics:read", "Найти ключи по большому списку фраз без query-string", "semantics"),
  endpoint("keywords-body-list", "POST", "/projects/{projectId}/keywords/list", "semantics:read", "Получить страницу ключей со сложным фильтром в JSON body", "semantics", {
    request: "JSON: { query: { limit, cursor?, search?, sort?, groupIds?, includeNotes?, filters? } }; точные поля проверяются по allowlist.",
    response: "200 · data: SemanticKeywordListItem[]; page: { hasNext, nextCursor?, totalApprox? }."
  }),
  endpoint("keyword-tag-options", "GET", "/projects/{projectId}/keywords/tag-options", "semantics:read", "Получить доступные теги проекта", "semantics"),
  endpoint("keyword-tags", "GET", "/projects/{projectId}/keywords/tags", "semantics:read", "Получить теги проекта с количеством связанных запросов", "semantics"),
  endpoint("keyword-tag-delete", "DELETE", "/projects/{projectId}/keywords/tags/{tagId}", "semantics:write", "Удалить тег и снять его со всех запросов проекта", "semantics"),
  endpoint("keywords-bulk-preview", "POST", "/projects/{projectId}/keywords/bulk-preview", "semantics:write", "Проверить пакет ключей перед созданием", "semantics"),
  endpoint("keyword-insights", "GET", "/projects/{projectId}/keywords/{keywordId}/insights", "semantics:read", "Карточка ключа: текущие папки с цветами, позиции, частотность, SERP, URL и заметка", "semantics", {
    request: "Path: projectId, keywordId (UUID). Query: dimensionKey? — точный срез поисковика, региона и устройства; snapshotId? — точный immutable снимок для списка найденных URL.",
    response: "200 · data: SemanticKeywordInsights с последними частотностями, позициями, SERP-результатами, target URL и note."
  }),
  endpoint("keyword-ai-answers", "GET", "/projects/{projectId}/keywords/{keywordId}/ai-answers", "semantics:read", "Последние ИИ-ответы ключа по выбранному срезу", "semantics"),
  endpoint("keyword-ai-answer-history", "GET", "/projects/{projectId}/keywords/{keywordId}/ai-answers/history", "semantics:read", "История ИИ-ответов ключа с курсором", "semantics"),
  endpoint("keyword-frequency-delete", "DELETE", "/projects/{projectId}/keywords/{keywordId}/frequencies/{type}/{device}", "semantics:write", "Удалить выбранный контекст частотности ключа", "semantics"),
  endpoint("bulk-clean-preview", "POST", "/projects/{projectId}/bulk-commands/clean-preview", "semantics:write", "Предпросмотр очистки выбранных ключей", "semantics"),
  endpoint("bulk-clean", "POST", "/projects/{projectId}/bulk-commands/clean", "semantics:write", "Применить очистку выбранных ключей", "semantics"),
  endpoint("import-mapping", "POST", "/projects/{projectId}/imports/{importId}/mapping", "semantics:write", "Сохранить сопоставление колонок импорта", "semantics"),
  endpoint("import-publish", "POST", "/projects/{projectId}/imports/{importId}/publish", "semantics:write", "Опубликовать проверенный импорт", "semantics"),
  endpoint("import-cancel", "POST", "/projects/{projectId}/imports/{importId}/cancel", "semantics:write", "Отменить импорт", "semantics"),
  endpoint("upload-create", "POST", "/projects/{projectId}/uploads", "semantics:write", "Создать multipart-загрузку файла импорта", "semantics"),
  endpoint("upload-parts", "POST", "/projects/{projectId}/uploads/{uploadId}/parts", "semantics:write", "Получить подписанные URL частей загрузки", "semantics"),
  endpoint("upload-complete", "POST", "/projects/{projectId}/uploads/{uploadId}/complete", "semantics:write", "Завершить multipart-загрузку", "semantics"),
  endpoint("upload-get", "GET", "/projects/{projectId}/uploads/{uploadId}", "semantics:read", "Получить состояние загрузки", "semantics"),
  endpoint("upload-delete", "DELETE", "/projects/{projectId}/uploads/{uploadId}", "semantics:write", "Отменить незавершённую загрузку", "semantics"),
  endpoint("export-get", "GET", "/projects/{projectId}/exports/{exportId}", "semantics:read", "Получить состояние экспорта", "semantics"),
  endpoint("export-download", "GET", "/projects/{projectId}/exports/{exportId}/download", "semantics:read", "Скачать готовый экспорт через браузерный маршрут", "semantics"),
  endpoint("export-file", "GET", "/projects/{projectId}/exports/{exportId}/file", "semantics:read", "Скачать готовый экспорт по Bearer API", "semantics"),
  endpoint("export-cancel", "POST", "/projects/{projectId}/exports/{exportId}/cancel", "semantics:write", "Отменить активный экспорт", "semantics"),
  endpoint("clustering-list", "GET", "/projects/{projectId}/clustering-runs", "semantics:read", "История кластеризаций", "semantics"),
  endpoint("clustering-section", "GET", "/projects/{projectId}/clustering-runs/{jobId}/result/sections/{sectionId}", "semantics:read", "Страница секции результата кластеризации", "semantics"),
  endpoint("clustering-result", "GET", "/projects/{projectId}/clustering-runs/{jobId}/result", "semantics:read", "Сводный результат кластеризации", "semantics"),
  endpoint("clustering-get", "GET", "/projects/{projectId}/clustering-runs/{jobId}", "semantics:read", "Состояние кластеризации", "semantics"),
  endpoint("clustering-cancel", "POST", "/projects/{projectId}/clustering-runs/{jobId}/cancel", "semantics:write", "Отменить кластеризацию", "semantics"),
  endpoint("clustering-apply", "POST", "/projects/{projectId}/clustering-runs/{jobId}/apply", "semantics:write", "Применить proposal кластеризации", "semantics"),
  endpoint("clustering-reject", "POST", "/projects/{projectId}/clustering-runs/{jobId}/reject", "semantics:write", "Отклонить proposal кластеризации", "semantics"),
  endpoint("clusters-list", "GET", "/projects/{projectId}/clusters", "semantics:read", "Список кластеров проекта", "semantics"),
  endpoint("clusters-create", "POST", "/projects/{projectId}/clusters", "semantics:write", "Создать кластер", "semantics"),
  endpoint("clusters-page-mapping-preview", "POST", "/projects/{projectId}/clusters/page-mapping-preview", "semantics:write", "Предпросмотр назначения страниц кластерам", "semantics"),
  endpoint("clusters-page-mapping-bulk", "POST", "/projects/{projectId}/clusters/page-mapping-bulk", "semantics:write", "Массово назначить страницы кластерам", "semantics"),
  endpoint("clusters-merge-preview", "POST", "/projects/{projectId}/clusters/merge-preview", "semantics:write", "Предпросмотр объединения кластеров", "semantics"),
  endpoint("clusters-merge", "POST", "/projects/{projectId}/clusters/merge", "semantics:write", "Объединить кластеры", "semantics"),
  endpoint("clusters-split-preview", "POST", "/projects/{projectId}/clusters/split-preview", "semantics:write", "Предпросмотр разделения кластера", "semantics"),
  endpoint("clusters-split", "POST", "/projects/{projectId}/clusters/split", "semantics:write", "Разделить кластер", "semantics"),
  endpoint("cluster-update", "PATCH", "/projects/{projectId}/clusters/{clusterId}", "semantics:write", "Изменить кластер", "semantics"),
  endpoint("cluster-delete", "DELETE", "/projects/{projectId}/clusters/{clusterId}", "semantics:write", "Удалить кластер и снять его со всех запросов проекта", "semantics"),
  endpoint("custom-columns", "GET", "/projects/{projectId}/semantic-custom-columns", "semantics:read", "Пользовательские колонки семантики", "semantics"),
  endpoint("custom-column-create", "POST", "/projects/{projectId}/semantic-custom-columns", "semantics:write", "Создать пользовательскую колонку", "semantics"),
  endpoint("custom-column-update", "PATCH", "/projects/{projectId}/semantic-custom-columns/{columnId}", "semantics:write", "Изменить пользовательскую колонку", "semantics"),
  endpoint("custom-column-delete", "DELETE", "/projects/{projectId}/semantic-custom-columns/{columnId}", "semantics:write", "Удалить пользовательскую колонку", "semantics"),
  endpoint("custom-value-set", "PUT", "/projects/{projectId}/keywords/{keywordId}/custom-values/{columnId}", "semantics:write", "Записать пользовательское значение ключа", "semantics"),
  endpoint("custom-value-delete", "DELETE", "/projects/{projectId}/keywords/{keywordId}/custom-values/{columnId}", "semantics:write", "Удалить пользовательское значение ключа", "semantics"),
  endpoint("duplicates-preview", "POST", "/projects/{projectId}/semantic-duplicates/preview", "semantics:read", "Получить группы дублей без изменений", "semantics"),
  endpoint("duplicates-apply", "POST", "/projects/{projectId}/semantic-duplicates/apply", "semantics:write", "Применить выбранные решения по дублям", "semantics"),
  endpoint("negative-presets", "GET", "/projects/{projectId}/negative-keyword-presets", "semantics:read", "Список наборов минус-слов", "semantics"),
  endpoint("negative-preset-create", "POST", "/projects/{projectId}/negative-keyword-presets", "semantics:write", "Создать набор минус-слов", "semantics"),
  endpoint("negative-preset-update", "PATCH", "/projects/{projectId}/negative-keyword-presets/{presetId}", "semantics:write", "Изменить набор минус-слов", "semantics"),
  endpoint("negative-preset-delete", "DELETE", "/projects/{projectId}/negative-keyword-presets/{presetId}", "semantics:write", "Удалить набор минус-слов", "semantics"),
  endpoint("negative-preview", "POST", "/projects/{projectId}/negative-keywords/preview", "semantics:read", "Предпросмотр совпадений минус-слов", "semantics"),
  endpoint("negative-apply", "POST", "/projects/{projectId}/negative-keywords/apply", "semantics:write", "Применить минус-слова к выборке", "semantics"),
  endpoint("saved-views", "GET", "/projects/{projectId}/semantic-saved-views", "semantics:read", "Представления таблицы семантики", "semantics"),
  endpoint("saved-view-create", "POST", "/projects/{projectId}/semantic-saved-views", "semantics:write", "Создать представление", "semantics"),
  endpoint("saved-view-update", "PATCH", "/projects/{projectId}/semantic-saved-views/{viewId}", "semantics:write", "Изменить представление", "semantics"),
  endpoint("saved-view-delete", "DELETE", "/projects/{projectId}/semantic-saved-views/{viewId}", "semantics:write", "Удалить представление", "semantics"),
  endpoint("semantic-versions", "GET", "/projects/{projectId}/semantic-versions", "semantics:read", "История версий семантики", "semantics"),
  endpoint("semantic-version-get", "GET", "/projects/{projectId}/semantic-versions/{versionId}", "semantics:read", "Детали версии семантики", "semantics"),
  endpoint("semantic-version-undo-preview", "GET", "/projects/{projectId}/semantic-versions/{versionId}/undo-preview", "semantics:read", "Предпросмотр отката версии", "semantics"),
  endpoint("semantic-version-undo", "POST", "/projects/{projectId}/semantic-versions/{versionId}/undo", "semantics:write", "Откатить версию семантики", "semantics"),
  endpoint("operation-estimate", "POST", "/projects/{projectId}/operation-estimates", "frequency:run | ai:run | semantics:write | research:run", "Рассчитать стоимость платной операции по её kind", "jobs", {
    request: "Headers: Idempotency-Key. JSON: { kind: FREQUENCY_COLLECTION | AI_ANSWER_COLLECTION | CLUSTERING_RUN | KEYWORD_RESEARCH, command: <тело соответствующего запуска> }.",
    response: "200 · data: { workspaceId, projectId, id, kind, provider, credentialMode, currency, maximumChargeMinor, quantity, affordable, expiresAt, priceBookVersion }; для PLATFORM_PAID передайте id в X-Operation-Estimate-Id при запуске."
  }),
  endpoint("rank-runtime-diagnostics", "GET", "/projects/{projectId}/jobs/{jobId}/runtime-diagnostics", "positions:read", "Безопасная диагностика активного съёма", "positions"),
  endpoint("rank-retry-missing", "POST", "/projects/{projectId}/jobs/{jobId}/retry-missing", "positions:run", "Повторить только отсутствующие результаты", "positions"),
  endpoint("rank-history", "GET", "/projects/{projectId}/rank-history", "positions:read", "История позиций и сохранённой SERP конкретного ключа", "positions"),
  endpoint("rank-dimension-merges", "GET", "/projects/{projectId}/rank-workbench/dimension-merges", "positions:read", "Настройки объединения импортированных срезов", "positions"),
  endpoint("rank-dimension-merge-create", "POST", "/projects/{projectId}/rank-workbench/dimension-merges", "positions:run", "Объединить совместимые срезы в представлении", "positions"),
  endpoint("rank-dimension-merge-remove", "POST", "/projects/{projectId}/rank-workbench/dimension-merges/{mergeId}/remove", "positions:run", "Удалить правило объединения срезов", "positions"),
  endpoint("rank-workbench-positions", "POST", "/projects/{projectId}/rank-workbench/positions", "positions:read", "Матрица позиций, URL, частотности и ИИ-позиций", "positions", {
    request: "JSON: { mode?: SEO|AI, dimensionKey, observedFrom, observedBefore, dateLimit: 2..31, groupIds?, search?, limit: 50|100|200, cursor?, sort }. Без mode используется SEO.",
    response: "200 · data: { dimension, dates, summary, trend, rows, page }; dates, summary, trend и cells с position/rankingUrl относятся только к выбранному mode."
  }),
  endpoint("rank-workbench-serp", "POST", "/projects/{projectId}/rank-workbench/serp", "positions:read", "Сравнить обычную и ИИ-выдачу до пяти срезов", "positions", {
    request: "JSON: { dimensionKeys: string[1..5], groupIds?, search?, limit: 50|100|200, cursor? }.",
    response: "200 · data: { dimensions, rows, page }; каждая строка содержит snapshots и aiSnapshots с position, URL, title, snippet и faviconUrl. Обычный snapshot имеет canonical provider ARSENKIN | XMLSTOCK | KEY_COLLECTOR."
  }),
  endpoint("rank-dimension-history-delete", "POST", "/projects/{projectId}/rank-workbench/delete-dimension-history", "positions:run", "Исключить старую историю выбранного среза", "positions"),
  endpoint("rank-dimensions", "GET", "/projects/{projectId}/keyword-ranks/dimensions", "positions:read", "Каталог поисковиков, городов и устройств", "positions", {
    response: "200 · data: { dimensions, aiDimensions?, truncated }; dimensions содержит SEO-срезы, aiDimensions — срезы с сохранёнными ИИ-позициями."
  }),
  endpoint("rank-comparison", "POST", "/projects/{projectId}/keyword-ranks/comparison", "positions:read", "Сравнить позиции ключей по нескольким срезам", "positions"),
  endpoint("context-get", "GET", "/projects/{projectId}/tracking-contexts/{contextId}", "positions:read", "Получить контекст съёма", "positions"),
  endpoint("context-archive", "POST", "/projects/{projectId}/tracking-contexts/{contextId}/archive", "positions:run", "Архивировать контекст", "positions"),
  endpoint("context-restore", "POST", "/projects/{projectId}/tracking-contexts/{contextId}/restore", "positions:run", "Восстановить контекст", "positions"),
  endpoint("context-keywords-get", "GET", "/projects/{projectId}/tracking-contexts/{contextId}/keywords", "positions:read", "Получить ключи контекста", "positions"),
  endpoint("context-keyword-set", "PUT", "/projects/{projectId}/tracking-contexts/{contextId}/keywords/{keywordId}", "positions:run", "Добавить или обновить ключ в контексте", "positions"),
  endpoint("context-keyword-delete", "DELETE", "/projects/{projectId}/tracking-contexts/{contextId}/keywords/{keywordId}", "positions:run", "Удалить ключ из контекста", "positions"),
  endpoint("research-get", "GET", "/projects/{projectId}/keyword-research-runs/{runId}", "research:read", "Состояние подбора ключей", "research"),
  endpoint("research-rows", "GET", "/projects/{projectId}/keyword-research-runs/{runId}/rows", "research:read", "Строки подбора с курсором", "research"),
  endpoint("research-confirm", "POST", "/projects/{projectId}/keyword-research-runs/{runId}/confirm", "research:run", "Подтвердить выбранные строки и импорт", "research"),
  endpoint("research-cancel", "POST", "/projects/{projectId}/keyword-research-runs/{runId}/cancel", "research:run", "Отменить подбор ключей", "research"),
  endpoint("research-retry-import", "POST", "/projects/{projectId}/keyword-research-runs/{runId}/retry-import", "research:run", "Повторить импорт готового результата", "research"),
  endpoint("crawl-issues", "GET", "/projects/{projectId}/crawl-issues", "audits:read", "Агрегированные проблемы технического аудита", "audits"),
  endpoint("crawl-changes", "GET", "/projects/{projectId}/crawl-changes", "audits:read", "Изменения между обходами", "audits"),
  endpoint("crawl-duplicate-groups", "GET", "/projects/{projectId}/crawls/{crawlId}/duplicate-groups", "audits:read", "Группы дублей конкретного обхода", "audits"),
  endpoint("crawl-absent-pages", "GET", "/projects/{projectId}/crawls/{crawlId}/absent-pages", "audits:read", "Страницы карты, отсутствующие в обходе", "audits"),
  endpoint("crawl-get", "GET", "/projects/{projectId}/crawls/{crawlId}", "audits:read", "Состояние обхода", "audits"),
  endpoint("crawl-result", "GET", "/projects/{projectId}/crawls/{crawlId}/result", "audits:read", "Постраничный результат обхода", "audits"),
  endpoint("crawl-cancel", "POST", "/projects/{projectId}/crawls/{crawlId}/cancel", "audits:run", "Отменить технический аудит", "audits"),
  endpoint("page-get", "GET", "/projects/{projectId}/pages/{pageId}", "pages:read", "Получить страницу проекта", "project-data"),
  endpoint("page-statistics", "GET", "/projects/{projectId}/pages/rank-statistics", "pages:read", "Пакетная статистика страниц; также нужен positions:read", "project-data"),
  endpoint("page-keyword-target", "GET", "/projects/{projectId}/pages/by-keyword/{keywordId}", "pages:read", "Целевая страница запроса; также нужен semantics:read", "project-data"),
  endpoint("page-panel", "GET", "/projects/{projectId}/pages/{pageId}/panel", "pages:read", "Ссылки, история или семантика страницы; для ключей нужен semantics:read", "project-data"),
  endpoint("page-update", "PATCH", "/projects/{projectId}/pages/{pageId}", "pages:write", "Изменить страницу проекта", "project-data"),
  endpoint("page-archive", "POST", "/projects/{projectId}/pages/{pageId}/archive", "pages:write", "Архивировать страницу", "project-data"),
  endpoint("page-restore", "POST", "/projects/{projectId}/pages/{pageId}/restore", "pages:write", "Восстановить страницу", "project-data"),
  endpoint("note-get", "GET", "/projects/{projectId}/notes/{noteId}", "notes:read", "Получить файл заметки с содержимым", "project-data", {
    request: "Path: projectId, noteId (UUID). Тело и query отсутствуют.",
    response: "200 · data: ProjectNote; ETag содержит version для последующего PATCH или DELETE."
  }),
  endpoint("note-update", "PATCH", "/projects/{projectId}/notes/{noteId}", "notes:write", "Изменить заметку", "project-data", {
    request: "Headers: If-Match. JSON: любое непустое подмножество { title, markdown, visibility, format }.",
    response: "200 · data: обновлённый ProjectNote; ETag содержит новую version."
  }),
  endpoint("note-delete", "DELETE", "/projects/{projectId}/notes/{noteId}", "notes:write", "Удалить заметку", "project-data", {
    request: "Headers: If-Match. Path: projectId, noteId (UUID). Тело отсутствует.",
    response: "204 No Content."
  }),
  endpoint("workspace-integration-catalog", "GET", "/workspaces/{workspaceId}/integrations/catalog", "integrations:read", "Каталог провайдеров и возможностей", "integrations"),
  endpoint("workspace-integration-credentials", "GET", "/workspaces/{workspaceId}/integrations/credentials", "integrations:read", "Безопасные метаданные подключений без секретов", "integrations"),
  endpoint("workspace-integration-routing", "GET", "/workspaces/{workspaceId}/integrations/routing", "integrations:read", "Маршруты провайдеров рабочей области", "integrations"),
  endpoint("workspace-integration-routing-update", "PUT", "/workspaces/{workspaceId}/integrations/routing/{capability}", "integrations:write", "Заменить маршрут выбранной возможности", "integrations"),
  endpoint("workspace-credential-create", "POST", "/workspaces/{workspaceId}/integrations/credentials", "integrations:write", "Добавить BYOK credential", "integrations"),
  endpoint("workspace-platform-credential-create", "POST", "/workspaces/{workspaceId}/integrations/platform-credentials", "integrations:write", "Подключить системный credential", "integrations"),
  endpoint("workspace-credential-update", "PATCH", "/workspaces/{workspaceId}/integrations/credentials/{credentialId}", "integrations:write", "Переименовать или заменить credential", "integrations"),
  endpoint("workspace-credential-validate", "POST", "/workspaces/{workspaceId}/integrations/credentials/{credentialId}/validations", "integrations:write", "Запустить безопасную проверку credential", "integrations"),
  endpoint("workspace-credential-validation", "GET", "/workspaces/{workspaceId}/integrations/credentials/{credentialId}/validations/{validationId}", "integrations:read", "Получить состояние проверки credential", "integrations"),
  endpoint("workspace-credential-delete", "DELETE", "/workspaces/{workspaceId}/integrations/credentials/{credentialId}", "integrations:write", "Отозвать credential и стереть его secret material", "integrations"),
  endpoint("integration-settings-create", "POST", "/projects/{projectId}/integration-settings", "integrations:write", "Создать project override маршрута", "integrations"),
  endpoint("integration-settings-prepare", "POST", "/projects/{projectId}/integration-settings/prepare-system", "integrations:write", "Подготовить доступные системные маршруты", "integrations"),
  endpoint("integration-settings-inherit", "POST", "/projects/{projectId}/integration-settings/{bindingId}/inherit", "integrations:write", "Вернуть маршрут к настройкам workspace", "integrations"),
  endpoint("crawl-automation-runs", "GET", "/projects/{projectId}/crawl-automations/{automationId}/runs", "automations:read", "История запусков расписания аудита", "automations"),
  endpoint("crawl-automation-update", "PATCH", "/projects/{projectId}/crawl-automations/{automationId}", "automations:manage", "Изменить расписание аудита", "automations"),
  endpoint("crawl-automation-pause", "POST", "/projects/{projectId}/crawl-automations/{automationId}/pause", "automations:manage", "Поставить аудит на паузу", "automations"),
  endpoint("crawl-automation-resume", "POST", "/projects/{projectId}/crawl-automations/{automationId}/resume", "automations:manage", "Возобновить аудит", "automations"),
  endpoint("crawl-automation-run", "POST", "/projects/{projectId}/crawl-automations/{automationId}/runs", "automations:manage", "Запустить аудит по расписанию сейчас", "automations")
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

export function apiAgentCatalog(baseUrl: string) {
  return {
    apiVersion: "v1" as const,
    baseUrl,
    conventions: {
      authorization: "Authorization: Bearer seo_pat_<secret>",
      contentType: "application/json",
      dates: "ISO 8601 UTC",
      pagination: {
        request: "limit + opaque cursor",
        response: "page.hasNext + page.nextCursor"
      },
      commands: {
        idempotency: "Idempotency-Key for create/run commands",
        concurrency: "If-Match: \"v<version>\" for versioned changes"
      },
      envelope: {
        success: "{ data, meta: { requestId, version? }, page? }",
        error: "{ error: { code, message, details? }, meta: { requestId } }"
      }
    },
    sections: apiDocSections.map(({ slug, title, description, group }) => ({
      slug,
      title,
      description,
      group,
      endpoints: apiEndpointCatalog.filter(
        (endpoint) => endpoint.section === slug
      )
    }))
  };
}

function endpoint(
  id: string,
  method: ApiEndpointDoc["method"],
  path: string,
  scope: string,
  description: string,
  section: ApiDocSectionSlug,
  formats: ApiEndpointFormats = {}
): ApiEndpointDoc {
  return {
    id,
    method,
    path,
    scope,
    description,
    section,
    requestFormat:
      formats.request ?? defaultRequestFormat(method, path),
    responseFormat:
      formats.response ?? defaultResponseFormat(method)
  };
}

function defaultRequestFormat(
  method: ApiEndpointDoc["method"],
  path: string
): string {
  const parameters = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)]
    .map(([, name]) => `${name}: ${name?.endsWith("Id") ? "UUID" : "string"}`)
    .join(", ");
  const target = parameters ? `Path: ${parameters}. ` : "";
  return ["GET", "DELETE"].includes(method)
    ? `${target}JSON body отсутствует, если для метода явно не указано обратное.`
    : `${target}Content-Type: application/json; неизвестные поля отклоняются.`;
}

function defaultResponseFormat(method: ApiEndpointDoc["method"]): string {
  return method === "DELETE"
    ? "204 No Content либо JSON { data, meta: { requestId } }, если команда возвращает ресурс."
    : "JSON { data: <типизированный результат>, meta: { requestId }, page?: { hasNext, nextCursor } }.";
}
