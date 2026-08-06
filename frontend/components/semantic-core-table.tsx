"use client";

import { CustomSelect } from "./custom-select";

import {
  semanticKeywordDefaultPageSize,
  semanticKeywordPageSizes,
  type SemanticKeywordPageSize,
  type SemanticKeywordBulkCreateItemInput,
  type SemanticKeywordBulkCreateResult,
  type FrequencyCollectionSummary,
  type RankJobSummary
} from "@seo-platform/contracts";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  browserApiCollectionRequest,
  browserApiDownload,
  BrowserApiError,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";
import { externalPageUrlPresentation } from "../lib/app-path";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  manualKeywordInputStats,
  manualKeywordTexts,
  runManualKeywordBulkChunks
} from "../lib/manual-keyword-input";
import {
  initialSemanticCreateGroupId,
  semanticClipboardText,
  semanticHighlightAfterRowClick,
  toggleSemanticHighlightedSelection
} from "../lib/semantic-row-selection";
import { rankChangePresentation } from "../lib/semantic-rank-presentation";
import {
  clampSemanticColumnWidth,
  clampSemanticGroupSidebarWidth,
  normalizeSemanticKeywordPageSize,
  readSemanticLayoutPreferences,
  semanticColumnDefaultWidth,
  semanticColumnMaxWidth,
  semanticColumnMinWidth,
  semanticGroupSidebarDefaultWidth,
  semanticGroupSidebarMaxWidth,
  semanticGroupSidebarMinWidth,
  writeSemanticLayoutPreferences
} from "../lib/semantic-layout-preferences";
import { SemanticBulkEditor } from "./semantic-bulk-editor";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import type { SemanticCustomColumn } from "./semantic-custom-column-types";
import { SemanticCustomValueEditor } from "./semantic-custom-value-editor";
import {
  SemanticGroupDialog,
  type SemanticGroupDialogState
} from "./semantic-group-dialog";
import {
  SemanticGroupTree,
  type SemanticGroupTreeDropTarget,
  type SemanticGroupTreeItem
} from "./semantic-group-tree";
import { SemanticKeywordMoveDialog } from "./semantic-keyword-move-dialog";
import { SemanticKeywordInspector } from "./semantic-keyword-inspector";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { SemanticFrequencyDialog } from "./semantic-frequency-dialog";
import { SemanticOperationsDrawer } from "./semantic-operations-drawer";
import { SemanticLayoutDrawer } from "./semantic-layout-drawer";
import { SemanticNegativeKeywordsDialog } from "./semantic-negative-keywords-dialog";
import { SemanticModal } from "./semantic-modal";
import {
  SemanticTrashRecoveryDialog,
  type SemanticTrashRecoveryItem
} from "./semantic-trash-recovery-dialog";
import { SemanticVersionHistory } from "./semantic-version-history";
import { SearchEngineLogo } from "./search-engine-logo";
import { KeywordDataGrid } from "./keyword-data-grid";
import { Icon } from "./icon";
import { ProjectSelectOption } from "./project-select-option";
import type { AppProject } from "../lib/app-types";
import {
  defaultSemanticViewConfig,
  semanticFolderSortFor,
  semanticFolderSortViewName,
  semanticFolderSortViewPrefix,
  semanticProjectTableViewName,
  type SemanticKeywordIntent,
  type SemanticKeywordSort,
  type SemanticSavedView,
  type SemanticSystemColumn,
  type SemanticViewColumn,
  type SemanticViewConfig,
  type SemanticViewFilters
} from "./semantic-view-types";

interface SemanticKeyword {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly hasNote?: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly groupPath?: string;
  readonly clusterId?: string;
  readonly clusterName?: string;
  readonly targetPageId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly frequency?: Readonly<{
    value?: string;
    regionCode: string;
    device: "ALL" | "DESKTOP" | "MOBILE";
    provider: string;
    observedAt: string;
  }>;
  readonly frequencies?: readonly Readonly<{
    type: "BASE" | "EXACT" | "FIXED";
    value?: string;
    regionCode: string;
    device: "ALL" | "DESKTOP" | "MOBILE";
    provider: string;
    observedAt: string;
  }>[];
  readonly positions?: readonly Readonly<{
    searchEngine: "GOOGLE" | "YANDEX";
    found: boolean;
    position?: number;
    previousPosition?: number;
    rankingUrl?: string;
    observedAt: string;
  }>[];
  readonly customValues?: readonly Readonly<{
    columnId: string;
    value: string | number | boolean | readonly string[];
    version: number;
    updatedAt: string;
  }>[];
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
  readonly trashed?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

interface SemanticKeywordGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
  readonly systemKind?: "UNGROUPED" | "TRASH";
  readonly version: number;
}

interface SemanticCluster {
  readonly id: string;
  readonly name: string;
  readonly keywordCount: number;
  readonly version: number;
}

interface KeywordDraft {
  readonly text: string;
  readonly language: string;
  readonly priority: string;
  readonly isFavorite: boolean;
  readonly skipDuplicates: boolean;
  readonly intent: "" | SemanticKeywordIntent;
  readonly groupId: string;
  readonly clusterId: string;
  readonly targetUrl: string;
  readonly tagNames: string;
}

type KeywordEditor =
  | Readonly<{ mode: "create"; draft: KeywordDraft }>
  | Readonly<{
      mode: "edit";
      keywordId: string;
      version: number;
      draft: KeywordDraft;
    }>;

const MANUAL_KEYWORD_LIMIT = 2_000;

interface SemanticCoreTableProps {
  readonly columnRefreshVersion: number;
  readonly clusterRefreshVersion: number;
  readonly projectId: string;
  readonly refreshVersion: number;
  readonly groupRefreshVersion: number;
  readonly onGroupsChanged: () => void;
  readonly onOpenColumns: () => void;
  readonly onOpenImport: () => void;
  readonly projectName: string;
  readonly projects: readonly Pick<AppProject, "domain" | "id" | "name">[];
  readonly workspaceId: string;
}

type SemanticExportFormat =
  | "CSV"
  | "TSV"
  | "JSON"
  | "NDJSON"
  | "GOOGLE_CSV";

type SemanticExportScope = "CURRENT_FILTER" | "SELECTED" | "GROUP_SUBTREE";

interface SemanticExportDialogState {
  readonly groupId?: string;
}

