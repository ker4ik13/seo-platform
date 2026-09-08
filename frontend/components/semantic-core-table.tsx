"use client";
import { prepareOperationAttempt, type OperationAttempt } from "../lib/operation-attempt";

import { CustomSelect } from "./custom-select";
import { KeywordTagPicker } from "./keyword-tag-picker";
import { uniqueKeywordTags } from "../lib/keyword-tags";
import { rankColumnLabel, rankDimensionColumns, rankDimensionLabel } from "../lib/rank-dimension-presentation";
import { useSemanticRankComparison } from "./use-semantic-rank-comparison";
import {
  SemanticRankCheckedAtCell,
  SemanticRankComparisonCell,
  SemanticRankPositionCell,
  SemanticRankUrlCell
} from "./semantic-rank-comparison-cell";
import { SemanticRankContext } from "./semantic-rank-context";

import {
  semanticKeywordDefaultPageSize,
  semanticCompetitorRowColumnKeys,
  isSemanticRankDimensionSort,
  parseSemanticRankColumnKey,
  parseSemanticRankDimensionKey,
  type SemanticRankDimension,
  semanticKeywordPageSizes,
  semanticSavedViewQueryIndicators,
  semanticSystemColumnKeys,
  type SemanticKeywordPageSize,
  type SemanticKeywordMultiSearch,
  type SemanticKeywordBulkCreatePreviewResult,
  type SemanticKeywordBulkCreateResult,
  type CreateWordstatExpansionRunInput,
  type KeywordResearchRunSummary,
  type AiAnswerCollectionSummary,
  type ClusteringRunSummary,
  type FrequencyCollectionSummary,
  type RankJobSummary,
  type SemanticExportColumnKey,
  type SemanticExportJobSummary,
  type SemanticPositionHistorySearchEngine
} from "@seo-platform/contracts";
import type { ProjectPresenceActivity } from "@seo-platform/contracts";

import {
  useCallback,
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
  BrowserApiError,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";
import { semanticExportFileUrl } from "../lib/app-path";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  manualKeywordDuplicateCanApply,
  manualKeywordDuplicatePolicy,
  manualKeywordInputStats,
  manualKeywordTexts,
  runManualKeywordBulkChunks,
  runManualKeywordBulkPreviewChunks
} from "../lib/manual-keyword-input";
import {
  initialSemanticCreateGroupId,
  semanticClipboardText,
  semanticHighlightAllRows,
  semanticHighlightAfterRowClick,
  semanticSelectionScopeSignature,
  toggleSemanticHighlightedSelection
} from "../lib/semantic-row-selection";
import {
  hasSemanticAiAnswerSnapshot,
  rankChangePresentation,
  sameSemanticRankingUrl
} from "../lib/semantic-rank-presentation";
import {
  clampSemanticColumnWidth,
  clampSemanticGroupSidebarWidth,
  normalizeSemanticKeywordPageSize,
  readSemanticLayoutPreferences,
  semanticAppliedTableLayoutConfig,
  semanticColumnDefaultWidth,
  semanticColumnMaxWidth,
  semanticColumnMinWidth,
  semanticGroupSidebarDefaultWidth,
  semanticGroupSidebarMaxWidth,
  semanticGroupSidebarMinWidth,
  semanticSavedViewConfigForPersistence,
  semanticVisibleColumnWidths,
  writeSemanticLayoutPreferences
} from "../lib/semantic-layout-preferences";
import {
  readSemanticManualAddPreferences,
  writeSemanticManualAddPreferences
} from "../lib/semantic-manual-add-preferences";
import { semanticKeywordSearchPlaceholder } from "../lib/semantic-group-selection";
import { normalizeSemanticGroupName } from "../lib/semantic-group-name-batch";
import {
  semanticResearchImportSignature,
  shouldRefreshSemanticOperationMetrics,
  shouldRefreshSemanticResearchImport
} from "../lib/semantic-live-operation-metrics";
import { SemanticBulkEditor } from "./semantic-bulk-editor";
import { ContextMenu, type ContextMenuItem } from "./context-menu";
import type { SemanticCustomColumn } from "./semantic-custom-column-types";
import { SemanticCustomValueEditor } from "./semantic-custom-value-editor";
import {
  SemanticGroupDialog,
  type SemanticGroupDialogState
} from "./semantic-group-dialog";
import { SemanticGroupPickerField } from "./semantic-group-picker";
import {
  SemanticGroupTree,
  type SemanticGroupRemotePresence,
  type SemanticGroupTreeDropTarget,
  type SemanticGroupTreeItem
} from "./semantic-group-tree";
import { SemanticKeywordMoveDialog } from "./semantic-keyword-move-dialog";
import {
  SemanticMultiSearchDialog,
  type SemanticMultiSearchAction
} from "./semantic-multi-search-dialog";
import { SemanticKeywordInspector } from "./semantic-keyword-inspector";
import { SemanticProjectSerpResults } from "./semantic-project-serp-results";
import { SemanticPositionDialog } from "./semantic-position-dialog";
import { SemanticFrequencyDialog } from "./semantic-frequency-dialog";
import { WordstatExpansionDialog } from "./keyword-research-workspace";
import { SemanticAiAnswerDialog } from "./semantic-ai-answer-dialog";
import { SemanticClusteringDialog } from "./semantic-clustering-dialog";
import { SemanticAiAnswerDetailsModal } from "./semantic-ai-answer-details-modal";
import { SemanticOperationsDrawer } from "./semantic-operations-drawer";
import { SemanticLayoutDrawer } from "./semantic-layout-drawer";
import { SemanticNegativeKeywordsDialog } from "./semantic-negative-keywords-dialog";
import { SemanticDuplicatesDialog } from "./semantic-duplicates-dialog";
import { SemanticModal } from "./semantic-modal";
import { SemanticExportFolderPicker } from "./semantic-export-folder-picker";
import { SemanticVersionHistory } from "./semantic-version-history";
import { SearchEngineLogo } from "./search-engine-logo";
import {
  KeywordDataGrid,
  type KeywordDataGridRowPresence
} from "./keyword-data-grid";
import { Icon } from "./icon";
import { ProjectSelect } from "./project-select";
import {
  requestProjectOperationActivityRefresh,
  useProjectActiveOperationCount
} from "./project-operation-activity-provider";
import { useProjectPresence } from "./project-presence-provider";
import {
  normalizeProjectPresenceView,
  projectPresenceAvatarUrl,
  projectPresenceInitials,
  sameProjectPresenceView
} from "../lib/project-presence";
import type { AppProject } from "../lib/app-types";
import {
  defaultSemanticViewConfig,
  isInternalSemanticViewName,
  semanticColumnOrderFor,
  semanticQueryIndicatorsFor,
  semanticFolderSortConfigFor,
  semanticFolderSortViewName,
  semanticFolderSortViewPrefix,
  semanticProjectTableViewName,
  semanticViewConfigForCurrentSchema,
  type SemanticKeywordIntent,
  type SemanticKeywordSort,
  type SemanticQueryIndicator,
  type SemanticSavedView,
  type SemanticSystemColumn,
  type SemanticViewColumn,
  type SemanticViewConfig,
  type SemanticViewFilters
} from "./semantic-view-types";
import { UiText, useUiLocale, UiElement } from "./ui-locale";


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
    dimension?: SemanticRankDimension;
    found: boolean;
    position?: number;
    previousPosition?: number;
    rankingUrl?: string;
    siteResults?: readonly Readonly<{
      position: number;
      rankingUrl: string;
      title?: string;
      snippet?: string;
    }>[];
    observedAt: string;
  }>[];
  readonly aiAnswers?: readonly Readonly<{
    searchEngine: "GOOGLE" | "YANDEX";
    answerPresent: boolean;
    siteFound: boolean;
    position?: number;
    previousPosition?: number;
    rankingUrl?: string;
    brandFound: boolean;
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
  readonly addDuplicatesToGroup: boolean;
  readonly text: string;
  readonly language: string;
  readonly priority: string;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly skipDuplicates: boolean;
  readonly intent: "" | SemanticKeywordIntent;
  readonly groupId: string;
  readonly clusterId: string;
  readonly targetUrl: string;
  readonly tagNames: readonly string[];
}

type KeywordEditor =
  | Readonly<{ mode: "create"; draft: KeywordDraft }>
  | Readonly<{
      mode: "edit";
      keywordId: string;
      version: number;
      draft: KeywordDraft;
    }>;

interface ManualKeywordDuplicateReview {
  readonly texts: readonly string[];
  readonly preview: SemanticKeywordBulkCreatePreviewResult;
  readonly selectedIndices: ReadonlySet<number>;
}

const MANUAL_KEYWORD_LIMIT = 2_000;
const SEMANTIC_KEYWORD_EDITOR_FORM_ID = "semantic-keyword-editor-form";

interface SemanticCoreTableProps {
  readonly canReorderProjects: boolean;
  readonly currentUserId: string;
  readonly columnRefreshVersion: number;
  readonly clusterRefreshVersion: number;
  readonly projectId: string;
  readonly refreshVersion: number;
  readonly groupRefreshVersion: number;
  readonly onGroupsChanged: () => void;
  readonly onOpenColumns: () => void;
  readonly onOpenImport: () => void;
  readonly projectName: string;
  readonly projects: readonly Pick<
    AppProject,
    "id" | "name" | "domain" | "version" | "activeOperationCount" | "searchCity"
  >[];
  readonly workspaceId: string;
  readonly workspaceRoleCode: string;
}

type SemanticExportFormat =
  | "CSV"
  | "TSV"
  | "JSON"
  | "NDJSON"
  | "GOOGLE_CSV"
  | "XLSX";

type SemanticExportScope = "CURRENT_FILTER" | "SELECTED" | "GROUP_SUBTREE";
type SemanticExportContent = "SEMANTIC" | "POSITION_HISTORY" | "FOLDER_MAP" | "COMPETITORS";

interface SemanticExportDialogState {
  readonly groupId?: string;
}

