"use client";

import { WorkspaceSidebar } from "./workspace-sidebar";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  semanticRankDimensionKey,
  type SemanticAiAnswerCompetitorSnapshot,
  type FrequencySnapshotSummary,
  type SemanticAiAnswerHistoryItem,
  type SemanticAiAnswerSummary,
  type SemanticKeywordCompetitorSnapshot,
  type SemanticKeywordInsights,
  type SemanticKeywordListItem,
  type SemanticKeywordPositionHistoryPoint,
  type SemanticKeywordPositionSummary
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  latestSemanticRankHistory,
  normalizeSemanticTargetUrlInput,
  primaryRankContextIds,
  rankEngineLabel,
  semanticRankHistoryDateRows,
  sameSemanticRankingUrl
} from "../lib/semantic-rank-presentation";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import {
  searchRegionDisplayName,
  seoRegionDisplayName
} from "../lib/seo-regions";
import { Icon, type IconName } from "./icon";
import { CustomSelect } from "./custom-select";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SemanticKeywordPositionHistoryModal } from "./semantic-keyword-position-history-modal";
import { SemanticKeywordSerpHistory } from "./semantic-keyword-serp-history";
import { SemanticKeywordAiPositionHistoryModal } from "./semantic-keyword-ai-position-history-modal";
import { SemanticModal } from "./semantic-modal";
import { UnsavedChangesConfirmation } from "./unsaved-changes-confirmation";
import { KeywordTargetPage, useKeywordTargetPage } from "./page-technical-panel";
import { SemanticRankDeviceBadge } from "./semantic-rank-context";
import { SemanticRankHistoryChart } from "./semantic-rank-history-chart";
import { SemanticSeasonalityCharts } from "./semantic-seasonality-chart";
import { useUiLocale, UiText } from "./ui-locale";