export function SemanticCoreTable({
  columnRefreshVersion,
  clusterRefreshVersion,
  projectId,
  refreshVersion,
  groupRefreshVersion,
  onGroupsChanged,
  onOpenColumns,
  onOpenImport,
  projectName,
  projects,
  workspaceId
}: SemanticCoreTableProps) {
  const [items, setItems] = useState<readonly SemanticKeyword[]>([]);
  const [page, setPage] = useState<BrowserCursorPage>({
    hasNext: false
  });
  const [rootTotal, setRootTotal] = useState<number>();
  const [draftConfig, setDraftConfig] = useState<SemanticViewConfig>(
    defaultSemanticViewConfig
  );
  const [viewConfig, setViewConfig] = useState<SemanticViewConfig>(
    defaultSemanticViewConfig
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  const [editor, setEditor] = useState<KeywordEditor>();
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [trashRecoveryItems, setTrashRecoveryItems] = useState<
    readonly SemanticTrashRecoveryItem[]
  >([]);
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [clusters, setClusters] = useState<readonly SemanticCluster[]>([]);
  const [customColumns, setCustomColumns] = useState<
    readonly SemanticCustomColumn[]
  >([]);
  const [customValueEditor, setCustomValueEditor] = useState<Readonly<{
    keyword: SemanticKeyword;
    column: SemanticCustomColumn;
  }>>();
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [bulkNotice, setBulkNotice] = useState<string>();
  const [exportFormat, setExportFormat] =
    useState<SemanticExportFormat>("CSV");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string>();
  const [exportDialog, setExportDialog] = useState<SemanticExportDialogState>();
  const [exportScope, setExportScope] =
    useState<SemanticExportScope>("CURRENT_FILTER");
  const [exportColumns, setExportColumns] = useState<readonly SemanticViewColumn[]>(
    defaultSemanticViewConfig.columns
  );
  const [exportBom, setExportBom] = useState(true);
  const [projectTableView, setProjectTableView] = useState<SemanticSavedView>();
  const [folderSortViews, setFolderSortViews] = useState<
    readonly SemanticSavedView[]
  >([]);
  const [savingTableLayout, setSavingTableLayout] = useState(false);
  const [savingFolderSort, setSavingFolderSort] = useState(false);
  const [groupSidebarWidth, setGroupSidebarWidth] = useState(
    semanticGroupSidebarDefaultWidth
  );
  const [columnWidths, setColumnWidths] = useState<
    Readonly<Record<string, number>>
  >({});
  const [pageSize, setPageSize] = useState<SemanticKeywordPageSize>(
    semanticKeywordDefaultPageSize
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string> | null>(
    null
  );
  const layoutPreferencesRef = useRef({
    groupSidebarWidth: semanticGroupSidebarDefaultWidth,
    columnWidths: {} as Readonly<Record<string, number>>,
    pageSize: semanticKeywordDefaultPageSize as SemanticKeywordPageSize,
    expandedGroupIds: null as readonly string[] | null
  });
  const [rightSidebar, setRightSidebar] = useState<
    | Readonly<{ type: "KEYWORD"; keywordId: string }>
    | Readonly<{ type: "HISTORY" | "OPERATIONS" | "LAYOUT" }>
  >();
  const [groupDialog, setGroupDialog] = useState<SemanticGroupDialogState>();
  const [moveKeywordDialog, setMoveKeywordDialog] = useState(false);
  const [moveKeywordTargetId, setMoveKeywordTargetId] = useState("");
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [actionIds, setActionIds] = useState<ReadonlySet<string> | null>(null);
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [frequencyDialogOpen, setFrequencyDialogOpen] = useState(false);
  const [negativeKeywordsOpen, setNegativeKeywordsOpen] = useState(false);
  const [watchedFrequencyId, setWatchedFrequencyId] = useState<string>();
  const [operationsRefreshVersion, setOperationsRefreshVersion] = useState(0);
  const [rowContextMenu, setRowContextMenu] = useState<Readonly<{
    item: SemanticKeyword;
    targetIds: readonly string[];
    x: number;
    y: number;
  }>>();
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const highlightAnchorIdRef = useRef<string | undefined>(undefined);
  const liveOperationSignatureRef = useRef("");
  const liveMetricRefreshInFlightRef = useRef(false);
  const liveOperationActiveRef = useRef(false);
  const [tableViewport, setTableViewport] = useState({
    height: 520,
    scrollTop: 0
  });
  const keywordQueryConfig = useMemo(
    () => ({ filters: viewConfig.filters, sort: viewConfig.sort }),
    [viewConfig.filters, viewConfig.sort]
  );
  const debouncedSearch = useDebouncedValue(
    draftConfig.filters.search ?? "",
    300
  );

  useEffect(() => {
    applySearch(debouncedSearch);
  }, [debouncedSearch]);

  useEffect(() => {
    const preferences = readSemanticLayoutPreferences(
      projectId,
      window.localStorage
    );
    layoutPreferencesRef.current = preferences;
    setGroupSidebarWidth(preferences.groupSidebarWidth);
    setColumnWidths(preferences.columnWidths);
    setPageSize(preferences.pageSize);
    setExpandedGroupIds(
      preferences.expandedGroupIds
        ? new Set(preferences.expandedGroupIds)
        : null
    );
  }, [projectId]);

  useEffect(() => {
    if (!rightSidebar) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          ".semantic-keyword-inspector, .semantic-operations-drawer, .semantic-history-drawer, .semantic-layout-drawer, .semantic-modal, [data-semantic-sidebar-trigger]"
        )
      ) {
        return;
      }
      setRightSidebar(undefined);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector(".semantic-modal[open]")
      ) {
        setRightSidebar(undefined);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [rightSidebar]);

  useEffect(() => {
    const controller = new AbortController();
    setRootTotal(undefined);
    void loadKeywordPage(
      projectId,
      {
        filters: {},
        sort: defaultSemanticViewConfig.sort
      },
      undefined,
      controller.signal,
      1
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setRootTotal(result.page.totalApprox ?? result.data.length);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, refreshVersion, retryVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const preservedScrollTop = tableScrollRef.current?.scrollTop ?? 0;
    setCheckedIds(new Set());
    setHighlightedIds(new Set());
    highlightAnchorIdRef.current = undefined;
    setLoading(true);
    setError(undefined);
    void loadKeywordPage(
      projectId,
      keywordQueryConfig,
      undefined,
      controller.signal,
      pageSize
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.data);
        setPage(result.page);
        window.requestAnimationFrame(() => {
          const viewport = tableScrollRef.current;
          if (!viewport) return;
          const nextScrollTop = Math.min(
            preservedScrollTop,
            Math.max(0, viewport.scrollHeight - viewport.clientHeight)
          );
          viewport.scrollTop = nextScrollTop;
          setTableViewport({
            height: viewport.clientHeight,
            scrollTop: nextScrollTop
          });
        });
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(keywordErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [keywordQueryConfig, pageSize, projectId, refreshVersion, retryVersion]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    liveOperationSignatureRef.current = "";
    const reconcile = async (): Promise<boolean> => {
      const [frequencyResult, rankResult] = await Promise.allSettled([
        browserApiRequest<{ readonly collections: readonly FrequencyCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
          { signal: controller.signal }
        ),
        browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`,
          { signal: controller.signal }
        )
      ]);
      if (controller.signal.aborted) return liveOperationActiveRef.current;
      const frequencies = frequencyResult.status === "fulfilled"
        ? frequencyResult.value.collections
        : [];
      const ranks = rankResult.status === "fulfilled" ? rankResult.value.jobs : [];
      const active = frequencies.some(({ status }) => ![
        "ACTION_REQUIRED",
        "CANCELLED",
        "PARTIALLY_COMPLETED",
        "COMPLETED",
        "FAILED_FINAL"
      ].includes(status)) || ranks.some(({ status }) => ![
        "COMPLETED",
        "PARTIALLY_COMPLETED",
        "CANCELLED",
        "FAILED",
        "ACTION_REQUIRED"
      ].includes(status));
      liveOperationActiveRef.current = active;
      const signature = JSON.stringify([
        ...frequencies.map((job) => [
          "frequency",
          job.id,
          job.status,
          job.completedKeywords,
          job.failedKeywords,
          job.updatedAt
        ]),
        ...ranks.map((job) => [
          "rank",
          job.id,
          job.status,
          job.progress.current,
          job.progress.total,
          "finishedAt" in job ? job.finishedAt : undefined
        ])
      ]);
      const previous = liveOperationSignatureRef.current;
      liveOperationSignatureRef.current = signature;
      if (!previous || previous === signature || liveMetricRefreshInFlightRef.current) return active;
      liveMetricRefreshInFlightRef.current = true;
      try {
        const result = await loadKeywordPage(
          projectId,
          keywordQueryConfig,
          undefined,
          controller.signal,
          Math.min(1_000, Math.max(pageSize, items.length))
        );
        if (!controller.signal.aborted) {
          setItems((current) => mergeKeywordMetrics(current, result.data));
        }
      } finally {
        liveMetricRefreshInFlightRef.current = false;
      }
      return active;
    };
    const poll = async () => {
      let active = liveOperationActiveRef.current;
      try {
        active = await reconcile();
      } catch {
        // The table keeps its last authoritative projection while a bounded
        // reconciliation request is temporarily unavailable.
      }
      if (controller.signal.aborted) return;
      timer = window.setTimeout(
        () => void poll(),
        document.visibilityState === "visible" ? (active ? 2_000 : 15_000) : 30_000
      );
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, [items.length, keywordQueryConfig, operationsRefreshVersion, pageSize, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly SemanticKeywordGroup[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setGroups(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGroups([]);
      });
    return () => controller.abort();
  }, [groupRefreshVersion, projectId, retryVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly SemanticCluster[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/clusters`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setClusters(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setClusters([]);
      });
    return () => controller.abort();
  }, [clusterRefreshVersion, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly SemanticCustomColumn[]>(
      `/app/api/projects/${encodeURIComponent(
        projectId
      )}/semantic-custom-columns`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setCustomColumns(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCustomColumns([]);
      });
    return () => controller.abort();
  }, [columnRefreshVersion, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setProjectTableView(undefined);
    setFolderSortViews([]);
    void browserApiRequest<readonly SemanticSavedView[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
      { signal: controller.signal }
    )
      .then((views) => {
        if (controller.signal.aborted) return;
        const projectView = views.find(
          ({ name, scope }) =>
            name === semanticProjectTableViewName && scope === "PROJECT_SHARED"
        );
        const sortViews = views.filter(
          ({ name, scope }) =>
            name.startsWith(semanticFolderSortViewPrefix) &&
            scope === "PROJECT_SHARED"
        );
        setProjectTableView(projectView);
        setFolderSortViews(sortViews);
        setDraftConfig((current) => ({
          ...current,
          ...(projectView
            ? {
                columns: projectView.config.columns,
                density: projectView.config.density
              }
            : {}),
          sort: folderSortFor(current.filters.groupId, sortViews)
        }));
        setViewConfig((current) => ({
          ...current,
          ...(projectView
            ? {
                columns: projectView.config.columns,
                density: projectView.config.density
              }
            : {}),
          sort: folderSortFor(current.filters.groupId, sortViews)
        }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (!bulkNotice && !exportNotice) return;
    const timer = window.setTimeout(() => {
      setBulkNotice(undefined);
      setExportNotice(undefined);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [bulkNotice, exportNotice]);

  useEffect(() => {
    const copySelectedKeywords = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase("en") !== "c" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        isEditableCopyTarget(event.target) ||
        window.getSelection()?.toString()
      ) {
        return;
      }
      const clipboardText = semanticClipboardText(items, highlightedIds);
      if (!clipboardText) return;
      event.preventDefault();
      void navigator.clipboard
        .writeText(clipboardText)
        .then(() =>
          setBulkNotice(
            `Скопировано запросов: ${formatInteger(highlightedIds.size)}`
          )
        )
        .catch(() =>
          setMutationError(
            "Браузер не разрешил доступ к буферу обмена. Проверьте разрешение сайта."
          )
        );
    };
    document.addEventListener("keydown", copySelectedKeywords);
    return () => document.removeEventListener("keydown", copySelectedKeywords);
  }, [highlightedIds, items]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { search: draftSearch, ...otherFilters } = draftConfig.filters;
    const search = draftSearch?.trim();
    setViewConfig({
      ...draftConfig,
      sort: folderSortFor(otherFilters.groupId),
      filters: {
        ...otherFilters,
        ...(search ? { search } : {})
      }
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    applySearch(draftConfig.filters.search ?? "");
  }

  function applySearch(value: string): void {
    const search = value.trim();
    setViewConfig((current) => {
      const { search: ignored, ...filters } = current.filters;
      void ignored;
      const nextFilters = search ? { ...filters, search } : filters;
      if ((current.filters.search ?? "") === (search || "")) return current;
      return { ...current, filters: nextFilters };
    });
  }

  function clearSearch(): void {
    setDraftConfig((current) => {
      const { search: ignored, ...filters } = current.filters;
      void ignored;
      return { ...current, filters };
    });
    applySearch("");
  }

  function clearFilters(): void {
    const reset = (current: SemanticViewConfig): SemanticViewConfig => ({
      ...current,
      filters: {},
      sort: folderSortFor(undefined)
    });
    setDraftConfig((current) => reset(current));
    setViewConfig((current) => reset(current));
  }

  function updateFilter(patch: Partial<SemanticViewFilters>): void {
    setDraftConfig((current) => ({
      ...current,
      filters: { ...current.filters, ...patch }
    }));
  }

  function updateBooleanFilter(
    field: "isFavorite" | "isTracked",
    value: string
  ): void {
    setDraftConfig((current) => {
      const { [field]: ignored, ...rest } = current.filters;
      void ignored;
      return {
        ...current,
        filters:
          value === ""
            ? rest
            : { ...rest, [field]: value === "true" }
      };
    });
  }

  function updateOptionalFilter(
    field: "intent" | "groupId" | "clusterId",
    value: string
  ): void {
    setDraftConfig((current) => {
      const { [field]: ignored, ...rest } = current.filters;
      void ignored;
      return {
        ...current,
        filters:
          value === ""
            ? rest
            : { ...rest, [field]: value }
      } as SemanticViewConfig;
    });
  }

  function selectGroup(groupId?: string): void {
    const apply = (current: SemanticViewConfig): SemanticViewConfig => {
      const { groupId: ignored, ...filters } = current.filters;
      void ignored;
      return {
        ...current,
        sort: folderSortFor(groupId),
        filters: groupId ? { ...filters, groupId } : filters
      };
    };
    setDraftConfig((current) => apply(current));
    setViewConfig((current) => apply(current));
    setCheckedIds(new Set());
    setBulkNotice(undefined);
  }

  function folderSortFor(
    groupId?: string,
    views: readonly SemanticSavedView[] = folderSortViews
  ): SemanticKeywordSort {
    return semanticFolderSortFor(groupId, views);
  }

  async function changeFolderSort(sort: SemanticKeywordSort): Promise<void> {
    if (savingFolderSort || sort === viewConfig.sort) return;
    const groupId = viewConfig.filters.groupId;
    const viewName = semanticFolderSortViewName(groupId);
    const config: SemanticViewConfig = {
      ...defaultSemanticViewConfig,
      filters: groupId ? { groupId } : {},
      sort
    };
    setDraftConfig((current) => ({ ...current, sort }));
    setViewConfig((current) => ({ ...current, sort }));
    setSavingFolderSort(true);
    setMutationError(undefined);
    try {
      let currentView = folderSortViews.find(({ name }) => name === viewName);
      let saved: SemanticSavedView;
      try {
        saved = currentView
          ? await browserApiRequest<SemanticSavedView>(
              `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(currentView.id)}`,
              {
                method: "PATCH",
                body: { config },
                ifMatch: currentView.version
              }
            )
          : await browserApiRequest<SemanticSavedView>(
              `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
              {
                method: "POST",
                body: { name: viewName, scope: "PROJECT_SHARED", config }
              }
            );
      } catch (requestError) {
        if (
          !(requestError instanceof BrowserApiError) ||
          ![409, 412].includes(requestError.status)
        ) {
          throw requestError;
        }
        const latestViews = await browserApiRequest<readonly SemanticSavedView[]>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`
        );
        currentView = latestViews.find(
          ({ name, scope }) =>
            name === viewName && scope === "PROJECT_SHARED"
        );
        if (!currentView) throw requestError;
        saved = await browserApiRequest<SemanticSavedView>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(currentView.id)}`,
          {
            method: "PATCH",
            body: { config },
            ifMatch: currentView.version
          }
        );
      }
      setFolderSortViews((current) => [
        ...current.filter(({ name }) => name !== saved.name),
        saved
      ]);
      setBulkNotice(
        groupId
          ? "Сортировка сохранена для выбранной группы"
          : "Сортировка сохранена для корневого уровня"
      );
    } catch (requestError) {
      const previousSort = folderSortFor(groupId);
      setDraftConfig((current) => ({ ...current, sort: previousSort }));
      setViewConfig((current) => ({ ...current, sort: previousSort }));
      setMutationError(keywordErrorMessage(requestError));
    } finally {
      setSavingFolderSort(false);
    }
  }

  function updatePriorityFilter(
    field: "priorityMin" | "priorityMax",
    value: string
  ): void {
    setDraftConfig((current) => {
      const { [field]: ignored, ...rest } = current.filters;
      void ignored;
      return {
        ...current,
        filters:
          value === ""
            ? rest
            : { ...rest, [field]: Number(value) }
      };
    });
  }

  function toggleColumn(column: SemanticViewColumn): void {
    if (column === "query") return;
    setDraftConfig((current) => ({
      ...current,
      columns: current.columns.includes(column)
        ? current.columns.filter((item) => item !== column)
        : [...current.columns, column]
    }));
  }

  function moveColumn(column: SemanticViewColumn, target: SemanticViewColumn): void {
    if (column === target) return;
    setDraftConfig((current) => {
      const columns = [...current.columns];
      const sourceIndex = columns.indexOf(column);
      const targetIndex = columns.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      columns.splice(sourceIndex, 1);
      columns.splice(targetIndex, 0, column);
      return { ...current, columns };
    });
  }

  function persistLayoutPreferences(
    nextGroupSidebarWidth = layoutPreferencesRef.current.groupSidebarWidth,
    nextColumnWidths = layoutPreferencesRef.current.columnWidths,
    nextPageSize = layoutPreferencesRef.current.pageSize,
    nextExpandedGroupIds = layoutPreferencesRef.current.expandedGroupIds
  ): void {
    const preferences = {
      groupSidebarWidth: nextGroupSidebarWidth,
      columnWidths: nextColumnWidths,
      pageSize: nextPageSize,
      expandedGroupIds: nextExpandedGroupIds
    };
    layoutPreferencesRef.current = preferences;
    writeSemanticLayoutPreferences(projectId, preferences, window.localStorage);
  }

  function resizeSemanticColumn(
    column: SemanticViewColumn,
    width: number,
    persist: boolean
  ): void {
    const nextColumnWidths = {
      ...layoutPreferencesRef.current.columnWidths,
      [column]: clampSemanticColumnWidth(column, width)
    };
    layoutPreferencesRef.current = {
      ...layoutPreferencesRef.current,
      columnWidths: nextColumnWidths
    };
    setColumnWidths(nextColumnWidths);
    if (persist) persistLayoutPreferences(undefined, nextColumnWidths);
  }

  function updateGroupSidebarWidth(width: number, persist: boolean): void {
    const nextWidth = clampSemanticGroupSidebarWidth(width);
    layoutPreferencesRef.current = {
      ...layoutPreferencesRef.current,
      groupSidebarWidth: nextWidth
    };
    setGroupSidebarWidth(nextWidth);
    if (persist) persistLayoutPreferences(nextWidth);
  }

  function updatePageSize(value: string): void {
    const nextPageSize = normalizeSemanticKeywordPageSize(Number(value));
    if (nextPageSize === pageSize) return;
    layoutPreferencesRef.current = {
      ...layoutPreferencesRef.current,
      pageSize: nextPageSize
    };
    setPageSize(nextPageSize);
    persistLayoutPreferences(undefined, undefined, nextPageSize);
  }

  function updateExpandedGroupIds(next: ReadonlySet<string>): void {
    const persistedIds = [...next];
    layoutPreferencesRef.current = {
      ...layoutPreferencesRef.current,
      expandedGroupIds: persistedIds
    };
    setExpandedGroupIds(next);
    persistLayoutPreferences(undefined, undefined, undefined, persistedIds);
  }

  function startGroupSidebarResize(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = layoutPreferencesRef.current.groupSidebarWidth;
    let nextWidth = startWidth;
    let finished = false;
    const onPointerMove = (moveEvent: PointerEvent) => {
      nextWidth = clampSemanticGroupSidebarWidth(
        startWidth + moveEvent.clientX - startX
      );
      updateGroupSidebarWidth(nextWidth, false);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      document.body.classList.remove("semantic-sidebar-resizing");
      updateGroupSidebarWidth(nextWidth, true);
    };
    document.body.classList.add("semantic-sidebar-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("blur", finish, { once: true });
    handle.addEventListener("lostpointercapture", finish, { once: true });
    handle.setPointerCapture(pointerId);
  }

  function resizeGroupSidebarFromKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void {
    const current = layoutPreferencesRef.current.groupSidebarWidth;
    const next =
      event.key === "Home"
        ? semanticGroupSidebarMinWidth
        : event.key === "End"
          ? semanticGroupSidebarMaxWidth
          : event.key === "ArrowLeft"
            ? current - (event.shiftKey ? 40 : 12)
            : event.key === "ArrowRight"
              ? current + (event.shiftKey ? 40 : 12)
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    updateGroupSidebarWidth(next, true);
  }

  async function applyTableLayout(): Promise<void> {
    if (savingTableLayout) return;
    const layoutConfig: SemanticViewConfig = {
      ...defaultSemanticViewConfig,
      columns: draftConfig.columns,
      density: draftConfig.density
    };
    setViewConfig((current) => ({
      ...current,
      columns: layoutConfig.columns,
      density: layoutConfig.density
    }));
    setSavingTableLayout(true);
    setMutationError(undefined);
    try {
      const saved = projectTableView
        ? await browserApiRequest<SemanticSavedView>(
            `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(projectTableView.id)}`,
            {
              method: "PATCH",
              body: { config: layoutConfig },
              ifMatch: projectTableView.version
            }
          )
        : await browserApiRequest<SemanticSavedView>(
            `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
            {
              method: "POST",
              body: {
                name: semanticProjectTableViewName,
                scope: "PROJECT_SHARED",
                config: layoutConfig
              }
            }
          );
      setProjectTableView(saved);
      setBulkNotice("Порядок колонок и плотность сохранены для всего проекта");
    } catch (requestError) {
      setMutationError(keywordErrorMessage(requestError));
    } finally {
      setSavingTableLayout(false);
    }
  }

  function applySavedView(view: SemanticSavedView): void {
    setDraftConfig(view.config);
    setViewConfig(view.config);
  }

  async function refreshFrequencyMetrics(): Promise<void> {
    try {
      const result = await loadKeywordPage(
        projectId,
        viewConfig,
        undefined,
        undefined,
        pageSize
      );
      setItems(result.data);
      setPage(result.page);
      setBulkNotice(
        "Сбор частотности завершён. Актуальные значения загружены в таблицу."
      );
    } catch (requestError) {
      setMutationError(keywordErrorMessage(requestError));
    }
  }

  async function loadMore(): Promise<void> {
    if (!page.hasNext || !page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const result = await loadKeywordPage(
        projectId,
        viewConfig,
        page.nextCursor,
        undefined,
        pageSize
      );
      setItems((current) => mergeKeywords(current, result.data));
      setPage({
        ...result.page,
        ...(result.page.totalApprox === undefined &&
        page.totalApprox !== undefined
          ? { totalApprox: page.totalApprox }
          : {})
      });
    } catch (requestError) {
      setError(keywordErrorMessage(requestError));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const scrollRoot = tableScrollRef.current;
    if (!sentinel || !scrollRoot || !page.hasNext || !page.nextCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { root: scrollRoot, rootMargin: "280px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  useEffect(() => {
    const scrollRoot = tableScrollRef.current;
    if (!scrollRoot) return;
    const updateHeight = () =>
      setTableViewport((current) => ({
        ...current,
        height: scrollRoot.clientHeight
      }));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [loading, items.length]);

  function openCreate(): void {
    setCheckedIds(new Set());
    setBulkNotice(undefined);
    setMutationError(undefined);
    setEditor({
      mode: "create",
      draft: {
        text: "",
        language: "ru",
        priority: "0",
        isFavorite: false,
        skipDuplicates: true,
        intent: "",
        groupId: initialSemanticCreateGroupId(
          viewConfig.filters.groupId,
          groups
        ),
        clusterId: "",
        targetUrl: "",
        tagNames: ""
      }
    });
  }

  function openEdit(item: SemanticKeyword): void {
    setCheckedIds(new Set());
    setBulkNotice(undefined);
    setMutationError(undefined);
    setEditor({
      mode: "edit",
      keywordId: item.id,
      version: item.version,
      draft: {
        text: item.textOriginal,
        language: item.language,
        priority: String(item.priority),
        isFavorite: item.isFavorite,
        skipDuplicates: true,
        intent: item.intent ?? "",
        groupId: item.groupId ?? "",
        clusterId: item.clusterId ?? "",
        targetUrl: item.targetUrl ?? "",
        tagNames: item.tags.join(", ")
      }
    });
  }

  function updateDraft(patch: Partial<KeywordDraft>): void {
    setEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current
    );
  }

  async function saveKeyword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || saving) return;
    const draft = editor.draft;
    const texts = editor.mode === "create"
      ? manualKeywordTexts(draft.text, draft.skipDuplicates)
      : [draft.text.trim()];
    if (texts.length < 1 || texts.length > MANUAL_KEYWORD_LIMIT) {
      setMutationError(
        `Введите от 1 до ${formatInteger(MANUAL_KEYWORD_LIMIT)} запросов, по одному в строке.`
      );
      return;
    }
    if (texts.some((text) => text.length > 2_000)) {
      setMutationError("Длина каждого запроса не должна превышать 2000 символов.");
      return;
    }
    setSaving(true);
    setMutationError(undefined);
    const commonBody = {
      language: draft.language,
      priority: Number(draft.priority),
      isFavorite: draft.isFavorite,
      ...(draft.intent ? { intent: draft.intent } : editor.mode === "edit"
        ? { intent: null }
        : {}),
      ...(draft.groupId
        ? { groupId: draft.groupId }
        : editor.mode === "edit"
          ? { groupId: null }
          : {}),
      ...(draft.clusterId
        ? { clusterId: draft.clusterId }
        : editor.mode === "edit"
          ? { clusterId: null }
          : {}),
      ...(draft.targetUrl
        ? { targetUrl: draft.targetUrl }
        : editor.mode === "edit"
          ? { targetUrl: null }
          : {}),
      tagNames: parseTagNames(draft.tagNames)
    };
    try {
      if (editor.mode === "create") {
        const inputStats = manualKeywordInputStats(draft.text);
        const result = await runManualKeywordBulkChunks(
          texts,
          async (chunk) =>
            browserApiRequest<SemanticKeywordBulkCreateResult>(
              `/app/api/projects/${encodeURIComponent(projectId)}/keywords/bulk`,
              {
                method: "POST",
                body: {
                  duplicatePolicy: draft.skipDuplicates
                    ? "SKIP_EXISTING"
                    : "REJECT_EXISTING",
                  items: chunk.map((text) => ({ ...commonBody, text }))
                }
              }
            )
        );
        const locallySkipped = draft.skipDuplicates ? inputStats.duplicates : 0;
        setRetryVersion((value) => value + 1);
        setBulkNotice(
          `Добавлено: ${result.created} · восстановлено: ${result.restored} · ` +
            `пропущено: ${result.skipped + locallySkipped}`
        );
        if (result.retryRows.length > 0) {
          setEditor((current) => current && current.mode === "create"
            ? { ...current, draft: { ...current.draft, text: result.retryRows.join("\n") } }
            : current);
          setMutationError(
            result.transportError
              ? `Соединение прервано после ${result.selected} запросов. ` +
                  "В форме оставлены неподтверждённые и необработанные строки. " +
                  keywordMutationError(result.transportError)
              : `Не добавлено: ${result.rejected + result.failed}. ` +
                  "В форме оставлены дубли и строки с ошибками — исправьте их или удалите."
          );
          return;
        }
        if (result.trashCandidates.length > 0) {
          setTrashRecoveryItems(
            result.trashCandidates.map(({ keywordId, text }) => ({
              keywordId,
              text,
              input: {
                ...commonBody,
                text
              } as SemanticKeywordBulkCreateItemInput
            }))
          );
        }
      } else {
        await browserApiRequest<SemanticKeyword>(
          `/app/api/projects/${encodeURIComponent(
            projectId
          )}/keywords/${encodeURIComponent(editor.keywordId)}`,
          {
            method: "PATCH",
            body: { ...commonBody, text: texts[0] },
            ifMatch: editor.version
          }
        );
        setRetryVersion((value) => value + 1);
      }
      setEditor(undefined);
    } catch (requestError) {
      setMutationError(keywordMutationError(requestError));
    } finally {
      setSaving(false);
    }
  }

  function toggleSelection(keywordId: string): void {
    setBulkNotice(undefined);
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(keywordId)) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  function selectKeywordRow(
    item: SemanticKeyword,
    event: MouseEvent<HTMLElement>
  ): void {
    setBulkNotice(undefined);
    const highlight = semanticHighlightAfterRowClick(
      items.map(({ id }) => id),
      highlightAnchorIdRef.current,
      item.id,
      event.shiftKey
    );
    highlightAnchorIdRef.current = highlight.anchorId;
    setHighlightedIds(highlight.highlightedIds);
    setRightSidebar({ type: "KEYWORD", keywordId: item.id });
  }

  function toggleKeywordRow(
    item: SemanticKeyword,
    _event: MouseEvent<HTMLInputElement>
  ): void {
    toggleSelection(item.id);
  }

  function toggleVisibleSelection(): void {
    setBulkNotice(undefined);
    const visibleIds = items.map(({ id }) => id);
    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => checkedIds.has(id));
    setCheckedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function toggleHighlightedSelection(): void {
    setBulkNotice(undefined);
    setCheckedIds((current) =>
      toggleSemanticHighlightedSelection(current, highlightedIds)
    );
  }

  function openExport(groupId?: string): void {
    setExportDialog(groupId ? { groupId } : {});
    setExportScope(
      groupId
        ? "GROUP_SUBTREE"
        : checkedIds.size > 0
          ? "SELECTED"
          : "CURRENT_FILTER"
    );
    setExportColumns(viewConfig.columns);
    setExportBom(exportFormat === "CSV" || exportFormat === "TSV");
  }

  async function downloadExport(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExportNotice(undefined);
    setMutationError(undefined);
    const groupId = exportDialog?.groupId;
    const selected = exportScope === "SELECTED"
      ? items
          .filter(({ id }) => checkedIds.has(id))
          .map(({ id }) => id)
      : [];
    try {
      const download = await browserApiDownload(
        `/app/api/projects/${encodeURIComponent(projectId)}/exports`,
        {
          body: {
            format: exportFormat,
            scope: exportScope,
            locale: "ru",
            columns: exportColumns,
            ...(groupId
              ? { filters: { groupId } }
              : selected.length > 0
              ? { keywordIds: selected }
              : { filters: viewConfig.filters }),
            sort: viewConfig.sort,
            includeBom: exportBom
          }
        }
      );
      saveBrowserDownload(download.blob, download.filename);
      setExportNotice(
        `Экспорт готов: ${formatInteger(download.rowCount ?? 0)} строк`
      );
      setExportDialog(undefined);
    } catch (requestError) {
      setMutationError(keywordErrorMessage(requestError));
    } finally {
      setExporting(false);
    }
  }

  async function deleteSelectedKeywords(ids: ReadonlySet<string>): Promise<void> {
    if (saving || ids.size === 0) return;
    setSaving(true);
    setMutationError(undefined);
    const selected = items.filter(({ id }) => ids.has(id));
    const permanent = groups.some(
      ({ id, systemKind }) =>
        id === viewConfig.filters.groupId && systemKind === "TRASH"
    );
    const results: PromiseSettledResult<void>[] = [];
    for (let offset = 0; offset < selected.length; offset += 8) {
      const batch = selected.slice(offset, offset + 8);
      results.push(
        ...(await Promise.allSettled(
          batch.map((item) =>
            browserApiRequest<void>(
              `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}`,
              {
                method: "DELETE",
                ifMatch: item.version,
                body: permanent ? { permanent: true } : {}
              }
            )
          )
        ))
      );
    }
    const deletedIds = new Set(
      results.flatMap((result, index) =>
        result.status === "fulfilled" && selected[index]
          ? [selected[index].id]
          : []
      )
    );
    setItems((current) => current.filter(({ id }) => !deletedIds.has(id)));
    setCheckedIds(new Set());
    setActionIds(null);
    setDeleteSelectionOpen(false);
    setSaving(false);
    if (deletedIds.size !== selected.length) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );
      setMutationError(
        `Удалено ${deletedIds.size} из ${selected.length}. ${
          firstFailure
            ? keywordMutationError(firstFailure.reason)
            : "Остальные строки были изменены или недоступны."
        } Таблица обновлена.`
      );
    } else {
      setBulkNotice(
        permanent
          ? `Навсегда удалено запросов: ${deletedIds.size}`
          : `Перемещено в корзину: ${deletedIds.size}`
      );
    }
    setRetryVersion((value) => value + 1);
  }

  async function reorderGroup(
    group: SemanticGroupTreeItem,
    position: number
  ): Promise<void> {
    setMutationError(undefined);
    try {
      await browserApiRequest<SemanticKeywordGroup>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups/${encodeURIComponent(group.id)}`,
        {
          method: "PATCH",
          ifMatch: group.version,
          body: {
            name: group.name,
            color: group.color ?? null,
            parentId: group.parentId ?? null,
            position
          }
        }
      );
      setBulkNotice(`Порядок группы «${group.name}» сохранён`);
      onGroupsChanged();
    } catch (requestError) {
      setMutationError(keywordMutationError(requestError));
    }
  }

  async function moveGroupsImmediately(
    selectedGroups: readonly SemanticGroupTreeItem[],
    target: SemanticGroupTreeDropTarget
  ): Promise<void> {
    if (saving) return;
    const selectedPaths = new Set(selectedGroups.map(({ path }) => path));
    const movingGroups = selectedGroups
      .filter(
        (group) =>
          ![...selectedPaths].some(
            (path) => path !== group.path && group.path.startsWith(`${path} / `)
          )
      )
      .sort(compareGroupTreeOrder);
    if (movingGroups.length === 0) return;

    const movingIds = new Set(movingGroups.map(({ id }) => id));
    const targetParentId =
      target.placement === "root"
        ? undefined
        : target.placement === "inside"
          ? target.group.id
          : target.group.parentId;
    const targetPosition =
      target.placement === "before" || target.placement === "after"
        ? (() => {
            const siblings = groups
              .filter(
                ({ id, parentId }) =>
                  parentId === target.group.parentId && !movingIds.has(id)
              )
              .sort(compareGroupTreeOrder);
            const index = siblings.findIndex(({ id }) => id === target.group.id);
            return Math.max(0, index + (target.placement === "after" ? 1 : 0));
          })()
        : undefined;

    setSaving(true);
    setMutationError(undefined);
    let moved = 0;
    try {
      const basePath = `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`;
      for (const [offset, selectedGroup] of movingGroups.entries()) {
        const currentGroups = await browserApiRequest<readonly SemanticKeywordGroup[]>(
          basePath
        );
        const current = currentGroups.find(({ id }) => id === selectedGroup.id);
        if (!current) throw new Error("GROUP_NOT_FOUND");
        await browserApiRequest<SemanticKeywordGroup>(
          `${basePath}/${encodeURIComponent(current.id)}`,
          {
            method: "PATCH",
            ifMatch: current.version,
            body: {
              name: current.name,
              color: current.color ?? null,
              parentId: targetParentId ?? null,
              ...(targetPosition === undefined
                ? {}
                : { position: targetPosition + offset })
            }
          }
        );
        moved += 1;
      }
      setBulkNotice(
        moved === 1
          ? `Группа «${movingGroups[0]?.name ?? ""}» перемещена`
          : `Перемещено групп: ${moved}`
      );
    } catch (requestError) {
      setMutationError(
        moved > 0
          ? `Перемещено ${moved} из ${movingGroups.length}. Дерево обновлено; повторите оставшиеся группы.`
          : keywordMutationError(requestError)
      );
    } finally {
      setSaving(false);
      onGroupsChanged();
    }
  }

  function openRowMenu(event: MouseEvent, item: SemanticKeyword): void {
    event.preventDefault();
    setRowContextMenu({
      item,
      targetIds: checkedIds.size > 0 ? [...checkedIds] : [item.id],
      x: event.clientX,
      y: event.clientY
    });
  }

  function selectProject(nextProjectId: string): void {
    if (!nextProjectId || nextProjectId === projectId) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `seo_project=${encodeURIComponent(nextProjectId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.location.assign("/app/semantics");
  }

  const total = rootTotal;
  const filteredTotal = page.totalApprox;
  const projectOptions = projects.some(({ id }) => id === projectId)
    ? projects
    : [{ id: projectId, name: projectName, domain: "" }, ...projects];
  const manualInputStats = editor?.mode === "create"
    ? manualKeywordInputStats(editor.draft.text)
    : undefined;
  const activeGroup = viewConfig.filters.groupId
    ? groups.find(({ id }) => id === viewConfig.filters.groupId)
    : undefined;
  const activeGroupIsEmpty = activeGroup?.keywordCount === 0;
  const activeScopeIsEmpty = activeGroup
    ? activeGroupIsEmpty
    : rootTotal === 0;
  const canAddToActiveScope =
    activeScopeIsEmpty && activeGroup?.systemKind !== "TRASH";
  const emptyTableContent = items.length === 0 ? (
    <div className="semantic-table-empty">
      <strong>
        {activeScopeIsEmpty
          ? activeGroup?.systemKind === "TRASH"
            ? "Корзина пуста"
            : activeGroup
              ? `В группе «${activeGroup.name}» пока нет запросов`
              : "В проекте пока нет запросов"
          : hasActiveFilters(viewConfig)
            ? "По выбранным фильтрам ничего не найдено"
            : "Опубликованных запросов пока нет"}
      </strong>
      <p>
        {activeScopeIsEmpty
          ? activeGroup?.systemKind === "TRASH"
            ? "Удалённые запросы появятся здесь и останутся доступными для восстановления или окончательного удаления."
            : activeGroup
              ? "Добавьте запросы вручную или импортируйте их сразу в выбранную группу."
              : "Добавьте запросы вручную или импортируйте файл Key Collector, CSV, TSV либо XLSX."
          : hasActiveFilters(viewConfig)
            ? "Измените условия или сбросьте фильтры."
            : "Добавьте запросы вручную или импортируйте файл."}
      </p>
      {canAddToActiveScope ? (
        <button
          className="primary-button"
          onClick={openCreate}
          type="button"
        >
          <Icon name="plus" />
          {activeGroup
            ? "Добавить запросы в эту группу"
            : "Добавить запросы"}
        </button>
      ) : hasActiveFilters(viewConfig) && !activeScopeIsEmpty ? (
        <button
          className="secondary-button"
          onClick={clearFilters}
          type="button"
        >
          Сбросить фильтры
        </button>
      ) : null}
    </div>
  ) : undefined;
  const virtualRows = semanticVirtualRows(
    items,
    tableViewport,
    viewConfig.density
  );
  const focusedKeywordId = rightSidebar?.type === "KEYWORD"
    ? rightSidebar.keywordId
    : undefined;
  const focusedKeyword = items.find(({ id }) => id === focusedKeywordId);
  const activeNegativeGroup = groups
    .filter(({ systemKind }) => !systemKind)
    .find(({ id }) => id === viewConfig.filters.groupId);
  const mutationIds = actionIds ?? checkedIds;
  const contextKeyword = rowContextMenu?.targetIds.length === 1
    ? items.find(({ id }) => id === rowContextMenu.targetIds[0])
    : undefined;
  const rowMenuItems: readonly ContextMenuItem[] = rowContextMenu
    ? [
        {
          id: "edit",
          label: "Изменить запрос",
          disabled: rowContextMenu.targetIds.length !== 1 || !contextKeyword,
          onSelect: () => {
            if (contextKeyword) openEdit(contextKeyword);
          }
        },
        {
          id: "move",
          label:
            rowContextMenu.targetIds.length > 1
              ? `Перенести запросы (${rowContextMenu.targetIds.length})…`
              : "Перенести в группу…",
          onSelect: () => {
            setActionIds(new Set(rowContextMenu.targetIds));
            setMoveKeywordDialog(true);
          }
        },
        {
          id: "bulk",
          label: "Теги, интент и URL…",
          onSelect: () => {
            setActionIds(new Set(rowContextMenu.targetIds));
            setBulkEditorOpen(true);
          }
        },
        {
          id: "delete",
          label:
            rowContextMenu.targetIds.length > 1
              ? `Удалить запросы (${rowContextMenu.targetIds.length})`
              : "Удалить запрос",
          danger: true,
          dividerBefore: true,
          onSelect: () => {
            setActionIds(new Set(rowContextMenu.targetIds));
            setDeleteSelectionOpen(true);
          }
        }
      ]
    : [];
  return (
    <section
      aria-busy={loading}
      className="semantic-core"
      style={{
        "--semantic-groups-width": `${groupSidebarWidth}px`
      } as CSSProperties}
    >
      <header className="semantic-core-header">
        <div className="semantic-title-block">
          <h1>Семантическое ядро</h1>
          <CustomSelect
            aria-label="Проект семантического ядра"
            onChange={(event) => selectProject(event.target.value)}
            searchable={projectOptions.length > 8}
            showSelectedCheck={false}
            value={projectId}
          >
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                <ProjectSelectOption project={project} />
              </option>
            ))}
          </CustomSelect>
        </div>
        <dl className="semantic-summary">
          <div>
            <dt>Запросов</dt>
            <dd>{total === undefined ? "—" : formatInteger(total)}</dd>
          </div>
          <div>
            <dt>Групп</dt>
            <dd>{formatInteger(groups.filter(({ systemKind }) => !systemKind).length)}</dd>
          </div>
          <div>
            <dt>Кластеров</dt>
            <dd>{formatInteger(clusters.length)}</dd>
          </div>
          <div>
            <dt>Загружено</dt>
            <dd>{formatInteger(items.length)}</dd>
          </div>
        </dl>
        <div className="semantic-header-status"><span>Общий вид проекта</span></div>
      </header>
      <nav aria-label="Действия с семантикой" className="semantic-commandbar">
        <button onClick={openCreate} type="button"><Icon name="plus" />Добавить</button>
        <button onClick={onOpenImport} type="button"><Icon name="import" />Импорт</button>
        <button disabled={(rootTotal ?? items.length) === 0} onClick={() => setFrequencyDialogOpen(true)} title={(rootTotal ?? items.length) === 0 ? "В проекте пока нет запросов" : "Выберите запросы или папки в окне запуска"} type="button"><Icon name="frequency" />Собрать частотность</button>
        <button disabled={(rootTotal ?? items.length) === 0} onClick={() => setPositionDialogOpen(true)} title={(rootTotal ?? items.length) === 0 ? "В проекте пока нет запросов" : "Выберите запросы или папки в окне запуска"} type="button"><Icon name="rankCheck" />Проверить позиции</button>
        <button disabled={(rootTotal ?? items.length) === 0} onClick={() => setNegativeKeywordsOpen(true)} title="Найти запросы по минус-словам и переместить их в корзину" type="button"><Icon name="warning" />Минус-слова</button>
        <button className="danger" disabled={checkedIds.size === 0} onClick={() => { setActionIds(null); setDeleteSelectionOpen(true); }} type="button"><Icon name="trash" />Удалить</button>
        <button onClick={() => openExport()} type="button"><Icon name="export" />Экспорт</button>
        <button
          data-semantic-sidebar-trigger
          onClick={() =>
            setRightSidebar((current) =>
              current?.type === "HISTORY" ? undefined : { type: "HISTORY" }
            )
          }
          type="button"
        ><Icon name="history" />История</button>
        <button
          data-semantic-sidebar-trigger
          onClick={() =>
            setRightSidebar((current) =>
              current?.type === "OPERATIONS" ? undefined : { type: "OPERATIONS" }
            )
          }
          type="button"
        ><Icon name="operations" />Операции</button>
        {checkedIds.size > 0 && (
          <div className="semantic-selection-chip" role="status">
            <strong>Выбрано: {checkedIds.size}</strong>
            <button
              aria-label="Снять выделение"
              onClick={() => setCheckedIds(new Set())}
              title="Снять выделение"
              type="button"
            ><Icon name="close" /></button>
          </div>
        )}
      </nav>

      <SemanticGroupTree
        {...(viewConfig.filters.groupId
          ? { activeGroupId: viewConfig.filters.groupId }
          : {})}
        expandedIds={expandedGroupIds}
        groups={groups as readonly SemanticGroupTreeItem[]}
        onCreate={(parentId) => setGroupDialog({ mode: "create", ...(parentId ? { parentId } : {}) })}
        onDelete={(selectedGroups) => setGroupDialog({ mode: "delete", groups: selectedGroups })}
        onExport={(group) => openExport(group.id)}
        onDropMove={(selectedGroups, target) =>
          void moveGroupsImmediately(selectedGroups, target)
        }
        onMoveRequest={(selectedGroups) =>
          setGroupDialog({
            mode: "move",
            groups: selectedGroups
          })
        }
        onKeywordDrop={(keywordIds, targetId) => {
          const availableIds = keywordIds.filter((id) =>
            items.some((item) => item.id === id)
          );
          if (availableIds.length === 0) return;
          setCheckedIds(new Set(availableIds));
          setActionIds(null);
          setMoveKeywordTargetId(targetId ?? "");
          setMoveKeywordDialog(true);
        }}
        onRename={(group) => setGroupDialog({ mode: "rename", group })}
        onReorder={(group, position) => void reorderGroup(group, position)}
        onExpandedIdsChange={updateExpandedGroupIds}
        onSelect={selectGroup}
        {...(total === undefined ? {} : { total })}
      />
      <div
        aria-label="Изменить ширину дерева групп"
        aria-orientation="vertical"
        aria-valuemax={semanticGroupSidebarMaxWidth}
        aria-valuemin={semanticGroupSidebarMinWidth}
        aria-valuenow={groupSidebarWidth}
        className="semantic-group-tree-resizer"
        onDoubleClick={() =>
          updateGroupSidebarWidth(semanticGroupSidebarDefaultWidth, true)
        }
        onKeyDown={resizeGroupSidebarFromKeyboard}
        onPointerDown={startGroupSidebarResize}
        role="separator"
        tabIndex={0}
        title="Потяните для изменения ширины. Двойной клик — сбросить"
      />

      <div
        className="semantic-table-tools"
      >
        <form className="semantic-search" onSubmit={submitSearch}>
          <label>
            <span className="visually-hidden">Поиск по запросам</span>
            <Icon name="search" />
            <input
              maxLength={200}
              onChange={(event) => updateFilter({ search: event.target.value })}
              placeholder="Поиск по запросам"
              type="search"
              value={draftConfig.filters.search ?? ""}
            />
            {(draftConfig.filters.search ?? "") && (
              <button aria-label="Очистить поиск" onClick={clearSearch} title="Очистить" type="button">
                <Icon name="close" />
              </button>
            )}
          </label>
        </form>
        <details className="semantic-filter-disclosure" data-exclusive-dropdown>
          <summary>
            Фильтры
            {activeFilterCount(viewConfig.filters) > 0 && (
              <span>{activeFilterCount(viewConfig.filters)}</span>
            )}
          </summary>
          <form className="semantic-filter-bar" onSubmit={submitFilters}>
        <header className="semantic-filter-popover-header">
          <div><strong>Фильтры запросов</strong><small>Совмещайте условия и применяйте их одним действием.</small></div>
          {hasActiveFilters(viewConfig) && <button className="text-button" onClick={clearFilters} type="button">Очистить</button>}
        </header>
        <div className="semantic-filter-fields">
        <label>
          <span>Интент</span>
          <CustomSelect
            onChange={(event) =>
              updateOptionalFilter("intent", event.target.value)
            }
            value={draftConfig.filters.intent ?? ""}
          >
            <option value="">Все</option>
            <option value="INFORMATIONAL">Информационный</option>
            <option value="NAVIGATIONAL">Навигационный</option>
            <option value="COMMERCIAL">Коммерческий</option>
            <option value="TRANSACTIONAL">Транзакционный</option>
            <option value="LOCAL">Локальный</option>
            <option value="MIXED">Смешанный</option>
          </CustomSelect>
        </label>
        <label>
          <span>Группа</span>
          <CustomSelect
            onChange={(event) =>
              updateOptionalFilter("groupId", event.target.value)
            }
            value={draftConfig.filters.groupId ?? ""}
          >
            <option value="">Все группы</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.path}
              </option>
            ))}
          </CustomSelect>
        </label>
        <label>
          <span>Кластер</span>
          <CustomSelect
            aria-label="Кластер"
            onChange={(event) =>
              updateOptionalFilter("clusterId", event.target.value)
            }
            value={draftConfig.filters.clusterId ?? ""}
          >
            <option value="">Все кластеры</option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name}
              </option>
            ))}
          </CustomSelect>
        </label>
        <label>
          <span>Избранное</span>
          <CustomSelect
            onChange={(event) =>
              updateBooleanFilter("isFavorite", event.target.value)
            }
            value={booleanFilter(draftConfig.filters.isFavorite)}
          >
            <option value="">Все</option>
            <option value="true">Только избранные</option>
            <option value="false">Не избранные</option>
          </CustomSelect>
        </label>
        <label>
          <span>Отслеживание</span>
          <CustomSelect
            onChange={(event) =>
              updateBooleanFilter("isTracked", event.target.value)
            }
            value={booleanFilter(draftConfig.filters.isTracked)}
          >
            <option value="">Все</option>
            <option value="true">Отслеживаются</option>
            <option value="false">Не отслеживаются</option>
          </CustomSelect>
        </label>
        <label>
          <span>Приоритет от</span>
          <input
            max={100}
            min={0}
            onChange={(event) =>
              updatePriorityFilter("priorityMin", event.target.value)
            }
            type="number"
            value={draftConfig.filters.priorityMin ?? ""}
          />
        </label>
        <label>
          <span>Приоритет до</span>
          <input
            max={100}
            min={0}
            onChange={(event) =>
              updatePriorityFilter("priorityMax", event.target.value)
            }
            type="number"
            value={draftConfig.filters.priorityMax ?? ""}
          />
        </label>
        <label>
          <span>Сортировка</span>
          <CustomSelect
            disabled={savingFolderSort}
            onChange={(event) =>
              void changeFolderSort(
                event.target.value as SemanticViewConfig["sort"]
              )
            }
            value={viewConfig.sort}
          >
            <option value="CREATED_DESC">Сначала новые</option>
            <option value="CREATED_ASC">Сначала старые</option>
            <option value="UPDATED_DESC">Недавно изменённые</option>
            <option value="UPDATED_ASC">Давно изменённые</option>
            <option value="TEXT_ASC">Запрос: А → Я</option>
            <option value="TEXT_DESC">Запрос: Я → А</option>
            <option value="PRIORITY_DESC">Приоритет: высокий → низкий</option>
            <option value="PRIORITY_ASC">Приоритет: низкий → высокий</option>
            <option value="SOURCE_ASC">Источник: А → Я</option>
            <option value="SOURCE_DESC">Источник: Я → А</option>
            <option value="FREQUENCY_BASE_DESC">База: больше → меньше</option>
            <option value="FREQUENCY_BASE_ASC">База: меньше → больше</option>
            <option value="FREQUENCY_EXACT_DESC">&quot;&quot;: больше → меньше</option>
            <option value="FREQUENCY_EXACT_ASC">&quot;&quot;: меньше → больше</option>
            <option value="FREQUENCY_FIXED_DESC">&quot;!&quot;: больше → меньше</option>
            <option value="FREQUENCY_FIXED_ASC">&quot;!&quot;: меньше → больше</option>
            <option value="YANDEX_POSITION_ASC">Яндекс: лучшие позиции</option>
            <option value="YANDEX_POSITION_DESC">Яндекс: худшие позиции</option>
            <option value="GOOGLE_POSITION_ASC">Google: лучшие позиции</option>
            <option value="GOOGLE_POSITION_DESC">Google: худшие позиции</option>
            <option value="YANDEX_CHECKED_AT_DESC">Яндекс: свежий съём</option>
            <option value="YANDEX_CHECKED_AT_ASC">Яндекс: старый съём</option>
            <option value="GOOGLE_CHECKED_AT_DESC">Google: свежий съём</option>
            <option value="GOOGLE_CHECKED_AT_ASC">Google: старый съём</option>
          </CustomSelect>
        </label>
        </div>
        <footer className="semantic-filter-popover-actions">
          {hasActiveFilters(viewConfig) && (
            <button
              className="secondary-button semantic-filter-reset"
              onClick={clearFilters}
              type="button"
            >
              Сбросить
            </button>
          )}
          <button className="primary-button semantic-filter-apply" type="submit">
            Применить
          </button>
        </footer>
          </form>
        </details>
        <div className="semantic-table-view-actions">
          <button
            className={`semantic-compact-button${rightSidebar?.type === "LAYOUT" ? " active" : ""}`}
            data-semantic-sidebar-trigger
            onClick={() => setRightSidebar((current) => current?.type === "LAYOUT" ? undefined : { type: "LAYOUT" })}
            type="button"
          >
            <Icon name="settings" />
            Колонки и представления
          </button>
          <button className="semantic-compact-button" disabled={items.length === 0 && total === 0} onClick={() => openExport()} type="button">
            Экспорт
          </button>
        </div>
      </div>

      {exportDialog && (
        <SemanticModal
          description="Выберите область, формат и набор колонок. Экспорт формируется сервером с учётом текущих фильтров."
          onClose={exporting ? () => undefined : () => setExportDialog(undefined)}
          size="medium"
          title="Экспорт семантики"
        >
          <form
            className="semantic-export-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void downloadExport();
            }}
          >
            <div className="semantic-export-grid">
              <label>
                <span>Область экспорта</span>
                <CustomSelect
                  disabled={Boolean(exportDialog.groupId)}
                  onChange={(event) => setExportScope(event.target.value as SemanticExportScope)}
                  value={exportScope}
                >
                  <option value="CURRENT_FILTER">Все строки текущего фильтра</option>
                  <option disabled={checkedIds.size === 0} value="SELECTED">Выбранные строки ({checkedIds.size})</option>
                  {exportDialog.groupId && <option value="GROUP_SUBTREE">Текущая группа и подгруппы</option>}
                </CustomSelect>
              </label>
              <label>
                <span>Формат</span>
                <CustomSelect
                  disabled={exporting}
                  onChange={(event) => {
                    const format = event.target.value as SemanticExportFormat;
                    setExportFormat(format);
                    setExportBom(format === "CSV" || format === "TSV");
                  }}
                  value={exportFormat}
                >
                  <option value="CSV">CSV</option>
                  <option value="TSV">TSV</option>
                  <option value="JSON">JSON</option>
                  <option value="NDJSON">NDJSON</option>
                  <option value="GOOGLE_CSV">CSV для Google Sheets</option>
                </CustomSelect>
              </label>
            </div>
            <fieldset className="semantic-export-columns">
              <legend>Колонки</legend>
              {[
                ...semanticColumns,
                ...customColumns.map((column) => ({
                  key: `custom:${column.id}` as const,
                  label: column.name
                }))
              ].map((column) => (
                <label key={column.key}>
                  <input
                    checked={exportColumns.includes(column.key)}
                    onChange={() => setExportColumns((current) =>
                      current.includes(column.key)
                        ? current.filter((item) => item !== column.key)
                        : [...current, column.key]
                    )}
                    type="checkbox"
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="semantic-control-check">
              <input
                checked={exportBom}
                disabled={exportFormat !== "CSV" && exportFormat !== "TSV"}
                onChange={(event) => setExportBom(event.target.checked)}
                type="checkbox"
              />
              <span>Добавить UTF-8 BOM для корректного открытия в Excel</span>
            </label>
            {mutationError && <div className="inline-alert danger" role="alert">{mutationError}</div>}
            <div className="semantic-modal-actions">
              <button className="secondary-button" disabled={exporting} onClick={() => setExportDialog(undefined)} type="button">Отмена</button>
              <button
                className="primary-button"
                disabled={
                  exporting ||
                  exportColumns.length === 0 ||
                  (exportScope === "SELECTED" && checkedIds.size === 0)
                }
                type="submit"
              >
                {exporting ? "Готовим файл…" : "Экспортировать"}
              </button>
            </div>
          </form>
        </SemanticModal>
      )}

      {editor && (
        <SemanticModal
          description="Группа, кластер, посадочная страница и теги сохраняются вместе с проверкой версии."
          onClose={saving ? () => undefined : () => setEditor(undefined)}
          size="medium"
          title={editor.mode === "create" ? "Добавить запросы" : "Изменить запрос"}
        >
          <form
            className="semantic-editor"
            onSubmit={(event) => void saveKeyword(event)}
          >
          <div className="semantic-editor-grid">
            <label className="semantic-editor-query">
              <span>{editor.mode === "create" ? "Запросы — по одному в строке" : "Запрос"}</span>
              {editor.mode === "create" ? (
                <>
                  <textarea
                    autoFocus
                    maxLength={4_100_000}
                    onChange={(event) => updateDraft({ text: event.target.value })}
                    placeholder="купить слона\nдоставка слона\nцена слона"
                    required
                    rows={6}
                    value={editor.draft.text}
                  />
                  <small
                    className={
                      manualInputStats &&
                      (editor.draft.skipDuplicates
                        ? manualInputStats.unique
                        : manualInputStats.total) > MANUAL_KEYWORD_LIMIT
                        ? "semantic-editor-query-limit"
                        : undefined
                    }
                  >
                    {manualInputStats?.total ?? 0} запросов
                    {manualInputStats
                      ? ` · уникальных: ${manualInputStats.unique}`
                      : ""}
                    {manualInputStats?.duplicates
                      ? editor.draft.skipDuplicates
                        ? ` · будет пропущено дублей: ${manualInputStats.duplicates}`
                        : ` · дублей для проверки: ${manualInputStats.duplicates}`
                      : ""}
                    {` · лимит за один запуск: ${formatInteger(MANUAL_KEYWORD_LIMIT)}`}
                  </small>
                </>
              ) : (
                <input
                  autoFocus
                  maxLength={2000}
                  onChange={(event) => updateDraft({ text: event.target.value })}
                  required
                  value={editor.draft.text}
                />
              )}
            </label>
            <label className="semantic-editor-language">
              <span>Язык</span>
              <input
                maxLength={16}
                onChange={(event) =>
                  updateDraft({ language: event.target.value })
                }
                required
                value={editor.draft.language}
              />
            </label>
            <label className="semantic-editor-priority">
              <span>Приоритет</span>
              <input
                max={100}
                min={0}
                onChange={(event) =>
                  updateDraft({ priority: event.target.value })
                }
                required
                type="number"
                value={editor.draft.priority}
              />
            </label>
            <label className="semantic-editor-intent">
              <span>Интент</span>
              <CustomSelect
                onChange={(event) =>
                  updateDraft({
                    intent: event.target.value as KeywordDraft["intent"]
                  })
                }
                value={editor.draft.intent}
              >
                <option value="">Не задан</option>
                <option value="INFORMATIONAL">Информационный</option>
                <option value="NAVIGATIONAL">Навигационный</option>
                <option value="COMMERCIAL">Коммерческий</option>
                <option value="TRANSACTIONAL">Транзакционный</option>
                <option value="LOCAL">Локальный</option>
                <option value="MIXED">Смешанный</option>
              </CustomSelect>
            </label>
            <label className="semantic-editor-group">
              <span>Группа</span>
              <CustomSelect
                onChange={(event) =>
                  updateDraft({ groupId: event.target.value })
                }
                value={editor.draft.groupId}
              >
                <option value="">Без группы</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.path}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label className="semantic-editor-cluster">
              <span>Кластер</span>
              <CustomSelect
                onChange={(event) =>
                  updateDraft({ clusterId: event.target.value })
                }
                value={editor.draft.clusterId}
              >
                <option value="">Без кластера</option>
                {clusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label className="semantic-editor-url">
              <span>Целевая URL</span>
              <input
                maxLength={2048}
                onChange={(event) =>
                  updateDraft({ targetUrl: event.target.value })
                }
                placeholder="https://example.com/page"
                type="url"
                value={editor.draft.targetUrl}
              />
            </label>
            <label className="semantic-editor-tags">
              <span>Теги через запятую</span>
              <input
                onChange={(event) =>
                  updateDraft({ tagNames: event.target.value })
                }
                placeholder="Приоритет, Услуги"
                value={editor.draft.tagNames}
              />
            </label>
            <label className="semantic-editor-check">
              <input
                checked={editor.draft.isFavorite}
                onChange={(event) =>
                  updateDraft({ isFavorite: event.target.checked })
                }
                type="checkbox"
              />
              <span>Избранный запрос</span>
            </label>
            {editor.mode === "create" && (
              <label className="semantic-editor-check semantic-editor-deduplicate">
                <input
                  checked={editor.draft.skipDuplicates}
                  onChange={(event) =>
                    updateDraft({ skipDuplicates: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Не добавлять дубли</strong>
                  <small>
                    Повторы в списке и существующие активные запросы будут
                    пропущены.
                  </small>
                </span>
              </label>
            )}
          </div>
          {mutationError && (
            <div className="inline-alert danger" role="alert">
              {mutationError}
            </div>
          )}
          <div className="semantic-editor-actions">
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setEditor(undefined)}
              type="button"
            >
              Отмена
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
          </form>
        </SemanticModal>
      )}

      {!editor && mutationIds.size > 0 && bulkEditorOpen && (
        <SemanticModal
          description="Измените только выбранные поля. Перед очисткой запросов будет показан row-level preview."
          onClose={() => { setBulkEditorOpen(false); setActionIds(null); }}
          size="large"
          title={`Массовые операции · ${mutationIds.size}`}
        >
          <SemanticBulkEditor
          clusters={clusters}
          groups={groups}
          onCancel={() => { setBulkEditorOpen(false); setActionIds(null); }}
          onCompleted={(result) => {
            setCheckedIds(new Set());
            setActionIds(null);
            setBulkEditorOpen(false);
            setBulkNotice(
              `Массовое изменение: обновлено ${result.changed} из ${result.selected}` +
                (result.conflicted > 0
                  ? `, конфликтов ${result.conflicted}`
                  : "")
            );
            setRetryVersion((value) => value + 1);
          }}
          onSplitCompleted={(result) => {
            setCheckedIds(new Set());
            setActionIds(null);
            setBulkEditorOpen(false);
            setBulkNotice(
              `Создан кластер «${result.createdCluster.name}»: перенесено ${result.movedKeywordCount} запросов`
            );
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
          selections={items
            .filter(({ id }) => mutationIds.has(id))
            .map(({ id, version, clusterId }) => ({
              id,
              version,
              ...(clusterId ? { clusterId } : {})
            }))}
          />
        </SemanticModal>
      )}

      {customValueEditor && (
        <SemanticCustomValueEditor
          column={customValueEditor.column}
          existing={customValueEditor.keyword.customValues?.find(
            ({ columnId }) => columnId === customValueEditor.column.id
          )}
          keywordId={customValueEditor.keyword.id}
          keywordText={customValueEditor.keyword.textOriginal}
          onCancel={() => setCustomValueEditor(undefined)}
          onCompleted={() => {
            setCustomValueEditor(undefined);
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
        />
      )}

      {!editor && trashRecoveryItems.length > 0 && (
        <SemanticTrashRecoveryDialog
          items={trashRecoveryItems}
          onClose={() => setTrashRecoveryItems([])}
          onCompleted={({ restored, skipped }) => {
            setTrashRecoveryItems([]);
            setBulkNotice(
              `Из корзины восстановлено: ${restored}` +
                (skipped > 0 ? ` · уже были активны: ${skipped}` : "")
            );
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
        />
      )}

      {(bulkNotice || exportNotice || (!editor && !exportDialog && mutationError)) && (
        <div className="semantic-toast-stack" aria-live="polite">
          {bulkNotice && (
            <div className="semantic-toast success" role="status">
              <span aria-hidden="true">✓</span>
              <strong>{bulkNotice}</strong>
              <button aria-label="Закрыть уведомление" onClick={() => setBulkNotice(undefined)} type="button">×</button>
            </div>
          )}
          {exportNotice && (
            <div className="semantic-toast success" role="status">
              <span aria-hidden="true">✓</span>
              <strong>{exportNotice}</strong>
              <button aria-label="Закрыть уведомление" onClick={() => setExportNotice(undefined)} type="button">×</button>
            </div>
          )}
          {!editor && !exportDialog && mutationError && (
            <div className="semantic-toast danger" role="alert">
              <span aria-hidden="true">!</span>
              <strong>{mutationError}</strong>
              <button aria-label="Закрыть уведомление" onClick={() => setMutationError(undefined)} type="button">×</button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="semantic-table-skeleton" role="status">
          <span className="visually-hidden">Загружаем запросы</span>
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      ) : (
        <>
          <div
            aria-busy={loading}
            className={`semantic-table-wrap${loading ? " refreshing" : ""}`}
            onScroll={(event) =>
              setTableViewport({
                height: event.currentTarget.clientHeight,
                scrollTop: event.currentTarget.scrollTop
              })
            }
            ref={tableScrollRef}
            tabIndex={0}
            aria-label="Таблица семантического ядра"
          >
            <KeywordDataGrid
              actions={(item) => (
                <button
                  aria-label={`Действия с запросом ${item.textOriginal}`}
                  className="semantic-row-more"
                  onClick={(event) => {
                    event.stopPropagation();
                    openRowMenu(event, item);
                  }}
                  type="button"
                >
                  ⋮
                </button>
              )}
              ariaLabel="Таблица семантического ядра"
              columns={viewConfig.columns.map((column) => {
                const nextSort = nextSemanticColumnSort(column, viewConfig.sort);
                const direction = semanticColumnSortDirection(column, viewConfig.sort);
                return {
                  key: column,
                  ariaSort: direction,
                  cellClassName: `semantic-column-${column}`,
                  width:
                    columnWidths[column] ?? semanticColumnDefaultWidth(column),
                  minWidth:
                    column === "query" ? 180 : semanticColumnMinWidth,
                  maxWidth: semanticColumnMaxWidth,
                  resizeLabel: columnLabel(column, customColumns),
                  onResize: (width: number) =>
                    resizeSemanticColumn(column, width, false),
                  onResizeEnd: (width: number) =>
                    resizeSemanticColumn(column, width, true),
                  header: nextSort ? (
                    <button
                      aria-label={`${columnLabel(column, customColumns)}. ${sortActionLabel(nextSort)}`}
                      className={direction ? "active" : undefined}
                      disabled={savingFolderSort}
                      onClick={() => void changeFolderSort(nextSort)}
                      type="button"
                    >
                      <span>{columnHeader(column, customColumns)}</span>
                      <i aria-hidden="true">
                        {direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}
                      </i>
                    </button>
                  ) : columnHeader(column, customColumns),
                  cell: (item: SemanticKeyword) => keywordColumn(
                    item,
                    column,
                    customColumns,
                    (customColumn) => setCustomValueEditor({ keyword: item, column: customColumn })
                  )
                };
              })}
              density={viewConfig.density}
              draggable
              emptyContent={emptyTableContent}
              focusedId={focusedKeywordId}
              highlightedIds={highlightedIds}
              onContextMenu={(event, item) => openRowMenu(event, item)}
              onDragStart={(event, item) => {
                const ids = checkedIds.has(item.id) ? [...checkedIds] : [item.id];
                setCheckedIds(new Set(ids));
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-seo-keyword-ids", ids.join(","));
              }}
              onRowClick={(item, event) => selectKeywordRow(item, event)}
              onToggleAll={toggleVisibleSelection}
              onToggleHighlighted={toggleHighlightedSelection}
              onToggleRow={(item, event) => toggleKeywordRow(item, event)}
              paddingBottom={virtualRows.paddingBottom}
              paddingTop={virtualRows.paddingTop}
              rows={virtualRows.items}
              selectedIds={checkedIds}
            />
            <div aria-hidden="true" className="semantic-load-sentinel" ref={loadMoreSentinelRef} />
          </div>
          <footer className="semantic-table-footer">
            <span>
              Показано {formatInteger(items.length)}
              {filteredTotal === undefined ? "" : ` из ${formatInteger(filteredTotal)}`}
            </span>
            <div className="semantic-table-footer-controls">
              <span>
                {loadingMore
                  ? "Загружаем следующую часть…"
                  : page.hasNext
                    ? "Прокрутите ниже — строки загрузятся автоматически"
                    : "Все доступные строки загружены"}
              </span>
              <label>
                <span>Загружать по</span>
                <CustomSelect
                  aria-label="Количество запросов в одном блоке"
                  onChange={(event) => updatePageSize(event.target.value)}
                  value={pageSize}
                >
                  {semanticKeywordPageSizes.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </CustomSelect>
              </label>
            </div>
          </footer>
        </>
      )}
      {rightSidebar?.type === "KEYWORD" && focusedKeyword && (
        <SemanticKeywordInspector
          item={focusedKeyword}
          onClose={() => setRightSidebar(undefined)}
          onEdit={() => openEdit(focusedKeyword)}
          onUpdated={(updated) => {
            setItems((current) => current.map((keyword) =>
              keyword.id === updated.id
                ? {
                    ...keyword,
                    hasNote: updated.hasNote ?? false,
                    updatedAt: updated.updatedAt,
                    version: updated.version
                  }
                : keyword
            ));
          }}
          projectId={projectId}
        />
      )}
      {rightSidebar?.type === "HISTORY" && (
        <SemanticVersionHistory
          drawer
          onClose={() => setRightSidebar(undefined)}
          projectId={projectId}
          refreshVersion={refreshVersion + retryVersion}
        />
      )}
      {groupDialog && (
        <SemanticGroupDialog
          groups={groups}
          onClose={() => setGroupDialog(undefined)}
          onCompleted={(message) => {
            setGroupDialog(undefined);
            setBulkNotice(message);
            onGroupsChanged();
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
          state={groupDialog}
        />
      )}
      {moveKeywordDialog && mutationIds.size > 0 && (
        <SemanticKeywordMoveDialog
          groups={groups}
          initialGroupId={moveKeywordTargetId}
          onClose={() => {
            setMoveKeywordDialog(false);
            setMoveKeywordTargetId("");
            setActionIds(null);
          }}
          onCompleted={(result) => {
            setMoveKeywordDialog(false);
            setMoveKeywordTargetId("");
            setCheckedIds(new Set());
            setActionIds(null);
            setBulkNotice(
              `Перенесено ${result.changed} из ${result.selected}` +
                (result.conflicted > 0 ? `, конфликтов: ${result.conflicted}` : "")
            );
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
          selections={items
            .filter(({ id }) => mutationIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, text: textOriginal }))}
        />
      )}
      {deleteSelectionOpen && mutationIds.size > 0 && (
        <SemanticModal
          description={groups.some(
            ({ id, systemKind }) =>
              id === viewConfig.filters.groupId && systemKind === "TRASH"
          )
            ? "Запросы будут удалены без возможности восстановления. Аудит операции сохранится."
            : "Запросы будут перемещены в системную корзину. Оттуда их можно удалить навсегда."}
          onClose={saving ? () => undefined : () => { setDeleteSelectionOpen(false); setActionIds(null); }}
          size="small"
          title={`${groups.some(
            ({ id, systemKind }) =>
              id === viewConfig.filters.groupId && systemKind === "TRASH"
          ) ? "Удалить навсегда" : "Переместить в корзину"} (${mutationIds.size})`}
        >
          <div className="semantic-confirm-dialog">
            <div className="inline-alert danger" role="alert">
              {groups.some(
                ({ id, systemKind }) =>
                  id === viewConfig.filters.groupId && systemKind === "TRASH"
              )
                ? "Это окончательное удаление. Данные частотности, позиций и связанные записи также будут удалены."
                : "Параллельно изменённые строки не будут перезаписаны; остальные появятся в корзине."}
            </div>
            <div className="semantic-modal-actions">
              <button className="secondary-button" disabled={saving} onClick={() => { setDeleteSelectionOpen(false); setActionIds(null); }} type="button">Отмена</button>
              <button className="danger-button" disabled={saving} onClick={() => void deleteSelectedKeywords(mutationIds)} type="button">
                {saving
                  ? "Удаляем…"
                  : groups.some(
                        ({ id, systemKind }) =>
                          id === viewConfig.filters.groupId &&
                          systemKind === "TRASH"
                      )
                    ? "Удалить навсегда"
                    : "В корзину"}
              </button>
            </div>
          </div>
        </SemanticModal>
      )}
      {positionDialogOpen && (
        <SemanticPositionDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, label: textOriginal }))}
          onClose={() => setPositionDialogOpen(false)}
          onStarted={(job) => {
            setPositionDialogOpen(false);
            void job;
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice("Проверка позиций запущена в фоне. Прогресс доступен в операциях.");
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      )}
      {frequencyDialogOpen && (
        <SemanticFrequencyDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          onClose={() => setFrequencyDialogOpen(false)}
          onStarted={(job) => {
            setFrequencyDialogOpen(false);
            setWatchedFrequencyId(job.id);
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice("Сбор частотности запущен в фоне. Новые значения будут появляться в таблице по мере обработки.");
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectId={projectId}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, label: textOriginal }))}
        />
      )}
      {negativeKeywordsOpen && (
        <SemanticNegativeKeywordsDialog
          {...(activeNegativeGroup ? { activeGroup: activeNegativeGroup } : {})}
          onClose={() => setNegativeKeywordsOpen(false)}
          onCompleted={(message) => {
            setNegativeKeywordsOpen(false);
            setCheckedIds(new Set());
            setBulkNotice(message);
            onGroupsChanged();
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
          selections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, label: textOriginal }))}
        />
      )}
      {rowContextMenu && (
        <ContextMenu
          items={rowMenuItems}
          label={rowContextMenu.targetIds.length > 1
            ? `Действия с ${rowContextMenu.targetIds.length} запросами`
            : `Действия с запросом ${rowContextMenu.item.textOriginal}`}
          onClose={() => setRowContextMenu(undefined)}
          x={rowContextMenu.x}
          y={rowContextMenu.y}
        />
      )}
      {rightSidebar?.type === "OPERATIONS" && (
        <SemanticOperationsDrawer
          onClose={() => setRightSidebar(undefined)}
          onFrequencySettled={() => {
            setWatchedFrequencyId(undefined);
            void refreshFrequencyMetrics();
          }}
          projectId={projectId}
          refreshToken={operationsRefreshVersion}
          {...(watchedFrequencyId ? { watchedFrequencyId } : {})}
        />
      )}
      {rightSidebar?.type === "LAYOUT" && (
        <SemanticLayoutDrawer
          config={draftConfig}
          customColumns={customColumns}
          onApply={() => void applyTableLayout()}
          onApplySavedView={(view) => {
            applySavedView(view);
            setRightSidebar(undefined);
          }}
          onClose={() => setRightSidebar(undefined)}
          onDensityChange={(density) => setDraftConfig((current) => ({ ...current, density }))}
          onMoveColumn={moveColumn}
          onOpenCustomColumns={() => {
            setRightSidebar(undefined);
            onOpenColumns();
          }}
          onReset={() => setDraftConfig((current) => ({
            ...current,
            columns: defaultSemanticViewConfig.columns,
            density: defaultSemanticViewConfig.density
          }))}
          onToggleColumn={toggleColumn}
          projectId={projectId}
          saving={savingTableLayout}
        />
      )}
    </section>
  );
}

function saveBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function semanticVirtualRows(
  items: readonly SemanticKeyword[],
  viewport: Readonly<{ height: number; scrollTop: number }>,
  density: SemanticViewConfig["density"]
): Readonly<{
  items: readonly SemanticKeyword[];
  paddingTop: number;
  paddingBottom: number;
}> {
  const rowHeight = density === "COMPACT" ? 34 : 38;
  const overscan = 14;
  const bodyScrollTop = Math.max(0, viewport.scrollTop - 35);
  const start = Math.max(0, Math.floor(bodyScrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewport.height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visible);
  return {
    items: items.slice(start, end),
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (items.length - end) * rowHeight)
  };
}

async function loadKeywordPage(
  projectId: string,
  config: Pick<SemanticViewConfig, "filters" | "sort">,
  cursor?: string,
  signal?: AbortSignal,
  limit = 100
) {
  const query = new URLSearchParams({ limit: String(limit) });
  const filters = config.filters;
  if (filters.search) query.set("search", filters.search);
  if (filters.intent) query.set("intent", filters.intent);
  if (filters.groupId) query.set("groupId", filters.groupId);
  if (filters.clusterId) query.set("clusterId", filters.clusterId);
  if (filters.isFavorite !== undefined) {
    query.set("isFavorite", String(filters.isFavorite));
  }
  if (filters.isTracked !== undefined) {
    query.set("isTracked", String(filters.isTracked));
  }
  if (filters.priorityMin !== undefined) {
    query.set("priorityMin", String(filters.priorityMin));
  }
  if (filters.priorityMax !== undefined) {
    query.set("priorityMax", String(filters.priorityMax));
  }
  query.set("sort", config.sort);
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<SemanticKeyword>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
    signal ? { signal } : {}
  );
}

const semanticColumns: readonly Readonly<{
  key: SemanticSystemColumn;
  label: string;
}>[] = [
  { key: "query", label: "Запрос" },
  { key: "frequency", label: "База" },
  { key: "frequencyExact", label: '""' },
  { key: "frequencyFixed", label: '"!"' },
  { key: "wordCount", label: "WS" },
  { key: "yandexPosition", label: "Позиция Яндекс" },
  { key: "googlePosition", label: "Позиция Google" },
  { key: "yandexRelevantUrl", label: "Релевантный URL Яндекс" },
  { key: "googleRelevantUrl", label: "Релевантный URL Google" },
  { key: "yandexCheckedAt", label: "Дата съёма Яндекс" },
  { key: "googleCheckedAt", label: "Дата съёма Google" },
  { key: "visibility", label: "Видимость" },
  { key: "group", label: "Группа" },
  { key: "cluster", label: "Кластер" },
  { key: "targetUrl", label: "Целевая страница" },
  { key: "tags", label: "Теги" },
  { key: "intent", label: "Интент" },
  { key: "priority", label: "Приоритет" },
  { key: "source", label: "Источник" },
  { key: "updatedAt", label: "Обновлён" }
];

function nextSemanticColumnSort(
  column: SemanticViewColumn,
  current: SemanticKeywordSort
): SemanticKeywordSort | undefined {
  switch (column) {
    case "query":
      return current === "TEXT_ASC" ? "TEXT_DESC" : "TEXT_ASC";
    case "priority":
      return current === "PRIORITY_DESC" ? "PRIORITY_ASC" : "PRIORITY_DESC";
    case "source":
      return current === "SOURCE_ASC" ? "SOURCE_DESC" : "SOURCE_ASC";
    case "updatedAt":
      return current === "UPDATED_DESC" ? "UPDATED_ASC" : "UPDATED_DESC";
    case "frequency":
      return current === "FREQUENCY_BASE_DESC" ? "FREQUENCY_BASE_ASC" : "FREQUENCY_BASE_DESC";
    case "frequencyExact":
      return current === "FREQUENCY_EXACT_DESC" ? "FREQUENCY_EXACT_ASC" : "FREQUENCY_EXACT_DESC";
    case "frequencyFixed":
      return current === "FREQUENCY_FIXED_DESC" ? "FREQUENCY_FIXED_ASC" : "FREQUENCY_FIXED_DESC";
    case "yandexPosition":
      return current === "YANDEX_POSITION_ASC" ? "YANDEX_POSITION_DESC" : "YANDEX_POSITION_ASC";
    case "googlePosition":
      return current === "GOOGLE_POSITION_ASC" ? "GOOGLE_POSITION_DESC" : "GOOGLE_POSITION_ASC";
    case "yandexCheckedAt":
      return current === "YANDEX_CHECKED_AT_DESC" ? "YANDEX_CHECKED_AT_ASC" : "YANDEX_CHECKED_AT_DESC";
    case "googleCheckedAt":
      return current === "GOOGLE_CHECKED_AT_DESC" ? "GOOGLE_CHECKED_AT_ASC" : "GOOGLE_CHECKED_AT_DESC";
    default:
      return undefined;
  }
}

function semanticColumnSortDirection(
  column: SemanticViewColumn,
  current: SemanticKeywordSort
): "ascending" | "descending" | undefined {
  const activeColumn =
    (column === "query" && current.startsWith("TEXT_")) ||
    (column === "priority" && current.startsWith("PRIORITY_")) ||
    (column === "source" && current.startsWith("SOURCE_")) ||
    (column === "updatedAt" && current.startsWith("UPDATED_")) ||
    (column === "frequency" && current.startsWith("FREQUENCY_BASE_")) ||
    (column === "frequencyExact" && current.startsWith("FREQUENCY_EXACT_")) ||
    (column === "frequencyFixed" && current.startsWith("FREQUENCY_FIXED_")) ||
    (column === "yandexPosition" && current.startsWith("YANDEX_POSITION_")) ||
    (column === "googlePosition" && current.startsWith("GOOGLE_POSITION_")) ||
    (column === "yandexCheckedAt" && current.startsWith("YANDEX_CHECKED_AT_")) ||
    (column === "googleCheckedAt" && current.startsWith("GOOGLE_CHECKED_AT_"));
  if (!activeColumn) return undefined;
  return current.endsWith("_ASC") ? "ascending" : "descending";
}

function sortActionLabel(sort: SemanticKeywordSort): string {
  return sort.endsWith("_ASC")
    ? "Сортировать по возрастанию"
    : "Сортировать по убыванию";
}

function columnLabel(
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[]
): string {
  if (column.startsWith("custom:")) {
    return (
      customColumns.find(({ id }) => `custom:${id}` === column)?.name ??
      "Удалённая колонка"
    );
  }
  return (
    semanticColumns.find(({ key }) => key === column)?.label ?? column
  );
}

function columnHeader(
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[]
) {
  if (column === "frequency") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> База</span>;
  }
  if (column === "frequencyExact") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;&quot;</span>;
  }
  if (column === "frequencyFixed") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;!&quot;</span>;
  }
  if (column === "yandexPosition") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> Позиция</span>;
  }
  if (column === "googlePosition") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> Позиция</span>;
  }
  if (column === "yandexRelevantUrl") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> URL</span>;
  }
  if (column === "googleRelevantUrl") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> URL</span>;
  }
  if (column === "yandexCheckedAt") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> Съём</span>;
  }
  if (column === "googleCheckedAt") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> Съём</span>;
  }
  return columnLabel(column, customColumns);
}

