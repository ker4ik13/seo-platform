"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  SemanticKeywordInsights,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  primaryRankContextIds,
  rankChangePresentation,
  rankEngineLabel
} from "../lib/semantic-rank-presentation";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import { SearchEngineLogo } from "./search-engine-logo";
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
        </dl>
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
      </section>

      {error && <div className="inline-alert danger" role="alert">{error}</div>}

      <section>
        <h3>Целевая страница</h3>
        {item.targetUrl ? (
          <a href={item.targetUrl} rel="noopener noreferrer" target="_blank">{item.targetUrl}</a>
        ) : (
          <span className="semantic-inspector-muted">Не назначена</span>
        )}
      </section>

      <section>
        <h3>Теги</h3>
        <div className="semantic-inspector-tags">
          {item.tags.length > 0
            ? item.tags.map((tag) => <span key={tag}>{tag}</span>)
            : <span>Нет тегов</span>}
        </div>
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
    positionHistory: insights.positionHistory
  };
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
