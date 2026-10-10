"use client";

import { TableSelectionCheckbox } from "./table-selection-checkbox";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import { useConfirmation } from "./use-confirmation";
import { parsePageStatusJobSummary, type PageStatusInput, type PageStatusJobSummary } from "@seo-platform/contracts";
import { TableSortButton } from "./table-sort-button";
import { WorkspaceSidebar, WorkspaceSidebarSeparator } from "./workspace-sidebar";
import { CustomDateInput } from "./custom-date-input";
import { CustomSelect } from "./custom-select";
import { ProjectPageInspector } from "./project-page-inspector";
import { PageMapDiagram } from "./page-map-diagram";
import { RankDimensionSelect } from "./rank-dimension-select";
import { ProjectPageEditor } from "./project-page-editor";
import { sortSiteSections } from "../lib/page-map-layout";
import { buildSiteStructure, type SiteStructureNode } from "../lib/site-structure";
import { pageIndexabilityLabel, pageTypeLabel } from "../lib/page-presentation";
import { usePageStatistics } from "../lib/use-page-statistics";
import { useVirtualWindow } from "../lib/use-virtual-window";

import {
  pageIndexabilities,
  pageTypes,
  parseSemanticRankDimensionCatalog,
  parseSemanticRankDimensionKey,
  projectPageSortFields,
  type ProjectPageSortField,
  type TechnicalCrawlSummary,
  type CreateTechnicalCrawlInput,
  type SemanticRankDimension,
  type ProjectPageStatistics,
  type ProjectCrawlIssueCollection,
  type ProjectCrawlIssueSummary,
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
  type MouseEvent as ReactMouseEvent,
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
import { UiText, useUiLocale } from "./ui-locale";


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
  indexability: 148,
  keywords: 88,
  averagePosition: 116,
  title: 220,
  h1: 190,
  responseTime: 104,
  size: 104,
  issues: 92,
  actions: 140
} as const;

type PageMapColumn = keyof typeof PAGE_MAP_COLUMN_DEFAULTS;
const PAGE_MAP_SORT_COLUMNS: Readonly<Partial<Record<PageMapColumn, ProjectPageSortField>>> = { url: "URL", http: "HTTP", indexability: "INDEXABILITY", keywords: "KEYWORDS", averagePosition: "AVERAGE_POSITION", title: "TITLE", h1: "H1", responseTime: "RESPONSE_TIME", size: "SIZE", issues: "ISSUES" };
type PageMapColumnWidths = Record<PageMapColumn, number>;

const PAGE_MAP_COLUMN_ORDER = Object.keys(
  PAGE_MAP_COLUMN_DEFAULTS
) as readonly PageMapColumn[];
const PAGE_MAP_COLUMN_LABELS: Readonly<Record<PageMapColumn, string>> = { url: "URL / страница", http: "HTTP", indexability: "Ограничения", keywords: "Запросы", averagePosition: "Средняя позиция", title: "Title", h1: "H1", responseTime: "Ответ", size: "Размер", issues: "Проблемы", actions: "Действия" };

const PAGE_MAP_COLUMN_MINIMUMS: Readonly<PageMapColumnWidths> = {
  url: 220,
  http: 60,
  indexability: 120,
  keywords: 76,
  averagePosition: 100,
  title: 130,
  h1: 120,
  responseTime: 82,
  size: 82,
  issues: 76,
  actions: 112
};