function keywordColumn(
  item: SemanticKeyword,
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[],
  onEditCustom: (column: SemanticCustomColumn) => void
) {
  if (column.startsWith("custom:")) {
    const customColumn = customColumns.find(
      ({ id }) => `custom:${id}` === column
    );
    if (!customColumn) return "—";
    const value = item.customValues?.find(
      ({ columnId }) => columnId === customColumn.id
    );
    return (
      <button
        className="semantic-custom-value-button"
        onClick={() => onEditCustom(customColumn)}
        type="button"
      >
        {value
          ? formatCustomValue(customColumn, value.value)
          : "Добавить значение"}
      </button>
    );
  }
  switch (column) {
    case "query":
      return (
        <>
          <strong title={item.textOriginal}>
            {item.isFavorite ? "★ " : ""}
            {item.textOriginal}
            {item.hasNote && (
              <span aria-label="Есть заметка" className="semantic-keyword-note-indicator" title="У запроса есть заметка">
                <Icon name="note" />
              </span>
            )}
          </strong>
          <small>
            {item.language.toUpperCase()}
            {item.isTracked ? " · отслеживается" : ""}
          </small>
        </>
      );
    case "frequency":
      return keywordFrequency(item, "BASE");
    case "frequencyExact":
      return keywordFrequency(item, "EXACT");
    case "frequencyFixed":
      return keywordFrequency(item, "FIXED");
    case "wordCount":
      return countKeywordWords(item.textOriginal);
    case "yandexPosition":
      return keywordPosition(item, "YANDEX");
    case "googlePosition":
      return keywordPosition(item, "GOOGLE");
    case "yandexRelevantUrl":
      return keywordRelevantUrl(item, "YANDEX");
    case "googleRelevantUrl":
      return keywordRelevantUrl(item, "GOOGLE");
    case "yandexCheckedAt":
      return keywordCheckedAt(item, "YANDEX");
    case "googleCheckedAt":
      return keywordCheckedAt(item, "GOOGLE");
    case "visibility":
      return `${keywordVisibilityPercent(item)}%`;
    case "group":
      return <span title={item.groupPath}>{item.groupPath ?? "—"}</span>;
    case "cluster":
      return <span title={item.clusterName}>{item.clusterName ?? "—"}</span>;
    case "targetUrl":
      return <span title={item.targetUrl}>{item.targetUrl ?? "—"}</span>;
    case "tags":
      return item.tags.length > 0 ? (
        <span className="semantic-tags">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
          {(item.tags.length > 3 || item.tagsTruncated) && (
            <span>+{Math.max(1, item.tags.length - 3)}</span>
          )}
        </span>
      ) : (
        "—"
      );
    case "intent":
      return intentLabel(item.intent);
    case "priority":
      return `P${item.priority}`;
    case "source":
      return (
        <span
          className={`semantic-source source-${item.sourceMode.toLowerCase()}`}
        >
          {sourceModeLabel(item.sourceMode)}
        </span>
      );
    case "updatedAt":
      return (
        <time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time>
      );
  }
}