export function SemanticCoreTable({
  canReorderProjects,
  currentUserId,
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
  workspaceId,
  workspaceRoleCode
}: SemanticCoreTableProps) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const {
    activeParticipants,
    currentRoute,
    currentUserId: presenceCurrentUserId,
    currentView,
    publishActivity,
    publishSelection,
    publishView,
    showRemoteActivity
  } = useProjectPresence();
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
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  const [editor, setEditor] = useState<KeywordEditor>();
  const [manualDuplicateReview, setManualDuplicateReview] =
    useState<ManualKeywordDuplicateReview>();
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [multiGroupIds, setMultiGroupIds] = useState<readonly string[]>([]);
  const [clusters, setClusters] = useState<readonly SemanticCluster[]>([]);
  const [tagOptions, setTagOptions] = useState<readonly string[]>([]);
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
  const [exportContent, setExportContent] =
    useState<SemanticExportContent>("SEMANTIC");
  const [exportHistoryEngines, setExportHistoryEngines] = useState<
    readonly SemanticPositionHistorySearchEngine[]
  >(["YANDEX"]);
  const [exportHistoryFrom, setExportHistoryFrom] = useState(
    () => semanticHistoryDefaultRange().from
  );
  const [exportHistoryTo, setExportHistoryTo] = useState(
    () => semanticHistoryDefaultRange().to
  );
  const [exportHistoryIncludeUntracked, setExportHistoryIncludeUntracked] =
    useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportCancelling, setExportCancelling] = useState(false);
  const [exportJob, setExportJob] = useState<SemanticExportJobSummary>();
  const [exportNotice, setExportNotice] = useState<string>();
  const [exportDialog, setExportDialog] = useState<SemanticExportDialogState>();
  const [exportScope, setExportScope] =
    useState<SemanticExportScope>("CURRENT_FILTER");
  const [exportColumns, setExportColumns] = useState<readonly SemanticExportColumnKey[]>(
    defaultSemanticViewConfig.columns
  );
  const [exportFolderMapGroupIds, setExportFolderMapGroupIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [exportFolderMapIncludeDescendants, setExportFolderMapIncludeDescendants] = useState(true);
  const [exportBom, setExportBom] = useState(true);
  const [, setProjectTableView] = useState<SemanticSavedView>();
  const [activeSavedView, setActiveSavedView] = useState<SemanticSavedView>();
  const [activeSavedViewBaseline, setActiveSavedViewBaseline] = useState("");
  const [folderSortViews, setFolderSortViews] = useState<
    readonly SemanticSavedView[]
  >([]);
  const [savingTableLayout, setSavingTableLayout] = useState(false);
  const [savingFolderSort, setSavingFolderSort] = useState(false);
  const [groupSidebarWidth, setGroupSidebarWidth] = useState(
    semanticGroupSidebarDefaultWidth
  );
  const [mobileGroupTreeOpen, setMobileGroupTreeOpen] = useState(false);
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
  const manualAddPreferencesRef = useRef({
    addDuplicatesToGroup: false,
    skipDuplicates: true
  });
  const [rightSidebar, setRightSidebar] = useState<
    | Readonly<{ type: "KEYWORD"; keywordId: string }>
    | Readonly<{ type: "HISTORY" | "OPERATIONS" | "LAYOUT" }>
  >();
  const [groupDialog, setGroupDialog] = useState<SemanticGroupDialogState>();
  const [moveKeywordDialog, setMoveKeywordDialog] = useState(false);
  const [multiSearchDialogOpen, setMultiSearchDialogOpen] = useState(false);
  const [multiSearch, setMultiSearch] = useState<SemanticKeywordMultiSearch>();
  const [moveKeywordTargetId, setMoveKeywordTargetId] = useState("");
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [actionIds, setActionIds] = useState<ReadonlySet<string> | null>(null);
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [competitorDialogOpen, setCompetitorDialogOpen] = useState(false);
  const [frequencyDialogOpen, setFrequencyDialogOpen] = useState(false);
  const [wordstatDialogOpen, setWordstatDialogOpen] = useState(false);
  const [aiAnswerDialogOpen, setAiAnswerDialogOpen] = useState(false);
  const [aiCompetitorDialogOpen, setAiCompetitorDialogOpen] = useState(false);
  const [clusteringDialogOpen, setClusteringDialogOpen] = useState(false);
  const [aiAnswerKeyword, setAiAnswerKeyword] = useState<SemanticKeyword>();
  const [negativeKeywordsOpen, setNegativeKeywordsOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [siteResultsKeyword, setSiteResultsKeyword] = useState<SemanticKeyword>();
  const [watchedFrequencyId, setWatchedFrequencyId] = useState<string>();
  const [operationsRefreshVersion, setOperationsRefreshVersion] = useState(0);
  const activeOperationCount = useProjectActiveOperationCount(
    projectId,
    projects.find(({ id }) => id === projectId)?.activeOperationCount ?? 0
  );
  const projectDomain = projects.find(({ id }) => id === projectId)?.domain ?? "";
  const [rowContextMenu, setRowContextMenu] = useState<Readonly<{
    x: number;
    y: number;
  }>>();
  const [commandMenu, setCommandMenu] = useState<Readonly<{
    kind: "WORDSTAT" | "POSITIONS" | "COMPETITORS";
    x: number;
    y: number;
  }>>();
  const commandMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const selectAllAbortRef = useRef<AbortController | undefined>(undefined);
  const multiSearchActionRef = useRef<
    Exclude<SemanticMultiSearchAction, "SHOW"> | undefined
  >(undefined);
  const wordstatCreateCommandRef = useRef<
    OperationAttempt | undefined
  >(undefined);
  const selectAllMatchingKeywordsRef = useRef<(
    postAction: "SELECT" | "MOVE" | "HIGHLIGHT",
    config: SemanticKeywordLoadConfig
  ) => Promise<void>>(async () => undefined);
  const highlightAllKeywordsRef = useRef<() => void>(() => undefined);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const highlightAnchorIdRef = useRef<string | undefined>(undefined);
  const selectionScopeSignatureRef = useRef<string | undefined>(undefined);
  const liveOperationSignatureRef = useRef("");
  const liveResearchImportSignatureRef = useRef("[]");
  const liveMetricRefreshInFlightRef = useRef(false);
  const liveOperationActiveRef = useRef(false);
  const savedViewAutosaveBaselineRef = useRef("");
  const savedViewAutosaveInFlightRef = useRef<string | undefined>(undefined);
  const activeSavedViewRef = useRef<SemanticSavedView | undefined>(undefined);
  const activeSavedViewProjectIdRef = useRef("");
  const projectTableViewRef = useRef<SemanticSavedView | undefined>(undefined);
  const [tableViewport, setTableViewport] = useState({
    height: 520,
    scrollTop: 0
  });
  useEffect(() => {
    if (!mobileGroupTreeOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileGroupTreeOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileGroupTreeOpen]);
  const keywordQueryConfig = useMemo(
    () => ({
      filters: viewConfig.filters,
      sort: viewConfig.sort,
      ...(viewConfig.rankSortDimensionKey
        ? { rankSortDimensionKey: viewConfig.rankSortDimensionKey }
        : {}),
      ...(multiSearch ? { multiSearch } : {}),
      ...(multiGroupIds.length > 1 ? { groupIds: multiGroupIds } : {})
    }),
    [multiGroupIds, multiSearch, viewConfig.filters, viewConfig.rankSortDimensionKey, viewConfig.sort]
  );
  const selectionScopeSignature = semanticSelectionScopeSignature({
    projectId,
    filters: keywordQueryConfig.filters,
    ...(keywordQueryConfig.groupIds
      ? { groupIds: keywordQueryConfig.groupIds }
      : {}),
    ...(keywordQueryConfig.multiSearch
      ? { multiSearch: keywordQueryConfig.multiSearch }
      : {})
  });
  const currentSavedViewConfig = useMemo<SemanticViewConfig>(
    () => ({
      ...viewConfig,
      columnWidths: semanticVisibleColumnWidths(
        viewConfig.columns,
        columnWidths
      ),
      pageSize,
      groupSidebarWidth,
      expandedGroupIds: expandedGroupIds ? [...expandedGroupIds] : [],
      selectedGroupIds: multiGroupIds
    }),
    [columnWidths, expandedGroupIds, groupSidebarWidth, multiGroupIds, pageSize, viewConfig]
  );
  const draftSavedViewConfig = useMemo<SemanticViewConfig>(
    () => ({
      ...draftConfig,
      columnWidths: semanticVisibleColumnWidths(
        draftConfig.columns,
        columnWidths
      ),
      pageSize,
      groupSidebarWidth,
      expandedGroupIds: expandedGroupIds ? [...expandedGroupIds] : [],
      selectedGroupIds: multiGroupIds
    }),
    [columnWidths, draftConfig, expandedGroupIds, groupSidebarWidth, multiGroupIds, pageSize]
  );
  const isActiveSavedViewDirty = useMemo(
    () => Boolean(
      activeSavedView &&
      semanticViewConfigSignature(draftSavedViewConfig) !==
        activeSavedViewBaseline
    ),
    [activeSavedView, activeSavedViewBaseline, draftSavedViewConfig]
  );
  const debouncedSearch = useDebouncedValue(
    draftConfig.filters.search ?? "",
    300
  );
  const debouncedTagSearch = useDebouncedValue(
    draftConfig.filters.tag ?? "",
    250
  );
  const presenceGroupIds = useMemo<readonly string[]>(
    () =>
      multiGroupIds.length > 1
        ? [...new Set(multiGroupIds)].sort()
        : viewConfig.filters.groupId
          ? [viewConfig.filters.groupId]
          : [],
    [multiGroupIds, viewConfig.filters.groupId]
  );
  const remoteSemanticParticipants = useMemo(
    () =>
      showRemoteActivity
        ? activeParticipants.filter(
        (active) =>
          active.userId !== presenceCurrentUserId &&
          active.participant.status === "ACTIVE" &&
          active.participant.route === currentRoute &&
          active.participant.view?.kind === "SEMANTIC_CORE"
          )
        : [],
    [
      activeParticipants,
      currentRoute,
      presenceCurrentUserId,
      showRemoteActivity
    ]
  );
  const remoteSemanticGroupPresence = useMemo<
    readonly SemanticGroupRemotePresence[]
  >(
    () =>
      remoteSemanticParticipants.map((active) => ({
        userId: active.userId,
        displayName: active.member.displayName,
        colorIndex: active.colorIndex,
        groupIds: active.participant.view?.groupIds ?? []
      })),
    [remoteSemanticParticipants]
  );
  const remoteKeywordPresence = useMemo<
    ReadonlyMap<string, KeywordDataGridRowPresence>
  >(() => {
    const draft = new Map<
      string,
      {
        colorIndex: number;
        kind: KeywordDataGridRowPresence["kind"];
        names: string[];
        avatarUrl?: string;
        initials: string;
      }
    >();
    for (const active of remoteSemanticParticipants) {
      if (!sameProjectPresenceView(active.participant.view, currentView)) {
        continue;
      }
      const selection = active.participant.selection;
      if (!selection || selection.entity !== "KEYWORD") continue;
      const keywordKinds = new Map<string, KeywordDataGridRowPresence["kind"]>();
      for (const keywordId of selection.selectedIds) {
        keywordKinds.set(keywordId, "SELECTED");
      }
      for (const keywordId of selection.highlightedIds) {
        keywordKinds.set(keywordId, "HIGHLIGHTED");
      }
      for (const [keywordId, kind] of keywordKinds) {
        const existing = draft.get(keywordId);
        if (!existing) {
          const avatarUrl = projectPresenceAvatarUrl(
            projectId,
            active.member
          );
          draft.set(keywordId, {
            colorIndex: active.colorIndex,
            kind,
            names: [active.member.displayName],
            ...(avatarUrl ? { avatarUrl } : {}),
            initials: projectPresenceInitials(active.member.displayName)
          });
          continue;
        }
        if (!existing.names.includes(active.member.displayName)) {
          existing.names.push(active.member.displayName);
        }
        if (kind === "HIGHLIGHTED") existing.kind = "HIGHLIGHTED";
      }
    }
    return new Map(
      [...draft].map(([keywordId, presence]) => [
        keywordId,
        {
          colorIndex: presence.colorIndex,
          kind: presence.kind,
          label: `Выделяют: ${presence.names.join(", ")}`,
          ...(presence.avatarUrl ? { avatarUrl: presence.avatarUrl } : {}),
          initials: presence.initials
        }
      ])
    );
  }, [currentView, projectId, remoteSemanticParticipants]);

  const remoteActivityParticipants = useMemo(
    () =>
      new Map(
        remoteSemanticParticipants.flatMap((active) =>
          active.participant.activity
            ? [[active.participant.activity, active] as const]
            : []
        )
      ),
    [remoteSemanticParticipants]
  );
  const localPresenceActivity: ProjectPresenceActivity | null = editor
    ? editor.mode === "create"
      ? "SEMANTIC_ADD"
      : "SEMANTIC_EDIT"
    : clusteringDialogOpen
      ? "SEMANTIC_CLUSTERING"
      : wordstatDialogOpen
        ? "SEMANTIC_WORDSTAT"
        : frequencyDialogOpen
          ? "SEMANTIC_FREQUENCY"
          : positionDialogOpen
          ? "SEMANTIC_POSITIONS"
          : aiAnswerDialogOpen || aiAnswerKeyword
            ? "SEMANTIC_AI_ANSWERS"
            : negativeKeywordsOpen
              ? "SEMANTIC_NEGATIVE_KEYWORDS"
              : duplicatesOpen
                ? "SEMANTIC_DUPLICATES"
                : deleteSelectionOpen
                  ? "SEMANTIC_DELETE"
                  : exportDialog
                    ? "SEMANTIC_EXPORT"
                    : rightSidebar?.type === "HISTORY"
                      ? "SEMANTIC_HISTORY"
                      : rightSidebar?.type === "OPERATIONS"
                        ? "SEMANTIC_OPERATIONS"
                        : rightSidebar?.type === "LAYOUT"
                          ? "SEMANTIC_LAYOUT"
                          : rightSidebar?.type === "KEYWORD" || siteResultsKeyword
                            ? "SEMANTIC_KEYWORD"
                            : groupDialog?.mode === "move" || moveKeywordDialog
                              ? "SEMANTIC_MOVE"
                              : groupDialog
                                ? "SEMANTIC_GROUP"
                                : bulkEditorOpen || customValueEditor
                                  ? "SEMANTIC_EDIT"
                                  : null;

  highlightAllKeywordsRef.current = highlightAllKeywords;

  useEffect(() => {
    const nextView = normalizeProjectPresenceView({
      kind: "SEMANTIC_CORE",
      groupIds: presenceGroupIds
    });
    if (sameProjectPresenceView(currentView, nextView)) return;
    publishView(nextView);
  }, [currentView, presenceGroupIds, projectId, publishView]);

  useEffect(
    () => () => publishView(null),
    [publishView]
  );

  useEffect(() => {
    const selectedIds = [...checkedIds];
    const highlighted = [...highlightedIds];
    publishSelection(
      selectedIds.length > 0 || highlighted.length > 0
        ? {
            entity: "KEYWORD",
            selectedIds,
            highlightedIds: highlighted,
            columnId: null
          }
        : null
    );
  }, [checkedIds, highlightedIds, publishSelection]);

  useEffect(() => {
    publishActivity(localPresenceActivity);
  }, [localPresenceActivity, publishActivity]);

  useEffect(
    () => () => {
      publishSelection(null);
      publishActivity(null);
    },
    [publishActivity, publishSelection]
  );

  useEffect(() => {
    applySearch(debouncedSearch);
  }, [debouncedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (debouncedTagSearch.trim()) {
      query.set("search", debouncedTagSearch.trim());
    }
    const serializedQuery = query.toString();
    const suffix = serializedQuery ? `?${serializedQuery}` : "";
    void browserApiRequest<readonly string[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/tag-options${suffix}`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setTagOptions(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTagOptions([]);
      });
    return () => controller.abort();
  }, [debouncedTagSearch, projectId]);

  useEffect(() => {
    activeSavedViewRef.current = undefined;
    activeSavedViewProjectIdRef.current = "";
    projectTableViewRef.current = undefined;
    setActiveSavedView(undefined);
    setActiveSavedViewBaseline("");
    savedViewAutosaveBaselineRef.current = "";
    setMultiGroupIds([]);
    const preferences = readSemanticLayoutPreferences(
      projectId,
      window.localStorage
    );
    manualAddPreferencesRef.current = readSemanticManualAddPreferences(
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
    if (
      !activeSavedView ||
      activeSavedView.scope !== "PRIVATE" ||
      activeSavedViewProjectIdRef.current !== projectId
    ) return;
    const signature = semanticViewConfigSignature(currentSavedViewConfig);
    if (signature === savedViewAutosaveBaselineRef.current) return;
    const view = activeSavedView;
    const timer = window.setTimeout(() => {
      const liveView = activeSavedViewRef.current;
      const requestKey = `${projectId}:${view.id}`;
      if (
        !liveView ||
        liveView.id !== view.id ||
        liveView.scope !== "PRIVATE" ||
        activeSavedViewProjectIdRef.current !== projectId ||
        savedViewAutosaveInFlightRef.current === requestKey
      ) return;
      savedViewAutosaveInFlightRef.current = requestKey;
      void browserApiRequest<SemanticSavedView>(
        `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(liveView.id)}`,
        {
          method: "PATCH",
          body: { config: currentSavedViewConfig },
          ifMatch: liveView.version
        }
      )
        .then((updated) => {
          if (activeSavedViewProjectIdRef.current !== projectId) return;
          savedViewAutosaveBaselineRef.current = signature;
          setActiveSavedViewBaseline(signature);
          activeSavedViewRef.current = updated;
          setActiveSavedView((current) =>
            current?.id === updated.id ? updated : current
          );
          if (updated.name === semanticProjectTableViewName) {
            setProjectTableView(updated);
          }
        })
        .catch((requestError: unknown) => {
          if (requestError instanceof BrowserApiError && requestError.status === 412) {
            activeSavedViewRef.current = undefined;
            activeSavedViewProjectIdRef.current = "";
            setActiveSavedView(undefined);
            setActiveSavedViewBaseline("");
            setMutationError(
              "Личное представление изменилось в другой вкладке. Откройте его заново."
            );
            return;
          }
          setMutationError(savedViewMutationErrorMessage(requestError));
        })
        .finally(() => {
          if (savedViewAutosaveInFlightRef.current === requestKey) {
            savedViewAutosaveInFlightRef.current = undefined;
          }
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeSavedView, currentSavedViewConfig, projectId]);

  useEffect(() => {
    if (!rightSidebar) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          ".semantic-keyword-inspector, .semantic-operations-drawer, .semantic-history-drawer, .semantic-layout-drawer, .semantic-modal, [data-semantic-sidebar-trigger], [data-exclusive-dropdown-layer]"
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
    const previousSignature = selectionScopeSignatureRef.current;
    selectionScopeSignatureRef.current = selectionScopeSignature;
    if (
      previousSignature === undefined ||
      previousSignature === selectionScopeSignature
    ) {
      return;
    }
    selectAllAbortRef.current?.abort();
    selectAllAbortRef.current = undefined;
    setSelectingAll(false);
    setCheckedIds(new Set());
    setHighlightedIds(new Set());
    highlightAnchorIdRef.current = undefined;
  }, [selectionScopeSignature]);

  useEffect(() => {
    const controller = new AbortController();
    const preservedScrollTop = tableScrollRef.current?.scrollTop ?? 0;
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
        const pendingMultiSearchAction = multiSearchActionRef.current;
        if (pendingMultiSearchAction) {
          multiSearchActionRef.current = undefined;
          void selectAllMatchingKeywordsRef.current(
            pendingMultiSearchAction,
            keywordQueryConfig
          );
        }
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
      const [
        frequencyResult,
        rankResult,
        aiAnswerResult,
        clusteringResult,
        researchResult
      ] = await Promise.allSettled([
        browserApiRequest<{ readonly collections: readonly FrequencyCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
          { signal: controller.signal }
        ),
        browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`,
          { signal: controller.signal }
        ),
        browserApiRequest<{ readonly collections: readonly AiAnswerCollectionSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/ai-answer-collections`,
          { signal: controller.signal }
        ),
        browserApiRequest<{ readonly runs: readonly ClusteringRunSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs`,
          { signal: controller.signal }
        ),
        browserApiRequest<{ readonly runs: readonly KeywordResearchRunSummary[] }>(
          `/app/api/projects/${encodeURIComponent(projectId)}/keyword-research-runs`,
          { signal: controller.signal }
        )
      ]);
      if (controller.signal.aborted) return liveOperationActiveRef.current;
      const frequencies = frequencyResult.status === "fulfilled"
        ? frequencyResult.value.collections
        : [];
      const ranks = rankResult.status === "fulfilled" ? rankResult.value.jobs : [];
      const aiAnswers = aiAnswerResult.status === "fulfilled"
        ? aiAnswerResult.value.collections
        : [];
      const clusteringRuns = clusteringResult.status === "fulfilled"
        ? clusteringResult.value.runs
        : [];
      const researchRuns = researchResult.status === "fulfilled"
        ? researchResult.value.runs
        : [];
      const activeFrequencyCount = frequencies.filter(({ status }) => ![
        "ACTION_REQUIRED",
        "CANCELLED",
        "PARTIALLY_COMPLETED",
        "COMPLETED",
        "FAILED_FINAL"
      ].includes(status)).length;
      const activeRankCount = ranks.filter(({ status }) => ![
        "COMPLETED",
        "PARTIALLY_COMPLETED",
        "CANCELLED",
        "FAILED",
        "ACTION_REQUIRED"
      ].includes(status)).length;
      const activeAiAnswerCount = aiAnswers.filter(({ status }) => ![
        "ACTION_REQUIRED",
        "CANCELLED",
        "PARTIALLY_COMPLETED",
        "COMPLETED",
        "FAILED_FINAL"
      ].includes(status)).length;
      const activeClusteringCount = clusteringRuns.filter(({ status }) => ![
        "ACTION_REQUIRED",
        "CANCELLED",
        "PARTIALLY_COMPLETED",
        "COMPLETED",
        "FAILED_FINAL"
      ].includes(status)).length;
      const activeResearchCount = researchRuns.filter(({ status }) => [
        "QUEUED",
        "RUNNING",
        "RETRY_SCHEDULED",
        "IMPORT_QUEUED",
        "IMPORTING"
      ].includes(status)).length;
      const nextActiveOperationCount = activeFrequencyCount + activeRankCount +
        activeAiAnswerCount + activeClusteringCount + activeResearchCount;
      const active = nextActiveOperationCount > 0;
      liveOperationActiveRef.current = active;
      if (researchResult.status === "fulfilled") {
        const researchImportSignature = semanticResearchImportSignature(researchRuns);
        const previousResearchImportSignature = liveResearchImportSignatureRef.current;
        liveResearchImportSignatureRef.current = researchImportSignature;
        if (shouldRefreshSemanticResearchImport(
          previousResearchImportSignature,
          researchImportSignature
        )) {
          setRetryVersion((value) => value + 1);
        }
      }
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
        ]),
        ...aiAnswers.map((job) => [
          "ai-answer",
          job.id,
          job.status,
          job.completedKeywords,
          job.failedKeywords,
          job.updatedAt
        ]),
        ...clusteringRuns.map((job) => [
          "clustering",
          job.id,
          job.status,
          job.completedKeywords,
          job.failedKeywords,
          job.updatedAt
        ]),
        ...researchRuns.map((job) => [
          "keyword-research",
          job.id,
          job.status,
          job.collectedKeywords,
          job.importedKeywords,
          job.version,
          job.updatedAt
        ])
      ]);
      const previous = liveOperationSignatureRef.current;
      liveOperationSignatureRef.current = signature;
      if (!shouldRefreshSemanticOperationMetrics(
        previous,
        signature,
        liveMetricRefreshInFlightRef.current
      )) return active;
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
    requestProjectOperationActivityRefresh();
  }, [operationsRefreshVersion]);

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
  }, [clusterRefreshVersion, projectId, retryVersion]);

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
    projectTableViewRef.current = undefined;
    activeSavedViewRef.current = undefined;
    activeSavedViewProjectIdRef.current = "";
    setActiveSavedView(undefined);
    setActiveSavedViewBaseline("");
    savedViewAutosaveBaselineRef.current = "";
    setFolderSortViews([]);
    void browserApiRequest<readonly SemanticSavedView[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
      { signal: controller.signal }
    )
      .then((views) => {
        if (controller.signal.aborted) return;
        const projectView = views.find(
          ({ name, scope, ownerId }) =>
            name === semanticProjectTableViewName &&
            scope === "PRIVATE" &&
            ownerId === currentUserId
        );
        const sortViews = views.filter(
          ({ name, scope, ownerId }) =>
            name.startsWith(semanticFolderSortViewPrefix) &&
            scope === "PRIVATE" &&
            ownerId === currentUserId
        );
        setProjectTableView(projectView);
        projectTableViewRef.current = projectView;
        setFolderSortViews(sortViews);
        const visibleViews = views.filter(
          ({ name }) => !isInternalSemanticViewName(name)
        );
        const explicitlyAppliedView = projectView?.config.appliedViewId
          ? visibleViews.find(({ id }) => id === projectView.config.appliedViewId)
          : undefined;
        const defaultSharedView = preferredProjectSharedView(visibleViews);
        const appliedView = explicitlyAppliedView ?? defaultSharedView;
        const storedConfig = semanticViewConfigWithoutAppliedView(
          semanticViewConfigForCurrentSchema(
            appliedView?.config ?? projectView?.config ?? defaultSemanticViewConfig
          )
        );
        const nextConfig = appliedView || projectView
          ? storedConfig
          : withFolderSort(
              storedConfig,
              storedConfig.filters.groupId,
              sortViews
            );
        if (appliedView || projectView) {
          const nextPageSize = nextConfig.pageSize ?? layoutPreferencesRef.current.pageSize;
          const nextGroupSidebarWidth = nextConfig.groupSidebarWidth ??
            layoutPreferencesRef.current.groupSidebarWidth;
          layoutPreferencesRef.current = {
            ...layoutPreferencesRef.current,
            groupSidebarWidth: nextGroupSidebarWidth,
            columnWidths: nextConfig.columnWidths ?? {},
            pageSize: nextPageSize,
            expandedGroupIds: nextConfig.expandedGroupIds ?? []
          };
          setDraftConfig(nextConfig);
          setViewConfig(nextConfig);
          setGroupSidebarWidth(nextGroupSidebarWidth);
          setColumnWidths(nextConfig.columnWidths ?? {});
          setPageSize(nextPageSize);
          setExpandedGroupIds(new Set(nextConfig.expandedGroupIds ?? []));
          setMultiGroupIds(nextConfig.selectedGroupIds ?? []);
          const resolvedConfig: SemanticViewConfig = {
            ...nextConfig,
            columnWidths: nextConfig.columnWidths ?? {},
            pageSize: nextPageSize,
            groupSidebarWidth: nextGroupSidebarWidth,
            expandedGroupIds: nextConfig.expandedGroupIds ?? [],
            selectedGroupIds: nextConfig.selectedGroupIds ?? []
          };
          activeSavedViewRef.current = appliedView;
          activeSavedViewProjectIdRef.current = appliedView ? projectId : "";
          setActiveSavedView(appliedView);
          savedViewAutosaveBaselineRef.current = appliedView
            ? semanticViewConfigSignature(resolvedConfig)
            : "";
          setActiveSavedViewBaseline(savedViewAutosaveBaselineRef.current);
        } else {
          setDraftConfig(nextConfig);
          setViewConfig(nextConfig);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [currentUserId, projectId]);

  useEffect(() => {
    if (!bulkNotice && !exportNotice) return;
    const timer = window.setTimeout(() => {
      setBulkNotice(undefined);
      setExportNotice(undefined);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [bulkNotice, exportNotice]);

  useEffect(() => {
    const copySelectedKeywords = (event: KeyboardEvent, uiLocale: string = "ru-RU") => {
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
            `Скопировано выделенных запросов: ${formatInteger(highlightedIds.size, uiLocale)}`
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
  }, [highlightedIds, items, uiLocale]);

  useEffect(() => {
    const selectAllFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase("en") !== "a" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        isEditableCopyTarget(event.target) ||
        window.getSelection()?.toString() ||
        document.querySelector(".semantic-modal[open]")
      ) {
        return;
      }
      const activeElement = document.activeElement;
      const tableOwnsSelection =
        checkedIds.size > 0 ||
        highlightedIds.size > 0 ||
        (activeElement instanceof Node &&
          Boolean(tableScrollRef.current?.contains(activeElement)));
      if (!tableOwnsSelection) return;
      event.preventDefault();
      highlightAllKeywordsRef.current();
    };
    document.addEventListener("keydown", selectAllFromKeyboard);
    return () =>
      document.removeEventListener("keydown", selectAllFromKeyboard);
  }, [checkedIds, highlightedIds]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { search: draftSearch, ...otherFilters } = draftConfig.filters;
    if (otherFilters.groupId) setMultiGroupIds([]);
    const search = draftSearch?.trim();
    setViewConfig(withFolderSort({
      ...draftConfig,
      filters: {
        ...otherFilters,
        ...(search ? { search } : {})
      }
    }, otherFilters.groupId));
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    applySearch(draftConfig.filters.search ?? "");
  }

  function applySearch(value: string): void {
    const search = value.trim();
    if (search) setMultiSearch(undefined);
    setViewConfig((current) => {
      const { search: ignored, ...filters } = current.filters;
      void ignored;
      const nextFilters = search ? { ...filters, search } : filters;
      if ((current.filters.search ?? "") === (search || "")) return current;
      return { ...current, filters: nextFilters };
    });
  }

  function clearSearch(): void {
    setMultiSearch(undefined);
    setDraftConfig((current) => {
      const { search: ignored, ...filters } = current.filters;
      void ignored;
      return { ...current, filters };
    });
    applySearch("");
  }

  function clearFilters(): void {
    setMultiSearch(undefined);
    const currentGroupId = viewConfig.filters.groupId;
    const reset = (current: SemanticViewConfig): SemanticViewConfig => {
      return withFolderSort({
        ...current,
        filters: currentGroupId ? { groupId: currentGroupId } : {}
      }, currentGroupId);
    };
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
    field: "intent" | "groupId" | "clusterId" | "tag",
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
      return withFolderSort({
        ...current,
        filters: groupId ? { ...filters, groupId } : filters
      }, groupId);
    };
    setDraftConfig((current) => apply(current));
    setViewConfig((current) => apply(current));
    setMultiGroupIds([]);
    setCheckedIds(new Set());
    setBulkNotice(undefined);
  }

  function openMultipleGroups(groupIds: readonly string[], uiLocale: string = "ru-RU"): void {
    const uniqueGroupIds = [...new Set(groupIds)].sort();
    if (uniqueGroupIds.length < 2) return;
    const apply = (current: SemanticViewConfig): SemanticViewConfig => {
      const { groupId: ignored, ...filters } = current.filters;
      void ignored;
      return withFolderSort({
        ...current,
        filters
      }, undefined);
    };
    setDraftConfig((current) => apply(current));
    setViewConfig((current) => apply(current));
    setMultiGroupIds(uniqueGroupIds);
    setCheckedIds(new Set());
    setHighlightedIds(new Set());
    highlightAnchorIdRef.current = undefined;
    setBulkNotice(`Открыто групп: ${formatInteger(uniqueGroupIds.length, uiLocale)}`);
  }

  function folderSortConfigFor(
    groupId?: string,
    views: readonly SemanticSavedView[] = folderSortViews
  ): Readonly<Pick<SemanticViewConfig, "sort" | "rankSortDimensionKey">> {
    return semanticFolderSortConfigFor(groupId, views);
  }

  function applySortConfig(
    current: SemanticViewConfig,
    sortConfig: Readonly<Pick<SemanticViewConfig, "sort" | "rankSortDimensionKey">>
  ): SemanticViewConfig {
    const { rankSortDimensionKey: ignored, ...rest } = current;
    void ignored;
    return { ...rest, ...sortConfig };
  }

  function withFolderSort(
    current: SemanticViewConfig,
    groupId?: string,
    views: readonly SemanticSavedView[] = folderSortViews
  ): SemanticViewConfig {
    return applySortConfig(current, folderSortConfigFor(groupId, views));
  }

  async function changeFolderSort(
    sort: SemanticKeywordSort,
    rankSortDimensionKey?: string
  ): Promise<void> {
    const nextSort: Readonly<Pick<
      SemanticViewConfig,
      "sort" | "rankSortDimensionKey"
    >> = isSemanticRankDimensionSort(sort)
      ? { sort, rankSortDimensionKey: rankSortDimensionKey! }
      : { sort };
    if (
      isSemanticRankDimensionSort(sort) &&
      !rankSortDimensionKey
    ) {
      setMutationError("Не удалось определить город и устройство для сортировки.");
      return;
    }
    if (
      savingFolderSort ||
      (sort === viewConfig.sort &&
        nextSort.rankSortDimensionKey === viewConfig.rankSortDimensionKey)
    ) return;
    const groupId = viewConfig.filters.groupId;
    const viewName = semanticFolderSortViewName(groupId);
    const config: SemanticViewConfig = {
      ...defaultSemanticViewConfig,
      filters: groupId ? { groupId } : {},
      ...nextSort
    };
    setDraftConfig((current) => applySortConfig(current, nextSort));
    setViewConfig((current) => applySortConfig(current, nextSort));
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
                body: { name: viewName, scope: "PRIVATE", config }
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
          ({ name, scope, ownerId }) =>
            name === viewName &&
            scope === "PRIVATE" &&
            ownerId === currentUserId
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
      const previousSort = folderSortConfigFor(groupId);
      setDraftConfig((current) => applySortConfig(current, previousSort));
      setViewConfig((current) => applySortConfig(current, previousSort));
      setMutationError(savedViewMutationErrorMessage(requestError));
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

  function updateAdvancedFilter<K extends keyof SemanticViewFilters>(
    field: K,
    value: SemanticViewFilters[K] | ""
  ): void {
    setDraftConfig((current) => {
      const { [field]: ignored, ...rest } = current.filters;
      void ignored;
      return { ...current, filters: value === "" || value === undefined ? rest : { ...rest, [field]: value } } as SemanticViewConfig;
    });
  }

  function updateRankDimension(value: string): void {
    setDraftConfig((current) => {
      const { rankDimensionKey: _dimension, rankState: _state, rankPositionMin: _min, rankPositionMax: _max, rankCheckedFrom: _from, rankCheckedBefore: _before, ...rest } = current.filters;
      void _dimension; void _state; void _min; void _max; void _from; void _before;
      return { ...current, filters: value ? { ...rest, rankDimensionKey: value, rankState: "CHECKED" } : rest };
    });
  }

  function updateRankState(value: string): void {
    setDraftConfig((current) => {
      const { rankState: _state, rankPositionMin: _min, rankPositionMax: _max, rankCheckedFrom: _from, rankCheckedBefore: _before, ...rest } = current.filters;
      void _state; void _min; void _max; void _from; void _before;
      const keepDate = value !== "NOT_CHECKED";
      const keepPosition = value !== "NOT_CHECKED" && value !== "NOT_FOUND";
      return {
        ...current,
        filters: {
          ...rest,
          ...(value ? { rankState: value as NonNullable<SemanticViewFilters["rankState"]> } : {}),
          ...(keepPosition && current.filters.rankPositionMin !== undefined ? { rankPositionMin: current.filters.rankPositionMin } : {}),
          ...(keepPosition && current.filters.rankPositionMax !== undefined ? { rankPositionMax: current.filters.rankPositionMax } : {}),
          ...(keepDate && current.filters.rankCheckedFrom ? { rankCheckedFrom: current.filters.rankCheckedFrom } : {}),
          ...(keepDate && current.filters.rankCheckedBefore ? { rankCheckedBefore: current.filters.rankCheckedBefore } : {})
        }
      };
    });
  }

  function toggleColumn(column: SemanticViewColumn): void {
    if (column === "query") return;
    if (!draftConfig.columns.includes(column) && draftConfig.columns.length >= 128) {
      setMutationError("В таблице можно одновременно показать не более 128 колонок. Сначала отключите ненужную колонку.");
      return;
    }
    setMutationError(undefined);
    setDraftConfig((current) => {
      const columnOrder = semanticColumnOrderFor(
        current,
        [...semanticAvailableColumns(customColumns), ...rankColumns.map(column => column.key)]
      );
      const enabled = new Set(current.columns);
      if (enabled.has(column)) enabled.delete(column);
      else enabled.add(column);
      return {
        ...current,
        columns: columnOrder.filter((item) => enabled.has(item)),
        columnOrder: columnOrder.length > 128 ? columnOrder.filter(item => enabled.has(item)) : columnOrder
      };
    });
  }

  function toggleQueryIndicator(indicator: SemanticQueryIndicator): void {
    setDraftConfig((current) => {
      const enabled = new Set(semanticQueryIndicatorsFor(current));
      if (enabled.has(indicator)) enabled.delete(indicator);
      else enabled.add(indicator);
      return {
        ...current,
        queryIndicators: semanticSavedViewQueryIndicators.filter((value) =>
          enabled.has(value)
        )
      };
    });
  }

  function moveColumn(column: SemanticViewColumn, target: SemanticViewColumn): void {
    if (column === target) return;
    setDraftConfig((current) => {
      const columnOrder = [...semanticColumnOrderFor(
        current,
        [...semanticAvailableColumns(customColumns), ...rankColumns.map(column => column.key)]
      )];
      const sourceIndex = columnOrder.indexOf(column);
      const targetIndex = columnOrder.indexOf(target);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      columnOrder.splice(sourceIndex, 1);
      columnOrder.splice(targetIndex, 0, column);
      const enabled = new Set(current.columns);
      return {
        ...current,
        columns: columnOrder.filter((item) => enabled.has(item)),
        columnOrder: columnOrder.length > 128 ? columnOrder.filter(item => enabled.has(item)) : columnOrder
      };
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
    const layoutConfig = semanticAppliedTableLayoutConfig(
      currentSavedViewConfig,
      draftSavedViewConfig
    );
    const privateDestination = activeSavedView?.scope === "PRIVATE"
      ? activeSavedView
      : undefined;
    setDraftConfig(layoutConfig);
    setViewConfig(layoutConfig);
    setSavingTableLayout(true);
    setMutationError(undefined);
    const previousBaseline = savedViewAutosaveBaselineRef.current;
    if (privateDestination) {
      savedViewAutosaveBaselineRef.current = semanticViewConfigSignature(layoutConfig);
    }
    try {
      const saved = privateDestination
        ? await browserApiRequest<SemanticSavedView>(
            `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(privateDestination.id)}`,
            {
              method: "PATCH",
              body: { config: layoutConfig },
              ifMatch: privateDestination.version
            }
          )
        : await persistProjectTableLayout({
            ...layoutConfig,
            ...(activeSavedView ? { appliedViewId: activeSavedView.id } : {})
          });
      if (privateDestination) {
        activateSavedView(saved);
        setBulkNotice("Личное представление таблицы сохранено");
      } else {
        setBulkNotice("Настройки таблицы применены");
      }
    } catch (requestError) {
      savedViewAutosaveBaselineRef.current = previousBaseline;
      setMutationError(savedViewMutationErrorMessage(requestError));
    } finally {
      setSavingTableLayout(false);
    }
  }

  async function applySavedView(view: SemanticSavedView): Promise<void> {
    const nextConfig = semanticViewConfigWithoutAppliedView(
      semanticViewConfigForCurrentSchema(view.config)
    );
    const nextColumnWidths = nextConfig.columnWidths ?? {};
    const nextExpandedGroupIds = nextConfig.expandedGroupIds ?? [];
    const nextPageSize = nextConfig.pageSize ?? layoutPreferencesRef.current.pageSize;
    const nextGroupSidebarWidth = nextConfig.groupSidebarWidth ??
      layoutPreferencesRef.current.groupSidebarWidth;
    layoutPreferencesRef.current = {
      ...layoutPreferencesRef.current,
      groupSidebarWidth: nextGroupSidebarWidth,
      columnWidths: nextColumnWidths,
      pageSize: nextPageSize,
      expandedGroupIds: nextExpandedGroupIds
    };
    persistLayoutPreferences(
      nextGroupSidebarWidth,
      nextColumnWidths,
      nextPageSize,
      nextExpandedGroupIds
    );
    setMultiGroupIds(nextConfig.selectedGroupIds ?? []);
    setGroupSidebarWidth(nextGroupSidebarWidth);
    setColumnWidths(nextColumnWidths);
    setPageSize(nextPageSize);
    setExpandedGroupIds(new Set(nextExpandedGroupIds));
    setDraftConfig(nextConfig);
    setViewConfig(nextConfig);
    activateSavedView(view, {
      ...nextConfig,
      columnWidths: nextColumnWidths,
      pageSize: nextPageSize,
      groupSidebarWidth: nextGroupSidebarWidth,
      expandedGroupIds: nextExpandedGroupIds,
      selectedGroupIds: nextConfig.selectedGroupIds ?? []
    });
    setMutationError(undefined);
    try {
      await persistProjectTableLayout({
        ...nextConfig,
        appliedViewId: view.id
      });
    } catch (requestError) {
      setMutationError(savedViewMutationErrorMessage(requestError));
    }
  }

  function activateSavedView(
    view?: SemanticSavedView,
    appliedConfig?: SemanticViewConfig
  ): void {
    const currentConfig = semanticViewConfigForCurrentSchema(
      appliedConfig ?? view?.config ?? defaultSemanticViewConfig
    );
    activeSavedViewRef.current = view;
    activeSavedViewProjectIdRef.current = view ? projectId : "";
    setActiveSavedView(view);
    savedViewAutosaveBaselineRef.current = view
      ? semanticViewConfigSignature(currentConfig)
      : "";
    setActiveSavedViewBaseline(savedViewAutosaveBaselineRef.current);
  }

  async function persistProjectTableLayout(
    config: SemanticViewConfig
  ): Promise<SemanticSavedView> {
    const persistedConfig = semanticSavedViewConfigForPersistence(config);
    const current = projectTableViewRef.current;
    const saved = current
      ? await browserApiRequest<SemanticSavedView>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views/${encodeURIComponent(current.id)}`,
          {
            method: "PATCH",
            body: { config: persistedConfig },
            ifMatch: current.version
          }
        )
      : await browserApiRequest<SemanticSavedView>(
          `/app/api/projects/${encodeURIComponent(projectId)}/semantic-saved-views`,
          {
            method: "POST",
            body: {
              name: semanticProjectTableViewName,
              scope: "PRIVATE",
              config: persistedConfig
            }
          }
        );
    projectTableViewRef.current = saved;
    setProjectTableView(saved);
    return saved;
  }

  async function refreshFrequencyMetrics(): Promise<void> {
    try {
      const result = await loadKeywordPage(
        projectId,
        keywordQueryConfig,
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
        keywordQueryConfig,
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
    setManualDuplicateReview(undefined);
    setEditor({
      mode: "create",
      draft: {
        addDuplicatesToGroup:
          manualAddPreferencesRef.current.addDuplicatesToGroup,
        text: "",
        language: "ru",
        priority: "0",
        isFavorite: false,
        isTracked: true,
        skipDuplicates: manualAddPreferencesRef.current.skipDuplicates,
        intent: "",
        groupId: initialSemanticCreateGroupId(
          viewConfig.filters.groupId,
          groups
        ),
        clusterId: "",
        targetUrl: "",
        tagNames: []
      }
    });
  }

  function openEdit(item: SemanticKeyword): void {
    setCheckedIds(new Set());
    setBulkNotice(undefined);
    setMutationError(undefined);
    setActionIds(new Set([item.id]));
    setBulkEditorOpen(true);
  }

  function updateDraft(patch: Partial<KeywordDraft>): void {
    setManualDuplicateReview(undefined);
    setEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current
    );
  }

  function setManualDuplicateImport(enabled: boolean): void {
    const preferences = {
      ...manualAddPreferencesRef.current,
      addDuplicatesToGroup: enabled
    };
    manualAddPreferencesRef.current = preferences;
    writeSemanticManualAddPreferences(
      projectId,
      preferences,
      window.localStorage
    );
    setEditor((current) =>
      current?.mode === "create"
        ? {
            ...current,
            draft: { ...current.draft, addDuplicatesToGroup: enabled }
          }
        : current
    );
    setManualDuplicateReview((current) => {
      if (!current) return current;
      const groupId = editor?.mode === "create" ? editor.draft.groupId : "";
      return {
        ...current,
        selectedIndices: new Set(
          enabled && groupId
            ? current.preview.rows.flatMap((row) =>
                manualKeywordDuplicateCanApply(row, groupId)
                  ? [row.index]
                  : []
              )
            : []
        )
      };
    });
  }

  function setManualDuplicateSkipping(enabled: boolean): void {
    const preferences = {
      ...manualAddPreferencesRef.current,
      skipDuplicates: enabled
    };
    manualAddPreferencesRef.current = preferences;
    writeSemanticManualAddPreferences(
      projectId,
      preferences,
      window.localStorage
    );
    setEditor((current) =>
      current?.mode === "create"
        ? { ...current, draft: { ...current.draft, skipDuplicates: enabled } }
        : current
    );
  }

  function setManualDuplicateRowImport(
    index: number,
    enabled: boolean
  ): void {
    setManualDuplicateReview((current) => {
      if (!current) return current;
      const selectedIndices = new Set(current.selectedIndices);
      if (enabled) selectedIndices.add(index);
      else selectedIndices.delete(index);
      return { ...current, selectedIndices };
    });
  }

  async function saveKeyword(event: FormEvent<HTMLFormElement>, uiLocale: string = "ru-RU"): Promise<void> {
    event.preventDefault();
    if (!editor || saving) return;
    const draft = editor.draft;
    const texts = editor.mode === "create"
      ? manualKeywordTexts(draft.text)
      : [draft.text.trim()];
    if (texts.length < 1 || texts.length > MANUAL_KEYWORD_LIMIT) {
      setMutationError(
        `Введите от 1 до ${formatInteger(MANUAL_KEYWORD_LIMIT, uiLocale)} запросов, по одному в строке.`
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
      isTracked: draft.isTracked,
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
      tagNames: uniqueKeywordTags(draft.tagNames)
    };
    try {
      if (editor.mode === "create") {
        const inputStats = manualKeywordInputStats(draft.text);
        const addDuplicatesToGroupByDefault =
          draft.addDuplicatesToGroup &&
          groups.some(
            ({ id, systemKind }) =>
              id === draft.groupId && systemKind === undefined
          );
        let duplicateReview = manualDuplicateReview;
        if (!duplicateReview) {
          const preview = await runManualKeywordBulkPreviewChunks(
            texts,
            async (chunk) =>
              browserApiRequest<SemanticKeywordBulkCreatePreviewResult>(
                `/app/api/projects/${encodeURIComponent(projectId)}/keywords/bulk-preview`,
                {
                  method: "POST",
                  body: {
                    items: chunk.map((text) => ({
                      text,
                      language: draft.language,
                      ...(draft.groupId ? { groupId: draft.groupId } : {})
                    }))
                  }
                }
              )
          );
          if (preview.newKeywords !== preview.selected) {
            duplicateReview = {
              texts,
              preview,
              selectedIndices: new Set(
                !addDuplicatesToGroupByDefault
                  ? []
                  : preview.rows.flatMap((row) =>
                      manualKeywordDuplicateCanApply(row, draft.groupId)
                        ? [row.index]
                        : []
                    )
              )
            };
            setManualDuplicateReview(duplicateReview);
            return;
          }
        }
        const selectedDuplicateIndices =
          duplicateReview?.selectedIndices ?? new Set<number>();
        const previewRowsByIndex = new Map(
          duplicateReview?.preview.rows.map((row) => [row.index, row] as const)
        );
        const fallbackDuplicatePolicy = draft.skipDuplicates
          ? "SKIP_EXISTING"
          : "REJECT_EXISTING";
        const result = await runManualKeywordBulkChunks(
          texts,
          async (chunk, offset) =>
            browserApiRequest<SemanticKeywordBulkCreateResult>(
              `/app/api/projects/${encodeURIComponent(projectId)}/keywords/bulk`,
              {
                method: "POST",
                body: {
                  duplicatePolicy: fallbackDuplicatePolicy,
                  items: chunk.map((text, index) => {
                    const globalIndex = offset + index;
                    const previewRow = previewRowsByIndex.get(globalIndex);
                    return {
                      ...commonBody,
                      text,
                      duplicatePolicy: manualKeywordDuplicatePolicy({
                        addDuplicatesToGroup:
                          addDuplicatesToGroupByDefault,
                        inTargetGroup: previewRow?.inTargetGroup ?? false,
                        ...(previewRow
                          ? { previewState: previewRow.state }
                          : {}),
                        selectedForTargetGroup:
                          selectedDuplicateIndices.has(globalIndex),
                        skipDuplicates: draft.skipDuplicates
                      })
                    };
                  })
                }
              }
            )
        );
        const locallySkipped = inputStats.duplicates;
        setRetryVersion((value) => value + 1);
        setBulkNotice(
          `Добавлено: ${result.created} · перемещено: ${result.linked} · ` +
            `восстановлено: ${result.restored} · ` +
            `пропущено: ${result.skipped}` +
            (locallySkipped > 0
              ? ` · повторов во вставке объединено: ${locallySkipped}`
              : "")
        );
        if (result.retryRows.length > 0) {
          setManualDuplicateReview(undefined);
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
      setManualDuplicateReview(undefined);
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
      highlightedIds,
      {
        additive: event.ctrlKey || event.metaKey,
        extendRange: event.shiftKey
      }
    );
    highlightAnchorIdRef.current = highlight.anchorId;
    setHighlightedIds(highlight.highlightedIds);
    setRightSidebar({ type: "KEYWORD", keywordId: item.id });
    tableScrollRef.current?.focus({ preventScroll: true });
  }

  function navigateKeywordRows(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (
      (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
      isEditableCopyTarget(event.target) ||
      (event.target instanceof HTMLElement &&
        event.target.closest("button, a, [role='button']"))
    ) return;
    const currentId = rightSidebar?.type === "KEYWORD"
      ? rightSidebar.keywordId
      : highlightAnchorIdRef.current;
    const currentIndex = currentId
      ? items.findIndex(({ id }) => id === currentId)
      : -1;
    if (currentIndex < 0 || items.length === 0) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(
      items.length - 1,
      Math.max(0, currentIndex + direction)
    );
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextItem = items[nextIndex]!;
    const highlight = semanticHighlightAfterRowClick(
      items.map(({ id }) => id),
      event.shiftKey
        ? highlightAnchorIdRef.current ?? currentId
        : undefined,
      nextItem.id,
      highlightedIds,
      { additive: false, extendRange: event.shiftKey }
    );
    highlightAnchorIdRef.current = highlight.anchorId;
    setHighlightedIds(highlight.highlightedIds);
    setRightSidebar({ type: "KEYWORD", keywordId: nextItem.id });
    scrollKeywordIntoView(
      tableScrollRef.current,
      nextIndex,
      viewConfig.density
    );
  }

  function toggleKeywordRow(
    item: SemanticKeyword,
    _event: MouseEvent<HTMLInputElement>
  ): void {
    toggleSelection(item.id);
  }

  function toggleAllSelection(uiLocale: string = "ru-RU"): void {
    if (selectingAll) return;
    setBulkNotice(undefined);
    const allLoadedSelected =
      items.length > 0 &&
      !page.hasNext &&
      items.every(({ id }) => checkedIds.has(id));
    if (allLoadedSelected) {
      setCheckedIds(new Set());
      return;
    }
    void selectAllMatchingKeywords(undefined, undefined, uiLocale);
  }

  function highlightAllKeywords(uiLocale: string = "ru-RU"): void {
    if (selectingAll || items.length === 0) return;
    setBulkNotice(undefined);
    if (page.hasNext) {
      void selectAllMatchingKeywords("HIGHLIGHT", undefined, uiLocale);
      return;
    }
    const ids = items.map(({ id }) => id);
    const highlight = semanticHighlightAllRows(
      ids,
      highlightAnchorIdRef.current
    );
    highlightAnchorIdRef.current = highlight.anchorId;
    setHighlightedIds(highlight.highlightedIds);
    setBulkNotice(`Выделены все запросы: ${formatInteger(ids.length, uiLocale)}`);
  }

  async function selectAllMatchingKeywords(
    postAction: "SELECT" | "MOVE" | "HIGHLIGHT" = "SELECT",
    config = keywordQueryConfig, uiLocale: string = "ru-RU"
  ): Promise<void> {
    const controller = new AbortController();
    selectAllAbortRef.current?.abort();
    selectAllAbortRef.current = controller;
    setSelectingAll(true);
    setError(undefined);
    try {
      let cursor: string | undefined;
      let loaded: readonly SemanticKeyword[] = [];
      let lastPage: BrowserCursorPage = { hasNext: false };
      const seenCursors = new Set<string>();
      do {
        const result = await loadKeywordPage(
          projectId,
          config,
          cursor,
          controller.signal,
          500
        );
        loaded = mergeKeywords(loaded, result.data);
        lastPage = result.page;
        if (!result.page.hasNext) break;
        const nextCursor = result.page.nextCursor;
        if (!nextCursor || seenCursors.has(nextCursor)) {
          throw new Error("Keyword pagination did not advance");
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } while (!controller.signal.aborted);
      if (controller.signal.aborted) return;
      setItems(loaded);
      setPage(lastPage);
      const loadedIds = loaded.map(({ id }) => id);
      if (postAction === "HIGHLIGHT") {
        const highlight = semanticHighlightAllRows(
          loadedIds,
          highlightAnchorIdRef.current
        );
        highlightAnchorIdRef.current = highlight.anchorId;
        setHighlightedIds(highlight.highlightedIds);
        setBulkNotice(
          `Выделены все запросы: ${formatInteger(loadedIds.length, uiLocale)}`
        );
        return;
      }
      setCheckedIds(new Set(loadedIds));
      if (postAction === "MOVE" && loaded.length > 0) {
        setActionIds(new Set(loadedIds));
        setMoveKeywordTargetId("");
        setMoveKeywordDialog(true);
      }
      setBulkNotice(`Выбраны все запросы: ${formatInteger(loaded.length, uiLocale)}`);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(keywordErrorMessage(requestError));
      }
    } finally {
      if (selectAllAbortRef.current === controller) {
        selectAllAbortRef.current = undefined;
        setSelectingAll(false);
      }
    }
  }
  selectAllMatchingKeywordsRef.current = selectAllMatchingKeywords;

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
    const columns = semanticExportColumnsWithRankingUrls(viewConfig.columns);
    setExportColumns(
      exportContent === "FOLDER_MAP" && !columns.includes("query")
        ? ["query", ...columns]
        : columns
    );
    const contextualGroupIds = groupId
      ? [groupId]
      : multiGroupIds.length > 0
        ? multiGroupIds
        : viewConfig.filters.groupId
          ? [viewConfig.filters.groupId]
          : [];
    const regularGroupIds = new Set(
      groups
        .filter(({ id, systemKind }) =>
          contextualGroupIds.includes(id) && systemKind === undefined
        )
        .map(({ id }) => id)
    );
    setExportFolderMapGroupIds(regularGroupIds);
    setExportFolderMapIncludeDescendants(true);
    setExportHistoryIncludeUntracked(false);
    setExportBom(
      exportContent === "SEMANTIC" &&
      (exportFormat === "CSV" || exportFormat === "TSV")
    );
    if (exportContent !== "SEMANTIC") setExportFormat("XLSX");
    setExportJob(undefined);
  }

  async function downloadExport(uiLocale: string = "ru-RU"): Promise<void> {
    if (exporting) return;
    const selectedItems = exportScope === "SELECTED"
      ? items.filter(({ id }) => checkedIds.has(id))
      : [];
    const selected = selectedItems
      .filter(({ isTracked }) =>
        exportContent !== "POSITION_HISTORY" ||
        exportHistoryIncludeUntracked ||
        isTracked
      )
      .map(({ id }) => id);
    if (
      exportScope === "SELECTED" &&
      exportContent === "POSITION_HISTORY" &&
      !exportHistoryIncludeUntracked &&
      selected.length === 0
    ) {
      setMutationError(
        "Среди выбранных строк нет отслеживаемых запросов. Включите неотслеживаемые запросы или измените выбор."
      );
      return;
    }
    setExporting(true);
    setExportNotice(undefined);
    setMutationError(undefined);
    setExportJob(undefined);
    const groupId = exportDialog?.groupId;
    try {
      let current = await browserApiRequest<SemanticExportJobSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/exports`,
        {
          method: "POST",
          idempotencyKey: `semantic-export:${globalThis.crypto.randomUUID()}`,
          body: {
            format: exportContent === "SEMANTIC" || exportContent === "COMPETITORS" ? exportFormat : "XLSX",
            scope: exportContent === "FOLDER_MAP" ? "FOLDER_MAP" : exportScope,
            locale: uiLocale.startsWith("en") ? "en" : "ru",
            columns: exportContent === "POSITION_HISTORY" ? ["query"] : exportColumns,
            ...(exportContent === "COMPETITORS" ? { competitorRows: true } : {}),
            ...(exportContent === "FOLDER_MAP"
              ? {
                  folderMap: {
                    groupIds: [...exportFolderMapGroupIds],
                    includeDescendants: exportFolderMapIncludeDescendants
                  }
                }
              : groupId
              ? {
                  filters: {
                    groupId,
                    ...(exportContent === "POSITION_HISTORY" &&
                    !exportHistoryIncludeUntracked
                      ? { isTracked: true }
                      : {})
                  }
                }
              : selected.length > 0
              ? {
                  keywordIds: selected,
                  ...(exportContent === "POSITION_HISTORY" &&
                  !exportHistoryIncludeUntracked
                    ? { filters: { isTracked: true } }
                    : {})
                }
              : {
                  filters: {
                    ...viewConfig.filters,
                    ...(exportContent === "POSITION_HISTORY" &&
                    !exportHistoryIncludeUntracked
                      ? { isTracked: true }
                      : {}),
                    ...(multiGroupIds.length > 1
                      ? { groupIds: multiGroupIds }
                      : {})
                  }
                }),
            sort: viewConfig.sort,
            ...(viewConfig.rankSortDimensionKey
              ? { rankSortDimensionKey: viewConfig.rankSortDimensionKey }
              : {}),
            ...(exportContent === "SEMANTIC" || exportContent === "COMPETITORS" ? { includeBom: exportBom } : {}),
            ...(exportContent === "POSITION_HISTORY"
              ? {
                  positionHistory: semanticHistoryExportOptions(
                    exportHistoryFrom,
                    exportHistoryTo,
                    exportHistoryEngines
                  )
                }
              : {}),
          }
        }
      );
      setExportJob(current);
      setOperationsRefreshVersion((value) => value + 1);
      while (semanticExportActive(current.status)) {
        await wait(1_000);
        current = await browserApiRequest<SemanticExportJobSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(current.id)}`
        );
        setExportJob(current);
      }
      if (current.status !== "COMPLETED") {
        throw new SemanticExportTerminalError(current);
      }
      setExportNotice(
        `Экспорт готов: ${formatInteger(current.rowCount ?? current.processedRows, uiLocale)} строк. Нажмите «Скачать файл».`
      );
    } catch (requestError) {
      setMutationError(semanticExportErrorMessage(requestError));
    } finally {
      setExporting(false);
      setExportCancelling(false);
      setOperationsRefreshVersion((value) => value + 1);
    }
  }

  async function cancelExport(): Promise<void> {
    if (!exportJob || !semanticExportActive(exportJob.status) || exportCancelling) {
      return;
    }
    setExportCancelling(true);
    setMutationError(undefined);
    try {
      const cancelled = await browserApiRequest<SemanticExportJobSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(exportJob.id)}/cancel`,
        { method: "POST", body: {}, ifMatch: exportJob.version }
      );
      setExportJob(cancelled);
    } catch (requestError) {
      setMutationError(semanticExportErrorMessage(requestError));
    } finally {
      setExportCancelling(false);
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

  async function changeGroupColors(
    selectedGroups: readonly SemanticGroupTreeItem[],
    color: string
  ): Promise<void> {
    if (saving || selectedGroups.length === 0) return;
    setSaving(true);
    setMutationError(undefined);
    const basePath = `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`;
    const results = await Promise.allSettled(
      selectedGroups.map((group) =>
        browserApiRequest<SemanticKeywordGroup>(
          `${basePath}/${encodeURIComponent(group.id)}`,
          {
            method: "PATCH",
            ifMatch: group.version,
            body: {
              name: group.name,
              color,
              parentId: group.parentId ?? null
            }
          }
        )
      )
    );
    const changed = results.filter(({ status }) => status === "fulfilled").length;
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (firstFailure) {
      setMutationError(
        `Цвет изменён у ${changed} из ${selectedGroups.length}. ${keywordMutationError(firstFailure.reason)}`
      );
    } else {
      setBulkNotice(
        changed === 1
          ? `Цвет группы «${selectedGroups[0]?.name ?? ""}» изменён`
          : `Цвет изменён у групп: ${changed}`
      );
    }
    setSaving(false);
    onGroupsChanged();
  }

  async function renameGroupInline(
    group: SemanticGroupTreeItem,
    draft: string
  ): Promise<boolean> {
    if (saving) return false;
    let name: string;
    try {
      name = normalizeSemanticGroupName(draft);
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Проверьте название папки."
      );
      return false;
    }
    if (name === group.name) return true;

    setSaving(true);
    setMutationError(undefined);
    try {
      await browserApiRequest<SemanticKeywordGroup>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups/${encodeURIComponent(group.id)}`,
        {
          method: "PATCH",
          ifMatch: group.version,
          body: {
            name,
            color: group.color ?? null,
            parentId: group.parentId ?? null
          }
        }
      );
      setBulkNotice(`Группа переименована в «${name}»`);
      onGroupsChanged();
      return true;
    } catch (requestError) {
      setMutationError(keywordMutationError(requestError));
      return false;
    } finally {
      setSaving(false);
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
    if (highlightedIds.size === 0) {
      highlightAnchorIdRef.current = item.id;
      setHighlightedIds(new Set([item.id]));
      setRightSidebar({ type: "KEYWORD", keywordId: item.id });
    }
    setRowContextMenu({
      x: event.clientX,
      y: event.clientY
    });
  }

  const copyKeywordRows = useCallback((
    keywordIds: ReadonlySet<string>,
    kind: "выбранных" | "выделенных"
  ): void => {
    const clipboardText = semanticClipboardText(items, keywordIds);
    if (!clipboardText) {
      setMutationError(`Нет ${kind} запросов для копирования.`);
      return;
    }
    const copiedCount = items.reduce(
      (count, { id }) => count + (keywordIds.has(id) ? 1 : 0),
      0
    );
    void navigator.clipboard
      .writeText(clipboardText)
      .then(() =>
        setBulkNotice(
          `Скопировано ${kind} запросов: ${formatInteger(copiedCount, uiLocale)}`
        )
      )
      .catch(() =>
        setMutationError(
          "Браузер не разрешил доступ к буферу обмена. Проверьте разрешение сайта."
        )
      );
  }, [items, uiLocale]);

  function selectProject(nextProjectId: string): void {
    if (!nextProjectId || nextProjectId === projectId) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `seo_project=${encodeURIComponent(nextProjectId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.location.assign("/app/semantics");
  }

  async function startWordstatExpansion(
    input: CreateWordstatExpansionRunInput
  ): Promise<void> {
    const operationPath = `/app/api/projects/${encodeURIComponent(projectId)}/keyword-research-runs`;
    wordstatCreateCommandRef.current = prepareOperationAttempt(wordstatCreateCommandRef.current, operationPath, input, input.source, "wordstat-expansion");
    await browserApiRequest<KeywordResearchRunSummary>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keyword-research-runs`,
      {
        method: "POST",
        operationAttempt: wordstatCreateCommandRef.current,
        body: input
      }
    );
    wordstatCreateCommandRef.current = undefined;
    setWordstatDialogOpen(false);
    setOperationsRefreshVersion((value) => value + 1);
    setBulkNotice(
      "Парсинг Wordstat запущен в фоне. Результат появится в операциях и не изменит семантику без подтверждения."
    );
    setRightSidebar({ type: "OPERATIONS" });
  }

  const total = rootTotal;
  const filteredTotal = page.totalApprox;
  const projectOptions = projects.some(({ id }) => id === projectId)
    ? projects
    : [{ id: projectId, name: projectName, version: 0 }, ...projects];
  const manualInputStats = editor?.mode === "create"
    ? manualKeywordInputStats(editor.draft.text)
    : undefined;
  const manualDuplicateRows = manualDuplicateReview?.preview.rows.filter(
    ({ state }) => state !== "NEW"
  ) ?? [];
  const manualDuplicateTargetGroup = editor?.mode === "create"
    ? groups.find(
        ({ id, systemKind }) =>
          id === editor.draft.groupId && systemKind === undefined
      )
    : undefined;
  const manualActionableDuplicateRows = manualDuplicateTargetGroup
    ? manualDuplicateRows.filter(
        (row) => manualKeywordDuplicateCanApply(
          row,
          manualDuplicateTargetGroup.id
        )
      )
    : [];
  const allManualDuplicatesSelected =
    manualActionableDuplicateRows.length > 0 &&
    manualActionableDuplicateRows.every((row) =>
      manualDuplicateReview?.selectedIndices.has(row.index)
    );
  const activeGroup = viewConfig.filters.groupId
    ? groups.find(({ id }) => id === viewConfig.filters.groupId)
    : undefined;
  const keywordSearchPlaceholder = semanticKeywordSearchPlaceholder({
    ...(activeGroup ? { activeGroup } : {}),
    ...(viewConfig.filters.groupId
      ? { activeGroupId: viewConfig.filters.groupId }
      : {}),
    multiGroupIds
  }, uiLocale);
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
            ? <UiText text="Корзина пуста" />
            : activeGroup
              ? <UiText text="В группе «{0}» пока нет запросов" values={[String(activeGroup.name)]} />
              : <UiText text="В проекте пока нет запросов" />
          : hasActiveFilters(viewConfig)
            ? <UiText text="По выбранным фильтрам ничего не найдено" />
            : <UiText text="Опубликованных запросов пока нет" />}
      </strong>
      <p>
        {activeScopeIsEmpty
          ? activeGroup?.systemKind === "TRASH"
            ? <UiText text="Удалённые запросы появятся здесь и останутся доступными для восстановления или окончательного удаления." />
            : activeGroup
              ? <UiText text="Добавьте запросы вручную или импортируйте их сразу в выбранную группу." />
              : <UiText text="Добавьте запросы вручную или импортируйте файл Key Collector, CSV, TSV либо XLSX." />
          : hasActiveFilters(viewConfig)
            ? <UiText text="Измените условия или сбросьте фильтры." />
            : <UiText text="Добавьте запросы вручную или импортируйте файл." />}
      </p>
      {canAddToActiveScope ? (
        <button
          className="primary-button"
          onClick={openCreate}
          type="button"
        >
          <Icon name="plus" />
          {activeGroup
            ? <UiText text="Добавить запросы в эту группу" />
            : <UiText text="Добавить запросы" />}
        </button>
      ) : hasActiveFilters(viewConfig) && !activeScopeIsEmpty ? (
        <button
          className="secondary-button"
          onClick={clearFilters}
          type="button"
        >
          <UiText text="Сбросить фильтры" /></button>
      ) : null}
    </div>
  ) : undefined;
  const virtualRows = semanticVirtualRows(
    items,
    tableViewport,
    viewConfig.density
  );
  const tableColumns = semanticTableColumns(
    viewConfig.columns,
    multiGroupIds.length > 1
  );
  const rankDimensionsSignature = JSON.stringify([...new Set(tableColumns.flatMap(column => {
    const parsed = parseSemanticRankColumnKey(column);
    return parsed ? [parsed.dimension.key] : [];
  }))]);
  const rankKeywordSignature = JSON.stringify(virtualRows.items.map(row => row.id));
  const rankComparison = useSemanticRankComparison(
    projectId,
    rankKeywordSignature,
    rankDimensionsSignature,
    `${retryVersion}:${operationsRefreshVersion}:${virtualRows.items.map(row => row.positions?.map(position => position.observedAt).join(",")).join(";")}`,
    `${retryVersion}:${operationsRefreshVersion}`
  );
  const rankColumns = useMemo(() => rankDimensionColumns(rankComparison.dimensions, uiLocale), [rankComparison.dimensions, uiLocale]);
  const focusedKeywordId = rightSidebar?.type === "KEYWORD"
    ? rightSidebar.keywordId
    : undefined;
  const focusedKeyword = items.find(({ id }) => id === focusedKeywordId);
  const activeNegativeGroup = groups
    .filter(({ systemKind }) => !systemKind)
    .find(({ id }) => id === viewConfig.filters.groupId);
  const mutationIds = actionIds ?? checkedIds;
  const projectHasKeywords = (rootTotal ?? items.length) > 0;
  const commandMenuItems: readonly ContextMenuItem[] = commandMenu
    ? commandMenu.kind === "WORDSTAT"
      ? [
          {
            id: "frequency",
            label: "Собрать частотность",
            icon: <Icon name="frequency" />,
            disabled: !projectHasKeywords,
            onSelect: () => setFrequencyDialogOpen(true)
          },
          {
            id: "wordstat-parsing",
            label: "Парсинг",
            icon: <Icon name="search" />,
            onSelect: () => setWordstatDialogOpen(true)
          }
        ]
      : commandMenu.kind === "POSITIONS"
        ? [
            {
              id: "positions",
              label: "Собрать позиции",
              icon: <Icon name="rankCheck" />,
              disabled: !projectHasKeywords,
              onSelect: () => setPositionDialogOpen(true)
            },
            {
              id: "ai-answers",
              label: "Собрать ИИ-ответы",
              icon: <Icon name="ai" />,
              disabled: !projectHasKeywords,
              onSelect: () => setAiAnswerDialogOpen(true)
            }
          ]
        : [
            {
              id: "competitors",
              label: "Собрать конкурентов",
              icon: <Icon name="competitors" />,
              disabled: !projectHasKeywords,
              onSelect: () => setCompetitorDialogOpen(true)
            },
            {
              id: "ai-competitors",
              label: "Собрать ИИ-выдачу",
              icon: <Icon name="ai" />,
              disabled: !projectHasKeywords,
              onSelect: () => setAiCompetitorDialogOpen(true)
            }
          ]
    : [];
  const rowMenuItems: readonly ContextMenuItem[] = rowContextMenu
    ? [
        {
          id: "copy-checked",
          label: `Скопировать выбранные (${checkedIds.size})`,
          icon: <Icon name="copy" />,
          disabled: checkedIds.size === 0,
          onSelect: () => copyKeywordRows(checkedIds, "выбранных")
        },
        {
          id: "copy-highlighted",
          label: `Скопировать выделенные (${highlightedIds.size})`,
          icon: <Icon name="copy" />,
          disabled: highlightedIds.size === 0,
          onSelect: () => copyKeywordRows(highlightedIds, "выделенных")
        },
        {
          id: "edit-checked",
          label: `Изменить выбранные запросы (${checkedIds.size})…`,
          icon: <Icon name="edit" />,
          disabled: checkedIds.size === 0,
          dividerBefore: true,
          onSelect: () => {
            setActionIds(new Set(checkedIds));
            setBulkEditorOpen(true);
          }
        },
        {
          id: "edit-highlighted",
          label: `Изменить выделенные запросы (${highlightedIds.size})…`,
          icon: <Icon name="edit" />,
          disabled: highlightedIds.size === 0,
          onSelect: () => {
            setActionIds(new Set(highlightedIds));
            setBulkEditorOpen(true);
          }
        },
        {
          id: "move-checked",
          label: `Перенести выбранные запросы (${checkedIds.size})…`,
          icon: <Icon name="move" />,
          disabled: checkedIds.size === 0,
          dividerBefore: true,
          onSelect: () => {
            setActionIds(new Set(checkedIds));
            setMoveKeywordDialog(true);
          }
        },
        {
          id: "move-highlighted",
          label: `Перенести выделенные запросы (${highlightedIds.size})…`,
          icon: <Icon name="move" />,
          disabled: highlightedIds.size === 0,
          onSelect: () => {
            setActionIds(new Set(highlightedIds));
            setMoveKeywordDialog(true);
          }
        },
        {
          id: "delete-checked",
          label: `Удалить выбранные запросы (${checkedIds.size})`,
          icon: <Icon name="trash" />,
          danger: true,
          disabled: checkedIds.size === 0,
          dividerBefore: true,
          onSelect: () => {
            setActionIds(new Set(checkedIds));
            setDeleteSelectionOpen(true);
          }
        },
        {
          id: "delete-highlighted",
          label: `Удалить выделенные запросы (${highlightedIds.size})`,
          icon: <Icon name="trash" />,
          danger: true,
          disabled: highlightedIds.size === 0,
          onSelect: () => {
            setActionIds(new Set(highlightedIds));
            setDeleteSelectionOpen(true);
          }
        }
      ]
    : [];
  const activityButtonClass = (
    activity: ProjectPresenceActivity,
    baseClassName?: string
  ): string | undefined => {
    const remote = remoteActivityParticipants.get(activity);
    return [
      baseClassName,
      remote ? "remote-presence-action" : undefined,
      remote ? `presence-color-${remote.colorIndex}` : undefined
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  };
  const toggleCommandMenu = (
    event: MouseEvent<HTMLButtonElement>,
    kind: "WORDSTAT" | "POSITIONS" | "COMPETITORS"
  ): void => {
    commandMenuTriggerRef.current = event.currentTarget;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCommandMenu((current) =>
      current?.kind === kind
        ? undefined
        : {
            kind,
            x: bounds.left,
            y: bounds.bottom + 4
      }
    );
  };
  return (
    <section
      aria-busy={loading}
      className={`semantic-core${mobileGroupTreeOpen ? " semantic-mobile-groups-open" : ""}`}
      style={{
        "--semantic-groups-width": `${groupSidebarWidth}px`
      } as CSSProperties}
    >
      <header
        className="semantic-core-header"
        data-presence-cursor-anchor="true"
        data-presence-key="semantic-header"
      >
        <div className="semantic-title-block">
          <h1>
            <span className="semantic-desktop-title"><UiText text="Семантическое ядро" /></span>
            <span className="semantic-mobile-title"><UiText text="Семантика" /></span>
          </h1>
          <ProjectSelect
            ariaLabel={uiText("Проект семантического ядра")}
            canReorder={canReorderProjects}
            onChange={selectProject}
            projects={projectOptions}
            value={projectId}
            workspaceId={workspaceId}
          />
        </div>
        <dl className="semantic-summary">
          <div>
            <dt><UiText text="Запросов" /></dt>
            <dd>{total === undefined ? "—" : formatInteger(total, uiLocale)}</dd>
          </div>
          <div>
            <dt><UiText text="Групп" /></dt>
            <dd>{formatInteger(groups.filter(({ systemKind }) => !systemKind).length, uiLocale)}</dd>
          </div>
          <div>
            <dt><UiText text="Кластеров" /></dt>
            <dd>{formatInteger(clusters.length, uiLocale)}</dd>
          </div>
          <div>
            <dt><UiText text="Загружено" /></dt>
            <dd>{formatInteger(items.length, uiLocale)}</dd>
          </div>
        </dl>
        <div className="semantic-header-actions">
          <button
            aria-expanded={mobileGroupTreeOpen}
            aria-label={mobileGroupTreeOpen ? uiText("Закрыть группы") : uiText("Открыть группы")}
            className="semantic-mobile-groups-button"
            onClick={() => setMobileGroupTreeOpen((current) => !current)}
            type="button"
          >
            <Icon name="inbox" />
            <span>{activeGroup?.name ?? <UiText text="Группы" />}</span>
          </button>
          <button
            className={activityButtonClass("SEMANTIC_EXPORT")}
            data-presence-cursor-anchor="true"
            data-presence-key="semantic-action:export"
            onClick={() => openExport()}
            type="button"
          >
            <Icon name="export" /><span><UiText text="Экспорт" /></span>
          </button>
          <button
            className={activityButtonClass("SEMANTIC_HISTORY")}
            data-presence-cursor-anchor="true"
            data-presence-key="semantic-action:history"
            data-semantic-sidebar-trigger
            onClick={() =>
              setRightSidebar((current) =>
                current?.type === "HISTORY"
                  ? undefined
                  : { type: "HISTORY" }
              )
            }
            type="button"
          >
            <Icon name="history" /><span><UiText text="История" /></span>
          </button>
          <button
            aria-label={activeOperationCount > 0 ? uiText("Операции, активных: {0}", [String(activeOperationCount)]) : uiText("Операции")}
            className={activityButtonClass(
              "SEMANTIC_OPERATIONS",
              activeOperationCount > 0 ? "has-active-operations" : undefined
            )}
            data-presence-cursor-anchor="true"
            data-presence-key="semantic-action:operations"
            data-semantic-sidebar-trigger
            onClick={() =>
              setRightSidebar((current) =>
                current?.type === "OPERATIONS"
                  ? undefined
                  : { type: "OPERATIONS" }
              )
            }
            type="button"
          >
            <Icon name="operations" /><span><UiText text="Операции" /></span>
            {activeOperationCount > 0 && (
              <strong
                aria-hidden="true"
                className="semantic-operation-toolbar-badge"
                title={uiText("Активных операций: {0}", [String(activeOperationCount)])}
              >
                <i />
                {activeOperationCount}
              </strong>
            )}
          </button>
        </div>
      </header>
      <nav
        aria-label={uiText("Действия с семантикой")}
        className="semantic-commandbar"
        data-presence-cursor-anchor="true"
        data-presence-key="semantic-commandbar"
      >
        <button className={activityButtonClass("SEMANTIC_ADD")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:add" onClick={openCreate} type="button"><Icon name="plus" /><UiText text="Добавить" /></button>
        <button className={activityButtonClass("SEMANTIC_IMPORT")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:import" onClick={onOpenImport} type="button"><Icon name="import" /><UiText text="Импорт" /></button>
        <button
          aria-expanded={commandMenu?.kind === "WORDSTAT"}
          className={activityButtonClass("SEMANTIC_WORDSTAT", "semantic-command-menu-trigger")}
          data-presence-cursor-anchor="true"
          data-presence-key="semantic-action:wordstat"
          onClick={(event) => toggleCommandMenu(event, "WORDSTAT")}
          title={uiText("Частотность и парсинг Wordstat")}
          type="button"
        >
          <Icon name="frequency" />
          <span>Wordstat</span>
          <Icon className="semantic-command-chevron" name="chevronDown" />
        </button>
        <button
          aria-expanded={commandMenu?.kind === "POSITIONS"}
          className={activityButtonClass("SEMANTIC_POSITIONS", "semantic-command-menu-trigger")}
          data-presence-cursor-anchor="true"
          data-presence-key="semantic-action:positions"
          disabled={!projectHasKeywords}
          onClick={(event) => toggleCommandMenu(event, "POSITIONS")}
          title={projectHasKeywords ? uiText("Сбор обычных и ИИ-позиций") : uiText("В проекте пока нет запросов")}
          type="button"
        >
          <Icon name="rankCheck" />
          <span><UiText text="Сбор позиций" /></span>
          <Icon className="semantic-command-chevron" name="chevronDown" />
        </button>
        <button
          aria-expanded={commandMenu?.kind === "COMPETITORS"}
          className={activityButtonClass("SEMANTIC_POSITIONS", "semantic-command-menu-trigger")}
          data-presence-cursor-anchor="true"
          data-presence-key="semantic-action:competitors"
          disabled={!projectHasKeywords}
          onClick={(event) => toggleCommandMenu(event, "COMPETITORS")}
          title={projectHasKeywords ? uiText("Сбор обычной и ИИ-выдачи конкурентов") : uiText("В проекте пока нет запросов")}
          type="button"
        >
          <Icon name="competitors" />
          <span><UiText text="Сбор конкурентов" /></span>
          <Icon className="semantic-command-chevron" name="chevronDown" />
        </button>
        <button className={activityButtonClass("SEMANTIC_CLUSTERING")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:clustering" disabled={(rootTotal ?? items.length) === 0} onClick={() => setClusteringDialogOpen(true)} title={(rootTotal ?? items.length) === 0 ? uiText("В проекте пока нет запросов") : uiText("Разбить выбранные запросы или папки на группы по выдаче")} type="button"><Icon name="cluster" /><UiText text="Кластеризовать" /></button>
        <button className={activityButtonClass("SEMANTIC_NEGATIVE_KEYWORDS")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:negative-keywords" disabled={(rootTotal ?? items.length) === 0} onClick={() => setNegativeKeywordsOpen(true)} title={uiText("Найти запросы по минус-словам и переместить их в корзину")} type="button"><Icon name="warning" /><UiText text="Минус-слова" /></button>
        <button className={activityButtonClass("SEMANTIC_DUPLICATES")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:duplicates" disabled={(rootTotal ?? items.length) < 2} onClick={() => setDuplicatesOpen(true)} title={uiText("Найти фразы с одинаковым набором слов и удалить лишние варианты")} type="button"><Icon name="checkDouble" /><UiText text="Дубли" /></button>
        <button className={activityButtonClass("SEMANTIC_DELETE", "danger")} data-presence-cursor-anchor="true" data-presence-key="semantic-action:delete" disabled={checkedIds.size === 0} onClick={() => { setActionIds(null); setDeleteSelectionOpen(true); }} type="button"><Icon name="trash" /><UiText text="Удалить" /></button>
        {checkedIds.size > 0 && (
          <div className="semantic-selection-chip" role="status">
            <strong><UiText text="Выбрано:" after=" " />{checkedIds.size}</strong>
            <button
              aria-label={uiText("Снять выделение")}
              onClick={() => setCheckedIds(new Set())}
              title={uiText("Снять выделение")}
              type="button"
            ><Icon name="close" /></button>
          </div>
        )}
      </nav>

      {commandMenu && (
        <ContextMenu
          items={commandMenuItems}
          label={commandMenu.kind === "WORDSTAT" ? uiText("Действия Wordstat") : commandMenu.kind === "POSITIONS" ? uiText("Действия сбора позиций") : uiText("Действия сбора конкурентов")}
          onClose={() => setCommandMenu(undefined)}
          presentation="dropdown"
          triggerRef={commandMenuTriggerRef}
          x={commandMenu.x}
          y={commandMenu.y}
        />
      )}

      {mobileGroupTreeOpen && (
        <button
          aria-label={uiText("Закрыть группы")}
          className="semantic-mobile-groups-backdrop"
          onClick={() => setMobileGroupTreeOpen(false)}
          type="button"
        />
      )}
      <SemanticGroupTree
        {...(viewConfig.filters.groupId
          ? { activeGroupId: viewConfig.filters.groupId }
          : {})}
        expandedIds={expandedGroupIds}
        activeGroupIds={multiGroupIds}
        groups={groups as readonly SemanticGroupTreeItem[]}
        onCreate={(parentId, position) => {
          setMobileGroupTreeOpen(false);
          setGroupDialog({
            mode: "create",
            ...(parentId ? { parentId } : {}),
            ...(position === undefined ? {} : { position })
          });
        }}
        onDelete={(selectedGroups) => {
          setMobileGroupTreeOpen(false);
          setGroupDialog({ mode: "delete", groups: selectedGroups });
        }}
        onDuplicate={(group) => {
          setMobileGroupTreeOpen(false);
          setGroupDialog({ mode: "duplicate", group });
        }}
        onExport={(group) => {
          setMobileGroupTreeOpen(false);
          openExport(group.id);
        }}
        onColorChange={(selectedGroups, color) =>
          void changeGroupColors(selectedGroups, color)
        }
        {...(mobileGroupTreeOpen
          ? { onClose: () => setMobileGroupTreeOpen(false) }
          : {})}
        onDropMove={(selectedGroups, target) =>
          void moveGroupsImmediately(selectedGroups, target)
        }
        onInlineRename={renameGroupInline}
        onMoveRequest={(selectedGroups) => {
          setMobileGroupTreeOpen(false);
          setGroupDialog({
            mode: "move",
            groups: selectedGroups
          });
        }}
        onOpenSelection={(groupIds) => {
          openMultipleGroups(groupIds, uiLocale);
          setMobileGroupTreeOpen(false);
        }}
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
        onRename={(group) => {
          setMobileGroupTreeOpen(false);
          setGroupDialog({ mode: "rename", group });
        }}
        onReorder={(group, position) => void reorderGroup(group, position)}
        onExpandedIdsChange={updateExpandedGroupIds}
        projectId={projectId}
        refreshVersion={groupRefreshVersion}
        onSelect={(groupId) => {
          selectGroup(groupId);
          setMobileGroupTreeOpen(false);
        }}
        remotePresence={remoteSemanticGroupPresence}
        {...(total === undefined ? {} : { total })}
      />
      <div
        aria-label={uiText("Изменить ширину дерева групп")}
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
        title={uiText("Потяните для изменения ширины. Двойной клик — сбросить")}
      />

      <div
        className="semantic-table-tools"
      >
        <form className="semantic-search" onSubmit={submitSearch}>
          <button
            aria-label={uiText("Найти несколько запросов")}
            className={`semantic-multi-search-trigger${multiSearch ? " active" : ""}`}
            onClick={() => setMultiSearchDialogOpen(true)}
            title={uiText("Поиск по списку запросов")}
            type="button"
          >
            <Icon name="multiGroup" />
          </button>
          {multiSearch && (
            <span className="semantic-multi-search-chip">
              {formatInteger(multiSearch.terms.length, uiLocale)} <UiText text="по списку" before=" " /><button
                aria-label={uiText("Сбросить поиск по списку")}
                onClick={() => setMultiSearch(undefined)}
                title={uiText("Сбросить поиск по списку")}
                type="button"
              >
                <Icon name="close" />
              </button>
            </span>
          )}
          <label>
            <span className="visually-hidden">{keywordSearchPlaceholder}</span>
            <Icon name="search" />
            <input
              maxLength={200}
              onChange={(event) => updateFilter({ search: event.target.value })}
              placeholder={keywordSearchPlaceholder}
              type="text"
              value={draftConfig.filters.search ?? ""}
            />
            {(draftConfig.filters.search ?? "") && (
              <button aria-label={uiText("Очистить поиск")} onClick={clearSearch} title={uiText("Очистить")} type="button">
                <Icon name="close" />
              </button>
            )}
          </label>
        </form>
        <details className="semantic-filter-disclosure" data-exclusive-dropdown>
          <summary>
            <UiText text="Фильтры" />{activeFilterCount(viewConfig.filters) > 0 && (
              <span>{activeFilterCount(viewConfig.filters)}</span>
            )}
          </summary>
          <form className="semantic-filter-bar" onSubmit={submitFilters}>
        <header className="semantic-filter-popover-header">
          <div><strong><UiText text="Фильтры запросов" /></strong><small><UiText text="Совмещайте условия и применяйте их одним действием." /></small></div>
          {hasActiveFilters(viewConfig) && <button className="text-button" onClick={clearFilters} type="button"><UiText text="Очистить" /></button>}
        </header>
        <div className="semantic-filter-fields">
        <label>
          <span><UiText text="Интент" /></span>
          <CustomSelect
            onChange={(event) =>
              updateOptionalFilter("intent", event.target.value)
            }
            value={draftConfig.filters.intent ?? ""}
          >
            <option value=""><UiText text="Все" /></option>
            <option value="INFORMATIONAL"><UiText text="Информационный" /></option>
            <option value="NAVIGATIONAL"><UiText text="Навигационный" /></option>
            <option value="COMMERCIAL"><UiText text="Коммерческий" /></option>
            <option value="TRANSACTIONAL"><UiText text="Транзакционный" /></option>
            <option value="LOCAL"><UiText text="Локальный" /></option>
            <option value="MIXED"><UiText text="Смешанный" /></option>
          </CustomSelect>
        </label>
        <label>
          <span><UiText text="Группа" /></span>
          <SemanticGroupPickerField
            dialogTitle="Фильтр по папке"
            groups={groups}
            onChange={(value) => updateOptionalFilter("groupId", value)}
            rootLabel="Все группы"
            value={draftConfig.filters.groupId ?? ""}
          />
        </label>
        <label>
          <span><UiText text="Кластер" /></span>
          <CustomSelect
            aria-label={uiText("Кластер")}
            onChange={(event) =>
              updateOptionalFilter("clusterId", event.target.value)
            }
            value={draftConfig.filters.clusterId ?? ""}
          >
            <option value=""><UiText text="Все кластеры" /></option>
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name}
              </option>
            ))}
          </CustomSelect>
        </label>
        <label>
          <span><UiText text="Тег" /></span>
          <input
            list={`semantic-tag-filter-options-${projectId}`}
            maxLength={160}
            onChange={(event) =>
              updateOptionalFilter("tag", event.target.value)
            }
            placeholder={uiText("Выберите или введите тег")}
            type="text"
            value={draftConfig.filters.tag ?? ""}
          />
          <datalist id={`semantic-tag-filter-options-${projectId}`}>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </label>
        <label>
          <span><UiText text="Избранное" /></span>
          <CustomSelect
            onChange={(event) =>
              updateBooleanFilter("isFavorite", event.target.value)
            }
            value={booleanFilter(draftConfig.filters.isFavorite)}
          >
            <option value=""><UiText text="Все" /></option>
            <option value="true"><UiText text="Только избранные" /></option>
            <option value="false"><UiText text="Не избранные" /></option>
          </CustomSelect>
        </label>
        <label>
          <span><UiText text="Отслеживание" /></span>
          <CustomSelect
            onChange={(event) =>
              updateBooleanFilter("isTracked", event.target.value)
            }
            value={booleanFilter(draftConfig.filters.isTracked)}
          >
            <option value=""><UiText text="Все" /></option>
            <option value="true"><UiText text="Отслеживаются" /></option>
            <option value="false"><UiText text="Не отслеживаются" /></option>
          </CustomSelect>
        </label>
        <label>
          <span><UiText text="Приоритет от" /></span>
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
          <span><UiText text="Приоритет до" /></span>
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
        <section className="semantic-filter-range-section">
          <header><strong><UiText text="Частотность и длина" /></strong><small><UiText text="Пустая граница не участвует в фильтре." /></small></header>
          <div>
            {([
              ["База", "frequencyBaseMin", "frequencyBaseMax"],
              ['""', "frequencyExactMin", "frequencyExactMax"],
              ['"!"', "frequencyFixedMin", "frequencyFixedMax"]
            ] as const).flatMap(([label, min, max]) => [
              <label key={min}><span>{label} · <UiText text="от" /></span><input min={0} step={1} inputMode="numeric" type="number" value={draftConfig.filters[min] ?? ""} onChange={(event) => updateAdvancedFilter(min, event.target.value)} /></label>,
              <label key={max}><span>{label} · <UiText text="до" /></span><input min={0} step={1} inputMode="numeric" type="number" value={draftConfig.filters[max] ?? ""} onChange={(event) => updateAdvancedFilter(max, event.target.value)} /></label>
            ])}
            <label><span><UiText text="Слов от" /></span><input min={1} max={10_000} type="number" value={draftConfig.filters.wordCountMin ?? ""} onChange={(event) => updateAdvancedFilter("wordCountMin", event.target.value ? Number(event.target.value) : "")} /></label>
            <label><span><UiText text="Слов до" /></span><input min={1} max={10_000} type="number" value={draftConfig.filters.wordCountMax ?? ""} onChange={(event) => updateAdvancedFilter("wordCountMax", event.target.value ? Number(event.target.value) : "")} /></label>
          </div>
        </section>
        <section className="semantic-filter-range-section">
          <header><strong><UiText text="Позиции по городу и устройству" /></strong><small><UiText text="Фильтр использует последний снимок выбранного среза." /></small></header>
          <div>
            <label className="semantic-filter-wide"><span><UiText text="Срез позиций" /></span><CustomSelect searchable searchPlaceholder={uiText("Найти город или устройство")} value={draftConfig.filters.rankDimensionKey ?? ""} onChange={(event) => updateRankDimension(event.target.value)}><option value=""><UiText text="Не фильтровать по позициям" /></option>{rankComparison.dimensions.map(dimension => <option key={dimension.key} value={dimension.key}>{rankDimensionLabel(dimension, uiLocale)}</option>)}</CustomSelect></label>
            <label><span><UiText text="Состояние" /></span><CustomSelect disabled={!draftConfig.filters.rankDimensionKey} value={draftConfig.filters.rankState ?? ""} onChange={(event) => updateRankState(event.target.value)}><option value="CHECKED"><UiText text="Есть любой замер" /></option><option value="FOUND"><UiText text="Позиция найдена" /></option><option value="NOT_FOUND"><UiText text="Позиция не найдена" /></option><option value="NOT_CHECKED"><UiText text="Ещё не проверялся" /></option></CustomSelect></label>
            <label><span><UiText text="Позиция от" /></span><input min={1} max={100} type="number" disabled={!draftConfig.filters.rankDimensionKey || ["NOT_FOUND", "NOT_CHECKED"].includes(draftConfig.filters.rankState ?? "")} value={draftConfig.filters.rankPositionMin ?? ""} onChange={(event) => updateAdvancedFilter("rankPositionMin", event.target.value ? Number(event.target.value) : "")} /></label>
            <label><span><UiText text="Позиция до" /></span><input min={1} max={100} type="number" disabled={!draftConfig.filters.rankDimensionKey || ["NOT_FOUND", "NOT_CHECKED"].includes(draftConfig.filters.rankState ?? "")} value={draftConfig.filters.rankPositionMax ?? ""} onChange={(event) => updateAdvancedFilter("rankPositionMax", event.target.value ? Number(event.target.value) : "")} /></label>
            <label><span><UiText text="Снято с даты" /></span><input type="date" disabled={!draftConfig.filters.rankDimensionKey || draftConfig.filters.rankState === "NOT_CHECKED"} value={filterDateValue(draftConfig.filters.rankCheckedFrom)} onChange={(event) => updateAdvancedFilter("rankCheckedFrom", event.target.value ? `${event.target.value}T00:00:00.000Z` : "")} /></label>
            <label><span><UiText text="Снято до даты" /></span><input type="date" disabled={!draftConfig.filters.rankDimensionKey || draftConfig.filters.rankState === "NOT_CHECKED"} value={filterDateBeforeValue(draftConfig.filters.rankCheckedBefore)} onChange={(event) => updateAdvancedFilter("rankCheckedBefore", event.target.value ? nextUtcDay(event.target.value) : "")} /></label>
          </div>
        </section>
        <label>
          <span><UiText text="Целевой URL" /></span>
          <CustomSelect value={draftConfig.filters.targetUrlState ?? ""} onChange={(event) => updateAdvancedFilter("targetUrlState", event.target.value as "" | "SET" | "EMPTY")}><option value=""><UiText text="Любой" /></option><option value="SET"><UiText text="Задан" /></option><option value="EMPTY"><UiText text="Не задан" /></option></CustomSelect>
        </label>
        <label>
          <span><UiText text="Сортировка" /></span>
          <CustomSelect
            disabled={savingFolderSort}
            onChange={(event) =>
              void changeFolderSort(
                event.target.value as SemanticViewConfig["sort"]
              )
            }
            value={viewConfig.sort}
          >
            {isSemanticRankDimensionSort(viewConfig.sort) &&
              viewConfig.rankSortDimensionKey && (
                <option value={viewConfig.sort}>
                  {semanticRankSortLabel(
                    viewConfig,
                    rankComparison.dimensions,
                    uiLocale
                  )}
                </option>
              )}
            <option value="CREATED_DESC"><UiText text="Сначала новые" /></option>
            <option value="CREATED_ASC"><UiText text="Сначала старые" /></option>
            <option value="UPDATED_DESC"><UiText text="Недавно изменённые" /></option>
            <option value="UPDATED_ASC"><UiText text="Давно изменённые" /></option>
            <option value="TEXT_ASC"><UiText text="Запрос: А → Я" /></option>
            <option value="TEXT_DESC"><UiText text="Запрос: Я → А" /></option>
            <option value="PRIORITY_DESC"><UiText text="Приоритет: высокий → низкий" /></option>
            <option value="PRIORITY_ASC"><UiText text="Приоритет: низкий → высокий" /></option>
            <option value="SOURCE_ASC"><UiText text="Источник: А → Я" /></option>
            <option value="SOURCE_DESC"><UiText text="Источник: Я → А" /></option>
            <option value="TAGS_ASC"><UiText text="Теги: А → Я" /></option>
            <option value="TAGS_DESC"><UiText text="Теги: Я → А" /></option>
            <option value="FREQUENCY_BASE_DESC"><UiText text="База: больше → меньше" /></option>
            <option value="FREQUENCY_BASE_ASC"><UiText text="База: меньше → больше" /></option>
            <option value="FREQUENCY_EXACT_DESC"><UiText text="&quot;&quot;: больше → меньше" /></option>
            <option value="FREQUENCY_EXACT_ASC"><UiText text="&quot;&quot;: меньше → больше" /></option>
            <option value="FREQUENCY_FIXED_DESC"><UiText text="&quot;!&quot;: больше → меньше" /></option>
            <option value="FREQUENCY_FIXED_ASC"><UiText text="&quot;!&quot;: меньше → больше" /></option>
            <option value="YANDEX_POSITION_ASC"><UiText text="Яндекс: лучшие позиции" /></option>
            <option value="YANDEX_POSITION_DESC"><UiText text="Яндекс: худшие позиции" /></option>
            <option value="GOOGLE_POSITION_ASC"><UiText text="Google: лучшие позиции" /></option>
            <option value="GOOGLE_POSITION_DESC"><UiText text="Google: худшие позиции" /></option>
            <option value="YANDEX_CHECKED_AT_DESC"><UiText text="Яндекс: свежий съём" /></option>
            <option value="YANDEX_CHECKED_AT_ASC"><UiText text="Яндекс: старый съём" /></option>
            <option value="GOOGLE_CHECKED_AT_DESC"><UiText text="Google: свежий съём" /></option>
            <option value="GOOGLE_CHECKED_AT_ASC"><UiText text="Google: старый съём" /></option>
            <option value="YANDEX_AI_POSITION_ASC"><UiText text="ИИ Яндекс: лучшие позиции" /></option>
            <option value="YANDEX_AI_POSITION_DESC"><UiText text="ИИ Яндекс: худшие позиции" /></option>
            <option value="GOOGLE_AI_POSITION_ASC"><UiText text="ИИ Google: лучшие позиции" /></option>
            <option value="GOOGLE_AI_POSITION_DESC"><UiText text="ИИ Google: худшие позиции" /></option>
            <option value="YANDEX_AI_CHECKED_AT_DESC"><UiText text="ИИ Яндекс: свежий съём" /></option>
            <option value="YANDEX_AI_CHECKED_AT_ASC"><UiText text="ИИ Яндекс: старый съём" /></option>
            <option value="GOOGLE_AI_CHECKED_AT_DESC"><UiText text="ИИ Google: свежий съём" /></option>
            <option value="GOOGLE_AI_CHECKED_AT_ASC"><UiText text="ИИ Google: старый съём" /></option>
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
              <UiText text="Сбросить" /></button>
          )}
          <button className="primary-button semantic-filter-apply" type="submit">
            <UiText text="Применить" /></button>
        </footer>
          </form>
        </details>
        <div className="semantic-table-view-actions">
          <button
            aria-label={uiText("Колонки и представления")}
            className={`semantic-compact-button${rightSidebar?.type === "LAYOUT" ? " active" : ""}`}
            data-semantic-sidebar-trigger
            onClick={() => setRightSidebar((current) => current?.type === "LAYOUT" ? undefined : { type: "LAYOUT" })}
            type="button"
          >
            <Icon name="settings" />
            <span className="semantic-layout-button-full"><UiText text="Колонки и представления" /></span>
            <span className="semantic-layout-button-mobile" aria-hidden="true"><UiText text="Вид таблицы" /></span>
          </button>
        </div>
      </div>

      {exportDialog && (
        <SemanticModal
          description={uiText("Таблица, история позиций и карта сайта формируются в фоне.")}
          onClose={() => setExportDialog(undefined)}
          size={exportContent === "FOLDER_MAP" ? "large" : "medium"}
          title={uiText("Экспорт семантики")}
        >
          <form
            className="semantic-export-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void downloadExport(uiLocale);
            }}
          >
            <div className="semantic-export-grid">
              <label>
                <span><UiText text="Содержимое файла" /></span>
                <CustomSelect
                  disabled={exporting || exportJob?.status === "COMPLETED"}
                  onChange={(event) => {
                    const content = event.target.value as SemanticExportContent;
                    setExportContent(content);
                    if (exportContent === "COMPETITORS" && content !== "COMPETITORS") setExportColumns(viewConfig.columns);
                    if (content === "COMPETITORS") {
                      setExportFormat("XLSX"); setExportBom(false);
                      setExportColumns(["query", ...semanticCompetitorRowColumnKeys]);
                    } else if (content !== "SEMANTIC") {
                      setExportFormat("XLSX");
                      setExportBom(false);
                      if (content === "FOLDER_MAP") {
                        setExportColumns((current) =>
                          current.includes("query") ? current : ["query", ...current]
                        );
                      }
                    } else {
                      setExportBom(exportFormat === "CSV" || exportFormat === "TSV");
                    }
                  }}
                  value={exportContent}
                >
                  <option value="SEMANTIC"><UiText text="Таблица семантики" /></option>
                  <option value="POSITION_HISTORY"><UiText text="История позиций по датам" /></option>
                  <option value="COMPETITORS"><UiText text="Конкуренты по городам и устройствам" /></option>
                  <option value="FOLDER_MAP"><UiText text="Карта сайта по папкам" /></option>
                </CustomSelect>
              </label>
              {exportContent !== "FOLDER_MAP" && (
                <label>
                  <span><UiText text="Область экспорта" /></span>
                  <CustomSelect
                    disabled={exporting || Boolean(exportDialog.groupId)}
                    onChange={(event) => setExportScope(event.target.value as SemanticExportScope)}
                    value={exportScope}
                  >
                    <option value="CURRENT_FILTER"><UiText text="Все строки текущего фильтра" /></option>
                    <option disabled={checkedIds.size === 0} value="SELECTED"><UiText text="Выбранные строки (" />{checkedIds.size})</option>
                    {exportDialog.groupId && <option value="GROUP_SUBTREE"><UiText text="Текущая группа и подгруппы" /></option>}
                  </CustomSelect>
                </label>
              )}
              <label>
                <span><UiText text="Формат" /></span>
                <CustomSelect
                  disabled={
                    exporting ||
                    exportJob?.status === "COMPLETED" ||
                    (exportContent === "POSITION_HISTORY" || exportContent === "FOLDER_MAP")
                  }
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
                  <option value="GOOGLE_CSV"><UiText text="CSV для Google Sheets" /></option>
                  <option value="XLSX">Excel (XLSX)</option>
                </CustomSelect>
              </label>
            </div>
            {exportContent === "FOLDER_MAP" && (
              <SemanticExportFolderPicker
                disabled={exporting || exportJob?.status === "COMPLETED"}
                groups={groups}
                includeDescendants={exportFolderMapIncludeDescendants}
                onIncludeDescendantsChange={setExportFolderMapIncludeDescendants}
                onSelectedGroupIdsChange={setExportFolderMapGroupIds}
                selectedGroupIds={exportFolderMapGroupIds}
              />
            )}
            {exportContent !== "POSITION_HISTORY" ? (
              <fieldset className="semantic-export-columns">
                <legend><UiText text="Колонки" /></legend>
                {[
                  ...semanticColumns,
                  ...rankColumns,
                  ...(exportContent === "COMPETITORS" ? semanticCompetitorRowColumnKeys.map(key => ({ key, label: semanticCompetitorRowLabels[key] })) : semanticCompetitorExportColumns),
                  ...customColumns.map((column) => ({
                    key: `custom:${column.id}` as const,
                    label: column.name
                  }))
                ].map((column) => (
                  <label key={column.key}>
                    <input
                      checked={
                        exportColumns.includes(column.key) ||
                        (exportContent === "FOLDER_MAP" && column.key === "query")
                      }
                      disabled={
                        exporting ||
                        exportJob?.status === "COMPLETED" ||
                        (exportContent === "FOLDER_MAP" && column.key === "query")
                      }
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
            ) : (
              <fieldset className="semantic-history-export-settings">
                <legend><UiText text="Отчёт истории позиций" /></legend>
                <div className="semantic-history-export-engines">
                  {(["YANDEX", "GOOGLE"] as const).map((engine) => (
                    <label key={engine}>
                      <input
                        checked={exportHistoryEngines.includes(engine)}
                        disabled={exporting || exportJob?.status === "COMPLETED"}
                        name="position-history-engine"
                        onChange={() => setExportHistoryEngines([engine])}
                        type="radio"
                      />
                      <SearchEngineLogo engine={engine} />
                      <span>{engine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</span>
                    </label>
                  ))}
                </div>
                <p className="semantic-history-export-compatibility"><UiText text="Один файл содержит одну поисковую систему и совместим с обратным импортом истории позиций." /></p>
                <div className="semantic-history-export-dates">
                  <label>
                    <span><UiText text="С даты" /></span>
                    <input
                      disabled={exporting || exportJob?.status === "COMPLETED"}
                      onChange={(event) => setExportHistoryFrom(event.target.value)}
                      type="date"
                      value={exportHistoryFrom}
                    />
                  </label>
                  <label>
                    <span><UiText text="По дату включительно" /></span>
                    <input
                      disabled={exporting || exportJob?.status === "COMPLETED"}
                      onChange={(event) => setExportHistoryTo(event.target.value)}
                      type="date"
                      value={exportHistoryTo}
                    />
                  </label>
                </div>
                <label className="semantic-control-check semantic-history-export-untracked">
                  <input
                    checked={exportHistoryIncludeUntracked}
                    disabled={exporting || exportJob?.status === "COMPLETED"}
                    onChange={(event) =>
                      setExportHistoryIncludeUntracked(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span><UiText text="Включить неотслеживаемые запросы" /></span>
                </label>
                <div className="semantic-history-export-legend">
                  <span><i className="up" /> <UiText text="Рост или новая позиция" before=" " /></span>
                  <span><i className="down" /> <UiText text="Падение или потеря позиции" before=" " /></span>
                  <span><i /> <UiText text="Без изменений / нет данных" before=" " /></span>
                </div>
                <p>
                  <UiText text="Один лист на поисковую систему, реальные даты съёмов, числовые позиции и формулы ТОП‑5/10/30." /></p>
              </fieldset>
            )}
            {(exportContent === "SEMANTIC" || exportContent === "COMPETITORS") && (
              <label className="semantic-control-check">
                <input
                  checked={exportBom}
                  disabled={
                    exporting ||
                    exportJob?.status === "COMPLETED" ||
                    (exportFormat !== "CSV" && exportFormat !== "TSV")
                  }
                  onChange={(event) => setExportBom(event.target.checked)}
                  type="checkbox"
                />
                <span><UiText text="Добавить UTF-8 BOM для корректного открытия в Excel" /></span>
              </label>
            )}
            {exportJob && (
              <div className="semantic-export-progress" role="status">
                <div>
                  <strong>{<UiText text={semanticExportStatusLabel(exportJob) ?? ""} />}</strong>
                  <span>
                    {formatInteger(exportJob.processedRows, uiLocale)}
                    {exportJob.totalRows !== undefined
                      ? <UiText text="из {0}" values={[String(formatInteger(exportJob.totalRows, uiLocale))]} before=" " />
                      : ""} <UiText text="строк" before=" " /></span>
                </div>
                <progress
                  max={Math.max(1, exportJob.totalRows ?? exportJob.processedRows ?? 1)}
                  value={exportJob.processedRows}
                />
              </div>
            )}
            {mutationError && <div className="inline-alert danger" role="alert">{<UiText text={mutationError ?? ""} />}</div>}
            {exportJob?.status === "COMPLETED" && (
              <div className="inline-alert success" role="status">
                <UiText text="Файл готов:" after=" " />{formatInteger(exportJob.rowCount ?? exportJob.processedRows, uiLocale)} <UiText text="строк. Скачивание начинается только по кнопке ниже." before=" " /></div>
            )}
            <div className="semantic-modal-actions">
              {exporting && exportJob && semanticExportActive(exportJob.status) ? (
                <button
                  className="secondary-button"
                  disabled={exportCancelling}
                  onClick={() => void cancelExport()}
                  type="button"
                >
                  {exportCancelling ? <UiText text="Останавливаем…" /> : <UiText text="Остановить экспорт" />}
                </button>
              ) : (
                <button className="secondary-button" onClick={() => setExportDialog(undefined)} type="button">
                  {exportJob?.status === "COMPLETED" ? <UiText text="Закрыть" /> : <UiText text="Отмена" />}
                </button>
              )}
              {exportJob?.status === "COMPLETED" ? (
                <a
                  className="primary-button"
                  href={semanticExportFileUrl(projectId, exportJob.id)}
                  onClick={() => setExportNotice(
                    `Скачивание ${
                      exportContent === "POSITION_HISTORY"
                        ? "отчёта истории позиций"
                        : exportContent === "FOLDER_MAP"
                          ? "карты сайта"
                        : exportFormat
                    } началось. Если браузер запросит разрешение, подтвердите его.`
                  )}
                >
                  <UiText text="Скачать файл" /></a>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    exporting ||
                    (exportContent !== "POSITION_HISTORY" && exportColumns.length === 0) ||
                    (exportContent === "POSITION_HISTORY" &&
                      (exportHistoryEngines.length === 0 ||
                        !validSemanticHistoryDateRange(exportHistoryFrom, exportHistoryTo))) ||
                    (exportContent === "FOLDER_MAP" && exportFolderMapGroupIds.size === 0) ||
                    (exportContent !== "FOLDER_MAP" && exportScope === "SELECTED" && checkedIds.size === 0)
                  }
                  type="submit"
                >
                  {exporting ? <UiText text="Формируем файл…" /> : <UiText text="Экспортировать" />}
                </button>
              )}
            </div>
          </form>
        </SemanticModal>
      )}

      {editor && (
        <SemanticModal
          bodyClassName="semantic-keyword-editor-modal-body"
          className="semantic-keyword-editor-modal"
          description={uiText("Группа, кластер, посадочная страница и теги сохраняются вместе с проверкой версии.")}
          footer={
            <div className="semantic-keyword-editor-footer">
              <span>
                {editor.mode === "edit"
                  ? <UiText text="Изменения применятся к одному запросу" />
                  : manualDuplicateReview
                    ? <UiText text="Новых: {0} · совпадений: {1}" values={[String(formatInteger(manualDuplicateReview.preview.newKeywords, uiLocale)), String(formatInteger(manualDuplicateRows.length, uiLocale))]} />
                    : <UiText text="Уникальных запросов: {0}" values={[String(formatInteger(manualInputStats?.unique ?? 0, uiLocale))]} />}
              </span>
              <div className="semantic-modal-actions">
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => {
                    setManualDuplicateReview(undefined);
                    setEditor(undefined);
                  }}
                  type="button"
                >
                  <UiText text="Отмена" /></button>
                <button
                  className="primary-button"
                  disabled={saving}
                  form={SEMANTIC_KEYWORD_EDITOR_FORM_ID}
                  type="submit"
                >
                  {editor.mode === "edit"
                    ? saving
                      ? <UiText text="Сохраняем…" />
                      : <UiText text="Сохранить" />
                    : saving
                      ? manualDuplicateReview
                        ? <UiText text="Добавляем…" />
                        : <UiText text="Проверяем…" />
                      : manualDuplicateReview
                        ? <UiText text="Добавить и применить выбор" />
                        : <UiText text="Проверить и добавить" />}
                </button>
              </div>
            </div>
          }
          onClose={saving ? () => undefined : () => {
            setManualDuplicateReview(undefined);
            setEditor(undefined);
          }}
          size={manualDuplicateReview ? "large" : "medium"}
          title={editor.mode === "create" ? uiText("Добавить запросы") : uiText("Изменить запрос")}
        >
          <form
            className="semantic-editor"
            id={SEMANTIC_KEYWORD_EDITOR_FORM_ID}
            onSubmit={(event) => void saveKeyword(event, uiLocale)}
          >
          <fieldset className="semantic-editor-fields" disabled={saving}>
          <div className="semantic-editor-grid">
            <label className="semantic-editor-query">
              <span>{editor.mode === "create" ? <UiText text="Запросы — по одному в строке" /> : <UiText text="Запрос" />}</span>
              {editor.mode === "create" ? (
                <>
                  <textarea
                    autoFocus
                    maxLength={4_100_000}
                    onChange={(event) => updateDraft({ text: event.target.value })}
                    placeholder={uiText("купить слона доставка слона цена слона")}
                    required
                    rows={6}
                    value={editor.draft.text}
                  />
                  <small
                    className={
                      manualInputStats &&
                      manualInputStats.unique > MANUAL_KEYWORD_LIMIT
                        ? "semantic-editor-query-limit"
                        : undefined
                    }
                  >
                    {manualInputStats?.total ?? 0} <UiText text="запросов" before=" " />{manualInputStats
                      ? <UiText text="· уникальных: {0}" values={[String(manualInputStats.unique)]} before=" " />
                      : ""}
                    {manualInputStats?.duplicates
                      ? <UiText text="· повторов в списке будет объединено: {0}" values={[String(manualInputStats.duplicates)]} before=" " />
                      : ""}
                    {<UiText text="· лимит за один запуск: {0}" values={[String(formatInteger(MANUAL_KEYWORD_LIMIT, uiLocale))]} before=" " />}
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
              <span><UiText text="Язык" /></span>
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
              <span><UiText text="Приоритет" /></span>
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
              <span><UiText text="Интент" /></span>
              <CustomSelect
                onChange={(event) =>
                  updateDraft({
                    intent: event.target.value as KeywordDraft["intent"]
                  })
                }
                value={editor.draft.intent}
              >
                <option value=""><UiText text="Не задан" /></option>
                <option value="INFORMATIONAL"><UiText text="Информационный" /></option>
                <option value="NAVIGATIONAL"><UiText text="Навигационный" /></option>
                <option value="COMMERCIAL"><UiText text="Коммерческий" /></option>
                <option value="TRANSACTIONAL"><UiText text="Транзакционный" /></option>
                <option value="LOCAL"><UiText text="Локальный" /></option>
                <option value="MIXED"><UiText text="Смешанный" /></option>
              </CustomSelect>
            </label>
            <div className="semantic-editor-field semantic-editor-group">
              <span><UiText text="Группа" /></span>
              <SemanticGroupPickerField
                dialogTitle="Группа запросов"
                groups={groups}
                onChange={(groupId) => updateDraft({ groupId })}
                rootIcon="inbox"
                rootLabel="Без группы"
                searchPlaceholder={uiText("Найти группу по названию или пути")}
                value={editor.draft.groupId}
              />
            </div>
            <label className="semantic-editor-cluster">
              <span><UiText text="Кластер" /></span>
              <CustomSelect
                onChange={(event) =>
                  updateDraft({ clusterId: event.target.value })
                }
                value={editor.draft.clusterId}
              >
                <option value=""><UiText text="Без кластера" /></option>
                {clusters.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label className="semantic-editor-url">
              <span><UiText text="Целевой URL" /></span>
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
            <div className="semantic-editor-tags">
              <KeywordTagPicker projectId={projectId} value={editor.draft.tagNames} onChange={tagNames => updateDraft({ tagNames })} disabled={saving} />
            </div>
            <label className="semantic-editor-check">
              <input
                checked={editor.draft.isFavorite}
                onChange={(event) =>
                  updateDraft({ isFavorite: event.target.checked })
                }
                type="checkbox"
              />
              <span><UiText text="Избранный запрос" /></span>
            </label>
            <label className="semantic-editor-check">
              <input
                checked={editor.draft.isTracked}
                onChange={(event) =>
                  updateDraft({ isTracked: event.target.checked })
                }
                type="checkbox"
              />
              <span><UiText text="Отслеживать позиции" /></span>
            </label>
            {editor.mode === "create" && (
              <>
                <label className="semantic-editor-check semantic-editor-deduplicate">
                  <input
                    checked={editor.draft.skipDuplicates}
                    onChange={(event) =>
                      setManualDuplicateSkipping(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong><UiText text="Не добавлять дубли" /></strong>
                    <small>
                      <UiText text="Совпадения, не выбранные для текущей группы, будут пропущены и останутся в своих группах. Повторы внутри вставленного списка всегда объединяются." /></small>
                  </span>
                </label>
                <label className="semantic-editor-check semantic-editor-deduplicate">
                  <input
                    checked={manualDuplicateReview
                      ? allManualDuplicatesSelected
                      : editor.draft.addDuplicatesToGroup &&
                        manualDuplicateTargetGroup !== undefined}
                    disabled={
                      !manualDuplicateTargetGroup ||
                      (manualDuplicateReview !== undefined &&
                        manualActionableDuplicateRows.length === 0)
                    }
                    onChange={(event) =>
                      setManualDuplicateImport(event.target.checked)
                    }
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = Boolean(
                          manualDuplicateReview &&
                          manualDuplicateReview.selectedIndices.size > 0 &&
                          !allManualDuplicatesSelected
                        );
                      }
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>
                      {manualDuplicateTargetGroup
                        ? <UiText text="Добавить найденные дубли в «{0}»" values={[String(manualDuplicateTargetGroup.name)]} />
                        : <UiText text="Добавить найденные дубли в выбранную группу" />}
                    </strong>
                    <small>
                      {manualDuplicateTargetGroup
                        ? <UiText text="Имеет приоритет над правилом «Не добавлять дубли»: выбранный существующий запрос будет перемещён из прежних групп в эту, а запрос из корзины — восстановлен. После проверки действие можно изменить построчно." />
                        : <UiText text="Сначала выберите обычную группу. Дубли из активных групп нельзя переместить без целевой группы; запрос из корзины можно восстановить построчно без группы." />}
                    </small>
                  </span>
                </label>
              </>
            )}
          </div>
          {editor.mode === "create" && manualDuplicateReview && (
            <section
              aria-labelledby="manual-duplicate-review-title"
              className="semantic-manual-duplicate-review"
            >
              <header>
                <div>
                  <strong id="manual-duplicate-review-title">
                    <UiText text="Найдены совпадения:" after=" " />{formatInteger(manualDuplicateRows.length, uiLocale)}
                  </strong>
                  <span>
                    <UiText text="Новых запросов:" after=" " />{formatInteger(manualDuplicateReview.preview.newKeywords, uiLocale)}<UiText text=". Проверьте группы и выберите, какие запросы переместить или восстановить." /></span>
                </div>
                <small>
                  <UiText text="Выбрано действий:" after=" " />{formatInteger(
                    manualDuplicateReview.selectedIndices.size, uiLocale
                  )}
                </small>
              </header>
              <div className="semantic-manual-duplicate-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th><UiText text="Запрос" /></th>
                      <th><UiText text="Сейчас находится" /></th>
                      <th><UiText text="Действие" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualDuplicateRows.map((row) => {
                      const text = manualDuplicateReview.texts[row.index] ?? "";
                      const currentGroups = row.groups.length > 0
                        ? row.groups.map((group) =>
                            group.systemKind === "TRASH"
                              ? "Корзина"
                              : group.systemKind === "UNGROUPED"
                                ? "Без группы"
                                : group.path
                          ).join(", ") + (row.groupsTruncated ? ", …" : "")
                        : "Без группы";
                      const movable =
                        row.state === "ACTIVE_DUPLICATE" &&
                        manualKeywordDuplicateCanApply(
                          row,
                          manualDuplicateTargetGroup?.id
                        );
                      const restorableFromTrash =
                        row.state === "TRASHED_DUPLICATE";
                      const selected =
                        manualDuplicateReview.selectedIndices.has(row.index);
                      return (
                        <tr key={`${row.index}:${row.keywordId ?? "new"}`}>
                          <td title={text}>{text}</td>
                          <td title={currentGroups}>{currentGroups}</td>
                          <td>
                            {movable || restorableFromTrash ? (
                              <label className="semantic-manual-duplicate-choice">
                                <input
                                  checked={selected}
                                  onChange={(event) =>
                                    setManualDuplicateRowImport(
                                      row.index,
                                      event.target.checked
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  {restorableFromTrash
                                    ? selected
                                      ? manualDuplicateTargetGroup
                                        ? <UiText text="Восстановить и перенести в «{0}»" values={[String(manualDuplicateTargetGroup.name)]} />
                                        : <UiText text="Восстановить без группы" />
                                      : <UiText text="Оставить в корзине" />
                                    : selected
                                      ? <UiText text="Переместить в «{0}»" values={[String(manualDuplicateTargetGroup?.name ?? "выбранную группу")]} />
                                      : editor.draft.skipDuplicates
                                        ? <UiText text="Оставить в текущих группах" />
                                        : <UiText text="Не перемещать сейчас — оставить в форме" />}
                                </span>
                              </label>
                            ) : row.state === "ACTIVE_DUPLICATE" && row.inTargetGroup ? (
                              <span className="semantic-manual-duplicate-status">
                                <UiText text="Уже только в выбранной группе" /></span>
                            ) : (
                              <span className="semantic-manual-duplicate-status">
                                <UiText text="Будет восстановлен" /></span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          </fieldset>
          {mutationError && (
            <div className="inline-alert danger" role="alert">
              {<UiText text={mutationError ?? ""} />}
            </div>
          )}
          </form>
        </SemanticModal>
      )}

      {!editor && mutationIds.size > 0 && bulkEditorOpen && (
        <SemanticModal
          description={mutationIds.size === 1 ? uiText("Все основные свойства запроса сохраняются вместе с проверкой версии.") : uiText("Изменяйте только нужные поля сразу у всех выбранных запросов. Версии строк проверяются отдельно.")}
          onClose={() => {
            setBulkEditorOpen(false);
            setActionIds(null);
          }}
          size={mutationIds.size === 1 ? "medium" : "large"}
          title={mutationIds.size === 1 ? uiText("Изменить запрос") : uiText("Изменить запросы · {0}", [String(mutationIds.size)])}
        >
          <SemanticBulkEditor
          clusters={clusters}
          groups={groups}
          onCancel={() => {
            setBulkEditorOpen(false);
            setActionIds(null);
          }}
          onCompleted={(result) => {
            setCheckedIds(new Set());
            setActionIds(null);
            setBulkEditorOpen(false);
            setBulkNotice(
              `${result.selected === 1 ? "Запрос сохранён" : `Обновлено ${result.changed} из ${result.selected}`}` +
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
            .map(({ id, version, textOriginal, language, priority, isFavorite, isTracked, intent, groupId, clusterId, targetUrl, tags }) => ({
              id,
              version,
              text: textOriginal,
              language,
              priority,
              isFavorite,
              isTracked,
              ...(intent ? { intent } : {}),
              ...(groupId ? { groupId } : {}),
              ...(clusterId ? { clusterId } : {}),
              ...(targetUrl ? { targetUrl } : {}),
              tags
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

      {siteResultsKeyword && (
        <SemanticSiteResultsModal
          item={siteResultsKeyword}
          onClose={() => setSiteResultsKeyword(undefined)}
        />
      )}

      {(bulkNotice || exportNotice || (!editor && !exportDialog && mutationError)) && (
        <div className="semantic-toast-stack" aria-live="polite">
          {bulkNotice && (
            <div className="semantic-toast success" role="status">
              <span aria-hidden="true">✓</span>
              <strong>{<UiText text={bulkNotice ?? ""} />}</strong>
              <button aria-label={uiText("Закрыть уведомление")} onClick={() => setBulkNotice(undefined)} type="button">×</button>
            </div>
          )}
          {exportNotice && (
            <div className="semantic-toast success" role="status">
              <span aria-hidden="true">✓</span>
              <strong>{<UiText text={exportNotice ?? ""} />}</strong>
              <button aria-label={uiText("Закрыть уведомление")} onClick={() => setExportNotice(undefined)} type="button">×</button>
            </div>
          )}
          {!editor && !exportDialog && mutationError && (
            <div className="semantic-toast danger" role="alert">
              <span aria-hidden="true">!</span>
              <strong>{<UiText text={mutationError ?? ""} />}</strong>
              <button aria-label={uiText("Закрыть уведомление")} onClick={() => setMutationError(undefined)} type="button">×</button>
            </div>
          )}
        </div>
      )}

      {rankComparison.error && <div className="inline-alert warning semantic-table-alert" role="alert"><UiText text={rankComparison.error} /><button type="button" className="text-button" onClick={rankComparison.refresh}><UiText text="Повторить" /></button></div>}
      {error && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button
            className="text-button"
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            <UiText text="Повторить" /></button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="semantic-table-skeleton" role="status">
          <span className="visually-hidden"><UiText text="Загружаем запросы" /></span>
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      ) : (
        <>
          <div
            aria-busy={loading}
            className={`semantic-table-wrap${loading ? " refreshing" : ""}`}
            data-presence-cursor-anchor="true"
            data-presence-key="semantic-table-viewport"
            onKeyDown={navigateKeywordRows}
            onScroll={(event) =>
              setTableViewport({
                height: event.currentTarget.clientHeight,
                scrollTop: event.currentTarget.scrollTop
              })
            }
            ref={tableScrollRef}
            tabIndex={0}
            aria-label={uiText("Таблица семантического ядра")}
          >
            <KeywordDataGrid
              actions={(item) => (
                <button
                  aria-label={uiText("Действия с запросом {0}", [String(item.textOriginal)])}
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
              allRowsSelected={
                items.length > 0 &&
                !page.hasNext &&
                items.every(({ id }) => checkedIds.has(id))
              }
              ariaLabel={uiText("Таблица семантического ядра")}
              columns={tableColumns.map((column) => {
                const nextSort = nextSemanticColumnSort(
                  column,
                  viewConfig.sort,
                  viewConfig.rankSortDimensionKey
                );
                const direction = semanticColumnSortDirection(
                  column,
                  viewConfig.sort,
                  viewConfig.rankSortDimensionKey
                );
                return {
                  key: column,
                  ariaSort: direction,
                  cellClassName: `semantic-column-${column}`,
                  width:
                    columnWidths[column] ?? semanticColumnDefaultWidth(column),
                  minWidth:
                    column === "query" ? 180 : semanticColumnMinWidth,
                  maxWidth: semanticColumnMaxWidth,
                  resizeLabel: columnLabel(column, customColumns, rankComparison.dimensions, uiLocale),
                  onResize: (width: number) =>
                    resizeSemanticColumn(column, width, false),
                  onResizeEnd: (width: number) =>
                    resizeSemanticColumn(column, width, true),
                  header: nextSort ? (
                    <button
                      aria-label={`${columnLabel(column, customColumns, rankComparison.dimensions, uiLocale)}. ${sortActionLabel(nextSort.sort)}`}
                      className={direction ? "active" : undefined}
                      disabled={savingFolderSort}
                      onClick={() => void changeFolderSort(
                        nextSort.sort,
                        nextSort.rankSortDimensionKey
                      )}
                      type="button"
                    >
                      <span>{columnHeader(column, customColumns, rankComparison.dimensions, uiLocale)}</span>
                      <i aria-hidden="true">
                        {direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}
                      </i>
                    </button>
                  ) : columnHeader(column, customColumns, rankComparison.dimensions, uiLocale),
                  cell: (item: SemanticKeyword) => parseSemanticRankColumnKey(column) ? <SemanticRankComparisonCell item={rankComparison.items.get(`${item.id}:${parseSemanticRankColumnKey(column)!.dimension.key}`)} metric={parseSemanticRankColumnKey(column)!.metric} loading={rankComparison.loading} {...(rankComparison.error ? { error: rankComparison.error } : {})} /> : keywordColumn(
                    item,
                    column,
                    customColumns,
                    (customColumn) => setCustomValueEditor({ keyword: item, column: customColumn }),
                    () => setSiteResultsKeyword(item),
                    () => setAiAnswerKeyword(item),
                    viewConfig.density,
                    semanticQueryIndicatorsFor(viewConfig), uiLocale
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
              onToggleAll={toggleAllSelection}
              onToggleHighlighted={toggleHighlightedSelection}
              onToggleRow={(item, event) => toggleKeywordRow(item, event)}
              paddingBottom={virtualRows.paddingBottom}
              paddingTop={virtualRows.paddingTop}
              presenceByRowId={remoteKeywordPresence}
              rowNumberOffset={virtualRows.start}
              rows={virtualRows.items}
              selectedIds={checkedIds}
              showRowNumbers
              toggleAllDisabled={selectingAll}
            />
            <div aria-hidden="true" className="semantic-load-sentinel" ref={loadMoreSentinelRef} />
          </div>
          <footer className="semantic-table-footer">
            <span>
              <UiText text="Показано" after=" " />{formatInteger(items.length, uiLocale)}
              {filteredTotal === undefined ? "" : <UiText text="из {0}" values={[String(formatInteger(filteredTotal, uiLocale))]} before=" " />}
            </span>
            <div className="semantic-table-footer-controls">
              <span>
                {loadingMore
                  ? <UiText text="Загружаем следующую часть…" />
                  : page.hasNext
                    ? <UiText text="Прокрутите ниже — строки загрузятся автоматически" />
                    : <UiText text="Все доступные строки загружены" />}
              </span>
              <label>
                <span><UiText text="Загружать по" /></span>
                <CustomSelect
                  aria-label={uiText("Количество запросов в одном блоке")}
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
          onFrequencyDeleted={() =>
            setRetryVersion((value) => value + 1)
          }
          onOpenAiAnswer={() => setAiAnswerKeyword(focusedKeyword)}
          onUpdated={(updated) => {
            setItems((current) =>
              current.map((keyword) => {
                if (keyword.id !== updated.id) return keyword;
                const { targetUrl: _previousTargetUrl, ...unchanged } = keyword;
                return {
                  ...unchanged,
                  hasNote: updated.hasNote ?? false,
                  isTracked: updated.isTracked,
                    ...(updated.targetUrl
                      ? { targetUrl: updated.targetUrl }
                      : {}),
                  updatedAt: updated.updatedAt,
                  version: updated.version
                };
              })
            );
          }}
          projectDomain={projectDomain}
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
            .map(({ id, version, textOriginal, groupPath }) => ({
              id,
              version,
              text: textOriginal,
              ...(groupPath ? { currentGroupPath: groupPath } : {})
            }))}
        />
      )}
      {multiSearchDialogOpen && (
        <SemanticMultiSearchDialog
          {...(multiSearch ? { initialSearch: multiSearch } : {})}
          onApply={(search, action) => {
            const clearTextSearch = (current: SemanticViewConfig): SemanticViewConfig => {
              const { search: ignored, ...filters } = current.filters;
              void ignored;
              return { ...current, filters };
            };
            setDraftConfig(clearTextSearch);
            setViewConfig(clearTextSearch);
            multiSearchActionRef.current = action === "SHOW" ? undefined : action;
            setMultiSearch(search);
            setMultiSearchDialogOpen(false);
          }}
          onClose={() => setMultiSearchDialogOpen(false)}
        />
      )}
      {deleteSelectionOpen && mutationIds.size > 0 && (
        <SemanticModal
          description={groups.some(
            ({ id, systemKind }) =>
              id === viewConfig.filters.groupId && systemKind === "TRASH"
          ) ? uiText("Запросы будут удалены без возможности восстановления. Аудит операции сохранится.") : uiText("Запросы будут перемещены в системную корзину. Оттуда их можно удалить навсегда.")}
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
                ? <UiText text="Это окончательное удаление. Данные частотности, позиций и связанные записи также будут удалены." />
                : <UiText text="Параллельно изменённые строки не будут перезаписаны; остальные появятся в корзине." />}
            </div>
            <div className="semantic-modal-actions">
              <button className="secondary-button" disabled={saving} onClick={() => { setDeleteSelectionOpen(false); setActionIds(null); }} type="button"><UiText text="Отмена" /></button>
              <button className="danger-button" disabled={saving} onClick={() => void deleteSelectedKeywords(mutationIds)} type="button">
                {saving
                  ? <UiText text="Удаляем…" />
                  : groups.some(
                        ({ id, systemKind }) =>
                          id === viewConfig.filters.groupId &&
                          systemKind === "TRASH"
                      )
                    ? <UiText text="Удалить навсегда" />
                    : <UiText text="В корзину" />}
              </button>
            </div>
          </div>
        </SemanticModal>
      )}
      {wordstatDialogOpen && (
        <WordstatExpansionDialog
          {...(viewConfig.filters.groupId
            ? { activeGroupId: viewConfig.filters.groupId }
            : {})}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({
              id,
              version,
              label: textOriginal
            }))}
          initialText=""
          onClose={() => setWordstatDialogOpen(false)}
          onSubmit={startWordstatExpansion}
          projectId={projectId}
          projectSearchCity={projects.find(({ id }) => id === projectId)?.searchCity}
          workspaceId={workspaceId}
        />
      )}
      {positionDialogOpen && (
        <SemanticPositionDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal, isTracked }) => ({
              id,
              version,
              label: textOriginal,
              isTracked
            }))}
          onClose={() => setPositionDialogOpen(false)}
          onStarted={(job) => {
            setPositionDialogOpen(false);
            void job;
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice("Проверка позиций запущена в фоне. Прогресс доступен в операциях.");
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectSearchCity={projects.find(({ id }) => id === projectId)?.searchCity}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      )}
      {competitorDialogOpen && (
        <SemanticPositionDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal, isTracked }) => ({
              id,
              version,
              label: textOriginal,
              isTracked
            }))}
          mode="competitors"
          onClose={() => setCompetitorDialogOpen(false)}
          onStarted={() => {
            setCompetitorDialogOpen(false);
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice(
              "Сбор конкурентов запущен в фоне. Топ-10 появится в данных запроса после завершения."
            );
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectSearchCity={projects.find(({ id }) => id === projectId)?.searchCity}
          projectId={projectId}
          workspaceId={workspaceId}
        />
      )}
      {aiAnswerDialogOpen && (
        <SemanticAiAnswerDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, label: textOriginal }))}
          onClose={() => setAiAnswerDialogOpen(false)}
          onStarted={() => {
            setAiAnswerDialogOpen(false);
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice("Проверка ИИ-ответов запущена в фоне. Результаты появятся в отдельных колонках.");
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectDomain={projectDomain}
          projectId={projectId}
        />
      )}
      {aiCompetitorDialogOpen && (
        <SemanticAiAnswerDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({
              id,
              version,
              label: textOriginal
            }))}
          mode="competitors"
          onClose={() => setAiCompetitorDialogOpen(false)}
          onStarted={() => {
            setAiCompetitorDialogOpen(false);
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice(
              "Сбор ИИ-выдачи конкурентов запущен в фоне. Ответы и источники появятся после завершения."
            );
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectDomain={projectDomain}
          projectId={projectId}
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
      {clusteringDialogOpen && (
        <SemanticClusteringDialog
          activeGroupId={viewConfig.filters.groupId}
          groups={groups}
          initialSelections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({ id, version, label: textOriginal }))}
          onClose={() => setClusteringDialogOpen(false)}
          onStarted={() => {
            setClusteringDialogOpen(false);
            setOperationsRefreshVersion((value) => value + 1);
            setBulkNotice("Кластеризация запущена в фоне. После завершения откройте результат и подтвердите раскладку по папкам.");
            setRightSidebar({ type: "OPERATIONS" });
          }}
          projectId={projectId}
        />
      )}
      {negativeKeywordsOpen && (
        <SemanticNegativeKeywordsDialog
          {...(activeNegativeGroup ? { activeGroup: activeNegativeGroup } : {})}
          groups={groups}
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
      {duplicatesOpen && (
        <SemanticDuplicatesDialog
          {...(activeNegativeGroup ? { activeGroup: activeNegativeGroup } : {})}
          groups={groups}
          onClose={() => setDuplicatesOpen(false)}
          onCompleted={(message) => {
            setDuplicatesOpen(false);
            setCheckedIds(new Set());
            setBulkNotice(message);
            onGroupsChanged();
            setRetryVersion((value) => value + 1);
          }}
          projectId={projectId}
          selections={items
            .filter(({ id }) => checkedIds.has(id))
            .map(({ id, version, textOriginal }) => ({
              id,
              version,
              label: textOriginal
            }))}
        />
      )}
      {rowContextMenu && (
        <ContextMenu
          items={rowMenuItems}
          label={uiText("Действия с выбранными и выделенными запросами")}
          onClose={() => setRowContextMenu(undefined)}
          x={rowContextMenu.x}
          y={rowContextMenu.y}
        />
      )}
      {aiAnswerKeyword && (
        <SemanticAiAnswerDetailsModal
          keywordId={aiAnswerKeyword.id}
          keywordText={aiAnswerKeyword.textOriginal}
          onClose={() => setAiAnswerKeyword(undefined)}
          projectId={projectId}
        />
      )}
      {rightSidebar?.type === "OPERATIONS" && (
        <SemanticOperationsDrawer
          onClose={() => setRightSidebar(undefined)}
          onClusteringApplied={() => {
            setCheckedIds(new Set());
            setRetryVersion((value) => value + 1);
            onGroupsChanged();
          }}
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
          activeView={activeSavedView}
          canManageShared={workspaceRoleCode === "OWNER" || workspaceRoleCode === "ADMIN"}
          config={draftSavedViewConfig}
          currentUserId={currentUserId}
          customColumns={customColumns}
          rankColumns={rankColumns}
          rankError={rankComparison.catalogError}
          onRefreshRanks={rankComparison.refresh}
          isActiveViewDirty={isActiveSavedViewDirty}
          onApply={() => void applyTableLayout()}
          onApplySavedView={(view) => void applySavedView(view)}
          onActiveViewChange={activateSavedView}
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
            columnOrder: semanticSystemColumnKeys,
            density: defaultSemanticViewConfig.density,
            queryIndicators: semanticSavedViewQueryIndicators
          }))}
          onToggleColumn={toggleColumn}
          onToggleQueryIndicator={toggleQueryIndicator}
          projectId={projectId}
          saving={savingTableLayout}
        />
      )}
    </section>
  );
}

function semanticExportActive(
  status: SemanticExportJobSummary["status"]
): boolean {
  return [
    "QUEUED",
    "RUNNING",
    "CANCEL_REQUESTED",
    "RETRY_SCHEDULED",
    "FAILED_RETRYABLE"
  ].includes(status);
}

function semanticExportStatusLabel(job: SemanticExportJobSummary): string {
  switch (job.status) {
    case "QUEUED":
      return "Экспорт поставлен в очередь";
    case "RUNNING":
      return "Формируем файл";
    case "CANCEL_REQUESTED":
      return "Останавливаем экспорт";
    case "RETRY_SCHEDULED":
    case "FAILED_RETRYABLE":
      return "Временно недоступно — повторяем";
    case "COMPLETED":
      return "Файл готов";
    case "CANCELLED":
      return "Экспорт отменён";
    case "FAILED_FINAL":
      return "Не удалось сформировать файл";
  }
}

function semanticExportErrorMessage(error: unknown): string {
  if (error instanceof SemanticExportTerminalError) {
    if (error.job.status === "CANCELLED") return "Экспорт отменён.";
    return error.job.failureCode
      ? `Не удалось сформировать файл. Код: ${error.job.failureCode}.`
      : "Не удалось сформировать файл.";
  }
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Состояние экспорта уже изменилось. Дождитесь обновления и повторите.";
    }
    if (error.code === "STORAGE_UNAVAILABLE") {
      return "Хранилище экспортов временно недоступно.";
    }
    if (error.code === "FORBIDDEN") {
      return "У вас нет права экспортировать семантику этого проекта.";
    }
    return error.message;
  }
  return "Не удалось сформировать экспорт.";
}

class SemanticExportTerminalError extends Error {
  public constructor(public readonly job: SemanticExportJobSummary) {
    super(job.failureCode ?? job.status);
    this.name = "SemanticExportTerminalError";
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function semanticVirtualRows(
  items: readonly SemanticKeyword[],
  viewport: Readonly<{ height: number; scrollTop: number }>,
  density: SemanticViewConfig["density"]
): Readonly<{
  items: readonly SemanticKeyword[];
  paddingTop: number;
  paddingBottom: number;
  start: number;
}> {
  const rowHeight = semanticRowHeight(density);
  const overscan = 14;
  const bodyScrollTop = Math.max(0, viewport.scrollTop - 35);
  const start = Math.max(0, Math.floor(bodyScrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewport.height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visible);
  return {
    items: items.slice(start, end),
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (items.length - end) * rowHeight),
    start
  };
}

type SemanticKeywordLoadConfig = Pick<
  SemanticViewConfig,
  "filters" | "sort" | "rankSortDimensionKey"
> & Readonly<{
  groupIds?: readonly string[];
  multiSearch?: SemanticKeywordMultiSearch;
}>;

const semanticAdvancedFilterFields = [
  "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax",
  "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState",
  "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore"
] as const;

async function loadKeywordPage(
  projectId: string,
  config: SemanticKeywordLoadConfig,
  cursor?: string,
  signal?: AbortSignal,
  limit = 100
) {
  const query = new URLSearchParams({ limit: String(limit) });
  const filters = config.filters;
  if (filters.search) query.set("search", filters.search);
  if (filters.tag) query.set("tag", filters.tag);
  if (filters.intent) query.set("intent", filters.intent);
  if (filters.groupId) query.set("groupId", filters.groupId);
  if (config.groupIds?.length) query.set("groupIds", config.groupIds.join(","));
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
  for (const field of semanticAdvancedFilterFields) {
    const value = filters[field];
    if (value !== undefined) query.set(field, String(value));
  }
  query.set("sort", config.sort);
  if (config.rankSortDimensionKey) {
    query.set("rankSortDimensionKey", config.rankSortDimensionKey);
  }
  if (cursor) query.set("cursor", cursor);
  if (config.multiSearch || (config.groupIds?.length ?? 0) > 20) {
    const bodyQuery: Record<string, unknown> = {
      limit,
      sort: config.sort,
      ...(config.rankSortDimensionKey
        ? { rankSortDimensionKey: config.rankSortDimensionKey }
        : {}),
      ...(cursor ? { cursor } : {}),
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.tag ? { tag: filters.tag } : {}),
      ...(filters.intent ? { intent: filters.intent } : {}),
      ...(filters.groupId ? { groupId: filters.groupId } : {}),
      ...(config.groupIds?.length ? { groupIds: config.groupIds } : {}),
      ...(filters.clusterId ? { clusterId: filters.clusterId } : {}),
      ...(filters.isFavorite === undefined ? {} : { isFavorite: filters.isFavorite }),
      ...(filters.isTracked === undefined ? {} : { isTracked: filters.isTracked }),
      ...(filters.priorityMin === undefined ? {} : { priorityMin: filters.priorityMin }),
      ...(filters.priorityMax === undefined ? {} : { priorityMax: filters.priorityMax }),
      ...Object.fromEntries(semanticAdvancedFilterFields.flatMap(field => filters[field] === undefined ? [] : [[field, filters[field]]]))
    };
    return browserApiCollectionRequest<SemanticKeyword>(
      `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${config.multiSearch ? "search" : "list"}`,
      {
        method: "POST",
        body: config.multiSearch
          ? { query: bodyQuery, search: config.multiSearch }
          : { query: bodyQuery },
        ...(signal ? { signal } : {})
      }
    );
  }
  return browserApiCollectionRequest<SemanticKeyword>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
    signal ? { signal } : {}
  );
}

const semanticCompetitorRowLabels: Record<typeof semanticCompetitorRowColumnKeys[number], string> = {
  competitorEngine: "Поисковик", competitorRegion: "Город", competitorRegionCode: "Код региона", competitorDevice: "Устройство",
  competitorPosition: "Позиция в выдаче", competitorUrl: "URL результата", competitorTitle: "Заголовок", competitorDescription: "Описание",
  competitorObservedAt: "Дата съёма", competitorProvider: "Провайдер"
};

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
  { key: "updatedAt", label: "Обновлён" }
];

const semanticCompetitorExportColumns: readonly Readonly<{
  key: SemanticExportColumnKey;
  label: string;
}>[] = [
  { key: "serpCompetitorUrls", label: "Конкуренты" },
  { key: "serpCompetitorSerp", label: "SERP конкурентов" },
  { key: "aiCompetitorUrls", label: "ИИ-конкуренты" },
  { key: "aiCompetitorSerp", label: "SERP ИИ-конкурентов" }
];

function semanticExportColumnsWithRankingUrls(
  columns: readonly SemanticViewColumn[]
): readonly SemanticExportColumnKey[] {
  const result: SemanticExportColumnKey[] = [...columns];
  for (const [positionColumn, urlColumn] of [
    ["yandexPosition", "yandexRelevantUrl"],
    ["googlePosition", "googleRelevantUrl"],
    ["yandexAiPosition", "yandexAiRelevantUrl"],
    ["googleAiPosition", "googleAiRelevantUrl"]
  ] as const) {
    if (result.includes(urlColumn)) continue;
    const position = result.indexOf(positionColumn);
    result.splice(position < 0 ? result.length : position + 1, 0, urlColumn);
  }
  return result;
}

function nextSemanticColumnSort(
  column: SemanticViewColumn,
  current: SemanticKeywordSort,
  currentRankDimensionKey?: string
): Readonly<{
  sort: SemanticKeywordSort;
  rankSortDimensionKey?: string;
}> | undefined {
  const rank = parseSemanticRankColumnKey(column);
  if (rank?.metric === "position") {
    return {
      sort:
        currentRankDimensionKey === rank.dimension.key &&
        current === "RANK_POSITION_ASC"
          ? "RANK_POSITION_DESC"
          : "RANK_POSITION_ASC",
      rankSortDimensionKey: rank.dimension.key
    };
  }
  if (rank?.metric === "checkedAt") {
    return {
      sort:
        currentRankDimensionKey === rank.dimension.key &&
        current === "RANK_CHECKED_AT_DESC"
          ? "RANK_CHECKED_AT_ASC"
          : "RANK_CHECKED_AT_DESC",
      rankSortDimensionKey: rank.dimension.key
    };
  }
  const target = (sort: SemanticKeywordSort) => ({ sort });
  switch (column) {
    case "query":
      return target(current === "TEXT_ASC" ? "TEXT_DESC" : "TEXT_ASC");
    case "priority":
      return target(current === "PRIORITY_DESC" ? "PRIORITY_ASC" : "PRIORITY_DESC");
    case "source":
      return target(current === "SOURCE_ASC" ? "SOURCE_DESC" : "SOURCE_ASC");
    case "tags":
      return target(current === "TAGS_ASC" ? "TAGS_DESC" : "TAGS_ASC");
    case "updatedAt":
      return target(current === "UPDATED_DESC" ? "UPDATED_ASC" : "UPDATED_DESC");
    case "frequency":
      return target(current === "FREQUENCY_BASE_DESC" ? "FREQUENCY_BASE_ASC" : "FREQUENCY_BASE_DESC");
    case "frequencyExact":
      return target(current === "FREQUENCY_EXACT_DESC" ? "FREQUENCY_EXACT_ASC" : "FREQUENCY_EXACT_DESC");
    case "frequencyFixed":
      return target(current === "FREQUENCY_FIXED_DESC" ? "FREQUENCY_FIXED_ASC" : "FREQUENCY_FIXED_DESC");
    case "yandexPosition":
      return target(current === "YANDEX_POSITION_ASC" ? "YANDEX_POSITION_DESC" : "YANDEX_POSITION_ASC");
    case "googlePosition":
      return target(current === "GOOGLE_POSITION_ASC" ? "GOOGLE_POSITION_DESC" : "GOOGLE_POSITION_ASC");
    case "yandexCheckedAt":
      return target(current === "YANDEX_CHECKED_AT_DESC" ? "YANDEX_CHECKED_AT_ASC" : "YANDEX_CHECKED_AT_DESC");
    case "googleCheckedAt":
      return target(current === "GOOGLE_CHECKED_AT_DESC" ? "GOOGLE_CHECKED_AT_ASC" : "GOOGLE_CHECKED_AT_DESC");
    case "yandexAiPosition":
      return target(current === "YANDEX_AI_POSITION_ASC" ? "YANDEX_AI_POSITION_DESC" : "YANDEX_AI_POSITION_ASC");
    case "googleAiPosition":
      return target(current === "GOOGLE_AI_POSITION_ASC" ? "GOOGLE_AI_POSITION_DESC" : "GOOGLE_AI_POSITION_ASC");
    case "yandexAiCheckedAt":
      return target(current === "YANDEX_AI_CHECKED_AT_DESC" ? "YANDEX_AI_CHECKED_AT_ASC" : "YANDEX_AI_CHECKED_AT_DESC");
    case "googleAiCheckedAt":
      return target(current === "GOOGLE_AI_CHECKED_AT_DESC" ? "GOOGLE_AI_CHECKED_AT_ASC" : "GOOGLE_AI_CHECKED_AT_DESC");
    default:
      return undefined;
  }
}

function semanticColumnSortDirection(
  column: SemanticViewColumn,
  current: SemanticKeywordSort,
  currentRankDimensionKey?: string
): "ascending" | "descending" | undefined {
  const rank = parseSemanticRankColumnKey(column);
  if (
    rank &&
    currentRankDimensionKey === rank.dimension.key &&
    ((rank.metric === "position" && current.startsWith("RANK_POSITION_")) ||
      (rank.metric === "checkedAt" && current.startsWith("RANK_CHECKED_AT_")))
  ) {
    return current.endsWith("_ASC") ? "ascending" : "descending";
  }
  const activeColumn =
    (column === "query" && current.startsWith("TEXT_")) ||
    (column === "priority" && current.startsWith("PRIORITY_")) ||
    (column === "source" && current.startsWith("SOURCE_")) ||
    (column === "tags" && current.startsWith("TAGS_")) ||
    (column === "updatedAt" && current.startsWith("UPDATED_")) ||
    (column === "frequency" && current.startsWith("FREQUENCY_BASE_")) ||
    (column === "frequencyExact" && current.startsWith("FREQUENCY_EXACT_")) ||
    (column === "frequencyFixed" && current.startsWith("FREQUENCY_FIXED_")) ||
    (column === "yandexPosition" && current.startsWith("YANDEX_POSITION_")) ||
    (column === "googlePosition" && current.startsWith("GOOGLE_POSITION_")) ||
    (column === "yandexCheckedAt" && current.startsWith("YANDEX_CHECKED_AT_")) ||
    (column === "googleCheckedAt" && current.startsWith("GOOGLE_CHECKED_AT_")) ||
    (column === "yandexAiPosition" && current.startsWith("YANDEX_AI_POSITION_")) ||
    (column === "googleAiPosition" && current.startsWith("GOOGLE_AI_POSITION_")) ||
    (column === "yandexAiCheckedAt" && current.startsWith("YANDEX_AI_CHECKED_AT_")) ||
    (column === "googleAiCheckedAt" && current.startsWith("GOOGLE_AI_CHECKED_AT_"));
  if (!activeColumn) return undefined;
  return current.endsWith("_ASC") ? "ascending" : "descending";
}

function sortActionLabel(sort: SemanticKeywordSort): string {
  return sort.endsWith("_ASC")
    ? "Сортировать по возрастанию"
    : "Сортировать по убыванию";
}

function semanticRankSortLabel(
  config: Pick<SemanticViewConfig, "sort" | "rankSortDimensionKey">,
  dimensions: readonly SemanticRankDimension[],
  locale: string
): string {
  const dimension = config.rankSortDimensionKey
    ? dimensions.find(({ key }) => key === config.rankSortDimensionKey) ??
      parseSemanticRankDimensionKey(config.rankSortDimensionKey)
    : undefined;
  return dimension
    ? `${rankDimensionLabel(dimension, locale)} · ${config.sort.endsWith("_ASC") ? "↑" : "↓"}`
    : config.sort;
}

function columnLabel(
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[],
  rankDimensions: readonly SemanticRankDimension[] = [],
  locale = "ru"
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
    semanticColumns.find(({ key }) => key === column)?.label ?? column
  );
}

function columnHeader(
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[],
  rankDimensions: readonly SemanticRankDimension[] = [],
  locale = "ru"
) {
  const rank = parseSemanticRankColumnKey(column);
  if (rank) {
    const dimension = rankDimensions.find(value => value.key === rank.dimension.key) ?? rank.dimension;
    return <span className="semantic-rank-column-header" title={rankColumnLabel(column, rankDimensions, locale)}><SearchEngineLogo engine={dimension.searchEngine} size="compact" /><span>{dimension.regionLabel || dimension.regionCode}<small><UiText text={dimension.device === "DESKTOP" ? "ПК" : "Телефон"} /> · <UiText text={rank.metric === "position" ? "Позиция" : rank.metric === "url" ? "URL" : "Дата"} /></small></span></span>;
  }
  if (column === "frequency") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> <UiText text="База" before=" " /></span>;
  }
  if (column === "frequencyExact") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;&quot;</span>;
  }
  if (column === "frequencyFixed") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> &quot;!&quot;</span>;
  }
  if (column === "yandexPosition") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> <UiText text="Позиция" before=" " /></span>;
  }
  if (column === "googlePosition") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> <UiText text="Позиция" before=" " /></span>;
  }
  if (column === "yandexRelevantUrl") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> URL</span>;
  }
  if (column === "googleRelevantUrl") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> URL</span>;
  }
  if (column === "yandexAiRelevantUrl") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="YANDEX" size="compact" /><Icon name="ai" /> <UiText text="ИИ URL" before=" " /></span>;
  }
  if (column === "googleAiRelevantUrl") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="GOOGLE" size="compact" /><Icon name="ai" /> <UiText text="ИИ URL" before=" " /></span>;
  }
  if (column === "yandexCheckedAt") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="YANDEX" size="compact" /> <UiText text="Съём" before=" " /></span>;
  }
  if (column === "googleCheckedAt") {
    return <span className="semantic-engine-header"><SearchEngineLogo engine="GOOGLE" size="compact" /> <UiText text="Съём" before=" " /></span>;
  }
  if (column === "yandexAiPosition") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="YANDEX" size="compact" /><Icon name="ai" /> <UiText text="ИИ позиция" before=" " /></span>;
  }
  if (column === "googleAiPosition") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="GOOGLE" size="compact" /><Icon name="ai" /> <UiText text="ИИ позиция" before=" " /></span>;
  }
  if (column === "yandexAiCheckedAt") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="YANDEX" size="compact" /><Icon name="ai" /> <UiText text="ИИ съём" before=" " /></span>;
  }
  if (column === "googleAiCheckedAt") {
    return <span className="semantic-engine-header semantic-ai-column-header"><SearchEngineLogo engine="GOOGLE" size="compact" /><Icon name="ai" /> <UiText text="ИИ съём" before=" " /></span>;
  }
  return columnLabel(column, customColumns);
}

function SemanticSiteResultsModal({
  item,
  onClose
}: Readonly<{
  item: SemanticKeyword;
  onClose: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const positions = (item.positions ?? []).filter(
    ({ siteResults }) => (siteResults?.length ?? 0) > 1
  );

  return (
    <SemanticModal
      description={uiText("Страницы проекта, одновременно найденные в последней сохранённой выдаче, с доступными title, description и URL.")}
      onClose={onClose}
      size="large"
      title={uiText("Страницы сайта в выдаче · {0}", [String(item.textOriginal)])}
    >
      <div className="semantic-site-results-modal">
        {positions.length === 0 && (
          <div className="semantic-site-results-empty">
            <UiText text="Актуальная выдача изменилась. Повторно откройте список из строки запроса." /></div>
        )}
        {positions.map((position) => (
          <section key={`${position.searchEngine}:${position.dimension?.key ?? "legacy"}:${position.observedAt}`}>
            <header>
              {position.dimension ? (
                <SemanticRankContext
                  device={position.dimension.device}
                  regionCode={position.dimension.regionCode}
                  {...(position.dimension.regionLabel
                    ? { regionLabel: position.dimension.regionLabel }
                    : {})}
                  searchEngine={position.dimension.searchEngine}
                />
              ) : (
                <span>
                  <SearchEngineLogo engine={position.searchEngine} size="compact" />
                  <strong>
                    {position.searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}
                  </strong>
                </span>
              )}
              <time
                dateTime={position.observedAt}
                title={formatSemanticDateTime(position.observedAt, uiLocale)}
              >
                {formatSemanticDateTime(position.observedAt, uiLocale)}
              </time>
            </header>
            <SemanticProjectSerpResults
              results={position.siteResults ?? []}
              {...(item.targetUrl ? { targetUrl: item.targetUrl } : {})}
            />
          </section>
        ))}
      </div>
    </SemanticModal>
  );
}

function keywordHasTargetUrlMismatch(item: SemanticKeyword): boolean {
  return Boolean(
    item.targetUrl &&
    (
      item.positions?.some(
        ({ found, rankingUrl }) =>
          found &&
          rankingUrl !== undefined &&
          !sameSemanticRankingUrl(item.targetUrl!, rankingUrl)
      ) ||
      item.aiAnswers?.some(
        ({ siteFound, rankingUrl }) =>
          siteFound &&
          rankingUrl !== undefined &&
          !sameSemanticRankingUrl(item.targetUrl!, rankingUrl)
      )
    )
  );
}

function keywordHasMultipleSiteResults(item: SemanticKeyword): boolean {
  return Boolean(
    item.positions?.some(({ siteResults }) => (siteResults?.length ?? 0) > 1)
  );
}

function keywordColumn(
  item: SemanticKeyword,
  column: SemanticViewColumn,
  customColumns: readonly SemanticCustomColumn[],
  onEditCustom: (column: SemanticCustomColumn) => void,
  onOpenSiteResults: () => void,
  onOpenAiAnswer: () => void,
  density: SemanticViewConfig["density"],
  queryIndicators: readonly SemanticQueryIndicator[], uiLocale: string = "ru-RU"
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
          : <UiText text="Добавить значение" />}
      </button>
    );
  }
  switch (column) {
    case "query":
      return (
        <>
          <strong className="semantic-query-line">
            {!item.isTracked && (
              <UiElement tag="span" uiLabels={{"aria-label": "Запрос не отслеживается", "title": "Запрос не отслеживается"}}

                className="semantic-query-tracking-indicator"
                role="img"

              >
                <Icon name="eyeOff" />
              </UiElement>
            )}
            <span className="semantic-query-text" title={item.textOriginal}>
              {item.isFavorite ? "★ " : ""}
              {item.textOriginal}
            </span>
            <span className="semantic-query-actions">
              {item.hasNote && (
                <UiElement tag="span" uiLabels={{"aria-label": "Есть заметка", "title": "У запроса есть заметка"}}  className="semantic-keyword-note-indicator" >
                  <Icon name="note" />
                </UiElement>
              )}
              {queryIndicators.includes("TARGET_URL_MISMATCH") &&
                keywordHasTargetUrlMismatch(item) && (
                <UiElement tag="span" uiLabels={{"aria-label": "Найденный URL не совпадает с целевым", "title": "Найденный при съёме URL не совпадает с целевым URL запроса"}}

                  className="semantic-keyword-rank-indicator mismatch"
                  role="img"

                >
                  <Icon name="link" />
                </UiElement>
              )}
              {queryIndicators.includes("MULTIPLE_URLS") &&
                keywordHasMultipleSiteResults(item) && (
                <UiElement tag="button" uiLabels={{"aria-label": "Показать страницы сайта в выдаче", "title": "В выдаче найдено несколько страниц вашего сайта"}}

                  className="semantic-keyword-rank-indicator multiple"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSiteResults();
                  }}

                  type="button"
                >
                  <Icon name="multiGroup" />
                </UiElement>
              )}
              {queryIndicators.includes("AI_ANSWER") &&
                hasSemanticAiAnswerSnapshot(item.aiAnswers) && (
                  <UiElement tag="button" uiLabels={{"aria-label": "Открыть сохранённую ИИ-выдачу", "title": "Открыть сохранённую ИИ-выдачу и её источники"}}

                    className="semantic-keyword-ai-indicator"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAiAnswer();
                    }}

                    type="button"
                  >
                    <Icon name="ai" />
                  </UiElement>
                )}
            </span>
          </strong>
          {density !== "COMPACT" && item.tags.length > 0 && (
            <UiElement tag="span" uiLabels={{"aria-label": { text: "Теги: {0}", values: [String(item.tags.join(", "))] }}}

              className="semantic-query-tags"
              title={item.tags.join(", ")}
            >
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
              {(item.tags.length > 3 || item.tagsTruncated) && (
                <span>+{Math.max(1, item.tags.length - 3)}</span>
              )}
            </UiElement>
          )}
        </>
      );
    case "frequency":
      return keywordFrequency(item, "BASE", uiLocale);
    case "frequencyExact":
      return keywordFrequency(item, "EXACT", uiLocale);
    case "frequencyFixed":
      return keywordFrequency(item, "FIXED", uiLocale);
    case "wordCount":
      return countKeywordWords(item.textOriginal);
    case "yandexPosition":
      return keywordPosition(item, "YANDEX", uiLocale);
    case "googlePosition":
      return keywordPosition(item, "GOOGLE", uiLocale);
    case "yandexRelevantUrl":
      return keywordRelevantUrl(item, "YANDEX");
    case "googleRelevantUrl":
      return keywordRelevantUrl(item, "GOOGLE");
    case "yandexAiRelevantUrl":
      return keywordAiRelevantUrl(item, "YANDEX");
    case "googleAiRelevantUrl":
      return keywordAiRelevantUrl(item, "GOOGLE");
    case "yandexCheckedAt":
      return keywordCheckedAt(item, "YANDEX");
    case "googleCheckedAt":
      return keywordCheckedAt(item, "GOOGLE");
    case "yandexAiPosition":
      return keywordAiPosition(item, "YANDEX");
    case "googleAiPosition":
      return keywordAiPosition(item, "GOOGLE");
    case "yandexAiCheckedAt":
      return keywordAiCheckedAt(item, "YANDEX", uiLocale);
    case "googleAiCheckedAt":
      return keywordAiCheckedAt(item, "GOOGLE", uiLocale);
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
          {<UiText text={sourceModeLabel(item.sourceMode) ?? ""} />}
        </span>
      );
    case "updatedAt":
      return (
        <time dateTime={item.updatedAt}>{formatDate(item.updatedAt, uiLocale)}</time>
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
  return <SemanticRankUrlCell url={position?.rankingUrl} />;
}

function keywordAiRelevantUrl(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const answer = item.aiAnswers?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  if (answer && !answer.siteFound) return keywordNotFoundMark(searchEngine, "AI");
  return <SemanticRankUrlCell url={answer?.rankingUrl} />;
}

function keywordCheckedAt(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  return position
    ? <SemanticRankCheckedAtCell observedAt={position.observedAt} />
    : <span className="semantic-metric-empty">—</span>;
}

function keywordAiPosition(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX"
) {
  const answer = item.aiAnswers?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  if (!answer) return <span className="semantic-metric-empty">—</span>;
  if (!answer.siteFound || answer.position === undefined) {
    if (answer.previousPosition !== undefined) {
      const description = `${searchEngine === "YANDEX" ? "Яндекс" : "Google"}: сайт не найден в ИИ-ответе. Была позиция ${answer.previousPosition}`;
      return (
        <span
          aria-label={description}
          className="semantic-position-value semantic-ai-position-value not-found"
          title={description}
        >
          <span className="semantic-ai-site-not-found" aria-hidden="true">×</span>
          <small aria-hidden="true"><UiText text="Была" after=" " />{answer.previousPosition}</small>
        </span>
      );
    }
    if (!answer.answerPresent) {
      return <UiElement tag="span" uiLabels={{"title": "Проверка выполнена: ИИ-ответ не найден"}} className="semantic-ai-answer-absent" ><UiText text="Нет ответа" /></UiElement>;
    }
    return (
      <UiElement tag="span" uiLabels={{"title": "ИИ-ответ найден, но домен проекта отсутствует в источниках"}} className="semantic-ai-site-not-found" >
        ×
      </UiElement>
    );
  }
  const change = rankChangePresentation(answer.position, answer.previousPosition);
  return (
    <span
      aria-label={change.ariaLabel}
      className={`semantic-position-value semantic-ai-position-value ${change.tone}`}
      title={`${change.title}${answer.rankingUrl ? ` · ${answer.rankingUrl}` : ""}`}
    >
      <strong aria-hidden="true">{answer.position}</strong>
      <small aria-hidden="true">{change.label}</small>
    </span>
  );
}

function keywordAiCheckedAt(
  item: SemanticKeyword,
  searchEngine: "GOOGLE" | "YANDEX", uiLocale: string = "ru-RU"
) {
  const answer = item.aiAnswers?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  return answer ? (
    <time dateTime={answer.observedAt} title={new Date(answer.observedAt).toLocaleString(uiLocale)}>
      {formatDate(answer.observedAt, uiLocale)}
    </time>
  ) : <span className="semantic-metric-empty">—</span>;
}

function keywordNotFoundMark(
  searchEngine: "GOOGLE" | "YANDEX",
  source: "AI" | "RANK" = "RANK"
) {
  const sourceLabel = source === "AI" ? "ИИ-выдаче" : "выдаче";
  return (
    <UiElement tag="span" uiLabels={{"aria-label": { text: "{0}: URL в {1} не найден", values: [String(searchEngine === "YANDEX" ? "Яндекс" : "Google"), String(sourceLabel)] }, "title": { text: "Съём выполнен, URL проекта в {0} не найден", values: [String(sourceLabel)] }}}

      className="semantic-rank-not-found"
      role="img"

    >
      ×
    </UiElement>
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
  type: "BASE" | "EXACT" | "FIXED", uiLocale: string = "ru-RU"
) {
  const frequency =
    item.frequencies?.find((entry) => entry.type === type) ??
    (type === "BASE" ? item.frequency : undefined);
  return frequency?.value ? (
    <UiElement tag="span" uiLabels={{"title": { text: "{0} · регион {1}", values: [String(frequency.provider), String(frequency.regionCode)] }}}
      className="semantic-metric-value"

    >
      {formatInteger(Number(frequency.value), uiLocale)}
    </UiElement>
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
  searchEngine: "GOOGLE" | "YANDEX",
  locale: string
) {
  const position = item.positions?.find(
    (candidate) => candidate.searchEngine === searchEngine
  );
  if (!position) {
    return <span className="semantic-metric-empty">—</span>;
  }
  return (
    <SemanticRankPositionCell
      item={position}
      searchEngine={searchEngine}
      {...(position.dimension
        ? {
            titleSuffix: `${rankDimensionLabel(position.dimension, locale)} · ${new Date(position.observedAt).toLocaleString(locale)}`
          }
        : {})}
    />
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
  return Object.entries(config.filters).some(
    ([key, value]) => key !== "groupId" && value !== undefined && value !== ""
  );
}

function booleanFilter(value: boolean | undefined): string {
  return value === undefined ? "" : String(value);
}

function filterDateValue(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}

function filterDateBeforeValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(Date.parse(value) - 86_400_000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function nextUtcDay(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp + 86_400_000).toISOString();
}

function activeFilterCount(filters: SemanticViewConfig["filters"]): number {
  return Object.entries(filters).filter(([key, value]) =>
    key !== "search" && key !== "groupId" && value !== undefined && value !== ""
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

function savedViewMutationErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.status === 412) {
      return "Представление изменилось в другой вкладке. Откройте его заново.";
    }
    if (error.status === 403) {
      return "Недостаточно прав для изменения представления.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return "Не удалось сохранить настройки представления. Обновите страницу и повторите.";
    }
    return error.message;
  }
  return "Не удалось сохранить настройки представления.";
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

function scrollKeywordIntoView(
  viewport: HTMLDivElement | null,
  itemIndex: number,
  density: SemanticViewConfig["density"]
): void {
  if (!viewport) return;
  const headerHeight = 35;
  const rowHeight = semanticRowHeight(density);
  const rowTop = headerHeight + itemIndex * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const visibleTop = viewport.scrollTop + headerHeight;
  const visibleBottom = viewport.scrollTop + viewport.clientHeight;
  if (rowTop < visibleTop) {
    viewport.scrollTo({ top: Math.max(0, rowTop - headerHeight) });
  } else if (rowBottom > visibleBottom) {
    viewport.scrollTo({
      top: Math.max(0, rowBottom - viewport.clientHeight)
    });
  }
}

function semanticRowHeight(density: SemanticViewConfig["density"]): number {
  return density === "COMPACT" ? 28 : 34;
}

function semanticTableColumns(
  columns: readonly SemanticViewColumn[],
  multiGroupMode: boolean
): readonly SemanticViewColumn[] {
  if (!multiGroupMode || columns.includes("group")) return columns;
  const queryIndex = columns.indexOf("query");
  const insertAt = queryIndex < 0 ? 0 : queryIndex + 1;
  return [
    ...columns.slice(0, insertAt),
    "group",
    ...columns.slice(insertAt)
  ];
}

function preferredProjectSharedView(
  views: readonly SemanticSavedView[]
): SemanticSavedView | undefined {
  const shared = views.filter(({ scope }) => scope === "PROJECT_SHARED");
  return shared.find(
    ({ name }) => name.trim().toLocaleLowerCase("ru-RU") === "общее для проекта"
  ) ?? shared[0];
}

function semanticViewConfigWithoutAppliedView(
  config: SemanticViewConfig
): SemanticViewConfig {
  const { appliedViewId: _appliedViewId, ...layout } = config;
  return layout;
}

function semanticViewConfigSignature(config: SemanticViewConfig): string {
  const layout = semanticViewConfigWithoutAppliedView(config);
  return JSON.stringify({
    schemaVersion: layout.schemaVersion,
    filters: layout.filters,
    sort: layout.sort,
    rankSortDimensionKey: layout.rankSortDimensionKey ?? null,
    columns: layout.columns,
    columnOrder: layout.columnOrder ?? null,
    density: layout.density,
    queryIndicators: semanticQueryIndicatorsFor(layout),
    columnWidths: Object.fromEntries(
      Object.entries(layout.columnWidths ?? {}).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    pageSize: layout.pageSize ?? null,
    groupSidebarWidth: layout.groupSidebarWidth ?? null,
    expandedGroupIds: [...(layout.expandedGroupIds ?? [])].sort(),
    selectedGroupIds: [...(layout.selectedGroupIds ?? [])].sort()
  });
}

function semanticAvailableColumns(
  customColumns: readonly SemanticCustomColumn[]
): readonly SemanticViewColumn[] {
  return [
    ...semanticSystemColumnKeys,
    ...customColumns.map(
      ({ id }) => `custom:${id}` as SemanticViewColumn
    )
  ];
}

function semanticHistoryDefaultRange(): Readonly<{ from: string; to: string }> {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 89)
  ).toISOString().slice(0, 10);
  return { from, to };
}

function validSemanticHistoryDateRange(from: string, to: string): boolean {
  const fromTime = semanticHistoryDateTimestamp(from);
  const toTime = semanticHistoryDateTimestamp(to);
  return fromTime !== undefined &&
    toTime !== undefined &&
    toTime >= fromTime &&
    toTime - fromTime <= 1_099 * 24 * 60 * 60 * 1_000;
}

function semanticHistoryExportOptions(
  from: string,
  to: string,
  searchEngines: readonly SemanticPositionHistorySearchEngine[]
) {
  if (!validSemanticHistoryDateRange(from, to) || searchEngines.length === 0) {
    throw new Error("INVALID_POSITION_HISTORY_EXPORT_RANGE");
  }
  const fromTime = semanticHistoryDateTimestamp(from)!;
  const toTime = semanticHistoryDateTimestamp(to)!;
  return {
    observedFrom: new Date(fromTime).toISOString(),
    observedBefore: new Date(toTime + 24 * 60 * 60 * 1_000).toISOString(),
    searchEngines
  };
}

function semanticHistoryDateTimestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : undefined;
}

function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(uiLocale, {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric"
  }).format(date);
}

function formatSemanticDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(uiLocale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}
