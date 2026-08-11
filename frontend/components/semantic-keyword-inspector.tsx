"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  SemanticKeywordCompetitorSnapshot,
  SemanticKeywordInsights,
  SemanticKeywordListItem,
  SemanticKeywordPositionHistoryPoint
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel
} from "../lib/semantic-rank-presentation";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import { SearchEngineLogo } from "./search-engine-logo";
import { ProviderLogo } from "./provider-logo";
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
  onUpdated,
  projectId
}: Readonly<{
  item: SemanticKeywordInspectorItem;
  onClose: () => void;
  onEdit: () => void;
  onUpdated: (item: SemanticKeywordListItem) => void;
  projectId: string;
}>) {
  const [insights, setInsights] = useState<SemanticKeywordInsights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string>();
  const [expandedCompetitorSnapshots, setExpandedCompetitorSnapshots] =
    useState<ReadonlySet<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
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
    setExpandedCompetitorSnapshots(new Set());
    setHistoryOpen(false);
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
  const primaryHistory = useMemo(() => {
    const points = insights?.positionHistory ?? [];
    const contextIds = primaryRankContextIds(points);
    return points.filter(({ searchEngine, trackingContextId }) =>
      contextIds.get(searchEngine) === trackingContextId
    );
  }, [insights]);
  const positionChanges = useMemo(
    () => rankHistoryByDate(primaryHistory),
    [primaryHistory]
  );
  const competitorSnapshots = insights?.competitorSnapshots ?? [];
  const targetMismatches = useMemo(
    () => item.targetUrl
      ? [...primaryPositions.values()].flatMap((position) =>
          position.found &&
          position.rankingUrl &&
          !sameRankingUrl(item.targetUrl!, position.rankingUrl)
            ? [{
                engine: position.searchEngine,
                rankingUrl: position.rankingUrl
              }]
            : []
        )
      : [],
    [item.targetUrl, primaryPositions]
  );

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
          <strong>Целевая страница</strong>
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
              </div>
            ))}
          </div>
        ) : (
          <InspectorEmpty title="Нет актуального среза" text="Запустите сбор частотности по этому запросу." />
        )}
      </section>

      <section className="semantic-inspector-ranks">
        <h3>Позиции</h3>
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
                  ) : lostDescription ? (
                    <small className="declined">{position?.previousPosition === undefined ? "Не найдена" : `Была ${position.previousPosition}`}</small>
                  ) : <small>Нет данных</small>}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="semantic-inspector-muted">Загружаем позиции…</span>
        )}
        <SemanticRankHistoryChart points={insights?.positionHistory ?? []} />
        {positionChanges.length > 0 && (
          <div className="semantic-rank-change-history">
            <header>
              <strong>Изменения позиций</strong>
              {positionChanges.length > 5 && (
                <button onClick={() => setHistoryOpen(true)} type="button">
                  Показать все
                </button>
              )}
            </header>
            <RankChangeRows rows={positionChanges.slice(0, 5)} />
          </div>
        )}
      </section>

      {error && <div className="inline-alert danger" role="alert">{error}</div>}

      {competitorSnapshots.map((snapshot) => {
        const expanded = expandedCompetitorSnapshots.has(snapshot.snapshotId);
        const visibleResults = expanded
          ? snapshot.results
          : snapshot.results.slice(0, 5);
        return (
          <section
            className="semantic-competitor-snapshot"
            key={snapshot.snapshotId}
          >
            <header>
              <div>
                <h3>Топ конкурентов ({rankEngineLabel(snapshot.searchEngine)})</h3>
                <small>
                  {competitorSourceLabel(snapshot)} · {formatDateTime(snapshot.observedAt)}
                </small>
              </div>
              <ProviderLogo provider={snapshot.provider} size="compact" />
            </header>
            <ol>
              {visibleResults.map((result) => (
                <li key={`${snapshot.snapshotId}:${result.position}`}>
                  <span>{result.position}</span>
                  <div className="semantic-competitor-result">
                    <strong>{urlHost(result.url)}</strong>
                    <small>{shortUrl(result.url)}</small>
                    <a
                      aria-label={`Открыть результат ${result.position}: ${urlHost(result.url)}`}
                      href={result.url}
                      rel="noopener noreferrer"
                      target="_blank"
                      title={result.title ?? result.url}
                    >
                      <span className="visually-hidden">Открыть результат</span>
                    </a>
                  </div>
                </li>
              ))}
            </ol>
            {snapshot.results.length > 5 && (
              <button
                className="semantic-competitor-toggle"
                onClick={() =>
                  setExpandedCompetitorSnapshots((current) =>
                    toggleSetValue(current, snapshot.snapshotId)
                  )
                }
                type="button"
              >
                {expanded ? "Скрыть" : "Показать все"}
              </button>
            )}
          </section>
        );
      })}

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
        <SemanticModal
          description="Все сохранённые даты для текущих поисковых контекстов. Крестик означает, что позиция в глубине проверки не найдена."
          onClose={() => setHistoryOpen(false)}
          size="medium"
          title={`История позиций · ${item.textOriginal}`}
        >
          <div className="semantic-rank-history-modal">
            <RankChangeRows rows={positionChanges} />
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
      : {})
  };
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

function sameRankingUrl(targetUrl: string, rankingUrl: string): boolean {
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./u, "");
      const path = decodeURIComponent(url.pathname)
        .replace(/\/{2,}/gu, "/")
        .replace(/\/$/u, "") || "/";
      return `${host}${path}`.toLocaleLowerCase("en");
    };
    return normalize(targetUrl) === normalize(rankingUrl);
  } catch {
    return targetUrl.trim() === rankingUrl.trim();
  }
}

function competitorSourceLabel(snapshot: SemanticKeywordCompetitorSnapshot): string {
  const source = snapshot.searchEngine === "YANDEX"
    ? snapshot.searchSource === "LIVE"
      ? "Яндекс Live"
      : snapshot.searchSource === "SEARCH_API"
        ? "Яндекс XML"
        : "Яндекс"
    : snapshot.searchSource === "LIVE" ? "Google Live" : "Google";
  return `${source} · XMLStock`;
}

function historyPointTitle(point: SemanticKeywordPositionHistoryPoint): string {
  const status = point.found && point.position !== undefined
    ? `Позиция ${point.position}`
    : "Позиция не найдена";
  return `${status} · ${point.contextName} · ${formatDateTime(point.observedAt)}`;
}

function urlHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return value;
  }
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const suffix = `${url.pathname}${url.search}`;
    return suffix.length > 54 ? `${suffix.slice(0, 51)}…` : suffix || "/";
  } catch {
    return value.length > 54 ? `${value.slice(0, 51)}…` : value;
  }
}

function toggleSetValue(
  current: ReadonlySet<string>,
  value: string
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
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