function keywordRelevantUrl(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  if (position && !position.found) return keywordNotFoundMark(searchEngine);
  const url = position?.rankingUrl;
  const presentation = url
    ? externalPageUrlPresentation(url)
    : undefined;
  return presentation ? (
    <a href={presentation.href} onClick={(event) => event.stopPropagation()} rel="noreferrer noopener" target="_blank" title={presentation.href}>
      {presentation.label}
    </a>
  ) : <span className="semantic-metric-empty">—</span>;
}

function keywordCheckedAt(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  return position ? (
    <time dateTime={position.observedAt} title={new Date(position.observedAt).toLocaleString("ru-RU")}>
      {formatDate(position.observedAt)}
    </time>
  ) : <span className="semantic-metric-empty">—</span>;
}

function keywordNotFoundMark(searchEngine: "GOOGLE" | "YANDEX") {
  return (
    <span
      aria-label={`${searchEngine === "YANDEX" ? "Яндекс" : "Google"}: позиция не найдена`}
      className="semantic-rank-not-found"
      role="img"
      title="Съём выполнен, позиция не найдена"
    >
      ×
    </span>
  );
}

function keywordVisibilityPercent(item: SemanticKeyword): number {
  const positions = item.positions?.filter(({ found, position }) => found && position !== undefined) ?? [];
  if (positions.length === 0) return 0;
  return Math.round(
    positions.reduce((sum, { position = 100 }) => sum + Math.max(0, 101 - position), 0) /
      positions.length
  );
}

