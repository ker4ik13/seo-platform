"use client";

import {
  pageContentStatuses,
  pageIndexabilities,
  pageTypes,
  type PageContentStatus,
  type PageIndexability,
  type PageLifecycleStatus,
  type PageType,
  type ProjectPageSettings,
  type ProjectPageSummary
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  emptyProjectPageDraft,
  projectPageApiPath,
  projectPageDraft,
  projectPageInput,
  projectPagesApiPath,
  validateProjectPageDraft,
  type ProjectPageDraft,
  type ProjectPageDraftErrors
} from "../lib/project-pages";

interface PageFilters {
  readonly search: string;
  readonly pageType: PageType | "";
  readonly indexability: PageIndexability | "";
  readonly lifecycleStatus: PageLifecycleStatus;
}

interface EditorState {
  readonly page?: ProjectPageSummary;
  readonly draft: ProjectPageDraft;
}

const DEFAULT_FILTERS: PageFilters = {
  search: "",
  pageType: "",
  indexability: "",
  lifecycleStatus: "ACTIVE"
};

export function ProjectPageMap({
  projectId
}: Readonly<{ projectId: string }>) {
  const [collection, setCollection] = useState<ProjectPageSettings>();
  const [filters, setFilters] = useState<PageFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<PageFilters>(DEFAULT_FILTERS);
  const [editor, setEditor] = useState<EditorState>();
  const [errors, setErrors] = useState<ProjectPageDraftErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [online, setOnline] = useState(true);
  const [reload, setReload] = useState(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(undefined);
      try {
        const next = await browserApiRequest<ProjectPageSettings>(
          pagesUrl(projectId, appliedFilters),
          signal ? { signal } : {}
        );
        setCollection(next);
      } catch (error) {
        if (!signal?.aborted) {
          setLoadError(
            errorMessage(error, "Не удалось загрузить карту страниц.")
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId, appliedFilters]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    globalThis.addEventListener("online", update);
    globalThis.addEventListener("offline", update);
    return () => {
      globalThis.removeEventListener("online", update);
      globalThis.removeEventListener("offline", update);
    };
  }, []);

  const canManage = online && collection?.access.canManage === true;

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedFilters(filters);
  }

  function startCreate(): void {
    setErrors({});
    setOperationError(undefined);
    setSuccess(undefined);
    setEditor({ draft: emptyProjectPageDraft() });
  }

  function startEdit(page: ProjectPageSummary): void {
    setErrors({});
    setOperationError(undefined);
    setSuccess(undefined);
    setEditor({ page, draft: projectPageDraft(page) });
  }

  function changeDraft(patch: Partial<ProjectPageDraft>): void {
    setEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current
    );
  }

  async function submitPage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || !canManage) return;
    const nextErrors = validateProjectPageDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const current = editor.page;
    setBusyId(current?.id ?? "create");
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const saved = await browserApiRequest<ProjectPageSummary>(
        current
          ? projectPageApiPath(projectId, current.id)
          : projectPagesApiPath(projectId),
        {
          method: current ? "PATCH" : "POST",
          body: projectPageInput(editor.draft),
          ...(current
            ? { ifMatch: current.version }
            : {
                idempotencyKey: `page:${globalThis.crypto.randomUUID()}`
              })
        }
      );
      setCollection((value) =>
        value ? withPage(value, saved, appliedFilters) : value
      );
      setEditor(undefined);
      setSuccess(current ? "Страница обновлена." : "Страница добавлена.");
    } catch (error) {
      setOperationError(
        errorMessage(error, "Не удалось сохранить страницу.")
      );
      if (isVersionConflict(error)) void load();
    } finally {
      setBusyId(undefined);
    }
  }

  async function changeStatus(
    page: ProjectPageSummary,
    operation: "archive" | "restore"
  ): Promise<void> {
    if (!canManage) return;
    setBusyId(page.id);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const saved = await browserApiRequest<ProjectPageSummary>(
        `${projectPageApiPath(projectId, page.id)}/${operation}`,
        {
          method: "POST",
          body: {},
          ifMatch: page.version
        }
      );
      setCollection((value) =>
        value ? withPage(value, saved, appliedFilters) : value
      );
      setSuccess(
        operation === "archive"
          ? "Страница перенесена в архив."
          : "Страница восстановлена."
      );
    } catch (error) {
      setOperationError(
        errorMessage(
          error,
          operation === "archive"
            ? "Не удалось архивировать страницу."
            : "Не удалось восстановить страницу."
        )
      );
      if (isVersionConflict(error)) void load();
    } finally {
      setBusyId(undefined);
    }
  }

  async function loadMore(): Promise<void> {
    if (!collection?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setOperationError(undefined);
    try {
      const next = await browserApiRequest<ProjectPageSettings>(
        pagesUrl(projectId, appliedFilters, collection.nextCursor)
      );
      setCollection({
        ...next,
        pages: [...collection.pages, ...next.pages]
      });
    } catch (error) {
      setOperationError(
        errorMessage(error, "Не удалось загрузить следующую страницу.")
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !collection) {
    return (
      <section className="panel page-map-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p>Загружаем страницы проекта…</p>
      </section>
    );
  }

  if (loadError && !collection) {
    return (
      <section className="panel page-map-state" role="alert">
        <h2>Карта страниц недоступна</h2>
        <p>{loadError}</p>
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
          type="button"
        >
          Повторить
        </button>
      </section>
    );
  }

  if (!collection) return null;

  return (
    <div className="page-map">
      {!online && (
        <div className="inline-warning" role="status">
          Нет сети. Данные доступны для просмотра, изменения временно
          отключены.
        </div>
      )}
      {collection.access.mutationRestriction !== "NONE" && (
        <div className="inline-note" role="status">
          {restrictionLabel(collection.access.mutationRestriction)}
        </div>
      )}
      {operationError && (
        <div className="inline-error" role="alert">{operationError}</div>
      )}
      {success && (
        <div className="inline-success" role="status">{success}</div>
      )}

      <section className="panel page-map-toolbar">
        <form className="page-map-filters" onSubmit={applyFilters}>
          <label className="form-field page-map-search">
            <span>Поиск</span>
            <input
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  search: event.target.value
                }))
              }
              placeholder="URL, Title или H1"
              type="search"
              value={filters.search}
            />
          </label>
          <label className="form-field">
            <span>Тип</span>
            <select
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  pageType: event.target.value as PageType | ""
                }))
              }
              value={filters.pageType}
            >
              <option value="">Все типы</option>
              {pageTypes.map((value) => (
                <option key={value} value={value}>
                  {pageTypeLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Индексируемость</span>
            <select
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  indexability: event.target.value as PageIndexability | ""
                }))
              }
              value={filters.indexability}
            >
              <option value="">Все состояния</option>
              {pageIndexabilities.map((value) => (
                <option key={value} value={value}>
                  {indexabilityLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Раздел</span>
            <select
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  lifecycleStatus:
                    event.target.value as PageLifecycleStatus
                }))
              }
              value={filters.lifecycleStatus}
            >
              <option value="ACTIVE">Активные</option>
              <option value="ARCHIVED">Архив</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Применить
          </button>
        </form>
        <button
          className="primary-button"
          disabled={!canManage || busyId !== undefined}
          onClick={startCreate}
          type="button"
        >
          Добавить страницу
        </button>
      </section>

      {editor && (
        <PageEditor
          busy={busyId !== undefined}
          draft={editor.draft}
          errors={errors}
          existing={editor.page !== undefined}
          onCancel={() => setEditor(undefined)}
          onChange={changeDraft}
          onSubmit={submitPage}
        />
      )}

      {collection.pages.length === 0 ? (
        <section className="panel page-map-empty">
          <h2>
            {appliedFilters.lifecycleStatus === "ARCHIVED"
              ? "Архив пуст"
              : "Страниц пока нет"}
          </h2>
          <p>
            Добавьте существующую или планируемую посадочную страницу. URL,
            назначенные запросы и последующие результаты crawl будут
            объединены в одной карточке.
          </p>
          {canManage && appliedFilters.lifecycleStatus === "ACTIVE" && (
            <button className="primary-button" onClick={startCreate} type="button">
              Добавить первую страницу
            </button>
          )}
        </section>
      ) : (
        <section className="panel page-map-list">
          <div className="page-map-table-wrap">
            <table className="page-map-table">
              <thead>
                <tr>
                  <th>Страница</th>
                  <th>Тип</th>
                  <th>Индексируемость</th>
                  <th>HTTP</th>
                  <th>Запросы</th>
                  <th>Контент</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {collection.pages.map((page) => (
                  <PageRow
                    busy={busyId === page.id}
                    canManage={canManage}
                    key={page.id}
                    onEdit={() => startEdit(page)}
                    onStatus={() =>
                      void changeStatus(
                        page,
                        page.lifecycleStatus === "ACTIVE"
                          ? "archive"
                          : "restore"
                      )
                    }
                    page={page}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {collection.nextCursor && (
            <footer className="page-map-footer">
              <button
                className="secondary-button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </button>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}

function PageEditor({
  busy,
  draft,
  errors,
  existing,
  onCancel,
  onChange,
  onSubmit
}: Readonly<{
  busy: boolean;
  draft: ProjectPageDraft;
  errors: ProjectPageDraftErrors;
  existing: boolean;
  onCancel: () => void;
  onChange: (patch: Partial<ProjectPageDraft>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  return (
    <section className="panel page-map-editor">
      <header>
        <div>
          <p className="eyebrow">{existing ? "Редактирование" : "Новая страница"}</p>
          <h2>{existing ? "Параметры страницы" : "Добавить в карту"}</h2>
        </div>
        <button className="text-button" onClick={onCancel} type="button">
          Закрыть
        </button>
      </header>
      <form className="page-map-editor-grid" onSubmit={onSubmit}>
        <EditorField
          error={errors.url}
          label="Канонический URL"
          wide
        >
          <input
            aria-invalid={Boolean(errors.url)}
            onChange={(event) => onChange({ url: event.target.value })}
            placeholder="https://example.com/service/"
            required
            type="url"
            value={draft.url}
          />
        </EditorField>
        <EditorField label="Тип">
          <select
            onChange={(event) =>
              onChange({ pageType: event.target.value as PageType })
            }
            value={draft.pageType}
          >
            {pageTypes.map((value) => (
              <option key={value} value={value}>{pageTypeLabel(value)}</option>
            ))}
          </select>
        </EditorField>
        <EditorField label="Индексируемость">
          <select
            onChange={(event) =>
              onChange({
                indexability: event.target.value as PageIndexability
              })
            }
            value={draft.indexability}
          >
            {pageIndexabilities.map((value) => (
              <option key={value} value={value}>
                {indexabilityLabel(value)}
              </option>
            ))}
          </select>
        </EditorField>
        <EditorField error={errors.httpStatus} label="HTTP-код">
          <input
            inputMode="numeric"
            onChange={(event) => onChange({ httpStatus: event.target.value })}
            placeholder="200"
            value={draft.httpStatus}
          />
        </EditorField>
        <EditorField error={errors.priority} label="Приоритет">
          <input
            max="100"
            min="0"
            onChange={(event) => onChange({ priority: event.target.value })}
            required
            type="number"
            value={draft.priority}
          />
        </EditorField>
        <EditorField label="Title" wide>
          <input
            onChange={(event) => onChange({ title: event.target.value })}
            value={draft.title}
          />
        </EditorField>
        <EditorField label="H1" wide>
          <input
            onChange={(event) => onChange({ h1: event.target.value })}
            value={draft.h1}
          />
        </EditorField>
        <EditorField label="Description" wide>
          <textarea
            onChange={(event) => onChange({ description: event.target.value })}
            rows={2}
            value={draft.description}
          />
        </EditorField>
        <EditorField error={errors.canonicalTarget} label="Canonical target" wide>
          <input
            onChange={(event) =>
              onChange({ canonicalTarget: event.target.value })
            }
            placeholder="https://example.com/canonical/"
            type="url"
            value={draft.canonicalTarget}
          />
        </EditorField>
        <EditorField error={errors.aliases} label="Алиасы URL" wide>
          <textarea
            onChange={(event) => onChange({ aliases: event.target.value })}
            placeholder={"https://example.com/old-url/\nhttps://example.com/legacy/"}
            rows={3}
            value={draft.aliases}
          />
        </EditorField>
        <EditorField label="Статус контента">
          <select
            onChange={(event) =>
              onChange({
                contentStatus: event.target.value as PageContentStatus | ""
              })
            }
            value={draft.contentStatus}
          >
            <option value="">Не задан</option>
            {pageContentStatuses.map((value) => (
              <option key={value} value={value}>{contentStatusLabel(value)}</option>
            ))}
          </select>
        </EditorField>
        <EditorField error={errors.language} label="Язык">
          <input
            onChange={(event) => onChange({ language: event.target.value })}
            placeholder="ru-RU"
            value={draft.language}
          />
        </EditorField>
        <EditorField label="Шаблон">
          <input
            onChange={(event) => onChange({ template: event.target.value })}
            placeholder="service-detail"
            value={draft.template}
          />
        </EditorField>
        <EditorField label="Robots">
          <input
            onChange={(event) => onChange({ robots: event.target.value })}
            placeholder="index, follow"
            value={draft.robots}
          />
        </EditorField>
        <EditorField error={errors.ownerId} label="ID владельца">
          <input
            onChange={(event) => onChange({ ownerId: event.target.value })}
            value={draft.ownerId}
          />
        </EditorField>
        <EditorField label="Опубликована">
          <input
            onChange={(event) => onChange({ publishedAt: event.target.value })}
            type="datetime-local"
            value={draft.publishedAt}
          />
        </EditorField>
        <EditorField label="Заметки" wide>
          <textarea
            onChange={(event) => onChange({ notes: event.target.value })}
            rows={3}
            value={draft.notes}
          />
        </EditorField>
        <div className="page-map-editor-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Отмена
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </section>
  );
}

function EditorField({
  children,
  error,
  label,
  wide = false
}: Readonly<{
  children: ReactNode;
  error?: string | undefined;
  label: string;
  wide?: boolean;
}>) {
  return (
    <label className={`form-field${wide ? " page-map-field-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

function PageRow({
  busy,
  canManage,
  onEdit,
  onStatus,
  page
}: Readonly<{
  busy: boolean;
  canManage: boolean;
  onEdit: () => void;
  onStatus: () => void;
  page: ProjectPageSummary;
}>) {
  return (
    <tr>
      <td>
        <div className="page-map-url">
          <a href={page.normalizedUrl} rel="noreferrer" target="_blank">
            {page.title || page.normalizedUrl}
          </a>
          {page.title && <small>{page.normalizedUrl}</small>}
          <span>
            {page.aliases.length > 0
              ? `${page.aliases.length} алиасов`
              : "Без алиасов"}
            {" · "}
            {page.sources.map(({ source }) => sourceLabel(source)).join(", ")}
          </span>
        </div>
      </td>
      <td><span className="status-pill">{pageTypeLabel(page.pageType)}</span></td>
      <td>
        <span className={`status-pill page-index-${page.indexability.toLowerCase()}`}>
          {indexabilityLabel(page.indexability)}
        </span>
      </td>
      <td>{page.httpStatus ?? "—"}</td>
      <td><strong>{page.assignedKeywordCount}</strong></td>
      <td>{page.contentStatus ? contentStatusLabel(page.contentStatus) : "—"}</td>
      <td>
        <div className="page-map-actions">
          {page.lifecycleStatus === "ACTIVE" && (
            <button
              className="text-button"
              disabled={!canManage || busy}
              onClick={onEdit}
              type="button"
            >
              Изменить
            </button>
          )}
          <button
            className="text-button"
            disabled={!canManage || busy}
            onClick={onStatus}
            type="button"
          >
            {busy
              ? "Сохраняем…"
              : page.lifecycleStatus === "ACTIVE"
                ? "В архив"
                : "Восстановить"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function pagesUrl(
  projectId: string,
  filters: PageFilters,
  cursor?: string
): string {
  const query = new URLSearchParams({
    limit: "50",
    lifecycleStatus: filters.lifecycleStatus
  });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.pageType) query.set("pageType", filters.pageType);
  if (filters.indexability) query.set("indexability", filters.indexability);
  if (cursor) query.set("cursor", cursor);
  return `${projectPagesApiPath(projectId)}?${query.toString()}`;
}

function withPage(
  collection: ProjectPageSettings,
  page: ProjectPageSummary,
  filters: PageFilters
): ProjectPageSettings {
  const matches =
    page.lifecycleStatus === filters.lifecycleStatus &&
    (!filters.pageType || page.pageType === filters.pageType) &&
    (!filters.indexability || page.indexability === filters.indexability) &&
    (!filters.search ||
      [page.normalizedUrl, page.title ?? "", page.h1 ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase())
      ));
  const exists = collection.pages.some(({ id }) => id === page.id);
  return {
    ...collection,
    pages: matches
      ? exists
        ? collection.pages.map((item) => item.id === page.id ? page : item)
        : [page, ...collection.pages]
      : collection.pages.filter(({ id }) => id !== page.id)
  };
}

function restrictionLabel(
  value: ProjectPageSettings["access"]["mutationRestriction"]
): string {
  if (value === "WORKSPACE_READ_ONLY") {
    return "Workspace доступен только для чтения. Страницы и назначения сохранены.";
  }
  if (value === "PROJECT_ARCHIVED") {
    return "Проект архивирован. Карту страниц можно просматривать, но нельзя изменять.";
  }
  if (value === "MISSING_PERMISSION") {
    return "У вашей роли нет права изменять карту страниц.";
  }
  return "";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof BrowserApiError) {
    return `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}`;
  }
  return fallback;
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof BrowserApiError &&
    ["VERSION_CONFLICT", "RESOURCE_STATE_CONFLICT"].includes(error.code)
  );
}

const PAGE_TYPE_LABELS: Readonly<Record<PageType, string>> = {
  EXISTING: "Существующая",
  PLANNED: "План",
  REDIRECTED: "Редирект",
  DELETED: "Удалённая",
  EXTERNAL: "Внешняя",
  UNKNOWN: "Не определён"
};

const INDEXABILITY_LABELS: Readonly<Record<PageIndexability, string>> = {
  UNKNOWN: "Не проверено",
  INDEXABLE: "Индексируется",
  NOINDEX: "Noindex",
  BLOCKED_ROBOTS: "Закрыта robots",
  CANONICALIZED: "Canonical на другую",
  REDIRECTED: "Редирект",
  ERROR: "Ошибка"
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

function pageTypeLabel(value: PageType): string {
  return PAGE_TYPE_LABELS[value];
}

function indexabilityLabel(value: PageIndexability): string {
  return INDEXABILITY_LABELS[value];
}

function contentStatusLabel(value: PageContentStatus): string {
  return CONTENT_STATUS_LABELS[value];
}

function sourceLabel(value: ProjectPageSummary["sources"][number]["source"]): string {
  return value === "MANUAL" ? "вручную" : value.toLocaleLowerCase();
}
