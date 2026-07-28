"use client";

import {
  useEffect,
  useState,
  type FormEvent
} from "react";
import {
  browserApiCollectionRequest,
  BrowserApiError,
  type BrowserCursorPage
} from "../lib/browser-api";

interface SemanticKeyword {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isTracked: boolean;
  readonly groupPath?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

interface SemanticCoreTableProps {
  readonly projectId: string;
  readonly refreshVersion: number;
}

export function SemanticCoreTable({
  projectId,
  refreshVersion
}: SemanticCoreTableProps) {
  const [items, setItems] = useState<readonly SemanticKeyword[]>([]);
  const [page, setPage] = useState<BrowserCursorPage>({
    hasNext: false
  });
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void loadKeywordPage(projectId, search, undefined, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.data);
        setPage(result.page);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setItems([]);
        setPage({ hasNext: false });
        setError(keywordErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refreshVersion, retryVersion, search]);

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSearch(draftSearch.trim());
  }

  function clearSearch(): void {
    setDraftSearch("");
    setSearch("");
  }

  async function loadMore(): Promise<void> {
    if (!page.hasNext || !page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const result = await loadKeywordPage(
        projectId,
        search,
        page.nextCursor
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

  const total = page.totalApprox;
  return (
    <section className="panel semantic-core" aria-busy={loading}>
      <header className="panel-header semantic-core-header">
        <div>
          <h2>Запросы</h2>
          <p>
            {total === undefined
              ? "Опубликованное семантическое ядро"
              : `${formatInteger(total)} ${keywordCountLabel(total)}`}
          </p>
        </div>
        <form className="semantic-search" onSubmit={submitSearch}>
          <label>
            <span className="visually-hidden">Поиск по запросам</span>
            <input
              maxLength={200}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Поиск по запросам"
              type="search"
              value={draftSearch}
            />
          </label>
          {search && (
            <button
              className="secondary-button semantic-search-clear"
              onClick={clearSearch}
              type="button"
            >
              Сбросить
            </button>
          )}
          <button className="primary-button" type="submit">
            Найти
          </button>
        </form>
      </header>

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

      {loading ? (
        <div className="semantic-table-skeleton" role="status">
          <span className="visually-hidden">Загружаем запросы</span>
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      ) : error && items.length === 0 ? null : items.length === 0 ? (
        <div className="semantic-table-empty">
          <strong>
            {search
              ? "По вашему запросу ничего не найдено"
              : "Опубликованных запросов пока нет"}
          </strong>
          <p>
            {search
              ? "Измените формулировку или сбросьте поиск."
              : "Загрузите CSV или TSV, проверьте сопоставление колонок и опубликуйте импорт."}
          </p>
          {search && (
            <button
              className="secondary-button"
              onClick={clearSearch}
              type="button"
            >
              Показать все запросы
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className="semantic-table-wrap"
            tabIndex={0}
            aria-label="Таблица семантического ядра"
          >
            <table className="semantic-table">
              <thead>
                <tr>
                  <th>Запрос</th>
                  <th>Группа</th>
                  <th>Целевая страница</th>
                  <th>Теги</th>
                  <th>Источник</th>
                  <th>Обновлён</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong title={item.textOriginal}>
                        {item.textOriginal}
                      </strong>
                      <small>
                        {item.language.toUpperCase()}
                        {item.isTracked ? " · отслеживается" : ""}
                      </small>
                    </td>
                    <td title={item.groupPath}>
                      {item.groupPath ?? "—"}
                    </td>
                    <td title={item.targetUrl}>
                      {item.targetUrl ?? "—"}
                    </td>
                    <td>
                      {item.tags.length > 0 ? (
                        <span className="semantic-tags">
                          {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                          {(item.tags.length > 3 ||
                            item.tagsTruncated) && (
                            <span>
                              +{Math.max(1, item.tags.length - 3)}
                            </span>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span
                        className={`semantic-source source-${item.sourceMode.toLowerCase()}`}
                      >
                        {sourceModeLabel(item.sourceMode)}
                      </span>
                    </td>
                    <td>
                      <time dateTime={item.updatedAt}>
                        {formatDate(item.updatedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="semantic-table-footer">
            <span>
              Показано {formatInteger(items.length)}
              {total === undefined ? "" : ` из ${formatInteger(total)}`}
            </span>
            {page.hasNext && (
              <button
                className="secondary-button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore ? "Загружаем…" : "Показать ещё"}
              </button>
            )}
          </footer>
        </>
      )}
    </section>
  );
}

async function loadKeywordPage(
  projectId: string,
  search: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ limit: "100" });
  if (search) query.set("search", search);
  if (cursor) query.set("cursor", cursor);
  return browserApiCollectionRequest<SemanticKeyword>(
    `/app/api/projects/${encodeURIComponent(projectId)}/keywords?${query.toString()}`,
    { ...(signal ? { signal } : {}) }
  );
}

function mergeKeywords(
  current: readonly SemanticKeyword[],
  next: readonly SemanticKeyword[]
): readonly SemanticKeyword[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()];
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

function sourceModeLabel(mode: SemanticKeyword["sourceMode"]): string {
  const labels: Readonly<Record<SemanticKeyword["sourceMode"], string>> = {
    BYOK: "Свой API",
    PLATFORM: "Платформа",
    IMPORT: "Импорт",
    MANUAL: "Вручную"
  };
  return labels[mode];
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

function keywordCountLabel(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "запросов";
  if (mod10 === 1) return "запрос";
  if (mod10 >= 2 && mod10 <= 4) return "запроса";
  return "запросов";
}