function keywordFrequency(
  item: SemanticKeyword,
  type: "BASE" | "EXACT" | "FIXED"
) {
  const frequency =
    item.frequencies?.find((entry) => entry.type === type) ??
    (type === "BASE" ? item.frequency : undefined);
  return frequency?.value ? (
    <span
      className="semantic-metric-value"
      title={`${frequency.provider} · регион ${frequency.regionCode}`}
    >
      {formatInteger(Number(frequency.value))}
    </span>
  ) : (
    <span className="semantic-metric-empty">—</span>
  );
}

function countKeywordWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function compareGroupTreeOrder(
  left: SemanticGroupTreeItem,
  right: SemanticGroupTreeItem
): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function keywordPosition(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  if (position && !position.found) {
    const description = position.previousPosition === undefined
      ? `${searchEngine === "YANDEX" ? "Яндекс" : "Google"}: позиция не найдена`
      : `${searchEngine === "YANDEX" ? "Яндекс" : "Google"}: позиция не найдена. Была ${position.previousPosition}`;
    return (
      <span aria-label={description} className="semantic-position-value not-found" title={description}>
        {keywordNotFoundMark(searchEngine)}
        {position.previousPosition !== undefined && (
          <small aria-hidden="true">Была {position.previousPosition}</small>
        )}
      </span>
    );
  }
  if (!position || position.position === undefined) {
    return <span className="semantic-metric-empty">—</span>;
  }
  const change = rankChangePresentation(
    position.position,
    position.previousPosition
  );
  return (
    <span
      aria-label={change.ariaLabel}
      className={`semantic-position-value ${change.tone}`}
      title={change.title}
    >
      <strong aria-hidden="true">{position.position}</strong>
      <small aria-hidden="true">{change.label}</small>
    </span>
  );
}