export interface SemanticKeywordInspectorItem {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly hasNote?: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupPath?: string;
  readonly clusterName?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly aiAnswers?: SemanticKeywordListItem["aiAnswers"];
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
  readonly trashed?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type SemanticKeywordInspectorCollection =
  | "POSITIONS"
  | "AI_POSITIONS"
  | "SERP"
  | "AI_SERP"
  | "FREQUENCY"
  | "SEASONALITY";

type SemanticKeywordInspectorTab =
  | "OVERVIEW"
  | "POSITIONS"
  | "SERP"
  | "WORDSTAT"
  | "PAGE"
  | "NOTE";

type SemanticKeywordInspectorMode = "SEARCH" | "AI";

type InspectorDimensionPreference =
  | "SEO_POSITIONS"
  | "SEO_SERP"
  | "AI_POSITIONS"
  | "AI_SERP";

const EMPTY_COMPETITOR_SNAPSHOTS: readonly SemanticKeywordCompetitorSnapshot[] = [];
const EMPTY_AI_POSITION_HISTORY: readonly SemanticAiAnswerHistoryItem[] = [];
const EMPTY_AI_COMPETITOR_SNAPSHOTS: readonly SemanticAiAnswerCompetitorSnapshot[] = [];

export function SemanticKeywordInspector({
  currentUserId,
  item,
  onClose,
  onCollect,
  onEdit,
  onFrequencyDeleted,
  onOpenAiAnswer,
  onUpdated,
  projectDomain,
  projectId,
  rankDimensionPreferenceScope
}: Readonly<{
  currentUserId: string;
  item: SemanticKeywordInspectorItem;
  onClose: () => void;
  onCollect: (collection: SemanticKeywordInspectorCollection) => void;
  onEdit: () => void;
  onFrequencyDeleted: () => void;
  onOpenAiAnswer: (dimensionKey?: string) => void;
  onUpdated: (item: SemanticKeywordListItem) => void;
  projectDomain: string;
  projectId: string;
  rankDimensionPreferenceScope: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [insights, setInsights] = useState<SemanticKeywordInsights>();
  const [activeTab, setActiveTab] =
    useState<SemanticKeywordInspectorTab>("OVERVIEW");
  const targetPage = useKeywordTargetPage(projectId, item.id, item.targetUrl, activeTab === "OVERVIEW" || activeTab === "PAGE");
  const [inspectorMode, setInspectorMode] =
    useState<SemanticKeywordInspectorMode>("SEARCH");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string>();
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rankDimensionKey, setRankDimensionKey] = useState("");
  const [serpDimensionKey, setSerpDimensionKey] = useState("");
  const [aiPositionDimensionKey, setAiPositionDimensionKey] = useState("");
  const [aiSerpDimensionKey, setAiSerpDimensionKey] = useState("");
  const [serpHistoryOpen, setSerpHistoryOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [frequencyToDelete, setFrequencyToDelete] =
    useState<FrequencySnapshotSummary>();
  const [deletingFrequency, setDeletingFrequency] = useState(false);
  const [frequencyDeleteError, setFrequencyDeleteError] = useState<string>();
  const [targetUrlCopied, setTargetUrlCopied] = useState(false);
  const [targetUrlEditorOpen, setTargetUrlEditorOpen] = useState(false);
  const [targetUrlDraft, setTargetUrlDraft] = useState("");
  const [savingTargetUrl, setSavingTargetUrl] = useState(false);
  const [targetUrlError, setTargetUrlError] = useState<string>();
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const noteDirtyRef = useRef(false);
  const presenceKeyPrefix = `semantic-keyword-inspector:${item.id}`;

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);
  useEffect(() => {
    setActiveTab(readInspectorTabPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope
    ));
    setInspectorMode(readInspectorModePreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope
    ));
    setRankDimensionKey(readRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "SEO_POSITIONS"
    ));
    setSerpDimensionKey(readRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "SEO_SERP"
    ));
    setAiPositionDimensionKey(readRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "AI_POSITIONS"
    ));
    setAiSerpDimensionKey(readRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "AI_SERP"
    ));
  }, [currentUserId, item.id, projectId, rankDimensionPreferenceScope]);
  useEffect(() => { setSerpHistoryOpen(false); }, [item.id]);

  function selectRankDimension(key: string): void {
    setRankDimensionKey(key);
    if (key) {
      writeRankDimensionPreference(
        currentUserId,
        projectId,
        rankDimensionPreferenceScope,
        key,
        "SEO_POSITIONS"
      );
    }
  }

  function selectInspectorTab(tab: SemanticKeywordInspectorTab): void {
    setActiveTab(tab);
    writeInspectorViewPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "TAB",
      tab
    );
  }

  function selectSharedInspectorMode(mode: SemanticKeywordInspectorMode): void {
    setInspectorMode(mode);
    writeInspectorViewPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      "MODE",
      mode
    );
  }

  function selectSerpDimension(key: string): void {
    selectInspectorDimension(
      key,
      "SEO_SERP",
      setSerpDimensionKey
    );
  }

  function selectAiPositionDimension(key: string): void {
    selectInspectorDimension(
      key,
      "AI_POSITIONS",
      setAiPositionDimensionKey
    );
  }

  function selectAiSerpDimension(key: string): void {
    selectInspectorDimension(
      key,
      "AI_SERP",
      setAiSerpDimensionKey
    );
  }

  function selectInspectorDimension(
    key: string,
    preference: InspectorDimensionPreference,
    select: (dimensionKey: string) => void
  ): void {
    select(key);
    if (!key) return;
    writeRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope,
      key,
      preference
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    setInsights(undefined);
    setLoading(true);
    setError(undefined);
    setNote("");
    setNoteDirty(false);
    setNoteStatus(undefined);
    setTrackingBusy(false);
    setTrackingStatus(undefined);
    setHistoryOpen(false);
    setAiHistoryOpen(false);
    setFrequencyToDelete(undefined);
    setDeletingFrequency(false);
    setFrequencyDeleteError(undefined);
    setTargetUrlCopied(false);
    setTargetUrlEditorOpen(false);
    setTargetUrlDraft(item.targetUrl ?? "");
    setSavingTargetUrl(false);
    setTargetUrlError(undefined);
    setCloseConfirmOpen(false);
    let inFlight = false;
    const load = () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      void browserApiRequest<SemanticKeywordInsights>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}/insights`,
        { signal: controller.signal }
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          setInsights(result);
          if (!noteDirtyRef.current) setNote(result.note ?? "");
          setError(undefined);
        })
        .catch((requestError) => {
          if (!controller.signal.aborted) setError(insightError(requestError));
        })
        .finally(() => {
          inFlight = false;
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [item.id, item.targetUrl, projectId]);

  const latestFrequencies = useMemo(() => {
    const seen = new Set<string>();
    return (insights?.frequencies ?? []).filter(({ type, regionCode, device }) => {
      const key = `${type}:${regionCode}:${device}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [insights]);
  const primaryPositions = useMemo(() => {
    const positions = insights?.positions ?? [];
    const contextIds = primaryRankContextIds(positions);
    return new Map(
      positions
        .filter(({ searchEngine, trackingContextId }) =>
          contextIds.get(searchEngine) === trackingContextId
        )
        .map((position) => [position.searchEngine, position] as const)
    );
  }, [insights]);
  const visibleHistory = useMemo(
    () => latestSemanticRankHistory((insights?.positionHistory ?? []).filter(point => !rankDimensionKey || point.dimensionKey === rankDimensionKey)),
    [insights, rankDimensionKey]
  );
  const competitorSnapshots =
    insights?.competitorSnapshots ?? EMPTY_COMPETITOR_SNAPSHOTS;
  const aiPositionHistory =
    insights?.aiPositionHistory ?? EMPTY_AI_POSITION_HISTORY;
  const aiCompetitorSnapshots =
    insights?.aiCompetitorSnapshots ?? EMPTY_AI_COMPETITOR_SNAPSHOTS;
  const seoPositionSlices = useMemo(
    () => inspectorSeoPositionSlices(insights?.positions ?? []),
    [insights]
  );
  const seoSerpSlices = useMemo(
    () => inspectorSeoSerpSlices(insights?.competitorSnapshots ?? []),
    [insights]
  );
  const aiPositionSlices = useMemo(
    () => inspectorAiPositionSlices(
      insights?.aiPositionHistory ?? [],
      insights?.aiCompetitorSnapshots ?? []
    ),
    [insights]
  );
  const aiSerpSlices = useMemo(
    () => inspectorAiSerpSlices(insights?.aiCompetitorSnapshots ?? []),
    [insights]
  );
  const selectedAiPositionHistory = useMemo(
    () => aiPositionHistory.filter(
      (snapshot) => aiDimensionKey(snapshot) === aiPositionDimensionKey
    ),
    [aiPositionDimensionKey, aiPositionHistory]
  );
  const selectedSerpSnapshots = useMemo(
    () => competitorSnapshots.filter(
      ({ dimensionKey }) => dimensionKey === serpDimensionKey
    ),
    [competitorSnapshots, serpDimensionKey]
  );
  const selectedAiCompetitorSnapshots = useMemo(
    () => aiCompetitorSnapshots.filter(
      (snapshot) => aiDimensionKey(snapshot) === aiSerpDimensionKey
    ),
    [aiCompetitorSnapshots, aiSerpDimensionKey]
  );
  const aiChartHistory = useMemo(
    () => latestSemanticRankHistory(
      aiHistoryChartPoints(selectedAiPositionHistory)
    ),
    [selectedAiPositionHistory]
  );
  const currentAiAnswers = useMemo(
    () => latestAiAnswerSummaries(
      selectedAiPositionHistory,
      aiPositionDimensionKey ? [] : item.aiAnswers ?? []
    ),
    [aiPositionDimensionKey, item.aiAnswers, selectedAiPositionHistory]
  );
  const latestAiAnswers = useMemo(
    () => latestAiAnswerSummaries(
      aiPositionHistory,
      item.aiAnswers ?? []
    ),
    [aiPositionHistory, item.aiAnswers]
  );
  const positionChanges = useMemo(
    () => semanticRankHistoryDateRows(insights?.positionHistory ?? [], rankDimensionKey),
    [insights, rankDimensionKey]
  );
  const aiPositionChanges = useMemo(
    () => rankHistoryByDate(aiChartHistory),
    [aiChartHistory]
  );
  const hasAnyAiSnapshot =
    (item.aiAnswers?.length ?? 0) > 0 ||
    (insights?.aiPositionHistory?.length ?? 0) > 0 ||
    aiCompetitorSnapshots.length > 0;
  const targetMismatches = useMemo(
    () => item.targetUrl
      ? [
          ...[...primaryPositions.values()].flatMap((position) =>
            position.found &&
            position.rankingUrl &&
            !sameSemanticRankingUrl(item.targetUrl!, position.rankingUrl)
              ? [{
                  engine: position.searchEngine,
                  rankingUrl: position.rankingUrl,
                  source: "SERP" as const
                }]
              : []
          ),
          ...latestAiAnswers.flatMap((answer) =>
            answer.siteFound &&
            answer.rankingUrl &&
            !sameSemanticRankingUrl(item.targetUrl!, answer.rankingUrl)
              ? [{
                  engine: answer.searchEngine,
                  rankingUrl: answer.rankingUrl,
                  source: "AI" as const
                }]
              : []
          )
        ]
      : [],
    [item.targetUrl, latestAiAnswers, primaryPositions]
  );
  const hasSavedAiAnswer = currentAiAnswers.length > 0;
  const effectiveInspectorMode: SemanticKeywordInspectorMode =
    hasAnyAiSnapshot ? inspectorMode : "SEARCH";
  const latestPositionAt = latestObservedAt(insights?.positions ?? []);
  const latestSerpSnapshot = [...competitorSnapshots, ...aiCompetitorSnapshots]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0];
  const latestSerpAt = latestSerpSnapshot?.observedAt;
  const latestFrequencyAt = latestObservedAt(latestFrequencies);
  const latestSerpResultCount = latestSerpSnapshot?.results.length ?? 0;
  const frequencyByType = useMemo(
    () => latestFrequencyByType(latestFrequencies),
    [latestFrequencies]
  );

  useEffect(() => {
    if (!insights) return;
    selectAvailableSlice(rankDimensionKey, seoPositionSlices, setRankDimensionKey);
  }, [insights, rankDimensionKey, seoPositionSlices]);
  useEffect(() => {
    if (!insights) return;
    selectAvailableSlice(serpDimensionKey, seoSerpSlices, setSerpDimensionKey);
  }, [insights, seoSerpSlices, serpDimensionKey]);
  useEffect(() => {
    if (!insights) return;
    selectAvailableSlice(
      aiPositionDimensionKey,
      aiPositionSlices,
      setAiPositionDimensionKey
    );
  }, [aiPositionDimensionKey, aiPositionSlices, insights]);
  useEffect(() => {
    if (!insights) return;
    selectAvailableSlice(aiSerpDimensionKey, aiSerpSlices, setAiSerpDimensionKey);
  }, [aiSerpDimensionKey, aiSerpSlices, insights]);

  function requestClose(): void {
    if (noteDirty) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  async function saveNote(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (savingNote || item.trashed) return;
    setSavingNote(true);
    setNoteStatus(undefined);
    try {
      const normalized = note.trim();
      const updated = await browserApiRequest<SemanticKeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: { note: normalized || null },
          ifMatch: item.version
        }
      );
      setInsights((current) => current ? {
        ...withoutNote(current),
        ...(normalized ? { note: normalized } : {})
      } : current);
      setNote(normalized);
      setNoteDirty(false);
      onUpdated(updated);
      setNoteStatus(normalized ? "Заметка сохранена" : "Заметка удалена");
    } catch (requestError) {
      setNoteStatus(noteError(requestError));
    } finally {
      setSavingNote(false);
    }
  }

  async function deleteFrequencyContext(): Promise<void> {
    if (!frequencyToDelete || deletingFrequency || item.trashed) return;
    setDeletingFrequency(true);
    setFrequencyDeleteError(undefined);
    try {
      await browserApiRequest<void>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}/frequencies/${encodeURIComponent(frequencyToDelete.type)}/${encodeURIComponent(frequencyToDelete.device)}?regionCode=${encodeURIComponent(frequencyToDelete.regionCode)}`,
        { method: "DELETE" }
      );
      setInsights((current) => current ? {
        ...current,
        frequencies: current.frequencies.filter(
          (frequency) => !sameFrequencyContext(frequency, frequencyToDelete)
        )
      } : current);
      setFrequencyToDelete(undefined);
      onFrequencyDeleted();
    } catch (requestError) {
      setFrequencyDeleteError(frequencyDeletionError(requestError));
    } finally {
      setDeletingFrequency(false);
    }
  }

  async function toggleTracking(): Promise<void> {
    if (trackingBusy || item.trashed) return;
    setTrackingBusy(true);
    setTrackingStatus(undefined);
    try {
      const updated = await browserApiRequest<SemanticKeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: { isTracked: !item.isTracked },
          ifMatch: item.version
        }
      );
      onUpdated(updated);
      setTrackingStatus(
        updated.isTracked ? "Отслеживание включено" : "Отслеживание выключено"
      );
    } catch (requestError) {
      setTrackingStatus(trackingError(requestError));
    } finally {
      setTrackingBusy(false);
    }
  }

  async function copyTargetUrl(): Promise<void> {
    if (!item.targetUrl) return;
    try {
      await navigator.clipboard.writeText(item.targetUrl);
      setTargetUrlCopied(true);
      window.setTimeout(() => setTargetUrlCopied(false), 1_800);
    } catch {
      setTargetUrlCopied(false);
    }
  }

  async function saveTargetUrl(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (savingTargetUrl || item.trashed) return;
    const targetUrl = normalizeSemanticTargetUrlInput(
      targetUrlDraft,
      projectDomain
    );
    if (!targetUrl) {
      setTargetUrlError(
        "Укажите корректный HTTP(S)-адрес, домен или путь внутри проекта."
      );
      return;
    }
    setTargetUrlDraft(targetUrl);
    setSavingTargetUrl(true);
    setTargetUrlError(undefined);
    try {
      const updated = await browserApiRequest<SemanticKeywordListItem>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: { targetUrl },
          ifMatch: item.version
        }
      );
      onUpdated(updated);
      setTargetUrlDraft(updated.targetUrl ?? targetUrl);
      setTargetUrlEditorOpen(false);
    } catch (requestError) {
      setTargetUrlError(targetUrlMutationError(requestError));
    } finally {
      setSavingTargetUrl(false);
    }
  }

  const inspectorGroups: readonly Readonly<{
    id: string;
    name: string;
    path: string;
    color?: string;
  }>[] = insights
    ? insights.groups
    : item.groupPath
      ? [{
          id: `${item.id}:primary-group`,
          name: visibleGroupPath(item.groupPath),
          path: visibleGroupPath(item.groupPath)
        }]
      : [];

  return (
    <WorkspaceSidebar side="right"
      aria-label={uiText("Детали запроса {0}", [String(item.textOriginal)])}
      className="semantic-keyword-inspector"
    >
      <header
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:header`}
      >
        <div>
          <span><UiText text="Запрос" /></span>
          <strong>{item.textOriginal}</strong>
          <small>ID: {item.id.slice(0, 8)}</small>
        </div>
        <div className="semantic-sidebar-actions">
          {!item.trashed && (
            <button
              aria-label={item.isTracked ? uiText("Отключить отслеживание") : uiText("Включить отслеживание")}
              aria-pressed={item.isTracked}
              className={`semantic-sidebar-tracking${item.isTracked ? " active" : ""}`}
              disabled={trackingBusy}
              onClick={() => void toggleTracking()}
              title={item.isTracked ? uiText("Отключить отслеживание") : uiText("Включить отслеживание")}
              type="button"
            >
              <Icon name={item.isTracked ? "eye" : "eyeOff"} />
            </button>
          )}
          {!item.trashed && (
            <button className="semantic-sidebar-edit" onClick={onEdit} type="button">
              <UiText text="Изменить" /></button>
          )}
          <button
            aria-label={uiText("Закрыть детали")}
            className="semantic-sidebar-close"
            onClick={requestClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>

      <nav
        aria-label={uiText("Разделы карточки запроса")}
        className="semantic-inspector-tabs"
        role="tablist"
      >
        <button
          aria-selected={activeTab === "OVERVIEW"}
          className={activeTab === "OVERVIEW" ? "active" : undefined}
          onClick={() => selectInspectorTab("OVERVIEW")}
          role="tab"
          type="button"
        >
          <UiText text="Обзор" />
        </button>
        <button
          aria-selected={activeTab === "POSITIONS"}
          className={activeTab === "POSITIONS" ? "active" : undefined}
          onClick={() => selectInspectorTab("POSITIONS")}
          role="tab"
          type="button"
        >
          <UiText text="Позиции" />
        </button>
        <button
          aria-selected={activeTab === "SERP"}
          className={activeTab === "SERP" ? "active" : undefined}
          onClick={() => selectInspectorTab("SERP")}
          role="tab"
          type="button"
        >
          <UiText text="Выдача" />
        </button>
        <button
          aria-selected={activeTab === "WORDSTAT"}
          className={activeTab === "WORDSTAT" ? "active" : undefined}
          onClick={() => selectInspectorTab("WORDSTAT")}
          role="tab"
          type="button"
        >
          Wordstat
        </button>
        <button aria-label={uiText("Страница")} aria-selected={activeTab === "PAGE"} className={`semantic-inspector-icon-tab${activeTab === "PAGE" ? " active" : ""}`} onClick={() => selectInspectorTab("PAGE")} role="tab" title={uiText("Целевая страница и её SEO-параметры")} type="button"><Icon name="page" /></button>
        <button
          aria-label={uiText("Заметка")}
          aria-selected={activeTab === "NOTE"}
          className={`semantic-inspector-icon-tab semantic-inspector-note-tab${activeTab === "NOTE" ? " active" : ""}${note.trim() || noteDirty ? " has-note" : ""}`}
          onClick={() => selectInspectorTab("NOTE")}
          role="tab"
          title={uiText("Заметка к запросу")}
          type="button"
        >
          <Icon name="note" />
        </button>
      </nav>

      <section
        className="semantic-inspector-overview"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:overview`}
        hidden={activeTab !== "OVERVIEW"}
        role="tabpanel"
      >
        {activeTab === "OVERVIEW" && <KeywordTargetPage projectId={projectId} targetUrl={item.targetUrl} detailed={false} state={targetPage.state} onRefresh={targetPage.refresh} onOpenDetails={() => selectInspectorTab("PAGE")} />}
        <div className="semantic-inspector-parameter-card">
          <h3><UiText text="Параметры запроса" /></h3>
          <dl>
            <div><dt><UiText text="Интент" /></dt><dd><span className="semantic-intent-chip">{<UiText text={intentLabel(item.intent) ?? ""} />}</span></dd></div>
            <div className="semantic-inspector-overview-groups">
              <dt><UiText text="Папки" /></dt>
              <dd>
                {inspectorGroups.length > 0 ? (
                  <span className="semantic-inspector-group-list">
                    {inspectorGroups.map((group) => (
                      <span key={group.id} title={group.path}>
                        <i
                          aria-hidden="true"
                          style={{ backgroundColor: group.color ?? "#a8a5b8" }}
                        />
                        {group.path}
                      </span>
                    ))}
                    {insights?.groupsTruncated && (
                      <em><UiText text="Показана часть папок" /></em>
                    )}
                  </span>
                ) : (
                  <span className="semantic-inspector-muted">
                    <UiText text="Без группы" />
                  </span>
                )}
              </dd>
            </div>
            <div><dt><UiText text="Кластер" /></dt><dd>{item.clusterName ?? <UiText text="Не назначен" />}</dd></div>
            <div><dt><UiText text="Язык" /></dt><dd>{item.language.toUpperCase()}</dd></div>
            <div><dt><UiText text="Отслеживание" /></dt><dd>{item.isTracked ? <UiText text="Включено" /> : <UiText text="Выключено" />}</dd></div>
            <div className="semantic-inspector-overview-tags">
              <dt><UiText text="Теги" /></dt>
              <dd>
                <span className="semantic-inspector-tags">
                  {item.tags.length > 0
                    ? item.tags.map((tag) => <span key={tag}>{tag}</span>)
                    : <span><UiText text="Нет тегов" /></span>}
                </span>
              </dd>
            </div>
          </dl>
          {trackingStatus && <small className="semantic-tracking-status" role="status">{trackingStatus}</small>}
        </div>
        <div className="semantic-inspector-target-url">
          <div className="semantic-inspector-target-url-heading">
            <strong><UiText text="Целевой URL" /></strong>
            {item.targetUrl ? (
              <button
                aria-label={targetUrlCopied ? uiText("URL скопирован") : uiText("Скопировать целевой URL")}
                className={targetUrlCopied ? "copied" : undefined}
                onClick={() => void copyTargetUrl()}
                title={targetUrlCopied ? uiText("URL скопирован") : uiText("Скопировать URL")}
                type="button"
              >
                <Icon name={targetUrlCopied ? "checkDouble" : "copy"} />
              </button>
            ) : !item.trashed ? (
              <button
                aria-label={uiText("Задать целевой URL")}
                onClick={() => {
                  setTargetUrlDraft("");
                  setTargetUrlError(undefined);
                  setTargetUrlEditorOpen(true);
                }}
                title={uiText("Задать целевой URL")}
                type="button"
              >
                <Icon name="plus" />
              </button>
            ) : null}
          </div>
          {item.targetUrl ? (
            <a href={item.targetUrl} rel="noopener noreferrer" target="_blank">{item.targetUrl}</a>
          ) : (
            <span className="semantic-inspector-muted"><UiText text="Не задан" /></span>
          )}
          {targetMismatches.length > 0 && (
            <div className="semantic-target-url-warning" role="status">
              <strong><UiText text="URL не совпадает с найденной страницей" /></strong>
              {targetMismatches.map(({ engine, rankingUrl, source }) => (
                <a
                  href={rankingUrl}
                  key={`${source}:${engine}:${rankingUrl}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <SearchEngineLogo engine={engine} size="compact" />
                  <span>{source === "AI" ? <UiText text="ИИ ·" after=" " /> : ""}{rankingUrl}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="semantic-inspector-data-state">
          <h3><UiText text="Данные" /></h3>
          <button onClick={() => selectInspectorTab("POSITIONS")} type="button">
            <span className="semantic-inspector-state-icon position">
              <Icon name="positions" />
            </span>
            <span>
              <strong><UiText text="Позиции" /></strong>
              <small>
                {latestPositionAt
                  ? `${insights?.positions.length ?? 0} · ${formatDate(latestPositionAt, uiLocale)}`
                  : <UiText text={loading ? "Загружаем позиции…" : "Позиция не снималась"} />}
              </small>
            </span>
            <Icon name="chevronRight" />
          </button>
          <button onClick={() => {
            if (latestSerpSnapshot) selectSharedInspectorMode("trackingContextId" in latestSerpSnapshot ? "SEARCH" : "AI");
            selectInspectorTab("SERP");
          }} type="button">
            <span className="semantic-inspector-state-icon serp">
              <Icon name="search" />
            </span>
            <span>
              <strong><UiText text="Выдача" /></strong>
              <small>
                {latestSerpAt
                  ? `${latestSerpResultCount} · ${formatDate(latestSerpAt, uiLocale)}`
                  : <UiText text={loading ? "Загружаем выдачу…" : "Выдача ещё не собрана"} />}
              </small>
            </span>
            <Icon name="chevronRight" />
          </button>
          <button onClick={() => selectInspectorTab("WORDSTAT")} type="button">
            <span className="semantic-inspector-state-icon wordstat">
              <Icon name="frequency" />
            </span>
            <span>
              <strong>Wordstat</strong>
              <small>
                {latestFrequencyAt
                  ? `${latestFrequencies.length} · ${formatDate(latestFrequencyAt, uiLocale)}`
                  : <UiText text={loading ? "Загружаем срезы…" : "Нет актуального среза"} />}
              </small>
            </span>
            <Icon name="chevronRight" />
          </button>
        </div>
      </section>

      {activeTab === "POSITIONS" && (
        <section
          className="semantic-inspector-tab-panel semantic-inspector-ranks"
          data-presence-cursor-anchor="true"
          data-presence-key={`${presenceKeyPrefix}:ranks`}
          role="tabpanel"
        >
          <InspectorModeSwitch
            mode={effectiveInspectorMode}
            onChange={selectSharedInspectorMode}
            showAi={hasAnyAiSnapshot}
          />
          {loading && !insights ? (
            <InspectorLoading />
          ) : effectiveInspectorMode === "SEARCH" ? (
            <>
              <InspectorSliceSelector
                label="Срезы SEO-выдачи"
                onChange={selectRankDimension}
                onHistory={() => setHistoryOpen(true)}
                slices={seoPositionSlices}
                value={rankDimensionKey}
              />
              {rankDimensionKey && !loading && (
                <>
                  <div className="semantic-normal-rank-chart">
                    <SemanticRankHistoryChart points={visibleHistory} />
                  </div>
                  {positionChanges.length > 0 && (
                    <div className="semantic-rank-change-history">
                      <header>
                        <strong><UiText text="Изменения позиций" /></strong>
                      </header>
                      <SeoRankChangeTable rows={positionChanges} />
                    </div>
                  )}
                </>
              )}
              {!item.trashed && seoPositionSlices.length === 0 && (
                <InspectorActionEmpty
                  action="Собрать позиции"
                  icon="positions"
                  onAction={() => onCollect("POSITIONS")}
                  text="Запустите первую проверку для этого запроса."
                  title="Позиции ещё не собраны"
                />
              )}
            </>
          ) : (
            <>
              <InspectorSliceSelector
                label="Срезы ИИ-выдачи"
                onChange={selectAiPositionDimension}
                onHistory={() => setAiHistoryOpen(true)}
                {...(hasSavedAiAnswer
                  ? {
                      onOpenAnswer: () =>
                        onOpenAiAnswer(aiPositionDimensionKey || undefined)
                    }
                  : {})}
                slices={aiPositionSlices}
                value={aiPositionDimensionKey}
              />
              {aiChartHistory.length > 0 && (
                <div className="semantic-ai-rank-chart">
                  <SemanticRankHistoryChart points={aiChartHistory} />
                </div>
              )}
              {aiPositionChanges.length > 0 && (
                <div className="semantic-rank-change-history">
                  <header>
                    <strong><UiText text="Изменения ИИ-позиций" /></strong>
                  </header>
                  <RankChangeRows rows={aiPositionChanges.slice(0, 5)} />
                </div>
              )}
              {!item.trashed && selectedAiPositionHistory.length === 0 && (
                <InspectorActionEmpty
                  action="Собрать ИИ-позиции"
                  icon="ai"
                  onAction={() => onCollect("AI_POSITIONS")}
                  text="Запустите проверку ИИ-позиций для выбранного запроса."
                  title="ИИ-позиции ещё не собраны"
                />
              )}
            </>
          )}
        </section>
      )}

      {activeTab === "SERP" && (
        <section
          className="semantic-inspector-tab-panel semantic-inspector-serp"
          data-presence-cursor-anchor="true"
          data-presence-key={`${presenceKeyPrefix}:serp`}
          role="tabpanel"
        >
          <InspectorModeSwitch
            mode={effectiveInspectorMode}
            onChange={selectSharedInspectorMode}
            showAi={hasAnyAiSnapshot}
          />
          {loading && !insights ? (
            <InspectorLoading />
          ) : effectiveInspectorMode === "SEARCH" ? (
            <>
              <InspectorSliceSelector
                label="Срезы SEO-выдачи"
                onChange={selectSerpDimension}
                slices={seoSerpSlices}
                value={serpDimensionKey}
              />
              {selectedSerpSnapshots.length > 0 ? (
                <SemanticCompetitorSnapshots
                  presenceKeyPrefix={`${presenceKeyPrefix}:competitors`}
                  projectDomain={projectDomain}
                  showEmpty
                  snapshots={selectedSerpSnapshots}
                />
              ) : (
                !item.trashed && (
                  <InspectorActionEmpty
                    action="Собрать выдачу"
                    icon="search"
                    onAction={() => onCollect("SERP")}
                    text="Сохраните выдачу и конкурентов для этого запроса."
                    title="Выдача ещё не собрана"
                  />
                )
              )}
              <button
                className="secondary-button semantic-serp-history-button"
                disabled={!serpDimensionKey}
                onClick={() => setSerpHistoryOpen(true)}
                type="button"
              >
                <Icon name="history" />
                <UiText text="История выдачи и конкурентов" />
              </button>
            </>
          ) : (
            <>
              <InspectorSliceSelector
                label="Срезы ИИ-выдачи"
                onChange={selectAiSerpDimension}
                slices={aiSerpSlices}
                value={aiSerpDimensionKey}
              />
              {selectedAiCompetitorSnapshots.length > 0 ? (
                <SemanticCompetitorSnapshots
                  heading="Топ конкурентов ИИ"
                  presenceKeyPrefix={`${presenceKeyPrefix}:ai-competitors`}
                  projectDomain={projectDomain}
                  showEmpty
                  snapshots={selectedAiCompetitorSnapshots}
                />
              ) : (
                !item.trashed && (
                  <InspectorActionEmpty
                    action="Собрать ИИ-выдачу"
                    icon="ai"
                    onAction={() => onCollect("AI_SERP")}
                    text="Сохраните источники и сайты из ИИ-ответа."
                    title="Источники ИИ ещё не собраны"
                  />
                )
              )}
              {selectedAiCompetitorSnapshots.length > 0 && (
                <button className="secondary-button semantic-serp-history-button" type="button" onClick={() => onOpenAiAnswer(aiSerpDimensionKey || undefined)}>
                  <Icon name="ai" /><UiText text="Открыть ИИ-ответ" />
                </button>
              )}
              <button
                className="secondary-button semantic-serp-history-button"
                disabled={aiCompetitorSnapshots.length === 0}
                onClick={() => setAiHistoryOpen(true)}
                type="button"
              >
                <Icon name="history" />
                <UiText text="История ИИ-выдачи и конкурентов" />
              </button>
            </>
          )}
        </section>
      )}

      {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}

      {activeTab === "WORDSTAT" && (
        <section
          className="semantic-inspector-tab-panel semantic-inspector-wordstat"
          data-presence-cursor-anchor="true"
          data-presence-key={`${presenceKeyPrefix}:frequency`}
          role="tabpanel"
        >
          {loading && !insights ? (
            <InspectorLoading />
          ) : (
            <>
              <div className="semantic-frequency-summary">
                {(["FIXED", "EXACT", "BASE"] as const).map((type) => {
                  const frequency = frequencyByType.get(type);
                  return (
                    <article className={`type-${type.toLocaleLowerCase()}`} key={type}>
                      <span><i />{<UiText text={frequencyTypeLabel(type)} />}</span>
                      <strong>
                        {frequency?.value
                          ? formatInteger(frequency.value, uiLocale)
                          : "—"}
                      </strong>
                    </article>
                  );
                })}
              </div>
              <div className="semantic-wordstat-context">
                <span>
                  {latestFrequencies[0]
                    ? <><UiText text={frequencyRegionLabel(latestFrequencies[0].regionCode)} /> · <UiText text={frequencyDeviceLabel(latestFrequencies[0].device)} /></>
                    : <UiText text="Срез ещё не выбран" />}
                </span>
                <small>
                  {latestFrequencyAt
                    ? <><UiText text="Обновлено" after=": " />{formatDate(latestFrequencyAt, uiLocale)}</>
                    : <UiText text="Нет данных" />}
                </small>
              </div>
              {latestFrequencies.length > 0 ? (
                <details className="semantic-frequency-details">
                  <summary>
                    <span><UiText text="Сохранённые срезы" /></span>
                    <b>{latestFrequencies.length.toLocaleString(uiLocale)}</b>
                    <Icon name="chevronDown" />
                  </summary>
                  <div className="semantic-frequency-list">
                    {latestFrequencies.map((frequency) => (
                      <div
                        className="semantic-frequency-row"
                        key={`${frequency.type}:${frequency.regionCode}:${frequency.device}`}
                      >
                        <div className="semantic-frequency-context">
                          <SearchEngineLogo engine="YANDEX" size="compact" />
                          <span>{<UiText text={frequencyTypeLabel(frequency.type)} />}</span>
                          <small>
                            <UiText text={frequencyRegionLabel(frequency.regionCode)} /> ·{" "}
                            <UiText text={frequencyDeviceLabel(frequency.device)} />
                          </small>
                        </div>
                        <div className="semantic-frequency-value">
                          <strong>
                            {frequency.value
                              ? formatInteger(frequency.value, uiLocale)
                              : "—"}
                          </strong>
                          <small>
                            {frequency.period
                              ? <UiText text={frequencyPeriodLabel(frequency.period)} after=" · " />
                              : null}
                            {formatDateTime(frequency.observedAt, uiLocale)}
                          </small>
                        </div>
                        {!item.trashed && (
                          <button
                            aria-label={uiText("Удалить частотность «{0}»", [String(frequencyTypeLabel(frequency.type))])}
                            className="semantic-frequency-delete"
                            disabled={deletingFrequency}
                            onClick={() => {
                              setFrequencyDeleteError(undefined);
                              setFrequencyToDelete(frequency);
                            }}
                            title={uiText("Удалить частотность")}
                            type="button"
                          >
                            <Icon name="trash" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                !item.trashed && (
                  <InspectorActionEmpty
                    action="Собрать частотность"
                    icon="frequency"
                    onAction={() => onCollect("FREQUENCY")}
                    text="Получите базовую, фразовую и точную частотность."
                    title="Частотность ещё не собрана"
                  />
                )
              )}

              <div
                className="semantic-inspector-seasonality"
                data-presence-cursor-anchor="true"
                data-presence-key={`${presenceKeyPrefix}:seasonality`}
              >
                <div className="semantic-inspector-section-heading">
                  <h3><UiText text="Сезонность" /></h3>
                  {!item.trashed && (
                    <button onClick={() => onCollect("SEASONALITY")} type="button">
                      <Icon name="plus" /><UiText text="Срез" />
                    </button>
                  )}
                </div>
                {(insights?.seasonality?.length ?? 0) > 0 ? (
                  <SemanticSeasonalityCharts points={insights?.seasonality ?? []} />
                ) : (
                  !item.trashed && (
                    <InspectorActionEmpty
                      action="Собрать сезонность"
                      icon="trend"
                      onAction={() => onCollect("SEASONALITY")}
                      text="Запустите сбор истории Wordstat для этого запроса."
                      title="Сезонность ещё не собрана"
                    />
                  )
                )}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === "PAGE" && <section className="semantic-inspector-tab-panel semantic-inspector-page-tab" role="tabpanel"><KeywordTargetPage projectId={projectId} targetUrl={item.targetUrl} detailed state={targetPage.state} onRefresh={targetPage.refresh} onOpenDetails={() => selectInspectorTab("PAGE")} /></section>}
      {activeTab === "NOTE" && (
        <section
          className="semantic-inspector-tab-panel semantic-keyword-note"
          data-presence-cursor-anchor="true"
          data-presence-key={`${presenceKeyPrefix}:note`}
          role="tabpanel"
        >
          <h3><UiText text="Заметка" /></h3>
          <form onSubmit={(event) => void saveNote(event)}>
            <textarea
              disabled={item.trashed || savingNote}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteDirty(true);
                setNoteStatus(undefined);
              }}
              placeholder={uiText("Добавьте контекст, гипотезу или задачу по запросу…")}
              aria-label={uiText("Заметка к запросу")}
              rows={10}
              value={note}
            />
            <div className="semantic-note-footer">
              <small>{note.length.toLocaleString(uiLocale)} <UiText text="символов" /></small>
              {!item.trashed && (
                <button className="primary-button" disabled={!noteDirty || savingNote} type="submit">
                  {savingNote ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
                </button>
              )}
            </div>
            {noteStatus && <p aria-live="polite">{noteStatus}</p>}
          </form>
        </section>
      )}

      {activeTab === "OVERVIEW" && (
        <section
          className="semantic-inspector-dates"
          data-presence-cursor-anchor="true"
          data-presence-key={`${presenceKeyPrefix}:dates`}
        >
          <small><UiText text="Создан:" after=" " />{formatDateTime(item.createdAt, uiLocale)}</small>
          <small><UiText text="Обновлён:" after=" " />{formatDateTime(item.updatedAt, uiLocale)}</small>
          <small><UiText text="Источник:" after=" " />{<UiText text={sourceLabel(item.sourceMode) ?? ""} />}</small>
        </section>
      )}
      {closeConfirmOpen && (
        <UnsavedChangesConfirmation
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={() => {
            setCloseConfirmOpen(false);
            onClose();
          }}
        />
      )}
      {serpHistoryOpen && <SemanticKeywordSerpHistory currentUserId={currentUserId} projectId={projectId} keywordId={item.id} keywordText={item.textOriginal} projectDomain={projectDomain} dimensionKey={serpDimensionKey || undefined} onClose={() => setSerpHistoryOpen(false)} />}
      {historyOpen && (
        <SemanticKeywordPositionHistoryModal
          dimensionKey={rankDimensionKey || undefined}
          contextPoints={insights?.positionHistory ?? []}
          createdAt={item.createdAt}
          keywordId={item.id}
          keywordText={item.textOriginal}
          onClose={() => setHistoryOpen(false)}
          projectId={projectId}
          {...(item.targetUrl ? { targetUrl: item.targetUrl } : {})}
        />
      )}
      {aiHistoryOpen && (
        <SemanticKeywordAiPositionHistoryModal
          includeCompetitors={activeTab === "SERP"}
          currentUserId={currentUserId}
          {...((activeTab === "SERP" ? aiSerpDimensionKey : aiPositionDimensionKey)
            ? {
                dimensionKey:
                  activeTab === "SERP"
                    ? aiSerpDimensionKey
                    : aiPositionDimensionKey
              }
            : {})}
          keywordId={item.id}
          keywordText={item.textOriginal}
          onClose={() => setAiHistoryOpen(false)}
          onOpenAiAnswer={() => onOpenAiAnswer(
            (activeTab === "SERP" ? aiSerpDimensionKey : aiPositionDimensionKey) || undefined
          )}
          projectDomain={projectDomain}
          projectId={projectId}
        />
      )}
      {frequencyToDelete && (
        <SemanticModal
          description={uiText("Удаление применяется только к выбранному запросу.")}
          onClose={deletingFrequency
            ? () => undefined
            : () => {
                setFrequencyToDelete(undefined);
                setFrequencyDeleteError(undefined);
              }}
          size="small"
          title={uiText("Удалить частотность?")}
        >
          <div className="semantic-confirm-dialog semantic-frequency-delete-dialog">
            <div className="inline-alert danger" role="alert">
              <UiText text="Все сохранённые срезы «" />{<UiText text={frequencyTypeLabel(frequencyToDelete.type) ?? ""} />}<UiText text="» для региона" after=" " />{<UiText text={frequencyRegionLabel(frequencyToDelete.regionCode)} />} <UiText text="и устройства «" before=" " />{<UiText text={frequencyDeviceLabel(frequencyToDelete.device) ?? ""} />}<UiText text="» будут удалены без возможности восстановления." /></div>
            <div className="semantic-frequency-delete-summary">
              <span>{<UiText text={frequencyTypeLabel(frequencyToDelete.type) ?? ""} />}</span>
              <strong>{frequencyToDelete.value ? formatInteger(frequencyToDelete.value, uiLocale) : "—"}</strong>
              <small>{formatDateTime(frequencyToDelete.observedAt, uiLocale)}</small>
            </div>
            {frequencyDeleteError && (
              <div className="inline-alert danger" role="alert">
                {<UiText text={frequencyDeleteError ?? ""} />}
              </div>
            )}
            <div className="semantic-modal-actions">
              <button
                className="secondary-button"
                disabled={deletingFrequency}
                onClick={() => {
                  setFrequencyToDelete(undefined);
                  setFrequencyDeleteError(undefined);
                }}
                type="button"
              >
                <UiText text="Отмена" /></button>
              <button
                className="danger-button"
                disabled={deletingFrequency}
                onClick={() => void deleteFrequencyContext()}
                type="button"
              >
                {deletingFrequency ? <UiText text="Удаляем…" /> : <UiText text="Удалить" />}
              </button>
            </div>
          </div>
        </SemanticModal>
      )}
      {targetUrlEditorOpen && (
        <SemanticModal
          description={uiText("URL будет использоваться для проверки совпадения с обычной и ИИ-выдачей.")}
          onClose={savingTargetUrl
            ? () => undefined
            : () => {
                setTargetUrlEditorOpen(false);
                setTargetUrlError(undefined);
              }}
          size="small"
          title={uiText("Задать целевой URL")}
        >
          <form
            className="semantic-confirm-dialog semantic-target-url-editor"
            onSubmit={(event) => void saveTargetUrl(event)}
          >
            <label className="semantic-workflow-field">
              <span><UiText text="Целевой URL" /></span>
              <div
                className={`semantic-target-url-input${targetUrlError ? " invalid" : ""}`}
              >
                <Icon name="link" />
                <input
                  aria-describedby="semantic-target-url-help"
                  aria-errormessage={targetUrlError
                    ? "semantic-target-url-error"
                    : undefined}
                  aria-invalid={Boolean(targetUrlError)}
                  autoCapitalize="none"
                  autoComplete="url"
                  autoCorrect="off"
                  autoFocus
                  disabled={savingTargetUrl}
                  inputMode="url"
                  maxLength={2_048}
                  onBlur={() => {
                    const normalized = normalizeSemanticTargetUrlInput(
                      targetUrlDraft,
                      projectDomain
                    );
                    if (normalized) setTargetUrlDraft(normalized);
                  }}
                  onChange={(event) => {
                    setTargetUrlDraft(event.target.value);
                    setTargetUrlError(undefined);
                  }}
                  placeholder={uiText("https://example.com/page или /page")}
                  required
                  spellCheck={false}
                  type="text"
                  value={targetUrlDraft}
                />
              </div>
              <small id="semantic-target-url-help">
                <UiText text="Можно вставить полный URL, домен или путь внутри проекта." /></small>
            </label>
            {targetUrlError && (
              <div
                className="inline-alert danger"
                id="semantic-target-url-error"
                role="alert"
              >
                {<UiText text={targetUrlError ?? ""} />}
              </div>
            )}
            <div className="semantic-modal-actions">
              <button
                className="secondary-button"
                disabled={savingTargetUrl}
                onClick={() => {
                  setTargetUrlEditorOpen(false);
                  setTargetUrlError(undefined);
                }}
                type="button"
              >
                <UiText text="Отмена" /></button>
              <button
                className="primary-button"
                disabled={savingTargetUrl || !targetUrlDraft.trim()}
                type="submit"
              >
                {savingTargetUrl ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
              </button>
            </div>
          </form>
        </SemanticModal>
      )}
    </WorkspaceSidebar>
  );
}

function withoutNote(
  insights: SemanticKeywordInsights
): Omit<SemanticKeywordInsights, "note"> {
  return {
    keywordId: insights.keywordId,
    groups: insights.groups,
    ...(insights.groupsTruncated ? { groupsTruncated: true } : {}),
    frequencies: insights.frequencies,
    positions: insights.positions,
    positionHistory: insights.positionHistory,
    ...(insights.competitorSnapshots
      ? { competitorSnapshots: insights.competitorSnapshots }
      : {}),
    ...(insights.aiPositionHistory
      ? { aiPositionHistory: insights.aiPositionHistory }
      : {}),
    ...(insights.aiCompetitorSnapshots
      ? { aiCompetitorSnapshots: insights.aiCompetitorSnapshots }
      : {})
  };
}

function latestAiAnswerSummaries(
  history: readonly SemanticAiAnswerHistoryItem[],
  fallback: readonly SemanticAiAnswerSummary[]
): readonly SemanticAiAnswerSummary[] {
  if (history.length === 0) return fallback;
  const ordered = [...history].sort((left, right) =>
    Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
    right.snapshotId.localeCompare(left.snapshotId)
  );
  return (["YANDEX", "GOOGLE"] as const).flatMap((searchEngine) => {
    const currentIndex = ordered.findIndex(
      (item) => item.searchEngine === searchEngine
    );
    if (currentIndex < 0) {
      const saved = fallback.find((item) => item.searchEngine === searchEngine);
      return saved ? [saved] : [];
    }
    const current = ordered[currentIndex]!;
    const saved = fallback.find((item) =>
      item.searchEngine === searchEngine &&
      item.observedAt === current.observedAt
    );
    const previousPosition = current.previousPosition ??
      saved?.previousPosition ??
      ordered
        .slice(currentIndex + 1)
        .find((item) =>
          item.searchEngine === searchEngine &&
          item.siteFound &&
          item.position !== undefined
        )?.position;
    return [{
      searchEngine,
      answerPresent: current.answerPresent,
      siteFound: current.siteFound,
      ...(current.position === undefined ? {} : { position: current.position }),
      ...(previousPosition === undefined ? {} : { previousPosition }),
      ...(current.rankingUrl === undefined ? {} : { rankingUrl: current.rankingUrl }),
      brandFound: current.brandFound,
      observedAt: current.observedAt
    }];
  });
}

function aiHistoryChartPoints(
  history: readonly SemanticAiAnswerHistoryItem[]
): readonly SemanticKeywordPositionHistoryPoint[] {
  return history.map((item) => ({
    snapshotId: item.snapshotId,
    trackingContextId: `ai-answer:${item.searchEngine}`,
    contextName: `ИИ-ответ · ${rankEngineLabel(item.searchEngine)}`,
    searchEngine: item.searchEngine,
    device: item.device,
    regionCode: item.regionCode,
    provider: "ARSENKIN" as const,
    found: item.siteFound,
    ...(item.position === undefined ? {} : { position: item.position }),
    observedAt: item.observedAt
  }));
}

interface RankHistoryDateRow {
  readonly date: string;
  readonly observedAt: string;
  readonly positions: ReadonlyMap<
    "GOOGLE" | "YANDEX",
    SemanticKeywordPositionHistoryPoint
  >;
}

function SeoRankChangeTable({ rows }: Readonly<{ rows: ReturnType<typeof semanticRankHistoryDateRows> }>) {
  const { locale, t: uiText } = useUiLocale();
  return (
    <table className="semantic-seo-rank-table">
      <thead>
        <tr>
          <th scope="col"><UiText text="Дата" /></th>
          {(["YANDEX", "GOOGLE"] as const).map((engine) => (
            <th key={engine} scope="col">
              <SearchEngineLogo engine={engine} size="compact" />
              <span>{rankEngineLabel(engine)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date}>
            <th scope="row"><time dateTime={row.date}>{formatDate(row.observedAt, locale)}</time></th>
            {(["YANDEX", "GOOGLE"] as const).map((engine) => {
              const point = row.positions.get(engine);
              return (
                <td
                  className={!point ? "empty" : point.found ? undefined : "lost"}
                  key={engine}
                  title={point ? historyPointTitle(point, locale) : uiText("В этот день замера не было")}
                >
                  {point ? (point.found ? point.position ?? "—" : "×") : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RankChangeRows({ rows }: Readonly<{ rows: readonly RankHistoryDateRow[] }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  return (
    <div className="semantic-rank-change-rows">
      {rows.map((row) => (
        <div key={row.date}>
          <time dateTime={row.observedAt}>{formatDate(row.observedAt, uiLocale)}</time>
          {(["YANDEX", "GOOGLE"] as const).map((engine) => {
            const point = row.positions.get(engine);
            return (
              <span
                className={!point ? "empty" : point.found ? undefined : "lost"}
                key={engine}
                title={point ? historyPointTitle(point, uiLocale) : uiText("В этот день замера не было")}
              >
                <SearchEngineLogo engine={engine} size="compact" />
                <b>{point ? (point.found ? point.position ?? "—" : "×") : "—"}</b>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface InspectorSlice {
  readonly key: string;
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly regionCode: string;
  readonly regionLabel: string;
  readonly device: "DESKTOP" | "MOBILE";
  readonly observedAt: string;
  readonly found?: boolean;
  readonly position?: number;
  readonly resultCount?: number;
}

function InspectorSliceSelector({
  label,
  onChange,
  onHistory,
  onOpenAnswer,
  slices,
  value
}: Readonly<{
  label: string;
  onChange: (key: string) => void;
  onHistory?: () => void;
  onOpenAnswer?: () => void;
  slices: readonly InspectorSlice[];
  value: string;
}>) {
  const { locale, t } = useUiLocale();
  return (
    <div className="semantic-inspector-slice-selector">
      <header>
        <span><UiText text={label} /></span>
        {(onHistory || onOpenAnswer) && (
          <div>
            {onHistory && (
              <button disabled={slices.length === 0} onClick={onHistory} type="button">
                <Icon name="history" /><UiText text="История" />
              </button>
            )}
            {onOpenAnswer && (
              <button disabled={slices.length === 0} onClick={onOpenAnswer} type="button">
                <UiText text="Открыть ответ" /> ↗
              </button>
            )}
          </div>
        )}
      </header>
      <CustomSelect
        aria-label={t(label)}
        disabled={slices.length === 0}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("Нет сохранённых срезов")}
        popoverClassName="semantic-inspector-slice-popover"
        value={value}
      >
        {slices.map((slice) => (
          <option key={slice.key} value={slice.key}>
            <span className="semantic-inspector-slice-option">
              <SearchEngineLogo engine={slice.searchEngine} size="compact" />
              <span>
                <strong>
                  {slice.regionLabel}
                </strong>
                <small>
                  {inspectorSliceStatus(slice, t)} · {formatDateTime(slice.observedAt, locale)}
                </small>
              </span>
              <SemanticRankDeviceBadge device={slice.device} />
            </span>
          </option>
        ))}
      </CustomSelect>
    </div>
  );
}

function inspectorSeoPositionSlices(
  positions: readonly SemanticKeywordPositionSummary[]
): readonly InspectorSlice[] {
  return latestInspectorSlices(positions.map((position) => ({
    key: position.dimensionKey ?? semanticRankDimensionKey({
      searchEngine: position.searchEngine,
      countryCode: position.countryCode ?? "RU",
      regionCode: position.regionCode,
      language: position.language ?? "ru",
      device: position.device
    }),
    searchEngine: position.searchEngine,
    regionCode: position.regionCode,
    regionLabel: inspectorRegionLabel(
      position.searchEngine,
      position.regionCode,
      position.regionLabel
    ),
    device: position.device,
    observedAt: position.observedAt,
    found: position.found,
    ...(position.position === undefined ? {} : { position: position.position })
  })));
}

function inspectorSeoSerpSlices(
  snapshots: readonly SemanticKeywordCompetitorSnapshot[]
): readonly InspectorSlice[] {
  return latestInspectorSlices(snapshots.flatMap((snapshot) => {
    if (!snapshot.regionCode || !snapshot.device) return [];
    return [{
      key: snapshot.dimensionKey ?? semanticRankDimensionKey({
        searchEngine: snapshot.searchEngine,
        countryCode: snapshot.countryCode ?? "RU",
        regionCode: snapshot.regionCode,
        language: snapshot.language ?? "ru",
        device: snapshot.device
      }),
      searchEngine: snapshot.searchEngine,
      regionCode: snapshot.regionCode,
      regionLabel: inspectorRegionLabel(
        snapshot.searchEngine,
        snapshot.regionCode,
        snapshot.regionLabel
      ),
      device: snapshot.device,
      observedAt: snapshot.observedAt,
      resultCount: snapshot.results.length
    }];
  }));
}

function inspectorAiPositionSlices(
  history: readonly SemanticAiAnswerHistoryItem[],
  snapshots: readonly SemanticAiAnswerCompetitorSnapshot[]
): readonly InspectorSlice[] {
  const positionSlices = latestInspectorSlices(history.map((snapshot) => ({
    ...aiInspectorSlice(snapshot),
    found: snapshot.siteFound,
    ...(snapshot.position === undefined ? {} : { position: snapshot.position }),
    ...(snapshot.results.length > 0
      ? { resultCount: snapshot.results.length }
      : {})
  })));
  const serpByKey = new Map(
    inspectorAiSerpSlices(snapshots).map((slice) => [slice.key, slice] as const)
  );
  for (const position of positionSlices) {
    const serp = serpByKey.get(position.key);
    serpByKey.set(position.key, {
      ...(serp ?? position),
      ...position,
      observedAt:
        latestObservedAt([position, ...(serp ? [serp] : [])]) ??
        position.observedAt,
      ...(serp?.resultCount === undefined
        ? {}
        : { resultCount: serp.resultCount })
    });
  }
  return latestInspectorSlices([...serpByKey.values()]);
}

function inspectorAiSerpSlices(
  snapshots: readonly SemanticAiAnswerCompetitorSnapshot[]
): readonly InspectorSlice[] {
  return latestInspectorSlices(snapshots.map((snapshot) => ({
    ...aiInspectorSlice(snapshot),
    resultCount: snapshot.results.length
  })));
}

function aiInspectorSlice(
  snapshot: Readonly<{
    searchEngine: "GOOGLE" | "YANDEX";
    regionCode: string;
    device: "DESKTOP" | "MOBILE";
    observedAt: string;
  }>
): InspectorSlice {
  return {
    key: aiDimensionKey(snapshot),
    searchEngine: snapshot.searchEngine,
    regionCode: snapshot.regionCode,
    regionLabel: inspectorRegionLabel(
      snapshot.searchEngine,
      snapshot.regionCode
    ),
    device: snapshot.device,
    observedAt: snapshot.observedAt
  };
}

function aiDimensionKey(
  snapshot: Readonly<{
    searchEngine: "GOOGLE" | "YANDEX";
    regionCode: string;
    device: "DESKTOP" | "MOBILE";
  }>
): string {
  return semanticRankDimensionKey({
    searchEngine: snapshot.searchEngine,
    countryCode: "RU",
    regionCode: snapshot.regionCode,
    language: "ru",
    device: snapshot.device
  });
}

function latestInspectorSlices(
  slices: readonly InspectorSlice[]
): readonly InspectorSlice[] {
  const result = new Map<string, InspectorSlice>();
  for (const slice of [...slices].sort(
    (left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      left.key.localeCompare(right.key)
  )) {
    if (!result.has(slice.key)) result.set(slice.key, slice);
  }
  return [...result.values()];
}

function inspectorRegionLabel(
  searchEngine: "GOOGLE" | "YANDEX",
  regionCode: string,
  regionLabel?: string
): string {
  return searchRegionDisplayName(searchEngine, regionCode, regionLabel);
}

function inspectorSliceStatus(
  slice: InspectorSlice,
  translate: (text: string, values?: readonly string[]) => string
): string {
  if (slice.found && slice.position !== undefined) {
    return translate("Позиция {0}", [String(slice.position)]);
  }
  if (slice.found === false) return translate("Не найдена");
  if (slice.resultCount !== undefined) {
    return translate("{0} результатов", [String(slice.resultCount)]);
  }
  return translate("Срез сохранён");
}

function selectAvailableSlice(
  current: string,
  slices: readonly InspectorSlice[],
  select: (key: string) => void
): void {
  if (slices.some(({ key }) => key === current)) return;
  const next = slices[0]?.key ?? "";
  if (next !== current) select(next);
}

function InspectorModeSwitch({
  mode,
  onChange,
  showAi
}: Readonly<{
  mode: SemanticKeywordInspectorMode;
  onChange: (mode: SemanticKeywordInspectorMode) => void;
  showAi: boolean;
}>) {
  return (
    <div className="semantic-inspector-mode-switch" role="tablist">
      <button
        aria-selected={mode === "SEARCH"}
        className={mode === "SEARCH" ? "active" : undefined}
        onClick={() => onChange("SEARCH")}
        role="tab"
        type="button"
      >
        <UiText text="SEO выдача" />
      </button>
      {showAi && (
        <button
          aria-selected={mode === "AI"}
          className={mode === "AI" ? "active" : undefined}
          onClick={() => onChange("AI")}
          role="tab"
          type="button"
        >
          <UiText text="ИИ выдача" />
        </button>
      )}
    </div>
  );
}

function InspectorLoading() {
  return (
    <div aria-live="polite" className="semantic-inspector-loading" role="status">
      <span className="spinner" />
      <strong><UiText text="Загружаем данные запроса…" /></strong>
      <i />
      <i />
      <i />
    </div>
  );
}

function InspectorActionEmpty({
  action,
  icon,
  onAction,
  text,
  title
}: Readonly<{
  action: string;
  icon: IconName;
  onAction: () => void;
  text: string;
  title: string;
}>) {
  return (
    <div className="semantic-inspector-action-empty">
      <span><Icon name={icon} /></span>
      <strong><UiText text={title} /></strong>
      <p><UiText text={text} /></p>
      <button className="primary-button" onClick={onAction} type="button">
        <Icon name={icon} /><UiText text={action} />
      </button>
    </div>
  );
}

function latestObservedAt(
  items: readonly Readonly<{ observedAt: string }>[]
): string | undefined {
  return items.reduce<string | undefined>((latest, item) => {
    if (!latest) return item.observedAt;
    const candidate = Date.parse(item.observedAt);
    const current = Date.parse(latest);
    if (Number.isNaN(candidate)) return latest;
    return Number.isNaN(current) || candidate > current
      ? item.observedAt
      : latest;
  }, undefined);
}

function latestFrequencyByType(
  frequencies: readonly FrequencySnapshotSummary[]
): ReadonlyMap<FrequencySnapshotSummary["type"], FrequencySnapshotSummary> {
  const result = new Map<
    FrequencySnapshotSummary["type"],
    FrequencySnapshotSummary
  >();
  for (const frequency of frequencies) {
    if (!result.has(frequency.type)) result.set(frequency.type, frequency);
  }
  return result;
}

function rankHistoryByDate(
  points: readonly SemanticKeywordPositionHistoryPoint[]
): readonly RankHistoryDateRow[] {
  const rows = new Map<string, {
    observedAt: string;
    positions: Map<"GOOGLE" | "YANDEX", SemanticKeywordPositionHistoryPoint>;
  }>();
  for (const point of [...points].sort((left, right) =>
    Date.parse(right.observedAt) - Date.parse(left.observedAt)
  )) {
    const date = dateKey(point.observedAt);
    const row = rows.get(date) ?? {
      observedAt: point.observedAt,
      positions: new Map()
    };
    if (!row.positions.has(point.searchEngine)) {
      row.positions.set(point.searchEngine, point);
    }
    rows.set(date, row);
  }
  return [...rows.entries()]
    .map(([date, row]) => ({ date, ...row }))
    .sort((left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt)
    );
}

function dateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function historyPointTitle(point: SemanticKeywordPositionHistoryPoint, uiLocale: string = "ru-RU"): string {
  const status = point.found && point.position !== undefined
    ? `Позиция ${point.position}`
    : "Позиция не найдена";
  return `${status} · ${point.contextName} · ${formatDateTime(point.observedAt, uiLocale)}`;
}

function visibleGroupPath(groupPath: string | undefined): string {
  if (!groupPath || groupPath.startsWith("__system__/")) return "Без группы";
  return groupPath;
}

function frequencyTypeLabel(type: string): string {
  return { BASE: "Базовая", EXACT: "Фразовая", FIXED: "Точная" }[type] ?? type;
}

function frequencyDeviceLabel(device: string): string {
  return {
    ALL: "все устройства",
    DESKTOP: "десктоп",
    MOBILE: "мобильные",
    PHONE_ONLY: "телефоны",
    TABLET_ONLY: "планшеты"
  }[device] ?? device;
}

function frequencyRegionLabel(regionCode: string): string {
  return seoRegionDisplayName("WORDSTAT", regionCode);
}

function frequencyPeriodLabel(period: string): string {
  return period === "LAST_30_DAYS" ? "Последние 30 дней" : period;
}

function sameFrequencyContext(
  left: Pick<FrequencySnapshotSummary, "type" | "regionCode" | "device">,
  right: Pick<FrequencySnapshotSummary, "type" | "regionCode" | "device">
): boolean {
  return left.type === right.type &&
    left.regionCode === right.regionCode &&
    left.device === right.device;
}

function formatInteger(value: string, uiLocale: string = "ru-RU"): string {
  const number = Number(value);
  return Number.isSafeInteger(number) ? new Intl.NumberFormat(uiLocale).format(number) : value;
}

function insightError(error: unknown): string {
  return error instanceof BrowserApiError ? error.message : "Не удалось загрузить частотность и позиции.";
}

function noteError(error: unknown): string {
  if (error instanceof BrowserApiError && error.status === 412) {
    return "Запрос изменился в другой вкладке. Закройте панель, откройте её снова и повторите сохранение.";
  }
  return error instanceof BrowserApiError ? error.message : "Не удалось сохранить заметку.";
}

function trackingError(error: unknown): string {
  if (error instanceof BrowserApiError && error.status === 412) {
    return "Запрос уже изменился. Откройте его заново и повторите действие.";
  }
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось изменить отслеживание.";
}

function targetUrlMutationError(error: unknown): string {
  if (error instanceof BrowserApiError && error.status === 412) {
    return "Запрос изменился в другой вкладке. Закройте карточку, откройте её снова и повторите сохранение.";
  }
  if (error instanceof BrowserApiError && error.status === 400) {
    return "Укажите корректный абсолютный URL с http:// или https:// без логина и пароля.";
  }
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось сохранить целевой URL.";
}

function frequencyDeletionError(error: unknown): string {
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось удалить частотность. Повторите попытку.";
}

function intentLabel(intent: SemanticKeywordIntent | undefined): string {
  const labels: Readonly<Record<SemanticKeywordIntent, string>> = {
    INFORMATIONAL: "Информационный",
    NAVIGATIONAL: "Навигационный",
    COMMERCIAL: "Коммерческий",
    TRANSACTIONAL: "Транзакционный",
    LOCAL: "Локальный",
    MIXED: "Смешанный"
  };
  return intent ? labels[intent] : "Не определён";
}

function sourceLabel(source: SemanticKeywordInspectorItem["sourceMode"]): string {
  return { BYOK: "Свой API", PLATFORM: "Платформа", IMPORT: "Импорт", MANUAL: "Вручную" }[source];
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(date);
}

function rankDimensionPreferenceKey(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  preference: InspectorDimensionPreference
): string {
  if (preference !== "SEO_POSITIONS") {
    return `seonorita:semantic-inspector-dimension:v1:${preference}:${currentUserId}:${projectId}:${viewScope}`;
  }
  return `seonorita:semantic-rank-dimension:v1:${currentUserId}:${projectId}:${viewScope}`;
}

function inspectorViewPreferenceKey(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  preference: "TAB" | "MODE"
): string {
  return `seonorita:semantic-inspector-view:v1:${preference}:${currentUserId}:${projectId}:${viewScope}`;
}

function readInspectorTabPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string
): SemanticKeywordInspectorTab {
  try {
    const value = localStorage.getItem(
      inspectorViewPreferenceKey(currentUserId, projectId, viewScope, "TAB")
    );
    return value === "OVERVIEW" ||
      value === "POSITIONS" ||
      value === "SERP" ||
      value === "WORDSTAT" ||
      value === "PAGE" ||
      value === "NOTE"
      ? value
      : "OVERVIEW";
  } catch {
    return "OVERVIEW";
  }
}

function readInspectorModePreference(
  currentUserId: string,
  projectId: string,
  viewScope: string
): SemanticKeywordInspectorMode {
  try {
    return localStorage.getItem(
      inspectorViewPreferenceKey(currentUserId, projectId, viewScope, "MODE")
    ) === "AI"
      ? "AI"
      : "SEARCH";
  } catch {
    return "SEARCH";
  }
}

function writeInspectorViewPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  preference: "TAB" | "MODE",
  value: SemanticKeywordInspectorTab | SemanticKeywordInspectorMode
): void {
  try {
    localStorage.setItem(
      inspectorViewPreferenceKey(
        currentUserId,
        projectId,
        viewScope,
        preference
      ),
      value
    );
  } catch {
    // Browser storage is optional; the current sidebar keeps its local state.
  }
}

function readRankDimensionPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  preference: InspectorDimensionPreference
): string {
  try {
    return localStorage.getItem(
      rankDimensionPreferenceKey(
        currentUserId,
        projectId,
        viewScope,
        preference
      )
    ) ?? "";
  } catch {
    return "";
  }
}

function writeRankDimensionPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  dimensionKey: string,
  preference: InspectorDimensionPreference
): void {
  try {
    localStorage.setItem(
      rankDimensionPreferenceKey(
        currentUserId,
        projectId,
        viewScope,
        preference
      ),
      dimensionKey
    );
  } catch {
    // Browser storage is optional; the current sidebar keeps its local state.
  }
}
