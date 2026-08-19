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
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel,
  sameSemanticRankingUrl
} from "../lib/semantic-rank-presentation";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import { Icon } from "./icon";
import { SearchEngineLogo } from "./search-engine-logo";
import { SemanticCompetitorSnapshots } from "./semantic-competitor-snapshots";
import { SemanticKeywordPositionHistoryModal } from "./semantic-keyword-position-history-modal";
import { SemanticKeywordAiPositionHistoryModal } from "./semantic-keyword-ai-position-history-modal";
import { SemanticModal } from "./semantic-modal";
import { SemanticRankHistoryChart } from "./semantic-rank-history-chart";

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
  item,
  onClose,
  onEdit,
  onFrequencyDeleted,
  onOpenAiAnswer,
  onUpdated,
  projectDomain,
  projectId
}: Readonly<{
  item: SemanticKeywordInspectorItem;
  onClose: () => void;
  onEdit: () => void;
  onFrequencyDeleted: () => void;
  onOpenAiAnswer: () => void;
  onUpdated: (item: SemanticKeywordListItem) => void;
  projectDomain: string;
  projectId: string;
}>) {
  const [insights, setInsights] = useState<SemanticKeywordInsights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiHistoryOpen, setAiHistoryOpen] = useState(false);
  const [frequencyToDelete, setFrequencyToDelete] =
    useState<FrequencySnapshotSummary>();
  const [deletingFrequency, setDeletingFrequency] = useState(false);
  const [frequencyDeleteError, setFrequencyDeleteError] = useState<string>();
  const [targetUrlCopied, setTargetUrlCopied] = useState(false);
  const noteDirtyRef = useRef(false);

  useEffect(() => {
    noteDirtyRef.current = noteDirty;
  }, [noteDirty]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setNote("");
    setNoteDirty(false);
    setNoteStatus(undefined);
    setHistoryOpen(false);
    setAiHistoryOpen(false);
    setFrequencyToDelete(undefined);
    setDeletingFrequency(false);
    setFrequencyDeleteError(undefined);
    setTargetUrlCopied(false);
    const load = () => {
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
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [item.id, projectId]);

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
    () => latestSemanticRankHistory(insights?.positionHistory ?? []),
    [insights]
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
      item.aiAnswers ?? []
    ),
    [insights, item.aiAnswers]
  );
  const positionChanges = useMemo(
    () => rankHistoryByDate(visibleHistory),
    [visibleHistory]
  );
  const competitorSnapshots = insights?.competitorSnapshots ?? [];
  const aiCompetitorSnapshots = insights?.aiCompetitorSnapshots ?? [];
  const targetMismatches = useMemo(
    () => item.targetUrl
      ? [...primaryPositions.values()].flatMap((position) =>
          position.found &&
          position.rankingUrl &&
          !sameSemanticRankingUrl(item.targetUrl!, position.rankingUrl)
            ? [{
                engine: position.searchEngine,
                rankingUrl: position.rankingUrl
              }]
            : []
        )
      : [],
    [item.targetUrl, primaryPositions]
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

  return (
    <aside aria-label={`Детали запроса ${item.textOriginal}`} className="semantic-keyword-inspector">
      <header>
        <div>
          <span>Запрос</span>
          <strong>{item.textOriginal}</strong>
          <small>ID: {item.id.slice(0, 8)}</small>
        </div>
        <div className="semantic-sidebar-actions">
          {!item.trashed && (
            <button className="semantic-sidebar-edit" onClick={onEdit} type="button">
              Изменить
            </button>
          )}
          <button aria-label="Закрыть детали" onClick={onClose} type="button">×</button>
        </div>
      </header>

      <section className="semantic-inspector-overview">
        <h3>Обзор</h3>
        <dl>
          <div><dt>Интент</dt><dd><span className="semantic-intent-chip">{intentLabel(item.intent)}</span></dd></div>
          <div><dt>Группа</dt><dd>{visibleGroupPath(item.groupPath)}</dd></div>
          <div><dt>Кластер</dt><dd>{item.clusterName ?? "Не назначен"}</dd></div>
          <div><dt>Язык</dt><dd>{item.language.toUpperCase()}</dd></div>
          <div className="semantic-inspector-overview-tags">
            <dt>Теги</dt>
            <dd>
              <span className="semantic-inspector-tags">
                {item.tags.length > 0
                  ? item.tags.map((tag) => <span key={tag}>{tag}</span>)
                  : <span>Нет тегов</span>}
              </span>
            </dd>
          </div>
        </dl>
        <div className="semantic-inspector-target-url">
          <div className="semantic-inspector-target-url-heading">
            <strong>Целевая страница</strong>
            {item.targetUrl && (
              <button
                aria-label={targetUrlCopied ? "URL скопирован" : "Скопировать целевой URL"}
                className={targetUrlCopied ? "copied" : undefined}
                onClick={() => void copyTargetUrl()}
                title={targetUrlCopied ? "URL скопирован" : "Скопировать URL"}
                type="button"
              >
                <Icon name={targetUrlCopied ? "checkDouble" : "copy"} />
              </button>
            )}
          </div>
          {item.targetUrl ? (
            <a href={item.targetUrl} rel="noopener noreferrer" target="_blank">{item.targetUrl}</a>
          ) : (
            <span className="semantic-inspector-muted">Не назначена</span>
          )}
          {targetMismatches.length > 0 && (
            <div className="semantic-target-url-warning" role="status">
              <strong>URL не совпадает с найденной страницей</strong>
              {targetMismatches.map(({ engine, rankingUrl }) => (
                <a
                  href={rankingUrl}
                  key={`${engine}:${rankingUrl}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <SearchEngineLogo engine={engine} size="compact" />
                  <span>{rankingUrl}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="semantic-inspector-ranks">
        <header className="semantic-inspector-section-heading">
          <h3>Позиции</h3>
          <button onClick={() => setHistoryOpen(true)} type="button">
            <Icon name="history" />
            История
          </button>
        </header>
        {!loading ? (
          <div className="semantic-current-ranks">
            {(["YANDEX", "GOOGLE"] as const).map((engine) => {
              const position = primaryPositions.get(engine);
              const change = position?.position === undefined
                ? undefined
                : rankChangePresentation(
                    position.position,
                    position.previousPosition
                  );
              const lostDescription = position && !position.found
                ? position.previousPosition === undefined
                  ? "Позиция не найдена"
                  : `Позиция не найдена. Была ${position.previousPosition}`
                : undefined;
              return (
                <div key={engine}>
                  <span>
                    <SearchEngineLogo engine={engine} size="compact" />
                    <span>{rankEngineLabel(engine)}</span>
                  </span>
                  <strong aria-label={change?.ariaLabel ?? lostDescription} className={!position?.found && position ? "lost" : undefined} title={change?.title ?? lostDescription}>
                    {position ? (position.found ? position.position ?? "—" : "×") : "—"}
                  </strong>
                  {change ? (
                    <small className={change.tone} title={change.title}>{change.label}</small>
                  ) : position?.previousPosition !== undefined ? (
                    <small className="declined" title={`Предыдущая позиция: ${position.previousPosition}`}>←{position.previousPosition}</small>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="semantic-inspector-muted">Загружаем позиции…</span>
        )}
        <div className="semantic-normal-rank-chart">
          <SemanticRankHistoryChart points={visibleHistory} />
        </div>
        {positionChanges.length > 0 && (
          <div className="semantic-rank-change-history">
            <header>
              <strong>Изменения позиций</strong>
            </header>
            <RankChangeRows rows={positionChanges.slice(0, 5)} />
          </div>
        )}
        <div className="semantic-inspector-ai-ranks">
          <header>
            <span>
              <Icon name="ai" />
              ИИ-позиции
            </span>
            <div>
              {hasSavedAiAnswer && (
                <button onClick={onOpenAiAnswer} type="button">
                  Открыть ответ
                </button>
              )}
              {(insights?.aiPositionHistory?.length ?? 0) > 0 && (
                <button onClick={() => setAiHistoryOpen(true)} type="button">
                  <Icon name="history" />
                  История
                </button>
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
                    <span>{rankEngineLabel(engine)}</span>
                  </span>
                  <strong
                    className={aiAnswerValueTone(answer)}
                    title={aiAnswerDescription(answer)}
                  >
                    {aiAnswerValue(answer)}
                  </strong>
                  <small
                    className={change?.tone ?? (lost ? "declined" : undefined)}
                    title={answer ? `${aiAnswerDescription(answer)} · ${formatDateTime(answer.observedAt)}` : "ИИ-позиции ещё не проверялись"}
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
        </div>
      </section>

      {error && <div className="inline-alert danger" role="alert">{error}</div>}

      <SemanticCompetitorSnapshots
        projectDomain={projectDomain}
        showEmpty={!loading}
        snapshots={competitorSnapshots}
      />
      <SemanticCompetitorSnapshots
        emptyText="После первого ИИ-съёма с источниками здесь появятся сайты, на которые ссылается ИИ-ответ."
        emptyTitle="Источники ИИ-ответов ещё не сохранены"
        heading="Топ конкурентов ИИ"
        projectDomain={projectDomain}
        showEmpty={false}
        snapshots={aiCompetitorSnapshots}
      />

      <section>
        <h3>Частотность</h3>
        {loading ? (
          <span className="semantic-inspector-muted">Загружаем срезы…</span>
        ) : latestFrequencies.length > 0 ? (
          <div className="semantic-frequency-list">
            {latestFrequencies.map((frequency) => (
              <div className="semantic-frequency-row" key={`${frequency.type}:${frequency.regionCode}:${frequency.device}`}>
                <div className="semantic-frequency-context">
                  <SearchEngineLogo engine="YANDEX" size="compact" />
                  <span>{frequencyTypeLabel(frequency.type)}</span>
                  <small>{frequency.regionCode} · {frequencyDeviceLabel(frequency.device)}</small>
                </div>
                <div className="semantic-frequency-value">
                  <strong>{frequency.value ? formatInteger(frequency.value) : "—"}</strong>
                  <small>{frequency.period ? `${frequency.period} · ` : ""}{formatDateTime(frequency.observedAt)}</small>
                </div>
                {!item.trashed && (
                  <button
                    aria-label={`Удалить частотность «${frequencyTypeLabel(frequency.type)}»`}
                    className="semantic-frequency-delete"
                    disabled={deletingFrequency}
                    onClick={() => {
                      setFrequencyDeleteError(undefined);
                      setFrequencyToDelete(frequency);
                    }}
                    title="Удалить частотность"
                    type="button"
                  >
                    <Icon name="trash" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <InspectorEmpty title="Нет актуального среза" text="Запустите сбор частотности по этому запросу." />
        )}
      </section>

      <section className="semantic-keyword-note">
        <h3>Заметка</h3>
        <form onSubmit={(event) => void saveNote(event)}>
          <textarea
            disabled={item.trashed || savingNote}
            maxLength={4_000}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteDirty(true);
              setNoteStatus(undefined);
            }}
            placeholder="Добавьте контекст, гипотезу или задачу по запросу…"
            rows={5}
            value={note}
          />
          <div>
            <small>{note.length.toLocaleString("ru-RU")} / 4 000</small>
            {!item.trashed && (
              <button className="secondary-button" disabled={!noteDirty || savingNote} type="submit">
                {savingNote ? "Сохраняем…" : "Сохранить"}
              </button>
            )}
          </div>
          {noteStatus && <p aria-live="polite">{noteStatus}</p>}
        </form>
      </section>

      <section className="semantic-inspector-dates">
        <small>Создан: {formatDateTime(item.createdAt)}</small>
        <small>Обновлён: {formatDateTime(item.updatedAt)}</small>
        <small>Источник: {sourceLabel(item.sourceMode)}</small>
      </section>
      {historyOpen && (
        <SemanticKeywordPositionHistoryModal
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
          keywordId={item.id}
          keywordText={item.textOriginal}
          onClose={() => setAiHistoryOpen(false)}
          projectId={projectId}
        />
      )}
      {frequencyToDelete && (
        <SemanticModal
          description="Удаление применяется только к выбранному запросу."
          onClose={deletingFrequency
            ? () => undefined
            : () => {
                setFrequencyToDelete(undefined);
                setFrequencyDeleteError(undefined);
              }}
          size="small"
          title="Удалить частотность?"
        >
          <div className="semantic-confirm-dialog semantic-frequency-delete-dialog">
            <div className="inline-alert danger" role="alert">
              Все сохранённые срезы «{frequencyTypeLabel(frequencyToDelete.type)}»
              для региона {frequencyToDelete.regionCode} и устройства «{frequencyDeviceLabel(frequencyToDelete.device)}»
              будут удалены без возможности восстановления.
            </div>
            <div className="semantic-frequency-delete-summary">
              <span>{frequencyTypeLabel(frequencyToDelete.type)}</span>
              <strong>{frequencyToDelete.value ? formatInteger(frequencyToDelete.value) : "—"}</strong>
              <small>{formatDateTime(frequencyToDelete.observedAt)}</small>
            </div>
            {frequencyDeleteError && (
              <div className="inline-alert danger" role="alert">
                {frequencyDeleteError}
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
                Отмена
              </button>
              <button
                className="danger-button"
                disabled={deletingFrequency}
                onClick={() => void deleteFrequencyContext()}
                type="button"
              >
                {deletingFrequency ? "Удаляем…" : "Удалить"}
              </button>
            </div>
          </div>
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
  return (
    <div className="semantic-rank-change-rows">
      {rows.map((row) => (
        <div key={row.date}>
          <time dateTime={row.observedAt}>{formatDate(row.observedAt)}</time>
          {(["YANDEX", "GOOGLE"] as const).map((engine) => {
            const point = row.positions.get(engine);
            return (
              <span
                className={!point ? "empty" : point.found ? undefined : "lost"}
                key={engine}
                title={point ? historyPointTitle(point) : "В этот день замера не было"}
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

function historyPointTitle(point: SemanticKeywordPositionHistoryPoint): string {
  const status = point.found && point.position !== undefined
    ? `Позиция ${point.position}`
    : "Позиция не найдена";
  return `${status} · ${point.contextName} · ${formatDateTime(point.observedAt)}`;
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

function sameFrequencyContext(
  left: Pick<FrequencySnapshotSummary, "type" | "regionCode" | "device">,
  right: Pick<FrequencySnapshotSummary, "type" | "regionCode" | "device">
): boolean {
  return left.type === right.type &&
    left.regionCode === right.regionCode &&
    left.device === right.device;
}

function formatInteger(value: string): string {
  const number = Number(value);
  return Number.isSafeInteger(number) ? new Intl.NumberFormat("ru-RU").format(number) : value;
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

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(date);
}