export function ProjectPageMap({
  heading,
  currentUserId,
  projectDomain,
  projectId,
  projectName
}: Readonly<{
  heading: ReactNode;
  currentUserId: string;
  projectDomain: string;
  projectId: string;
  projectName: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [collection, setCollection] = useState<ProjectPageSettings>();
  const collectionScopeRef = useRef("");
  const [filters, setFilters] = useState<PageFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<PageFilters>(DEFAULT_FILTERS);
  const [editor, setEditor] = useState<EditorState>();
  const [errors, setErrors] = useState<ProjectPageDraftErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreButtonRef = useRef<HTMLButtonElement>(null);
  const loadingMoreRef = useRef(false);
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [online, setOnline] = useState(true);
  const [reload, setReload] = useState(0);
  const { confirm, dialog: confirmationDialog } = useConfirmation();
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; page?: ProjectPageSummary; pageIds?: readonly string[]; path?: string }>();
  const [bulkJob, setBulkJob] = useState<PageStatusJobSummary>();
  const [bulkStarting, setBulkStarting] = useState(false);
  useEffect(() => { setBulkJob(undefined); setBulkStarting(false); }, [projectId]);
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
  const preferenceScope = `${currentUserId}:${projectId}`;
  const [hydratedScope, setHydratedScope] = useState("");
  const layoutHydrated = hydratedScope === preferenceScope;
  const [view, setView] = useState<"TABLE" | "DIAGRAM">("TABLE");
  const [visibleColumns, setVisibleColumns] = useState<readonly PageMapColumn[]>(["url", "http", "indexability", "keywords", "averagePosition", "issues", "actions"]);
  const [dimensions, setDimensions] = useState<readonly SemanticRankDimension[]>([]);
  const [sortField, setSortField] = useState<ProjectPageSortField>("URL");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("ASC");
  const pageCache = useRef(new Map<string, { at: number; value: ProjectPageSettings }>());
  const structureRef = useRef<Pick<ProjectPageSettings, "structureUrls" | "structurePageIds" | "structureTruncated">>({});
  const revisionRef = useRef(-1);
  const structureLifecycleRef = useRef<PageLifecycleStatus>("ACTIVE");
  const [checking, setChecking] = useState<{ pageId: string; crawl?: TechnicalCrawlSummary }>();
  const [dimensionKey, setDimensionKey] = useState("");
  const [rankDate, setRankDate] = useState("latest");
  const [diagramPageIds, setDiagramPageIds] = useState<readonly string[]>([]);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableWindow = useVirtualWindow(tableScrollRef, view === "TABLE" ? collection?.pages.length ?? 0 : 0, 56, 35, 100);
  const currentRows = (collection?.pages ?? []).slice(tableWindow.start, tableWindow.end);
  const statisticIds = [...(selectedPageId ? [selectedPageId] : []), ...(view === "TABLE" ? currentRows.map((row) => row.id) : diagramPageIds)];
  const rankStatistics = usePageStatistics(projectId, statisticIds, dimensionKey, sortField === "AVERAGE_POSITION" ? collection?.rankDate ?? rankDate : rankDate, reload, collection?.access.canViewKeywords === true);

  useEffect(() => {
    if (!collection?.access.canViewKeywords) return;
    const controller = new AbortController();
    void browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/keyword-ranks/dimensions`, { signal: controller.signal }).then(parseSemanticRankDimensionCatalog).then((catalog) => {
      if (!controller.signal.aborted) { setDimensions(catalog.dimensions); if (!catalog.dimensions.length) setSortField("URL"); setDimensionKey((old) => catalog.dimensions.some((dimension) => dimension.key === old) ? old : catalog.dimensions[0]?.key ?? ""); }
    }).catch((error: unknown) => { if (!controller.signal.aborted) setOperationError(errorMessage(error, "Не удалось загрузить поисковые срезы.")); });
    return () => controller.abort();
  }, [projectId, collection?.access.canViewKeywords]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (structureLifecycleRef.current !== appliedFilters.lifecycleStatus) { structureRef.current = {}; pageCache.current.clear(); structureLifecycleRef.current = appliedFilters.lifecycleStatus; }
      const scopeKey = pagesUrl(projectId, appliedFilters, selectedStructurePath, undefined, sortField, sortDirection, dimensionKey, rankDate, false);
      collectionScopeRef.current = scopeKey;
      const cached = pageCache.current.get(scopeKey);
      if (cached && Date.now() - cached.at < 30_000) { setCollection(cached.value); setLoading(false); setLoadError(undefined); return; }
      setLoading(true);
      setLoadError(undefined);
      try {
        const result = await browserApiRequest<ProjectPageSettings>(
          pagesUrl(projectId, appliedFilters, selectedStructurePath, undefined, sortField, sortDirection, dimensionKey, rankDate, !structureRef.current.structureUrls),
          signal ? { signal } : {}
        );
        if (signal?.aborted || collectionScopeRef.current !== scopeKey) return;
        if (result.structureUrls) structureRef.current = { structureUrls: result.structureUrls, ...(result.structurePageIds ? { structurePageIds: result.structurePageIds } : {}), ...(result.structureTruncated === undefined ? {} : { structureTruncated: result.structureTruncated }) };
        const next = { ...result, ...structureRef.current };
        if (pageCache.current.size >= 12) pageCache.current.delete(pageCache.current.keys().next().value!);
        pageCache.current.set(scopeKey, { at: Date.now(), value: next });
        setCollection(next);
      } catch (error) {
        if (error instanceof BrowserApiError && error.status === 403 && sortField === "AVERAGE_POSITION") { setSortField("URL"); setSortDirection("ASC"); return; }
        if (!signal?.aborted) {
          setLoadError(
            errorMessage(error, "Не удалось загрузить карту страниц.")
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId, appliedFilters, selectedStructurePath, sortField, sortDirection, dimensionKey, rankDate]
  );

  useEffect(() => {
    const saved = readPageMapLayout(currentUserId, projectId);
    pageCache.current.clear(); structureRef.current = {}; revisionRef.current = -1;
    setCollection(undefined); setSelectedPageId(undefined); setSelectedPageDetail(undefined); setChecking(undefined); setLoading(true);
    if (saved) {
      setStructureWidth(saved.structureWidth);
      setInspectorWidth(saved.inspectorWidth);
      setColumnWidths(saved.columnWidths);
      setStructureExpansion(saved.structureExpansion);
      setVisibleColumns(saved.visibleColumns);
      setView(saved.view);
      setDimensionKey(saved.dimensionKey ?? ""); setRankDate(saved.rankDate ?? "latest");
      if (saved.filters) { setFilters(saved.filters); setAppliedFilters(saved.filters); }
      if (saved.selectedPath) setSelectedStructurePath(saved.selectedPath);
      setSortField(saved.sortField ?? "URL"); setSortDirection(saved.sortDirection ?? "ASC");
    }
    else {
      setStructureWidth(248); setInspectorWidth(330); setColumnWidths({ ...PAGE_MAP_COLUMN_DEFAULTS }); setStructureExpansion({});
      setVisibleColumns(["url", "http", "indexability", "keywords", "averagePosition", "issues", "actions"]);
      setView("TABLE"); setDimensionKey(""); setRankDate("latest"); setSortField("URL"); setSortDirection("ASC");
      setFilters(DEFAULT_FILTERS); setAppliedFilters(DEFAULT_FILTERS); setSelectedStructurePath("/");
    }
    setHydratedScope(preferenceScope);
  }, [currentUserId, projectId, preferenceScope]);

  useEffect(() => {
    if (!layoutHydrated) return;
    savePageMapLayout(currentUserId, projectId, {
      structureWidth,
      inspectorWidth,
      columnWidths,
      structureExpansion
      ,visibleColumns, view, dimensionKey, rankDate, sortField, sortDirection, filters: appliedFilters, selectedPath: selectedStructurePath
    });
  }, [
    columnWidths,
    inspectorWidth,
    layoutHydrated,
    projectId,
    structureExpansion,
    structureWidth
    ,visibleColumns, view, currentUserId, dimensionKey, rankDate, sortField, sortDirection, appliedFilters, selectedStructurePath
  ]);

  useEffect(() => {
    if (!layoutHydrated) return;
    if (revisionRef.current !== reload) { pageCache.current.clear(); structureRef.current = {}; revisionRef.current = reload; }
    tableScrollRef.current?.scrollTo({ top: 0 });
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload, layoutHydrated]);

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



  const canManage = layoutHydrated && online && collection?.access.canManage === true;
  const structure = useMemo(
    () => buildSiteStructure(collection?.structureUrls ?? []),
    [collection?.structureUrls]
  );
  const hasDataFilters = filterCount(appliedFilters) > 0;
  const diagramStructure = useMemo(() => {
    if (hasDataFilters) return buildSiteStructure((collection?.pages ?? []).map((page) => page.normalizedUrl));
    return selectedStructurePath === "/" ? structure : buildSiteStructure((collection?.structureUrls ?? []).filter((url) => pageMatchesStructure(url, selectedStructurePath)));
  }, [hasDataFilters, collection?.pages, collection?.structureUrls, selectedStructurePath, structure]);
  const diagramNodes = diagramStructure.nodes;
  const pageIdsByPath = useMemo(() => {
    const byUrl = new Map((collection?.pages ?? []).map((page) => [page.normalizedUrl, page.id]));
    const result = new Map<string, string>();
    for (const [index, url] of (collection?.structureUrls ?? []).entries()) {
      const id = collection?.structurePageIds?.[index] ?? byUrl.get(url);
      if (id) { const pathname = new URL(url).pathname; result.set(pathname === "/" ? "/" : `${pathname.replace(/\/$/u, "")}/`, id); }
    }
    return result;
  }, [collection?.structureUrls, collection?.structurePageIds, collection?.pages]);

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

  const openInspector = useCallback(async (page: ProjectPageSummary, loaded = false): Promise<void> => {
    const requestId = inspectorRequestRef.current + 1;
    inspectorRequestRef.current = requestId;
    const issueRequestId = issueRequestRef.current + 1;
    issueRequestRef.current = issueRequestId;
    setSelectedPageId(page.id);
    setSelectedPageDetail(loaded ? page : undefined);
    setInspectorLoading(!loaded);
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
    if (loaded) return;
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
  }, [projectId]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pageId");
    if (!id || !/^[0-9a-f-]{36}$/iu.test(id)) return;
    const controller = new AbortController(), requestId = ++inspectorRequestRef.current;
    void browserApiRequest<ProjectPageSummary>(projectPageApiPath(projectId, id), { signal: controller.signal }).then((page) => { if (!controller.signal.aborted && inspectorRequestRef.current === requestId) void openInspector(page, true); }).catch((caught: unknown) => { if (!controller.signal.aborted) setOperationError(errorMessage(caught, "Не удалось открыть страницу.")); });
    return () => controller.abort();
  }, [projectId, openInspector]);

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
      pageCache.current.clear();
      setReload(value => value + 1);
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

  async function recheckPage(page: ProjectPageSummary) {
    if (!canManage || checking) return;
    setOperationError(undefined); setSuccess(undefined); setChecking({ pageId: page.id });
    try {
      const input: CreateTechnicalCrawlInput = {
        purpose: "TECHNICAL_AUDIT", startUrls: [page.normalizedUrl], sitemapUrls: [], includePatterns: [], excludePatterns: [],
        queryPolicy: "PRESERVE", maxUrls: 1, maxDepth: 0, maxRuntimeSeconds: 300,
        requestsPerMinute: 240, obeyRobots: true, savePageMap: true, conditionalRequests: false
      };
      const crawl = await browserApiRequest<TechnicalCrawlSummary>(`/app/api/projects/${encodeURIComponent(projectId)}/crawls`, { method: "POST", idempotencyKey: `crawl:${globalThis.crypto.randomUUID()}`, body: input });
      setChecking({ pageId: page.id, crawl }); setSuccess("Проверка страницы запущена.");
    } catch (caught) { setChecking(undefined); setOperationError(errorMessage(caught, "Не удалось запустить проверку страницы.")); }
  }
  useEffect(() => {
    if (!checking?.crawl) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const pageId = checking.pageId, crawlId = checking.crawl.id;
    const poll = async () => {
      try {
        const crawl = await browserApiRequest<TechnicalCrawlSummary>(`/app/api/projects/${encodeURIComponent(projectId)}/crawls/${crawlId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(crawl.status)) { timer = setTimeout(() => void poll(), 2000); return; }
        const updated = await browserApiRequest<ProjectPageSummary>(projectPageApiPath(projectId, pageId), { signal: controller.signal });
        if (controller.signal.aborted) return;
        setCollection(previous => previous ? { ...previous, pages: previous.pages.map(item => item.id === pageId ? updated : item) } : previous);
        setSelectedPageDetail(previous => previous?.id === pageId ? updated : previous);
        setChecking(undefined); setReload(value => value + 1);
        if (crawl.status === "COMPLETED" && !crawl.failedUrls) setSuccess("Страница проверена.");
        else setOperationError("Проверка страницы завершилась с ошибкой. Результат доступен в операциях.");
      } catch (caught) { if (!controller.signal.aborted) { setChecking(undefined); setOperationError(errorMessage(caught, "Не удалось получить результат проверки страницы.")); } }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [checking, projectId]);

  function selectRow(page: ProjectPageSummary, event: Pick<ReactMouseEvent, "ctrlKey" | "metaKey" | "shiftKey">, checkbox = false): void {
    if (event.shiftKey && selectionAnchor.current && collection) {
      const start = collection.pages.findIndex(row => row.id === selectionAnchor.current), end = collection.pages.findIndex(row => row.id === page.id);
      if (start >= 0 && end >= 0) {
        const next = new Set(event.ctrlKey || event.metaKey ? selectedIds : []);
        for (const row of collection.pages.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(row.id);
        setSelectedIds(next); return;
      }
    }
    selectionAnchor.current = page.id;
    if (checkbox || event.ctrlKey || event.metaKey) {
      setSelectedIds(previous => { const next = new Set(previous); if (next.has(page.id)) next.delete(page.id); else next.add(page.id); return next; });
    } else { setSelectedIds(new Set([page.id])); void openInspector(page); }
  }
  function pageMenu(event: ReactMouseEvent, page: ProjectPageSummary): void {
    event.preventDefault();
    const ids = selectedIds.has(page.id) ? [...selectedIds] : [page.id];
    setSelectedIds(new Set(ids));
    setContextMenu({ x: event.clientX, y: event.clientY, page, pageIds: ids });
  }
  async function startBulkStatus(input: PageStatusInput): Promise<void> {
    if (!canManage || bulkStarting || bulkJob && ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(bulkJob.status)) return;
    const scope = input.pathPrefix ? input.pathPrefix === "/" ? "все страницы проекта" : `все страницы раздела ${input.pathPrefix}` : `${input.pageIds?.length ?? 0} стр.`;
    if (!await confirm({ title: input.operation === "archive" ? "Перенести страницы в архив?" : "Восстановить страницы?", description: `${input.operation === "archive" ? "В архив будут перенесены" : "Будут восстановлены"} ${scope}.`, confirmLabel: input.operation === "archive" ? "В архив" : "Восстановить" })) return;
    setBulkStarting(true); setOperationError(undefined); setSuccess(undefined);
    try {
      const job = parsePageStatusJobSummary(await browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/pages/status-jobs`, { method: "POST", body: input, idempotencyKey: `page-status:${globalThis.crypto.randomUUID()}` }));
      setBulkJob(job); setSelectedIds(new Set());
    } catch (error) { setOperationError(errorMessage(error, "Не удалось запустить операцию со страницами.")); }
    finally { setBulkStarting(false); }
  }
  useEffect(() => { setSelectedIds(new Set()); setContextMenu(undefined); selectionAnchor.current = undefined; }, [projectId, selectedStructurePath, appliedFilters, sortField, sortDirection]);
  const bulkJobId = bulkJob?.id;
  useEffect(() => {
    if (!bulkJobId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = parsePageStatusJobSummary(await browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/pages/status-jobs/${bulkJobId}`, { signal: controller.signal }));
        if (controller.signal.aborted) return;
        setBulkJob(next);
        if (["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(next.status)) { timer = setTimeout(() => void poll(), 1000); return; }
        pageCache.current.clear(); structureRef.current = {}; revisionRef.current = -1; setReload(value => value + 1); closeInspector();
        if (next.status === "FAILED_FINAL") setOperationError("Не удалось завершить операцию со страницами. Повторите действие.");
        else setSuccess(`Обработано: ${next.processed}. Изменено: ${next.changed}.${next.blocked ? ` Сохранены страницы с основными кластерами: ${next.blocked}.` : ""}`);
      } catch (error) { if (!controller.signal.aborted) { setOperationError(errorMessage(error, "Не удалось получить прогресс операции.")); timer = setTimeout(() => void poll(), 2000); } }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, bulkJobId]);

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
      pageCache.current.clear();
      setReload(value => value + 1);
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

  const loadMore = useCallback(async (): Promise<void> => {
    const scopeKey = pagesUrl(projectId, appliedFilters, selectedStructurePath, undefined, sortField, sortDirection, dimensionKey, rankDate, false);
    if (!collection?.nextCursor || loadingMoreRef.current || collectionScopeRef.current !== scopeKey) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setOperationError(undefined);
    try {
      const next = await browserApiRequest<ProjectPageSettings>(
        pagesUrl(
          projectId,
          appliedFilters,
          selectedStructurePath,
          collection.nextCursor, sortField, sortDirection, dimensionKey, rankDate, false
        )
      );
      if (collectionScopeRef.current !== scopeKey) return;
      setCollection({
        ...next,
        pages: [...collection.pages, ...next.pages],
        ...(collection.structureUrls
          ? { structureUrls: collection.structureUrls, ...(collection.structurePageIds ? { structurePageIds: collection.structurePageIds } : {}), ...(collection.structureTruncated === undefined ? {} : { structureTruncated: collection.structureTruncated }) }
          : {})
      });
    } catch (error) {
      if (collectionScopeRef.current !== scopeKey) return;
      setOperationError(
        errorMessage(error, "Не удалось загрузить следующую страницу.")
      );
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appliedFilters, collection, projectId, selectedStructurePath, sortField, sortDirection, dimensionKey, rankDate]);

  useEffect(() => {
    const target = loadMoreButtonRef.current;
    if (!target || !collection?.nextCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [collection?.nextCursor, loadMore]);

  useEffect(() => {
    if (view === "DIAGRAM" && hasDataFilters && collection?.nextCursor && !loading && !loadingMore && !operationError) void loadMore();
  }, [view, hasDataFilters, collection?.nextCursor, loading, loadingMore, operationError, loadMore]);

  if (!layoutHydrated || (loading && !collection)) {
    return (
      <div className="page-map"><header className="page-map-primary-actions">{heading}</header><section className="panel page-map-state" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        <p><UiText text="Загружаем страницы проекта…" /></p>
      </section></div>
    );
  }

  if (loadError && !collection) {
    return (
      <div className="page-map"><header className="page-map-primary-actions">{heading}</header><section className="panel page-map-state" role="alert">
        <h2><UiText text="Карта страниц недоступна" /></h2>
        <p>{<UiText text={loadError ?? ""} />}</p>
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
          type="button"
        >
          <UiText text="Повторить" /></button>
      </section></div>
    );
  }

  function pageContextItems(): readonly ContextMenuItem[] {
    if (!contextMenu) return [];
    const input = contextMenu.path ? { pathPrefix: contextMenu.path } : { pageIds: contextMenu.pageIds ?? [] };
    const multiple = (contextMenu.pageIds?.length ?? 0) > 1;
    const busy = bulkStarting || bulkJob !== undefined && ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(bulkJob.status);
    const rows = collection?.pages.filter(row => contextMenu.pageIds?.includes(row.id)) ?? [];
    return [
      ...(contextMenu.path ? [{ id: "open", label: "Открыть раздел", icon: <Icon name="projects" />, onSelect: () => filterByStructure(contextMenu.path!) }] : contextMenu.page && !multiple ? [
        { id: "open", label: "Открыть страницу", icon: <Icon name="pages" />, onSelect: () => void openInspector(contextMenu.page!) },
        { id: "edit", label: "Изменить", disabled: !canManage, onSelect: () => startEdit(contextMenu.page!) },
        { id: "recheck", label: "Перепроверить", disabled: !canManage || checking !== undefined, onSelect: () => void recheckPage(contextMenu.page!) }
      ] : []),
      { id: "copy", label: contextMenu.path ? "Копировать путь" : "Копировать URL", onSelect: () => { void navigator.clipboard.writeText(contextMenu.path ?? rows.map(row => row.url).join("\n")).catch(() => setOperationError("Не удалось скопировать URL.")); } },
      { id: "archive", label: "В архив", dividerBefore: true, danger: true, disabled: !canManage || busy, onSelect: () => void startBulkStatus({ ...input, operation: "archive" }) },
      { id: "restore", label: "Восстановить", disabled: !canManage || busy, onSelect: () => void startBulkStatus({ ...input, operation: "restore" }) }
    ];
  }

  if (!collection) return null;
  const activeFilterCount = filterCount(appliedFilters);
  const hasActiveMapFilter =
    activeFilterCount > 0 || selectedStructurePath !== "/";
  const selectedListPage = collection.pages.find(
    ({ id }) => id === selectedPageId
  );
  const selectedPage =
    selectedPageDetail?.id === selectedPageId
      ? selectedPageDetail
      : selectedListPage;
  const pageMapStyle = {
    "--page-map-structure-width": `${structureWidth}px`,
    "--page-map-inspector-width": `${inspectorWidth}px`
  } as CSSProperties;
  const tableWidth = 40 + visibleColumns.reduce(
    (total, column) => total + columnWidths[column],
    0
  );
  const openPageId = async (id: string) => {
    const page = collection.pages.find((row) => row.id === id);
    if (page) { await openInspector(page); return; }
    const requestId = ++inspectorRequestRef.current;
    try { const detail = await browserApiRequest<ProjectPageSummary>(projectPageApiPath(projectId, id)); if (requestId === inspectorRequestRef.current) await openInspector(detail, true); }
    catch (error) { setOperationError(errorMessage(error, "Не удалось открыть страницу.")); }
  };

  return (
    <div className="page-map" style={pageMapStyle}>
      {!online && (
        <div className="inline-alert warning page-map-notice" role="status">
          <UiText text="Нет сети. Данные доступны для просмотра, изменения временно отключены." /></div>
      )}
      {collection.access.mutationRestriction !== "NONE" && (
        <div className="inline-alert page-map-notice" role="status">
          {<UiText text={restrictionLabel(collection.access.mutationRestriction) ?? ""} />}
        </div>
      )}
      {loadError && <div className="inline-alert error page-map-notice" role="alert">{loadError}<button className="text-button" onClick={() => setReload((value) => value + 1)} type="button"><UiText text="Повторить" /></button></div>}
      {operationError && (
        <div className="inline-alert error page-map-notice" role="alert">{<UiText text={operationError ?? ""} />}</div>
      )}
      {success && (
        <div className="inline-alert success page-map-notice" role="status">{<UiText text={success ?? ""} />}</div>
      )}

      <section className="page-map-primary-actions" aria-label={uiText("Действия карты страниц")}>
        {heading}
        <div className="page-map-view-switch" aria-label={uiText("Вид карты страниц")}><button aria-pressed={view === "TABLE"} onClick={() => setView("TABLE")} type="button"><Icon name="list" /><UiText text="Список" /></button><button aria-pressed={view === "DIAGRAM"} onClick={() => setView("DIAGRAM")} type="button"><Icon name="sitemap" /><UiText text="Схема" /></button></div>
        <span className="page-map-count">
          {structure.total.toLocaleString(uiLocale)}{collection.structureTruncated ? "+" : ""} <UiText text="страниц в структуре" before=" " /></span>
        <a
          className="primary-button"
          href={`/app/projects/${encodeURIComponent(projectId)}/tools/http-status-checker`}
        >
          <Icon name="sitemap" />
          <UiText text="Сканировать сайт" /></a>
        <button className="secondary-button" onClick={exportVisiblePages} type="button">
          <Icon name="export" />
          <UiText text="Экспорт" /></button>

        <button
          className="primary-button"
          disabled={!canManage || busyId !== undefined}
          onClick={startCreate}
          type="button"
        >
          <UiText text="Добавить страницу" /></button>
        {view === "TABLE" && <details className="page-map-columns" data-exclusive-dropdown><summary><Icon name="list" /><UiText text="Колонки" /></summary><div>{PAGE_MAP_COLUMN_ORDER.map((column) => <label key={column}><input checked={visibleColumns.includes(column)} disabled={column === "url"} onChange={(event) => setVisibleColumns((old) => event.target.checked ? PAGE_MAP_COLUMN_ORDER.filter((key) => old.includes(key) || key === column) : old.filter((key) => key !== column))} type="checkbox" /><UiText text={PAGE_MAP_COLUMN_LABELS[column]} /></label>)}</div></details>}
      </section>

        <section className="panel page-map-toolbar">
        <form className="page-map-commandbar" onSubmit={applyFilters}>
          <label className="form-field page-map-search">
            <span className="visually-hidden"><UiText text="Поиск по карте страниц" /></span>
            <input
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  search: event.target.value
                }))
              }
              placeholder={uiText("URL, Title или H1")}
              type="search"
              value={filters.search}
            />
          </label>
          <button className="secondary-button page-map-search-button" type="submit">
            <UiText text="Найти" /></button>
          <details className="page-map-filter-disclosure" data-exclusive-dropdown>
            <summary>
              <UiText text="Фильтры" />{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </summary>
            <div className="page-map-filter-popover">
              <label className="form-field">
                <span><UiText text="Тип" /></span>
                <CustomSelect
                  onChange={(event) =>
                    setFilters((value) => ({
                      ...value,
                      pageType: event.target.value as PageType | ""
                    }))
                  }
                  value={filters.pageType}
                >
                  <option value=""><UiText text="Все типы" /></option>
                  {pageTypes.map((value) => (
                    <option key={value} value={value}>
                      {<UiText text={pageTypeLabel(value) ?? ""} />}
                    </option>
                  ))}
                </CustomSelect>
              </label>
              <label className="form-field">
                <span><UiText text="Индексируемость" /></span>
                <CustomSelect
                  onChange={(event) =>
                    setFilters((value) => ({
                      ...value,
                      indexability: event.target.value as PageIndexability | ""
                    }))
                  }
                  value={filters.indexability}
                >
                  <option value=""><UiText text="Все состояния" /></option>
                  {pageIndexabilities.map((value) => (
                    <option key={value} value={value}>
                      {<UiText text={pageIndexabilityLabel(value) ?? ""} />}
                    </option>
                  ))}
                </CustomSelect>
              </label>
              <label className="form-field">
                <span><UiText text="Раздел" /></span>
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
                  <option value="ACTIVE"><UiText text="Активные" /></option>
                  <option value="ARCHIVED"><UiText text="Архив" /></option>
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
                  <UiText text="Сбросить" /></button>
                <button className="primary-button" type="submit">
                  <UiText text="Показать" /></button>
              </div>
            </div>
          </details>
        </form>
        {collection.access.canViewKeywords && <div className="page-map-rank-toolbar"><label><span className="visually-hidden"><UiText text="Поисковый срез для позиций" /></span><RankDimensionSelect ariaLabel={uiText("Поисковый срез для позиций")} dimensions={dimensions} value={dimensionKey} onChange={setDimensionKey} /></label><button className="secondary-button" aria-pressed={rankDate === "latest"} onClick={() => setRankDate("latest")} type="button"><UiText text="Последний съём" /></button><CustomDateInput aria-label={uiText("Дата съёма для карты страниц")} required type="date" value={rankDate === "latest" ? rankStatistics.date ?? new Date().toISOString().slice(0, 10) : rankDate} onChange={(event) => setRankDate(event.target.value)} /><button className="secondary-button page-map-refresh" aria-label={uiText("Обновить карту страниц")} title={uiText("Обновить карту страниц")} disabled={loading || rankStatistics.loading} onClick={() => setReload((value) => value + 1)} type="button"><Icon name="refresh" /></button>{rankStatistics.error && <span role="alert">{rankStatistics.error}</span>}</div>}
        </section>

      <div className={`page-map-workspace${view === "DIAGRAM" ? " is-diagram" : ""}`}>
        {view === "TABLE" && <>
        <SiteStructure
          domain={projectDomain}
          nodes={structure.nodes}
          onSelect={filterByStructure}
          selectedPath={selectedStructurePath}
          archived={appliedFilters.lifecycleStatus === "ARCHIVED"}
          onContextMenu={(event, path) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, path }); }}
          total={structure.total}
        />
        <PanelResizeHandle
          label={uiText("Изменить ширину структуры сайта")}
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
        </>}
        <div className="page-map-main">
          {(selectedIds.size > 0 || bulkStarting || bulkJob && ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(bulkJob.status)) && <div className="page-map-selection-toolbar">
            {selectedIds.size > 0 && <><span><UiText text="Выбрано" />: {selectedIds.size}</span><button className="text-button" type="button" onClick={() => setSelectedIds(new Set())}><UiText text="Снять выделение" /></button></>}
            {selectedIds.size > 0 && canManage && <><button className="text-button" disabled={bulkStarting || bulkJob?.status === "RUNNING" || bulkJob?.status === "QUEUED"} type="button" onClick={() => void startBulkStatus({ operation: appliedFilters.lifecycleStatus === "ARCHIVED" ? "restore" : "archive", pageIds: [...selectedIds] })}><UiText text={appliedFilters.lifecycleStatus === "ARCHIVED" ? "Восстановить" : "В архив"} /></button></>}
            {bulkStarting ? <span role="status"><UiText text="Запуск операции…" /></span> : bulkJob && ["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(bulkJob.status) && <span role="status"><UiText text="Обработка страниц" />: {bulkJob.processed} / {bulkJob.total ?? "—"}</span>}
          </div>}


      {confirmationDialog}
      {contextMenu && <ContextMenu label={uiText(contextMenu.path ? "Действия с разделом" : "Действия со страницами")} x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(undefined)} items={pageContextItems()} />}
      {editor && <ProjectPageEditor projectId={projectId} busy={busyId !== undefined} draft={editor.draft} errors={errors} existing={editor.page !== undefined} errorMessage={operationError} onCancel={() => setEditor(undefined)} onChange={changeDraft} onSubmit={submitPage} />}


        <div className={selectedPage ? "page-map-content has-inspector" : "page-map-content"}>
        {collection.pages.length === 0 ? (
          <section className="panel page-map-empty">
          <h2>
            {appliedFilters.lifecycleStatus === "ARCHIVED"
              ? <UiText text="Архив пуст" />
              : hasActiveMapFilter
                ? <UiText text="По фильтрам ничего не найдено" />
                : <UiText text="Страниц пока нет" />}
          </h2>
          <p>
            <UiText text={appliedFilters.lifecycleStatus === "ARCHIVED" ? "Здесь будут страницы, перенесённые в архив." : hasActiveMapFilter ? "Измените фильтры или выберите другой раздел." : "Добавьте первую страницу или запустите обход сайта."} /></p>
          {appliedFilters.lifecycleStatus === "ARCHIVED" && <button className="secondary-button" type="button" onClick={() => { setFilters(value => ({ ...value, lifecycleStatus: "ACTIVE" })); setAppliedFilters(value => ({ ...value, lifecycleStatus: "ACTIVE" })); }}><UiText text="Активные страницы" /></button>}
          {appliedFilters.lifecycleStatus === "ACTIVE" && hasActiveMapFilter && <button className="secondary-button" type="button" onClick={resetFilters}><UiText text="Сбросить фильтры" /></button>}
          {canManage && appliedFilters.lifecycleStatus === "ACTIVE" && !hasActiveMapFilter && (
            <button className="primary-button" onClick={startCreate} type="button">
              <UiText text="Добавить первую страницу" /></button>
          )}
          </section>
        ) : view === "DIAGRAM" ? <div className="page-map-diagram-shell"><PageMapDiagram domain={projectDomain} nodes={diagramNodes} total={diagramStructure.total} pages={collection.pages} pageIdsByPath={pageIdsByPath} expansion={structureExpansion} selectedPageId={selectedPageId} statistics={rankStatistics.values} onToggle={(path, expanded) => setStructureExpansion((old) => ({ ...old, [path]: !expanded }))} onSelectPage={(id) => void openPageId(id)} onSelectPath={filterByStructure} onVisiblePages={setDiagramPageIds} />{loadingMore && hasDataFilters && <span className="page-map-diagram-loading" role="status"><UiText text="Загрузка схемы…" /></span>}</div> : (
          <section className="panel page-map-list">
            <div className="page-map-table-wrap" ref={tableScrollRef}>
              <table
                className="page-map-table semantic-table has-sized-columns"
                onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelectedIds(new Set(collection.pages.map(page => page.id))); } }}
                style={{ minWidth: "100%", width: `${tableWidth}px` }}
              >
              <colgroup>
                <col style={{ width: 40 }} />
                {visibleColumns.map((column) => (
                  <col
                    key={column}
                    style={{ width: `${columnWidths[column]}px` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="page-map-selection-cell"><TableSelectionCheckbox label={uiText("Выбрать загруженные страницы")} checked={collection.pages.length > 0 && collection.pages.every(page => selectedIds.has(page.id))} mixed={selectedIds.size > 0 && !collection.pages.every(page => selectedIds.has(page.id))} onChange={checked => setSelectedIds(checked ? new Set(collection.pages.map(page => page.id)) : new Set())} /></th>
                  {visibleColumns.map((column) => <PageMapColumnHeader key={column} column={column} label={uiText(PAGE_MAP_COLUMN_LABELS[column])} onResize={resizeColumn} width={columnWidths[column]} direction={PAGE_MAP_SORT_COLUMNS[column] === sortField ? sortDirection === "ASC" ? "ascending" : "descending" : undefined} onSort={PAGE_MAP_SORT_COLUMNS[column] ? () => { setSortDirection(PAGE_MAP_SORT_COLUMNS[column] === sortField && sortDirection === "ASC" ? "DESC" : "ASC"); setSortField(PAGE_MAP_SORT_COLUMNS[column]!); } : undefined} disabled={column === "averagePosition" && !dimensionKey} />)}
                </tr>
              </thead>
                <tbody>
                  {tableWindow.paddingTop > 0 && <tr aria-hidden="true"><td colSpan={visibleColumns.length + 1} style={{ height: tableWindow.paddingTop, padding: 0, border: 0 }} /></tr>}
                  {currentRows.map((page) => (
                    <PageRow
                      busy={busyId === page.id}
                      canManage={canManage}
                      key={page.id}
                      onEdit={() => startEdit(page)}
                      onSelect={(event) => selectRow(page, event)}
                      onCheck={(event) => selectRow(page, event, true)}
                      onContextMenu={(event) => pageMenu(event, page)}
                      checked={selectedIds.has(page.id)}
                      onStatus={() =>
                        void changeStatus(
                          page,
                          page.lifecycleStatus === "ACTIVE"
                            ? "archive"
                            : "restore"
                        )
                      }
                      page={page}
                      columns={visibleColumns}
                      statistics={rankStatistics.values[page.id]}
                      selected={selectedIds.has(page.id) || selectedPageId === page.id}
                    />
                  ))}
                  {tableWindow.paddingBottom > 0 && <tr aria-hidden="true"><td colSpan={visibleColumns.length + 1} style={{ height: tableWindow.paddingBottom, padding: 0, border: 0 }} /></tr>}
                </tbody>
              </table>
            </div>
            {collection.nextCursor && (
              <footer className="page-map-footer">
                <button
                  className="secondary-button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  ref={loadMoreButtonRef}
                  type="button"
                >
                  {loadingMore ? <UiText text="Загрузка…" /> : <UiText text="Показать ещё" />}
                </button>
              </footer>
            )}
          </section>
        )}
        {selectedPage && (
          <>
            <PanelResizeHandle
              label={uiText("Изменить ширину инспектора страницы")}
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
            <ProjectPageInspector
              projectId={projectId}
              canViewKeywords={collection.access.canViewKeywords === true}
              statistics={rankStatistics.values[selectedPage.id]}
              dimensionKey={dimensionKey}
              date={rankStatistics.date ?? rankDate}
              onRecheck={() => void recheckPage(selectedPage)}
              checking={checking?.pageId === selectedPage.id}
              onStatus={() => void changeStatus(selectedPage, selectedPage.lifecycleStatus === "ACTIVE" ? "archive" : "restore")}
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
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <WorkspaceSidebarSeparator
      aria-label={label}
      className="page-map-panel-resizer"
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      title={uiText("{0}. Двойной клик — сбросить.", [String(label)])}
    />
  );
}

function PageMapColumnHeader({
  column,
  label,
  onResize,
  width, direction, onSort, disabled
}: Readonly<{
  direction?: "ascending" | "descending" | undefined; onSort?: (() => void) | undefined; disabled?: boolean;
  column: PageMapColumn;
  label: string;
  onResize: (column: PageMapColumn, width: number) => void;
  width: number;
}>) {
  const { t: uiText } = useUiLocale();
  function resizeFromKeyboard(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(column, width + (event.key === "ArrowRight" ? 12 : -12));
  }

  return (
    <th className="page-map-resizable-column semantic-resizable-column" scope="col" data-column={column} aria-sort={direction}>
      {onSort ? <TableSortButton label={label} direction={direction} disabled={disabled} onClick={onSort}>{label}</TableSortButton> : <span>{label}</span>}
      <span
        aria-label={uiText("Изменить ширину колонки «{0}»", [String(label)])}
        aria-orientation="vertical"
        aria-valuemax={640}
        aria-valuemin={PAGE_MAP_COLUMN_MINIMUMS[column]}
        aria-valuenow={width}
        className="page-map-column-resizer semantic-column-resizer"
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
        title={uiText("Потяните для изменения ширины. Двойной клик — сбросить.")}
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


function SiteStructure({ domain, nodes, onSelect, onContextMenu, selectedPath, total, archived }: Readonly<{
  domain: string; nodes: readonly SiteStructureNode[]; onSelect: (path: string) => void; onContextMenu: (event: ReactMouseEvent, path: string) => void; selectedPath: string; total: number; archived: boolean;
}>) {
  const { locale, t } = useUiLocale();
  return <WorkspaceSidebar className="page-map-structure" aria-label={t("Структура сайта")}><header><div><h2><UiText text="Структура сайта" /></h2><span>{domain}</span></div></header>
    <button className="page-map-tree-root" onContextMenu={event => onContextMenu(event, "/")} aria-pressed={selectedPath === "/"} onClick={() => onSelect("/")} type="button"><Icon name="sitemap" /><span><UiText text="Все страницы" /></span><strong>{total.toLocaleString(locale)}</strong></button>
    <ul className="page-map-tree">{sortSiteSections(nodes).map((node) => <li key={node.path}><button className={`page-map-tree-select${selectedPath === node.path ? " selected" : ""}`} onContextMenu={event => onContextMenu(event, node.path)} aria-pressed={selectedPath === node.path} onClick={() => onSelect(node.path)} type="button"><Icon name="projects" /><span>/{node.name}</span><strong>{node.count.toLocaleString(locale)}</strong></button></li>)}</ul>
    {nodes.length === 0 && <p className="page-map-tree-empty"><UiText text={archived ? "Нет архивированных разделов." : "В структуре пока нет разделов."} /></p>}
  </WorkspaceSidebar>;
}


function PageRow({ busy, canManage, onEdit, onSelect, onStatus, onCheck, onContextMenu, checked, page, selected, columns, statistics }: Readonly<{
  busy: boolean; canManage: boolean; onEdit: () => void; onSelect: (event: Pick<ReactMouseEvent, "ctrlKey" | "metaKey" | "shiftKey">) => void; onCheck: (event: ReactMouseEvent) => void; onContextMenu: (event: ReactMouseEvent) => void; checked: boolean; onStatus: () => void; page: ProjectPageSummary; selected: boolean;
  columns: readonly PageMapColumn[]; statistics?: ProjectPageStatistics | undefined;
}>) {
  const { locale, t } = useUiLocale();
  const crawl = page.latestCrawl, title = crawl?.title ?? page.title, h1 = crawl?.h1 ?? page.h1, status = crawl?.statusCode || page.httpStatus;
  const cells: Readonly<Record<PageMapColumn, ReactNode>> = {
    url: <div className="page-map-url"><a href={page.normalizedUrl} onClick={(event) => event.stopPropagation()} rel="noopener noreferrer" target="_blank">{pagePath(page.normalizedUrl)}</a><span>{title || page.normalizedUrl}</span></div>,
    http: <span className={`page-map-http status-${httpStatusKind(status)}`}>{status ?? "—"}</span>,
    indexability: <span className={`status-pill page-index-${page.indexability.toLowerCase()}`}>{pageIndexabilityLabel(page.indexability)}</span>,
    keywords: page.assignedKeywordCount,
    averagePosition: <div className="page-map-average" title={statistics ? `Измерено: ${statistics.measuredCount} / ${statistics.assignedCount}; найдено по этому URL: ${statistics.matchedCount}; другой URL: ${statistics.differentPageCount}` : t("Нет замеров")}><span>{statistics?.averagePosition?.toLocaleString(locale, { maximumFractionDigits: 2 }) ?? "—"}</span>{statistics && <small>{statistics.measuredCount} / {statistics.assignedCount}</small>}</div>,
    title: <span className="page-map-clamp">{title || "—"}</span>, h1: <span className="page-map-clamp">{h1 || "—"}</span>,
    responseTime: crawl && crawl.statusCode ? `${crawl.responseTimeMs.toLocaleString(locale)} мс` : "—", size: crawl && crawl.statusCode ? formatBytes(crawl.sizeBytes, locale) : "—",
    issues: <span className={`page-map-issue-count${(page.openIssueCount ?? 0) > 0 ? " has-issues" : ""}`}>{page.openIssueCount ?? "—"}</span>,
    actions: <div className="page-map-actions">{page.lifecycleStatus === "ACTIVE" && <button className="text-button" disabled={!canManage || busy} onClick={(event) => { event.stopPropagation(); onEdit(); }} type="button"><UiText text="Изменить" /></button>}<button className="text-button" disabled={!canManage || busy} onClick={(event) => { event.stopPropagation(); onStatus(); }} type="button"><UiText text={page.lifecycleStatus === "ACTIVE" ? "В архив" : "Восстановить"} /></button></div>
  };
  return <tr aria-selected={selected} data-page-id={page.id} className={selected ? "selected" : undefined} onClick={onSelect} onContextMenu={onContextMenu} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect({ ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }); } }} tabIndex={0}><td className="page-map-selection-cell"><TableSelectionCheckbox label={`Выбрать ${pagePath(page.url)}`} checked={checked} onClick={event => { event.stopPropagation(); onCheck(event); }} /></td>{columns.map((column) => <td key={column} data-column={column}>{cells[column]}</td>)}</tr>;
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

function formatBytes(value: number, uiLocale: string = "ru-RU"): string {
  if (value < 1_024) return `${value} Б`;
  if (value < 1_048_576) return `${(value / 1_024).toLocaleString(uiLocale, { maximumFractionDigits: 1 })} КБ`;
  return `${(value / 1_048_576).toLocaleString(uiLocale, { maximumFractionDigits: 1 })} МБ`;
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
  cursor?: string, sort: ProjectPageSortField = "URL", direction: "ASC" | "DESC" = "ASC", dimensionKey = "", date = "latest", includeStructure = false
): string {
  const query = new URLSearchParams({
    limit: "50",
    lifecycleStatus: filters.lifecycleStatus, sort, sortDirection: direction, includeStructure: String(includeStructure)
  });
  if (sort === "AVERAGE_POSITION" && dimensionKey) { query.set("dimensionKey", dimensionKey); query.set("date", date); }
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
  readonly visibleColumns: readonly PageMapColumn[];
  readonly view: "TABLE" | "DIAGRAM";
  readonly filters?: PageFilters; readonly selectedPath?: string;
  readonly dimensionKey?: string; readonly rankDate?: string; readonly sortField?: ProjectPageSortField; readonly sortDirection?: "ASC" | "DESC";
}

function pageMapLayoutKey(userId: string, projectId: string): string {
  return `seo-platform:page-map-layout:v2:${userId}:${projectId}`;
}

function readPageMapLayout(userId: string, projectId: string): StoredPageMapLayout | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(pageMapLayoutKey(userId, projectId));
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
      ),
      visibleColumns: Array.isArray(parsed.visibleColumns) ? ["url", ...PAGE_MAP_COLUMN_ORDER.filter((key) => key !== "url" && parsed.visibleColumns!.includes(key))] : ["url", "http", "indexability", "keywords", "averagePosition", "issues", "actions"],
      view: parsed.view === "DIAGRAM" ? "DIAGRAM" : "TABLE",
      ...(parseSemanticRankDimensionKey(parsed.dimensionKey) ? { dimensionKey: parsed.dimensionKey! } : {}),
      rankDate: parsed.rankDate && (parsed.rankDate === "latest" || /^\d{4}-\d{2}-\d{2}$/u.test(parsed.rankDate)) ? parsed.rankDate : "latest",
      ...(parsed.selectedPath?.startsWith("/") && !/[?#]/u.test(parsed.selectedPath) && parsed.selectedPath.length <= 2048 ? { selectedPath: parsed.selectedPath } : {}),
      ...(parsed.filters && typeof parsed.filters.search === "string" && parsed.filters.search.length <= 300 && (!parsed.filters.pageType || pageTypes.includes(parsed.filters.pageType)) && (!parsed.filters.indexability || pageIndexabilities.includes(parsed.filters.indexability)) && ["ACTIVE", "ARCHIVED"].includes(parsed.filters.lifecycleStatus) ? { filters: parsed.filters } : {}),
      sortField: projectPageSortFields.includes(parsed.sortField!) ? parsed.sortField! : "URL", sortDirection: parsed.sortDirection === "DESC" ? "DESC" : "ASC"
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
  userId: string,
  projectId: string,
  layout: StoredPageMapLayout
): void {
  try {
    globalThis.localStorage?.setItem(
      pageMapLayoutKey(userId, projectId),
      JSON.stringify(layout)
    );
  } catch {
    // The workspace remains usable when storage is blocked or full.
  }
}
