"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  FrequencySnapshotSummary,
  SemanticAiAnswerHistoryItem,
  SemanticAiAnswerSummary,
  SemanticKeywordInsights,
  SemanticKeywordListItem,
  SemanticKeywordPositionHistoryPoint
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  latestSemanticRankHistory,
  normalizeSemanticTargetUrlInput,
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel,
  sameSemanticRankingUrl
} from "../lib/semantic-rank-presentation";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import { seoRegionOptions } from "../lib/seo-regions";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SemanticKeywordPositionHistoryModal } from "./semantic-keyword-position-history-modal";
import { SemanticKeywordRegionalRanks } from "./semantic-keyword-regional-ranks";
import { SemanticKeywordSerpHistory } from "./semantic-keyword-serp-history";
import { SemanticKeywordAiPositionHistoryModal } from "./semantic-keyword-ai-position-history-modal";
import { SemanticModal } from "./semantic-modal";
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

export function SemanticKeywordInspector({
  currentUserId,
  item,
  onClose,
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
  const noteDirtyRef = useRef(false);
  const rankDimensionRef = useRef(rankDimensionKey);
  rankDimensionRef.current = rankDimensionKey;
  const priorRankDimension = useRef(rankDimensionKey);
  const reloadInsights = useRef<(() => void) | undefined>(undefined);
  const presenceKeyPrefix = `semantic-keyword-inspector:${item.id}`;

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);
  useEffect(() => {
    setRankDimensionKey(readRankDimensionPreference(
      currentUserId,
      projectId,
      rankDimensionPreferenceScope
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
        key
      );
    }
  }

  function fallbackRankDimension(key: string): void {
    setRankDimensionKey(key);
  }

  useEffect(() => {
    const controller = new AbortController();
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
    const load = () => {
      const requestedDimension = rankDimensionRef.current;
      void browserApiRequest<SemanticKeywordInsights>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}/insights${requestedDimension ? `?dimensionKey=${encodeURIComponent(requestedDimension)}` : ""}`,
        { signal: controller.signal }
      )
        .then((result) => {
          if (controller.signal.aborted || requestedDimension !== rankDimensionRef.current) return;
          setInsights(result);
          if (!noteDirtyRef.current) setNote(result.note ?? "");
          setError(undefined);
        })
        .catch((requestError) => {
          if (!controller.signal.aborted && requestedDimension === rankDimensionRef.current) setError(insightError(requestError));
        })
        .finally(() => {
          if (!controller.signal.aborted && requestedDimension === rankDimensionRef.current) setLoading(false);
        });
    };
    reloadInsights.current = load;
    load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item.id, item.targetUrl, projectId]);
  useEffect(() => {
    if (priorRankDimension.current === rankDimensionKey) return;
    priorRankDimension.current = rankDimensionKey;
    setLoading(true);
    reloadInsights.current?.();
  }, [rankDimensionKey]);

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
  const aiChartHistory = useMemo(
    () => latestSemanticRankHistory(
      aiHistoryChartPoints(insights?.aiPositionHistory ?? [])
    ),
    [insights]
  );
  const currentAiAnswers = useMemo(
    () => latestAiAnswerSummaries(
      insights?.aiPositionHistory ?? [],
      rankDimensionKey ? [] : item.aiAnswers ?? []
    ),
    [insights, item.aiAnswers, rankDimensionKey]
  );
  const positionChanges = useMemo(
    () => rankHistoryByDate(visibleHistory),
    [visibleHistory]
  );
  const competitorSnapshots = insights?.competitorSnapshots ?? [];
  const aiCompetitorSnapshots = insights?.aiCompetitorSnapshots ?? [];
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
          ...currentAiAnswers.flatMap((answer) =>
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
    [currentAiAnswers, item.targetUrl, primaryPositions]
  );
  const hasSavedAiAnswer = currentAiAnswers.length > 0;

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

  return (
    <aside
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
          <button aria-label={uiText("Закрыть детали")} onClick={onClose} type="button">×</button>
        </div>
      </header>

      <section
        className="semantic-inspector-overview"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:overview`}
      >
        <h3><UiText text="Обзор" /></h3>
        <dl>
          <div><dt><UiText text="Интент" /></dt><dd><span className="semantic-intent-chip">{<UiText text={intentLabel(item.intent) ?? ""} />}</span></dd></div>
          <div><dt><UiText text="Группа" /></dt><dd>{visibleGroupPath(item.groupPath)}</dd></div>
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
      </section>

      <section
        className="semantic-inspector-ranks"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:ranks`}
      >
        <SemanticKeywordRegionalRanks projectId={projectId} keywordId={item.id} dimensionKey={rankDimensionKey} onDimensionChange={selectRankDimension} onDimensionFallback={fallbackRankDimension} onHistory={() => setHistoryOpen(true)} revision={(insights?.positions ?? []).map(position => position.observedAt).join(":")} />
        {rankDimensionKey && !loading && <>
        <div className="semantic-normal-rank-chart">
          <SemanticRankHistoryChart points={visibleHistory} />
        </div>
        {positionChanges.length > 0 && (
          <div className="semantic-rank-change-history">
            <header>
              <strong><UiText text="Изменения позиций" /></strong>
            </header>
            <RankChangeRows rows={positionChanges.slice(0, 5)} />
          </div>
        )}
        </>}
        <SemanticCompetitorSnapshots
          presenceKeyPrefix={`${presenceKeyPrefix}:competitors`}
          projectDomain={projectDomain}
          showEmpty={!loading}
          snapshots={competitorSnapshots}
        />
        <button
          className="secondary-button semantic-serp-history-button"
          disabled={!rankDimensionKey}
          onClick={() => setSerpHistoryOpen(true)}
          type="button"
        >
          <Icon name="history" /><UiText text="История выдачи и конкурентов" />
        </button>
        {hasAnyAiSnapshot && (
        <div className="semantic-inspector-ai-ranks">
          <header>
            <span>
              <Icon name="ai" />
              <UiText text="ИИ-позиции" /></span>
            <div>
              {hasSavedAiAnswer && (
                <button onClick={() => onOpenAiAnswer(rankDimensionKey || undefined)} type="button">
                  <UiText text="Открыть ответ" /></button>
              )}
            </div>
          </header>
          <div className="semantic-current-ranks semantic-current-ai-ranks">
            {(["YANDEX", "GOOGLE"] as const).map((engine) => {
              const answer = currentAiAnswers.find(
                (candidate) => candidate.searchEngine === engine
              );
              const change = answer?.siteFound && answer.position !== undefined
                ? rankChangePresentation(answer.position, answer.previousPosition)
                : undefined;
              const lost = answer && !answer.siteFound && answer.previousPosition !== undefined
                ? `Была ${answer.previousPosition}`
                : undefined;
              return (
                <div key={engine}>
                  <span>
                    <SearchEngineLogo engine={engine} size="compact" />
                    <span>{<UiText text={rankEngineLabel(engine) ?? ""} />}</span>
                  </span>
                  <strong
                    className={aiAnswerValueTone(answer)}
                    title={aiAnswerDescription(answer)}
                  >
                    {aiAnswerValue(answer)}
                  </strong>
                  <small
                    className={change?.tone ?? (lost ? "declined" : undefined)}
                    title={answer ? `${aiAnswerDescription(answer)} · ${formatDateTime(answer.observedAt, uiLocale)}` : uiText("ИИ-позиции ещё не проверялись")}
                  >
                    {change?.label ?? (answer?.previousPosition !== undefined
                      ? `←${answer.previousPosition}`
                      : "")}
                  </small>
                </div>
              );
            })}
          </div>
          {aiChartHistory.length > 0 && (
            <div className="semantic-ai-rank-chart">
              <SemanticRankHistoryChart points={aiChartHistory} />
            </div>
          )}
          <SemanticCompetitorSnapshots
            emptyText="После первого ИИ-съёма с источниками здесь появятся сайты, на которые ссылается ИИ-ответ."
            emptyTitle="Источники ИИ-ответов ещё не сохранены"
            heading="Топ конкурентов ИИ"
            presenceKeyPrefix={`${presenceKeyPrefix}:ai-competitors`}
            projectDomain={projectDomain}
            showEmpty={!loading}
            snapshots={aiCompetitorSnapshots}
          />
          <button
            className="secondary-button semantic-serp-history-button"
            disabled={(insights?.aiPositionHistory?.length ?? 0) === 0}
            onClick={() => setAiHistoryOpen(true)}
            type="button"
          >
            <Icon name="history" /><UiText text="История ИИ-выдачи и конкурентов" />
          </button>
        </div>
        )}
      </section>

      {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}

      <section
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:frequency`}
      >
        <h3><UiText text="Частотность" /></h3>
        {loading ? (
          <span className="semantic-inspector-muted"><UiText text="Загружаем срезы…" /></span>
        ) : latestFrequencies.length > 0 ? (
          <div className="semantic-frequency-list">
            {latestFrequencies.map((frequency) => (
              <div className="semantic-frequency-row" key={`${frequency.type}:${frequency.regionCode}:${frequency.device}`}>
                <div className="semantic-frequency-context">
                  <SearchEngineLogo engine="YANDEX" size="compact" />
                  <span>{<UiText text={frequencyTypeLabel(frequency.type) ?? ""} />}</span>
                  <small><UiText text={frequencyRegionLabel(frequency.regionCode)} /> · {<UiText text={frequencyDeviceLabel(frequency.device) ?? ""} />}</small>
                </div>
                <div className="semantic-frequency-value">
                  <strong>{frequency.value ? formatInteger(frequency.value, uiLocale) : "—"}</strong>
                  <small>{frequency.period ? <><UiText text={frequencyPeriodLabel(frequency.period)} after=" · " /></> : null}{formatDateTime(frequency.observedAt, uiLocale)}</small>
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
        ) : (
          <InspectorEmpty title={uiText("Нет актуального среза")} text="Запустите сбор частотности по этому запросу." />
        )}
      </section>

      <section
        className="semantic-inspector-seasonality"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:seasonality`}
      >
        <h3><UiText text="Сезонность" /></h3>
        {loading ? (
          <span className="semantic-inspector-muted"><UiText text="Загружаем динамику…" /></span>
        ) : (insights?.seasonality?.length ?? 0) > 0 ? (
          <SemanticSeasonalityCharts points={insights?.seasonality ?? []} />
        ) : (
          <InspectorEmpty title={uiText("Сезонность ещё не собрана")} text="Запустите сбор истории Wordstat для этого запроса." />
        )}
      </section>

      <section
        className="semantic-keyword-note"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:note`}
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
            rows={5}
            value={note}
          />
          <div>
            <small><UiText text="Символов:" after=" " />{note.length.toLocaleString(uiLocale)}</small>
            {!item.trashed && (
              <button className="secondary-button" disabled={!noteDirty || savingNote} type="submit">
                {savingNote ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
              </button>
            )}
          </div>
          {noteStatus && <p aria-live="polite">{noteStatus}</p>}
        </form>
      </section>

      <section
        className="semantic-inspector-dates"
        data-presence-cursor-anchor="true"
        data-presence-key={`${presenceKeyPrefix}:dates`}
      >
        <small><UiText text="Создан:" after=" " />{formatDateTime(item.createdAt, uiLocale)}</small>
        <small><UiText text="Обновлён:" after=" " />{formatDateTime(item.updatedAt, uiLocale)}</small>
        <small><UiText text="Источник:" after=" " />{<UiText text={sourceLabel(item.sourceMode) ?? ""} />}</small>
      </section>
      {serpHistoryOpen && <SemanticKeywordSerpHistory currentUserId={currentUserId} projectId={projectId} keywordId={item.id} keywordText={item.textOriginal} createdAt={item.createdAt} projectDomain={projectDomain} dimensionKey={rankDimensionKey || undefined} onClose={() => setSerpHistoryOpen(false)} />}
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
          currentUserId={currentUserId}
          {...(rankDimensionKey ? { dimensionKey: rankDimensionKey } : {})}
          keywordId={item.id}
          keywordText={item.textOriginal}
          onClose={() => setAiHistoryOpen(false)}
          onOpenAiAnswer={() => onOpenAiAnswer(rankDimensionKey || undefined)}
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
              <UiText text="Все сохранённые срезы «" />{<UiText text={frequencyTypeLabel(frequencyToDelete.type) ?? ""} />}<UiText text="» для региона" after=" " />{frequencyToDelete.regionCode} <UiText text="и устройства «" before=" " />{<UiText text={frequencyDeviceLabel(frequencyToDelete.device) ?? ""} />}<UiText text="» будут удалены без возможности восстановления." /></div>
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
    </aside>
  );
}

function withoutNote(
  insights: SemanticKeywordInsights
): Omit<SemanticKeywordInsights, "note"> {
  return {
    keywordId: insights.keywordId,
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

function InspectorEmpty({ title, text }: Readonly<{ title: string; text: string }>) {
  return <div className="semantic-inspector-empty"><strong>{title}</strong><span>{text}</span></div>;
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
  if (regionCode === "ALL" || regionCode === "0") return "Все регионы";
  return seoRegionOptions("WORDSTAT").find(({ code }) => code === regionCode)?.label ?? regionCode;
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

type AiAnswerSummary = NonNullable<SemanticKeywordInspectorItem["aiAnswers"]>[number];

function aiAnswerValue(answer: AiAnswerSummary | undefined): string | number {
  if (!answer) return "—";
  if (!answer.answerPresent) return "—";
  if (!answer.siteFound || answer.position === undefined) return "×";
  return answer.position;
}

function aiAnswerValueTone(answer: AiAnswerSummary | undefined): string | undefined {
  if (!answer) return undefined;
  if (!answer.answerPresent) return "absent";
  if (!answer.siteFound || answer.position === undefined) return "missing";
  return "found";
}

function aiAnswerDescription(answer: AiAnswerSummary | undefined): string {
  if (!answer) return "ИИ-позиции ещё не проверялись";
  if (!answer.answerPresent) return "Проверка выполнена: ИИ-ответ не найден";
  if (!answer.siteFound) return "ИИ-ответ найден, но сайт отсутствует в источниках";
  return answer.rankingUrl
    ? `Сайт найден в источниках: ${answer.rankingUrl}`
    : "Сайт найден в источниках ИИ-ответа";
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
  viewScope: string
): string {
  return `seonorita:semantic-rank-dimension:v1:${currentUserId}:${projectId}:${viewScope}`;
}

function readRankDimensionPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string
): string {
  try {
    return localStorage.getItem(
      rankDimensionPreferenceKey(currentUserId, projectId, viewScope)
    ) ?? "";
  } catch {
    return "";
  }
}

function writeRankDimensionPreference(
  currentUserId: string,
  projectId: string,
  viewScope: string,
  dimensionKey: string
): void {
  try {
    localStorage.setItem(
      rankDimensionPreferenceKey(currentUserId, projectId, viewScope),
      dimensionKey
    );
  } catch {
    // Browser storage is optional; the current sidebar keeps its local state.
  }
}
