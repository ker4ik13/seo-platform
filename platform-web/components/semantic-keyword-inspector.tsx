"use client";

import { useEffect, useMemo, useState } from "react";
import type { SemanticKeywordInsights } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import type { SemanticKeywordIntent } from "./semantic-view-types";
import { SearchEngineLogo } from "./search-engine-logo";

export interface SemanticKeywordInspectorItem {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupPath?: string;
  readonly clusterName?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
  readonly trashed?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function SemanticKeywordInspector({
  item,
  onClose,
  onEdit,
  projectId
}: Readonly<{
  item: SemanticKeywordInspectorItem;
  onClose: () => void;
  onEdit: () => void;
  projectId: string;
}>) {
  const [insights, setInsights] = useState<SemanticKeywordInsights>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    const load = () => {
      void browserApiRequest<SemanticKeywordInsights>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/${encodeURIComponent(item.id)}/insights`,
        { signal: controller.signal }
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setInsights(result);
            setError(undefined);
          }
        })
        .catch((requestError) => {
          if (!controller.signal.aborted) setError(insightError(requestError));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 10_000);
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
      <section>
        <h3>Классификация</h3>
        <dl>
          <div><dt>Интент</dt><dd><span className="semantic-intent-chip">{intentLabel(item.intent)}</span></dd></div>
          <div><dt>Группа</dt><dd>{item.groupPath ?? "Без группы"}</dd></div>
          <div><dt>Кластер</dt><dd>{item.clusterName ?? "Не назначен"}</dd></div>
          <div><dt>Язык</dt><dd>{item.language.toUpperCase()}</dd></div>
          <div><dt>Приоритет</dt><dd>P{item.priority}</dd></div>
        </dl>
      </section>
      <section>
        <h3>Частотность</h3>
        {loading ? <span className="semantic-inspector-muted">Загружаем срезы…</span> : latestFrequencies.length > 0 ? (
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
                  {frequency.qualityFlags.length > 0 && <small className="negative">{frequency.qualityFlags.map(frequencyQualityLabel).join(", ")}</small>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="semantic-inspector-empty">
            <strong>Нет актуального среза</strong>
            <span>Запустите сбор по выбранным запросам или импортируйте сохранённые значения.</span>
          </div>
        )}
      </section>
      <section>
        <h3>Позиции</h3>
        {!loading && insights?.positions.length ? (
          <dl>
            {insights.positions.map((position) => (
              <div key={position.trackingContextId}>
                <dt className="semantic-position-context"><SearchEngineLogo engine={position.searchEngine} size="compact" /> <span>{position.contextName}</span></dt>
                <dd>
                  <strong>{position.found ? position.position ?? "—" : "Не найден"}</strong>
                  {position.position !== undefined && position.previousPosition !== undefined && (
                    <small className={position.position < position.previousPosition ? "positive" : position.position > position.previousPosition ? "negative" : undefined}>
                      было {position.previousPosition}
                    </small>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="semantic-inspector-empty">
            <strong>{item.isTracked ? "Ожидается история съёмов" : "Запрос не отслеживается"}</strong>
            <span>Позиции появятся после завершения фоновой проверки.</span>
          </div>
        )}
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
          {item.tags.length > 0 ? item.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>Нет тегов</span>}
        </div>
      </section>
      <section>
        <h3>Источник и даты</h3>
        <dl>
          <div><dt>Источник</dt><dd>{sourceLabel(item.sourceMode)}</dd></div>
          <div><dt>Создан</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
          <div><dt>Обновлён</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

function frequencyTypeLabel(type: string): string {
  return { BASE: "База", EXACT: '""', FIXED: '"!"' }[type] ?? type;
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

function frequencyQualityLabel(flag: string): string {
  return {
    CONTEXT_INCOMPLETE: "неполный контекст",
    STALE: "устарело",
    PARTIAL: "частичные данные",
    ESTIMATED: "оценка"
  }[flag] ?? flag;
}

function formatInteger(value: string): string {
  const number = Number(value);
  return Number.isSafeInteger(number)
    ? new Intl.NumberFormat("ru-RU").format(number)
    : value;
}

function insightError(error: unknown): string {
  return error instanceof BrowserApiError
    ? error.message
    : "Не удалось загрузить частотность и позиции.";
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
