"use client";

import { CustomSelect } from "./custom-select";

import {
  pageContentStatuses,
  pageIndexabilities,
  pageTypes,
  type ProjectCrawlIssueCollection,
  type ProjectCrawlIssueSummary,
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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import { Icon } from "./icon";

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

const PAGE_MAP_COLUMN_DEFAULTS = {
  url: 330,
  http: 72,
  title: 220,
  h1: 190,
  responseTime: 104,
  size: 104,
  issues: 92,
  actions: 140
} as const;

type PageMapColumn = keyof typeof PAGE_MAP_COLUMN_DEFAULTS;
type PageMapColumnWidths = Record<PageMapColumn, number>;

const PAGE_MAP_COLUMN_ORDER = Object.keys(
  PAGE_MAP_COLUMN_DEFAULTS
) as readonly PageMapColumn[];

const PAGE_MAP_COLUMN_MINIMUMS: Readonly<PageMapColumnWidths> = {
  url: 220,
  http: 60,
  title: 130,
  h1: 120,
  responseTime: 82,
  size: 82,
  issues: 76,
  actions: 112
};

export function ProjectPageMap({
  projectDomain,
  projectId,
  projectName
}: Readonly<{
  projectDomain: string;
  projectId: string;
  projectName: string;
}>) {
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
  const [selectedPageId, setSelectedPageId] = useState<string>();
  const [selectedPageDetail, setSelectedPageDetail] =
    useState<ProjectPageSummary>();
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const inspectorRequestRef = useRef(0);
  const issueRequestRef = useRef(0);
  const [selectedPageIssues, setSelectedPageIssues] = useState<
    readonly ProjectCrawlIssueSummary[]
  >([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string>();
  const [selectedStructurePath, setSelectedStructurePath] = useState("/");
  const [structureWidth, setStructureWidth] = useState(248);
  const [inspectorWidth, setInspectorWidth] = useState(330);
  const [columnWidths, setColumnWidths] = useState<PageMapColumnWidths>({
    ...PAGE_MAP_COLUMN_DEFAULTS
  });
  const [structureExpansion, setStructureExpansion] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [layoutHydrated, setLayoutHydrated] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(undefined);
      try {
        const next = await browserApiRequest<ProjectPageSettings>(
          pagesUrl(projectId, appliedFilters, selectedStructurePath),
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
    [projectId, appliedFilters, selectedStructurePath]
  );

  useEffect(() => {
    const saved = readPageMapLayout(projectId);
    if (saved) {
      setStructureWidth(saved.structureWidth);
      setInspectorWidth(saved.inspectorWidth);
      setColumnWidths(saved.columnWidths);
      setStructureExpansion(saved.structureExpansion);
    }
    setLayoutHydrated(true);
  }, [projectId]);

  useEffect(() => {
    if (!layoutHydrated) return;
    savePageMapLayout(projectId, {
      structureWidth,
      inspectorWidth,
      columnWidths,
      structureExpansion
    });
  }, [
    columnWidths,
    inspectorWidth,
    layoutHydrated,
    projectId,
    structureExpansion,
    structureWidth
  ]);

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

  useEffect(() => {
    if (!editor) return;
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape" && busyId === undefined) setEditor(undefined);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busyId, editor]);

  const canManage = online && collection?.access.canManage === true;
  const structure = useMemo(
    () => buildSiteStructure(collection?.structureUrls ?? []),
    [collection?.structureUrls]
  );

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedFilters(filters);
  }

  function resetFilters(): void {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setSelectedStructurePath("/");
  }

  function filterByStructure(path: string): void {
    if (path !== selectedStructurePath) closeInspector();
    setSelectedStructurePath(path);
  }

  function exportVisiblePages(): void {
    if (!collection) return;
    const header = [
      "URL", "HTTP", "Title", "Description", "H1", "Canonical",
      "Response time, ms", "Size, bytes", "Content type", "Issues"
    ];
    const rows = collection.pages.map((page) => {
      const crawl = page.latestCrawl;
      return [
        page.normalizedUrl,
        crawl?.statusCode ?? page.httpStatus ?? "",
        crawl?.title ?? page.title ?? "",
        crawl?.description ?? page.description ?? "",
        crawl?.h1 ?? page.h1 ?? "",
        crawl?.canonicalUrl ?? page.canonicalTarget ?? "",
        crawl?.responseTimeMs ?? "",
        crawl?.sizeBytes ?? "",
        crawl?.contentType ?? "",
        page.openIssueCount ?? 0
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(projectName)}-page-map.csv`;
    link.click();
    URL.revokeObjectURL(url);
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

  async function openInspector(page: ProjectPageSummary): Promise<void> {
    const requestId = inspectorRequestRef.current + 1;
    inspectorRequestRef.current = requestId;
    const issueRequestId = issueRequestRef.current + 1;
    issueRequestRef.current = issueRequestId;
    setSelectedPageId(page.id);
    setSelectedPageDetail(undefined);
    setInspectorLoading(true);
    setSelectedPageIssues([]);
    setIssuesError(undefined);
    setIssuesLoading((page.openIssueCount ?? 0) > 0);
    if ((page.openIssueCount ?? 0) > 0) {
      void browserApiRequest<ProjectCrawlIssueCollection>(
        `/app/api/projects/${encodeURIComponent(projectId)}/crawl-issues?pageId=${encodeURIComponent(page.id)}`
      )
        .then((collection) => {
          if (issueRequestRef.current !== issueRequestId) return;
          setSelectedPageIssues(
            collection.issues.filter(({ pageId }) => pageId === page.id)
          );
        })
        .catch((error: unknown) => {
          if (issueRequestRef.current !== issueRequestId) return;
          setIssuesError(
            errorMessage(error, "Не удалось загрузить проблемы страницы.")
          );
        })
        .finally(() => {
          if (issueRequestRef.current === issueRequestId) {
            setIssuesLoading(false);
          }
        });
    }
    try {
      const detail = await browserApiRequest<ProjectPageSummary>(
        projectPageApiPath(projectId, page.id)
      );
      if (inspectorRequestRef.current === requestId) {
        setSelectedPageDetail(detail);
      }
    } catch (error) {
      if (inspectorRequestRef.current === requestId) {
        setOperationError(
          errorMessage(error, "Не удалось загрузить детали страницы.")
        );
      }
    } finally {
      if (inspectorRequestRef.current === requestId) {
        setInspectorLoading(false);
      }
    }
  }

  function closeInspector(): void {
    inspectorRequestRef.current += 1;
    issueRequestRef.current += 1;
    setSelectedPageId(undefined);
    setSelectedPageDetail(undefined);
    setInspectorLoading(false);
    setSelectedPageIssues([]);
    setIssuesLoading(false);
    setIssuesError(undefined);
  }

  function resizeColumn(column: PageMapColumn, width: number): void {
    setColumnWidths((current) => ({
      ...current,
      [column]: clamp(width, PAGE_MAP_COLUMN_MINIMUMS[column], 640)
    }));
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
        value
          ? withPage(value, saved, appliedFilters, selectedStructurePath)
          : value
      );
      if (selectedPageId === saved.id) setSelectedPageDetail(saved);
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
        value
          ? withPage(value, saved, appliedFilters, selectedStructurePath)
          : value
      );
      if (selectedPageId === saved.id) setSelectedPageDetail(saved);
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
        pagesUrl(
          projectId,
          appliedFilters,
          selectedStructurePath,
          collection.nextCursor
        )
      );
      setCollection({
        ...next,
        pages: [...collection.pages, ...next.pages],
        ...(collection.structureUrls
          ? { structureUrls: collection.structureUrls }
          : {})
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
  const activeFilterCount = filterCount(appliedFilters);
  const hasActiveMapFilter =
    activeFilterCount > 0 || selectedStructurePath !== "/";
  const selectedListPage = collection.pages.find(
    ({ id }) => id === selectedPageId
  );
  const selectedPage =
    selectedListPage && selectedPageDetail?.id === selectedListPage.id
      ? selectedPageDetail
      : selectedListPage;
  const pageMapStyle = {
    "--page-map-structure-width": `${structureWidth}px`,
    "--page-map-inspector-width": `${inspectorWidth}px`
  } as CSSProperties;
  const tableWidth = PAGE_MAP_COLUMN_ORDER.reduce(
    (total, column) => total + columnWidths[column],
    0
  );

  return (
    <div className="page-map" style={pageMapStyle}>
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

      <section className="page-map-primary-actions" aria-label="Действия карты страниц">
        <a
          className="primary-button"
          href={`/app/projects/${encodeURIComponent(projectId)}/tools/http-status-checker`}
        >
          <Icon name="sitemap" />
          Сканировать сайт
        </a>
        <button className="secondary-button" onClick={exportVisiblePages} type="button">
          <Icon name="export" />
          Экспорт
        </button>
        <span>
          {structure.total.toLocaleString("ru-RU")} страниц в структуре
        </span>
      </section>

      <div className="page-map-workspace">
        <SiteStructure
          domain={projectDomain}
          expansion={structureExpansion}
          nodes={structure.nodes}
          onSelect={filterByStructure}
          onToggle={(path, defaultExpanded) =>
            setStructureExpansion((current) => ({
              ...current,
              [path]: !(current[path] ?? defaultExpanded)
            }))
          }
          selectedPath={selectedStructurePath}
          total={structure.total}
        />
        <PanelResizeHandle
          label="Изменить ширину структуры сайта"
          onDoubleClick={() => setStructureWidth(248)}
          onPointerDown={(event) =>
            beginHorizontalResize(event, {
              initial: structureWidth,
              minimum: 190,
              maximum: 420,
              onChange: setStructureWidth
            })
          }
        />
        <div className="page-map-main">
        <section className="panel page-map-toolbar">
        <form className="page-map-commandbar" onSubmit={applyFilters}>
          <label className="form-field page-map-search">
            <span className="visually-hidden">Поиск по карте страниц</span>
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
          <button className="secondary-button page-map-search-button" type="submit">
            Найти
          </button>
          <details className="page-map-filter-disclosure" data-exclusive-dropdown>
            <summary>
              Фильтры{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </summary>
            <div className="page-map-filter-popover">
              <label className="form-field">
                <span>Тип</span>
                <CustomSelect
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
                </CustomSelect>
              </label>
              <label className="form-field">
                <span>Индексируемость</span>
                <CustomSelect
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
                </CustomSelect>
              </label>
              <label className="form-field">
                <span>Раздел</span>
                <CustomSelect
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
                </CustomSelect>
              </label>
              <div className="page-map-filter-actions">
                <button
                  className="text-button"
                  disabled={
                    filterCount(filters) === 0 && selectedStructurePath === "/"
                  }
                  onClick={resetFilters}
                  type="button"
                >
                  Сбросить
                </button>
                <button className="primary-button" type="submit">
                  Показать
                </button>
              </div>
            </div>
          </details>
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
        <div
          className="page-map-editor-backdrop"
          data-dropdown-portal-root
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && busyId === undefined) {
              setEditor(undefined);
            }
          }}
          role="presentation"
        >
          <PageEditor
            busy={busyId !== undefined}
            draft={editor.draft}
            errors={errors}
            existing={editor.page !== undefined}
            onCancel={() => setEditor(undefined)}
            onChange={changeDraft}
            onSubmit={submitPage}
          />
        </div>
      )}

        <div className={selectedPage ? "page-map-content has-inspector" : "page-map-content"}>
        {collection.pages.length === 0 ? (
          <section className="panel page-map-empty">
          <h2>
            {appliedFilters.lifecycleStatus === "ARCHIVED"
              ? "Архив пуст"
              : hasActiveMapFilter
                ? "По фильтрам ничего не найдено"
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
              <table
                className="page-map-table has-sized-columns"
                style={{ minWidth: "100%", width: `${tableWidth}px` }}
              >
              <colgroup>
                {PAGE_MAP_COLUMN_ORDER.map((column) => (
                  <col
                    key={column}
                    style={{ width: `${columnWidths[column]}px` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <PageMapColumnHeader column="url" label="URL / страница" onResize={resizeColumn} width={columnWidths.url} />
                  <PageMapColumnHeader column="http" label="HTTP" onResize={resizeColumn} width={columnWidths.http} />
                  <PageMapColumnHeader column="title" label="Title" onResize={resizeColumn} width={columnWidths.title} />
                  <PageMapColumnHeader column="h1" label="H1" onResize={resizeColumn} width={columnWidths.h1} />
                  <PageMapColumnHeader column="responseTime" label="Время" onResize={resizeColumn} width={columnWidths.responseTime} />
                  <PageMapColumnHeader column="size" label="Размер" onResize={resizeColumn} width={columnWidths.size} />
                  <PageMapColumnHeader column="issues" label="Проблемы" onResize={resizeColumn} width={columnWidths.issues} />
                  <PageMapColumnHeader column="actions" label="Действия" onResize={resizeColumn} width={columnWidths.actions} />
                </tr>
              </thead>
                <tbody>
                  {collection.pages.map((page) => (
                    <PageRow
                      busy={busyId === page.id}
                      canManage={canManage}
                      key={page.id}
                      onEdit={() => startEdit(page)}
                      onSelect={() => void openInspector(page)}
                      onStatus={() =>
                        void changeStatus(
                          page,
                          page.lifecycleStatus === "ACTIVE"
                            ? "archive"
                            : "restore"
                        )
                      }
                      page={page}
                      selected={selectedPageId === page.id}
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
        {selectedPage && (
          <>
            <PanelResizeHandle
              label="Изменить ширину инспектора страницы"
              onDoubleClick={() => setInspectorWidth(330)}
              onPointerDown={(event) =>
                beginHorizontalResize(event, {
                  initial: inspectorWidth,
                  invert: true,
                  minimum: 280,
                  maximum: 560,
                  onChange: setInspectorWidth
                })
              }
            />
            <PageInspector
              canManage={canManage}
              issues={selectedPageIssues}
              issuesError={issuesError}
              issuesLoading={issuesLoading}
              loading={inspectorLoading}
              onClose={closeInspector}
              onEdit={() => startEdit(selectedPage)}
              page={selectedPage}
            />
          </>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}

function PanelResizeHandle({
  label,
  onDoubleClick,
  onPointerDown
}: Readonly<{
  label: string;
  onDoubleClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}>) {
  return (
    <button
      aria-label={label}
      className="page-map-panel-resizer"
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      title={`${label}. Двойной клик — сбросить.`}
      type="button"
    />
  );
}

function PageMapColumnHeader({
  column,
  label,
  onResize,
  width
}: Readonly<{
  column: PageMapColumn;
  label: string;
  onResize: (column: PageMapColumn, width: number) => void;
  width: number;
}>) {
  function resizeFromKeyboard(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(column, width + (event.key === "ArrowRight" ? 12 : -12));
  }

  return (
    <th className="page-map-resizable-column" scope="col">
      <span>{label}</span>
      <span
        aria-label={`Изменить ширину колонки «${label}»`}
        aria-orientation="vertical"
        aria-valuemax={640}
        aria-valuemin={PAGE_MAP_COLUMN_MINIMUMS[column]}
        aria-valuenow={width}
        className="page-map-column-resizer"
        onDoubleClick={() => onResize(column, PAGE_MAP_COLUMN_DEFAULTS[column])}
        onKeyDown={resizeFromKeyboard}
        onPointerDown={(event) =>
          beginHorizontalResize(event, {
            initial: width,
            minimum: PAGE_MAP_COLUMN_MINIMUMS[column],
            maximum: 640,
            onChange: (next) => onResize(column, next)
          })
        }
        role="separator"
        tabIndex={0}
        title="Потяните для изменения ширины. Двойной клик — сбросить."
      />
    </th>
  );
}

function beginHorizontalResize(
  event: ReactPointerEvent<HTMLElement>,
  options: Readonly<{
    initial: number;
    minimum: number;
    maximum: number;
    invert?: boolean;
    onChange: (value: number) => void;
  }>
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const ownerDocument = event.currentTarget.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return;
  ownerDocument.body.classList.add("page-map-resizing");
  const move = (pointerEvent: PointerEvent) => {
    const delta = pointerEvent.clientX - startX;
    options.onChange(
      clamp(
        options.initial + (options.invert ? -delta : delta),
        options.minimum,
        options.maximum
      )
    );
  };
  const stop = () => {
    ownerDocument.body.classList.remove("page-map-resizing");
    ownerWindow.removeEventListener("pointermove", move);
    ownerWindow.removeEventListener("pointerup", stop);
    ownerWindow.removeEventListener("pointercancel", stop);
  };
  ownerWindow.addEventListener("pointermove", move);
  ownerWindow.addEventListener("pointerup", stop, { once: true });
  ownerWindow.addEventListener("pointercancel", stop, { once: true });
}

interface SiteStructureNode {
  readonly name: string;
  readonly path: string;
  readonly count: number;
  readonly depth: number;
  readonly children: readonly SiteStructureNode[];
}

function SiteStructure({
  domain,
  expansion,
  nodes,
  onSelect,
  onToggle,
  selectedPath,
  total
}: Readonly<{
  domain: string;
  expansion: Readonly<Record<string, boolean>>;
  nodes: readonly SiteStructureNode[];
  onSelect: (path: string) => void;
  onToggle: (path: string, defaultExpanded: boolean) => void;
  selectedPath: string;
  total: number;
}>) {
  return (
    <aside className="panel page-map-structure" aria-label="Структура сайта">
      <header>
        <div>
          <h2>Структура сайта</h2>
          <span>{domain}</span>
        </div>
      </header>
      <button
        aria-pressed={selectedPath === "/"}
        className="page-map-tree-root"
        onClick={() => onSelect("/")}
        type="button"
      >
        <Icon name="sitemap" />
        <span>Все страницы</span>
        <strong>{total.toLocaleString("ru-RU")}</strong>
      </button>
      {nodes.length > 0 ? (
        <ul className="page-map-tree">
          {nodes.slice(0, 120).map((node) => (
            <SiteStructureBranch
              expansion={expansion}
              key={node.path}
              node={node}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedPath={selectedPath}
            />
          ))}
        </ul>
      ) : (
        <p className="page-map-tree-empty">
          Структура появится после первого сохранённого обхода.
        </p>
      )}
    </aside>
  );
}

function SiteStructureBranch({
  expansion,
  node,
  onSelect,
  onToggle,
  selectedPath
}: Readonly<{
  expansion: Readonly<Record<string, boolean>>;
  node: SiteStructureNode;
  onSelect: (path: string) => void;
  onToggle: (path: string, defaultExpanded: boolean) => void;
  selectedPath: string;
}>) {
  const hasChildren = node.children.length > 0;
  const defaultExpanded = node.depth < 3;
  const expanded = hasChildren && (expansion[node.path] ?? defaultExpanded);
  return (
    <li>
      <div
        className={`page-map-tree-row${selectedPath === node.path ? " selected" : ""}`}
        style={{ paddingLeft: `${10 + (node.depth - 1) * 16}px` }}
      >
        {hasChildren ? (
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "Свернуть" : "Развернуть"} папку «${node.name}»`}
            className="page-map-tree-toggle"
            onClick={() => {
              onToggle(node.path, defaultExpanded);
              if (
                expanded &&
                selectedPath !== node.path &&
                selectedPath.startsWith(node.path)
              ) {
                onSelect(node.path);
              }
            }}
            title={expanded ? "Свернуть папку" : "Развернуть папку"}
            type="button"
          >
            <Icon name="chevronRight" />
          </button>
        ) : (
          <span aria-hidden="true" className="page-map-tree-toggle-spacer" />
        )}
        <button
          aria-pressed={selectedPath === node.path}
          className="page-map-tree-select"
          onClick={() => onSelect(node.path)}
          type="button"
        >
          <Icon name={hasChildren ? "projects" : "pages"} />
          <span>{node.name}</span>
          <strong>{node.count.toLocaleString("ru-RU")}</strong>
        </button>
      </div>
      {expanded && (
        <ul>
          {node.children.slice(0, 80).map((child) => (
            <SiteStructureBranch
              expansion={expansion}
              key={child.path}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedPath={selectedPath}
            />
          ))}
        </ul>
      )}
    </li>
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
  const hasAdvancedErrors = Boolean(
    errors.httpStatus ||
    errors.language ||
    errors.canonicalTarget ||
    errors.aliases ||
    errors.ownerId
  );
  return (
    <section aria-labelledby="page-map-editor-title" aria-modal="true" className="panel page-map-editor" role="dialog">
      <header>
        <div>
          <p className="eyebrow">{existing ? "Редактирование" : "Новая страница"}</p>
          <h2 id="page-map-editor-title">{existing ? "Параметры страницы" : "Добавить в карту"}</h2>
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
          <CustomSelect
            onChange={(event) =>
              onChange({ pageType: event.target.value as PageType })
            }
            value={draft.pageType}
          >
            {pageTypes.map((value) => (
              <option key={value} value={value}>{pageTypeLabel(value)}</option>
            ))}
          </CustomSelect>
        </EditorField>
        <EditorField label="Индексируемость">
          <CustomSelect
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
          </CustomSelect>
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
        <EditorField label="Статус контента">
          <CustomSelect
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
          </CustomSelect>
        </EditorField>
        <details className="page-map-advanced" open={hasAdvancedErrors || undefined}>
          <summary>Дополнительные параметры</summary>
          <div className="page-map-advanced-grid">
            <EditorField error={errors.httpStatus} label="HTTP-код">
              <input
                inputMode="numeric"
                onChange={(event) => onChange({ httpStatus: event.target.value })}
                placeholder="200"
                value={draft.httpStatus}
              />
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
          </div>
        </details>
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
  onSelect,
  onStatus,
  page,
  selected
}: Readonly<{
  busy: boolean;
  canManage: boolean;
  onEdit: () => void;
  onSelect: () => void;
  onStatus: () => void;
  page: ProjectPageSummary;
  selected: boolean;
}>) {
  const crawl = page.latestCrawl;
  const title = crawl?.title ?? page.title;
  const h1 = crawl?.h1 ?? page.h1;
  const statusCode = crawl?.statusCode ?? page.httpStatus;
  return (
    <tr
      aria-selected={selected}
      className={selected ? "selected" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onClick={onSelect}
      tabIndex={0}
    >
      <td>
        <div className="page-map-url">
          <a href={page.normalizedUrl} rel="noreferrer" target="_blank">
            {pagePath(page.normalizedUrl)}
          </a>
          <span>{title || page.normalizedUrl}</span>
          <small>{page.assignedKeywordCount} запросов · {page.assignedClusterCount} кластеров</small>
        </div>
      </td>
      <td>
        <span className={`page-map-http status-${httpStatusKind(statusCode)}`}>
          {statusCode ?? "—"}
        </span>
      </td>
      <td><span className="page-map-clamp">{title || "—"}</span></td>
      <td><span className="page-map-clamp">{h1 || "—"}</span></td>
      <td>{crawl ? `${crawl.responseTimeMs.toLocaleString("ru-RU")} мс` : "—"}</td>
      <td>{crawl ? formatBytes(crawl.sizeBytes) : "—"}</td>
      <td>
        <span className={`page-map-issue-count${(page.openIssueCount ?? 0) > 0 ? " has-issues" : ""}`}>
          {(page.openIssueCount ?? 0) > 0 ? page.openIssueCount : "Нет"}
        </span>
      </td>
      <td>
        <div className="page-map-actions">
          {page.lifecycleStatus === "ACTIVE" && (
            <button
              className="text-button"
              disabled={!canManage || busy}
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              type="button"
            >
              Изменить
            </button>
          )}
          <button
            className="text-button"
            disabled={!canManage || busy}
            onClick={(event) => {
              event.stopPropagation();
              onStatus();
            }}
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

function PageInspector({
  canManage,
  issues,
  issuesError,
  issuesLoading,
  loading,
  onClose,
  onEdit,
  page
}: Readonly<{
  canManage: boolean;
  issues: readonly ProjectCrawlIssueSummary[];
  issuesError?: string | undefined;
  issuesLoading: boolean;
  loading: boolean;
  onClose: () => void;
  onEdit: () => void;
  page: ProjectPageSummary;
}>) {
  const crawl = page.latestCrawl;
  const title = crawl?.title ?? page.title;
  const description = crawl?.description ?? page.description;
  const h1 = crawl?.h1 ?? page.h1;
  const canonical = crawl?.canonicalUrl ?? page.canonicalTarget;
  return (
    <aside className="page-map-inspector" aria-label="Информация о странице">
      <header>
        <div>
          <span>Страница</span>
          <h2>{pagePath(page.normalizedUrl)}</h2>
          <a href={page.normalizedUrl} rel="noreferrer" target="_blank">{page.normalizedUrl}</a>
        </div>
        <div className="page-map-inspector-actions">
          {page.lifecycleStatus === "ACTIVE" && (
            <button className="secondary-button" disabled={!canManage} onClick={onEdit} type="button">Изменить</button>
          )}
          <button aria-label="Закрыть" className="page-map-inspector-close" onClick={onClose} type="button">×</button>
        </div>
      </header>
      <div className="page-map-inspector-body">
        {loading && (
          <p className="page-map-inspector-loading" role="status">
            <span aria-hidden="true" className="spinner" />
            Загружаем данные последнего обхода…
          </p>
        )}
        <section>
          <h3>Обзор</h3>
          <dl>
            <div><dt>Индексируемость</dt><dd><span className={`status-pill page-index-${page.indexability.toLowerCase()}`}>{indexabilityLabel(page.indexability)}</span></dd></div>
            <div><dt>Тип</dt><dd>{pageTypeLabel(page.pageType)}</dd></div>
            <div><dt>HTTP</dt><dd>{crawl?.statusCode ?? page.httpStatus ?? "—"}</dd></div>
            <div><dt>Проблемы</dt><dd>{page.openIssueCount ?? 0}</dd></div>
            <div><dt>В sitemap</dt><dd>{crawl ? (crawl.inSitemap ? "Да" : "Нет") : "—"}</dd></div>
          </dl>
        </section>
        <section className="page-map-issues">
          <header>
            <h3>Проблемы</h3>
            <span className={(page.openIssueCount ?? 0) > 0 ? "has-issues" : undefined}>
              {page.openIssueCount ?? 0}
            </span>
          </header>
          {issuesLoading ? (
            <p className="page-map-inspector-loading" role="status">
              <span aria-hidden="true" className="spinner" />
              Загружаем найденные проблемы…
            </p>
          ) : issuesError ? (
            <p className="page-map-issue-error" role="alert">{issuesError}</p>
          ) : issues.length > 0 ? (
            <div className="page-map-issue-list">
              {issues.map((issue) => (
                <article className={`page-map-issue severity-${issue.severity.toLowerCase()}`} key={issue.id}>
                  <header>
                    <strong>{issue.title}</strong>
                    <span>{issueSeverityLabel(issue.severity)}</span>
                  </header>
                  <small>{issue.code} · замечено {formatPageDate(issue.lastSeenAt)}</small>
                  {Object.keys(issue.details).length > 0 && (
                    <dl>
                      {Object.entries(issue.details).map(([key, value]) => (
                        <div key={key}>
                          <dt>{issueDetailLabel(key)}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          ) : (page.openIssueCount ?? 0) > 0 ? (
            <p className="page-map-issue-empty">
              Сводка показывает проблемы, но подробности не вошли в текущую выборку аудита.
            </p>
          ) : (
            <p className="page-map-issue-empty">Открытых проблем не найдено.</p>
          )}
        </section>
        <section>
          <h3>SEO-проверки</h3>
          <dl>
            <div><dt>Title</dt><dd className={lengthTone(title, 20, 70)}>{title ? `${title.length} символов` : "Нет"}</dd></div>
            <div><dt>Description</dt><dd className={lengthTone(description, 40, 180)}>{description ? `${description.length} символов` : "Нет"}</dd></div>
            <div><dt>H1</dt><dd>{crawl ? crawl.h1Count : h1 ? 1 : 0}</dd></div>
            <div><dt>Canonical</dt><dd>{canonical || "Не задан"}</dd></div>
            <div><dt>Robots</dt><dd>{crawl?.robots ?? page.robots ?? "—"}</dd></div>
          </dl>
          {title && <p><strong>Title:</strong> {title}</p>}
          {description && <p><strong>Description:</strong> {description}</p>}
          {h1 && <p><strong>H1:</strong> {h1}</p>}
        </section>
        <section>
          <h3>Загрузка и содержимое</h3>
          <dl>
            <div><dt>Время ответа</dt><dd>{crawl ? `${crawl.responseTimeMs.toLocaleString("ru-RU")} мс` : "—"}</dd></div>
            <div><dt>Размер</dt><dd>{crawl ? formatBytes(crawl.sizeBytes) : "—"}</dd></div>
            <div><dt>Тип ответа</dt><dd>{crawl?.contentType ?? "—"}</dd></div>
            <div><dt>Слов</dt><dd>{crawl?.wordCount.toLocaleString("ru-RU") ?? "—"}</dd></div>
            <div><dt>Изображений</dt><dd>{crawl?.imageCount ?? "—"}</dd></div>
            <div><dt>Без alt</dt><dd>{crawl?.imagesMissingAlt ?? "—"}</dd></div>
          </dl>
        </section>
        <section>
          <h3>Семантика</h3>
          <dl>
            <div><dt>Запросов</dt><dd>{page.assignedKeywordCount}</dd></div>
            <div><dt>Кластеров</dt><dd>{page.assignedClusterCount}</dd></div>
            <div><dt>Приоритет</dt><dd>{page.priority}</dd></div>
          </dl>
        </section>
        {crawl && crawl.metaTags.length > 0 && (
          <details className="page-map-meta-tags">
            <summary>Метатеги · {crawl.metaTags.length}</summary>
            <div>
              {crawl.metaTags.map((tag, index) => (
                <article key={`${tag.name ?? tag.property ?? tag.httpEquiv}-${index}`}>
                  <strong>{tag.name ?? tag.property ?? tag.httpEquiv}</strong>
                  <span>{tag.content}</span>
                </article>
              ))}
            </div>
          </details>
        )}
        <section>
          <h3>Источники и даты</h3>
          <dl>
            <div><dt>Источники</dt><dd>{page.sources.map(({ source }) => sourceLabel(source)).join(", ") || "—"}</dd></div>
            <div><dt>Обновлена</dt><dd>{formatPageDate(page.updatedAt)}</dd></div>
            <div><dt>Последний обход</dt><dd>{crawl ? formatPageDate(crawl.crawledAt) : "Не запускался"}</dd></div>
          </dl>
        </section>
      </div>
    </aside>
  );
}

function formatPageDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function buildSiteStructure(
  urls: readonly string[]
): Readonly<{ total: number; nodes: readonly SiteStructureNode[] }> {
  interface MutableNode {
    name: string;
    path: string;
    count: number;
    depth: number;
    children: Map<string, MutableNode>;
  }
  const roots = new Map<string, MutableNode>();
  for (const value of urls) {
    let pathname: string;
    try {
      pathname = new URL(value).pathname;
    } catch {
      continue;
    }
    const segments = pathname.split("/").filter(Boolean);
    let children = roots;
    let path = "";
    for (const [index, segment] of segments.entries()) {
      path += `/${segment}`;
      const key = `${path}/`;
      let node = children.get(key);
      if (!node) {
        node = {
          name: decodedPathSegment(segment),
          path: key,
          count: 0,
          depth: index + 1,
          children: new Map()
        };
        children.set(key, node);
      }
      node.count += 1;
      children = node.children;
    }
  }
  const freeze = (values: Iterable<MutableNode>): readonly SiteStructureNode[] =>
    [...values]
      .sort((left, right) =>
        left.name.localeCompare(right.name, "ru", { numeric: true })
      )
      .map((node) => ({
        name: node.name,
        path: node.path,
        count: node.count,
        depth: node.depth,
        children: freeze(node.children.values())
      }));
  return { total: urls.length, nodes: freeze(roots.values()) };
}

function decodedPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pagePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return value;
  }
}

function httpStatusKind(value: number | undefined): "ok" | "redirect" | "error" | "unknown" {
  if (value === undefined) return "unknown";
  if (value >= 200 && value < 300) return "ok";
  if (value >= 300 && value < 400) return "redirect";
  return "error";
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} Б`;
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
  return `${(value / 1_048_576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}

function lengthTone(
  value: string | undefined,
  minimum: number,
  maximum: number
): "is-good" | "is-warning" {
  return value && value.length >= minimum && value.length <= maximum
    ? "is-good"
    : "is-warning";
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "project";
}

function pagesUrl(
  projectId: string,
  filters: PageFilters,
  structurePath: string,
  cursor?: string
): string {
  const query = new URLSearchParams({
    limit: "50",
    lifecycleStatus: filters.lifecycleStatus
  });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (structurePath !== "/") query.set("pathPrefix", structurePath);
  if (filters.pageType) query.set("pageType", filters.pageType);
  if (filters.indexability) query.set("indexability", filters.indexability);
  if (cursor) query.set("cursor", cursor);
  return `${projectPagesApiPath(projectId)}?${query.toString()}`;
}

function withPage(
  collection: ProjectPageSettings,
  page: ProjectPageSummary,
  filters: PageFilters,
  structurePath: string
): ProjectPageSettings {
  const matches =
    page.lifecycleStatus === filters.lifecycleStatus &&
    (!filters.pageType || page.pageType === filters.pageType) &&
    (!filters.indexability || page.indexability === filters.indexability) &&
    pageMatchesStructure(page.normalizedUrl, structurePath) &&
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

function filterCount(filters: PageFilters): number {
  return [
    filters.search.trim() !== "",
    filters.pageType !== "",
    filters.indexability !== "",
    filters.lifecycleStatus !== "ACTIVE"
  ].filter(Boolean).length;
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

function issueSeverityLabel(
  value: ProjectCrawlIssueSummary["severity"]
): string {
  if (value === "CRITICAL") return "Критично";
  if (value === "ERROR") return "Ошибка";
  if (value === "WARNING") return "Важно";
  return "Информация";
}

function issueDetailLabel(value: string): string {
  return value
    .replaceAll(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .toLocaleLowerCase("ru-RU");
}

function pageMatchesStructure(url: string, structurePath: string): boolean {
  if (structurePath === "/") return true;
  try {
    const pathname = new URL(url).pathname.replace(/\/$/u, "");
    const prefix = structurePath.replace(/\/$/u, "");
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  } catch {
    return false;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

interface StoredPageMapLayout {
  readonly structureWidth: number;
  readonly inspectorWidth: number;
  readonly columnWidths: PageMapColumnWidths;
  readonly structureExpansion: Readonly<Record<string, boolean>>;
}

function pageMapLayoutKey(projectId: string): string {
  return `seo-platform:page-map-layout:${projectId}`;
}

function readPageMapLayout(projectId: string): StoredPageMapLayout | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(pageMapLayoutKey(projectId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredPageMapLayout>;
    if (
      typeof parsed.structureWidth !== "number" ||
      typeof parsed.inspectorWidth !== "number" ||
      typeof parsed.columnWidths !== "object" ||
      parsed.columnWidths === null
    ) {
      return undefined;
    }
    return {
      structureWidth: clamp(parsed.structureWidth, 190, 420),
      inspectorWidth: clamp(parsed.inspectorWidth, 280, 560),
      columnWidths: Object.fromEntries(
        PAGE_MAP_COLUMN_ORDER.map((column) => [
          column,
          clamp(
            Number(parsed.columnWidths?.[column]) ||
              PAGE_MAP_COLUMN_DEFAULTS[column],
            PAGE_MAP_COLUMN_MINIMUMS[column],
            640
          )
        ])
      ) as PageMapColumnWidths,
      structureExpansion: normalizeStructureExpansion(
        parsed.structureExpansion
      )
    };
  } catch {
    return undefined;
  }
}

function normalizeStructureExpansion(
  value: unknown
): Readonly<Record<string, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, boolean] =>
        entry[0].startsWith("/") &&
        entry[0].length <= 2_048 &&
        !entry[0].includes("?") &&
        !entry[0].includes("#") &&
        typeof entry[1] === "boolean"
    )
    .slice(0, 500);
  return Object.fromEntries(entries);
}

function savePageMapLayout(
  projectId: string,
  layout: StoredPageMapLayout
): void {
  try {
    globalThis.localStorage?.setItem(
      pageMapLayoutKey(projectId),
      JSON.stringify(layout)
    );
  } catch {
    // The workspace remains usable when storage is blocked or full.
  }
}