function formatCustomValue(
  column: SemanticCustomColumn,
  value: string | number | boolean | readonly string[]
): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (Array.isArray(value)) {
    return value
      .map(
        (item) =>
          column.config.options?.find(({ id }) => id === item)?.label ?? item
      )
      .join(", ");
  }
  if (column.type === "SELECT" || column.type === "STATUS") {
    return (
      column.config.options?.find(({ id }) => id === value)?.label ??
      String(value)
    );
  }
  return String(value);
}

function hasActiveFilters(config: SemanticViewConfig): boolean {
  return Object.keys(config.filters).length > 0 ||
    config.sort !== defaultSemanticViewConfig.sort;
}

function booleanFilter(value: boolean | undefined): string {
  return value === undefined ? "" : String(value);
}

function activeFilterCount(filters: SemanticViewConfig["filters"]): number {
  return Object.entries(filters).filter(([key, value]) =>
    key !== "search" && value !== undefined && value !== ""
  ).length;
}

function mergeKeywords(
  current: readonly SemanticKeyword[],
  next: readonly SemanticKeyword[]
): readonly SemanticKeyword[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()];
}

function mergeKeywordMetrics(
  current: readonly SemanticKeyword[],
  next: readonly SemanticKeyword[]
): readonly SemanticKeyword[] {
  const nextById = new Map(next.map((item) => [item.id, item]));
  return current.map((item) => {
    const updated = nextById.get(item.id);
    return updated ? { ...item, ...updated } : item;
  });
}

function keywordErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "FORBIDDEN") {
      return "У вас нет доступа к семантике этого проекта.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return "Параметры поиска устарели. Сбросьте поиск и повторите.";
    }
    return error.message;
  }
  return "Не удалось загрузить семантическое ядро.";
}

function keywordMutationError(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Запрос уже изменён другим пользователем. Обновите таблицу и повторите правку.";
    }
    if (error.code === "DUPLICATE") {
      return "Такой запрос с этим языком уже есть в проекте.";
    }
    if (error.code === "FORBIDDEN") {
      return "У вас нет права изменять семантическое ядро.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return error.fieldErrors[0]?.message ?? "Проверьте заполненные поля.";
    }
    return error.message;
  }
  return "Не удалось сохранить изменение.";
}

function parseTagNames(value: string): readonly string[] {
  return [
    ...new Map(
      value
        .split(",")
        .map((tag) => tag.normalize("NFKC").trim())
        .filter(Boolean)
        .map((tag) => [tag.toLocaleLowerCase(), tag] as const)
    ).values()
  ].slice(0, 50);
}

function intentLabel(intent: SemanticKeywordIntent | undefined): string {
  if (!intent) return "—";
  const labels: Readonly<Record<SemanticKeywordIntent, string>> = {
    INFORMATIONAL: "Информационный",
    NAVIGATIONAL: "Навигационный",
    COMMERCIAL: "Коммерческий",
    TRANSACTIONAL: "Транзакционный",
    LOCAL: "Локальный",
    MIXED: "Смешанный"
  };
  return labels[intent];
}

function sourceModeLabel(mode: SemanticKeyword["sourceMode"]): string {
  const labels: Readonly<Record<SemanticKeyword["sourceMode"], string>> = {
    BYOK: "Свой API",
    PLATFORM: "Платформа",
    IMPORT: "Импорт",
    MANUAL: "Вручную"
  };
  return labels[mode];
}

function isEditableCopyTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric"
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
