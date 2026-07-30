"use client";

import {
  useEffect,
  useState,
  type FormEvent
} from "react";
import {
  browserApiCollectionRequest,
  BrowserApiError,
  browserApiRequest,
  type BrowserCursorPage
} from "../lib/browser-api";

type SemanticKeywordIntent =
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "LOCAL"
  | "MIXED";

interface SemanticKeyword {
  readonly id: string;
  readonly textOriginal: string;
  readonly textNormalized: string;
  readonly language: string;
  readonly priority: number;
  readonly isFavorite: boolean;
  readonly isTracked: boolean;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly groupPath?: string;
  readonly targetPageId?: string;
  readonly targetUrl?: string;
  readonly tags: readonly string[];
  readonly tagsTruncated: boolean;
  readonly sourceMode: "BYOK" | "PLATFORM" | "IMPORT" | "MANUAL";
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
  readonly keywordCount: number;
  readonly version: number;
}

interface KeywordDraft {
  readonly text: string;
  readonly language: string;
  readonly priority: string;
  readonly isFavorite: boolean;
  readonly intent: "" | SemanticKeywordIntent;
  readonly groupId: string;
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

interface SemanticCoreTableProps {
  readonly projectId: string;
  readonly refreshVersion: number;
  readonly groupRefreshVersion: number;
}

export function SemanticCoreTable({
  projectId,
  refreshVersion,
  groupRefreshVersion
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
  const [editor, setEditor] = useState<KeywordEditor>();
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);

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
  }, [groupRefreshVersion, projectId]);

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

  function openCreate(): void {
    setMutationError(undefined);
    setEditor({
      mode: "create",
      draft: {
        text: "",
        language: "ru",
        priority: "0",
        isFavorite: false,
        intent: "",
        groupId: "",
        targetUrl: "",
        tagNames: ""
      }
    });
  }

  function openEdit(item: SemanticKeyword): void {
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
        intent: item.intent ?? "",
        groupId: item.groupId ?? "",
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
    setSaving(true);
    setMutationError(undefined);
    const draft = editor.draft;
    const body = {
      text: draft.text,
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
      ...(draft.targetUrl
        ? { targetUrl: draft.targetUrl }
        : editor.mode === "edit"
          ? { targetUrl: null }
          : {}),
      tagNames: parseTagNames(draft.tagNames)
    };
    try {
      const result =
        editor.mode === "create"
          ? await browserApiRequest<SemanticKeyword>(
              `/app/api/projects/${encodeURIComponent(projectId)}/keywords`,
              { method: "POST", body }
            )
          : await browserApiRequest<SemanticKeyword>(
              `/app/api/projects/${encodeURIComponent(
                projectId
              )}/keywords/${encodeURIComponent(editor.keywordId)}`,
              {
                method: "PATCH",
                body,
                ifMatch: editor.version
              }
            );
      setItems((current) =>
        editor.mode === "create"
          ? [result, ...current]
          : current.map((item) => (item.id === result.id ? result : item))
      );
      if (editor.mode === "create") {
        setPage((current) => ({
          ...current,
          ...(current.totalApprox === undefined
            ? {}
            : { totalApprox: current.totalApprox + 1 })
        }));
      }
      setEditor(undefined);
    } catch (requestError) {
      setMutationError(keywordMutationError(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteKeyword(item: SemanticKeyword): Promise<void> {
    if (
      !window.confirm(
        `Удалить запрос «${item.textOriginal}» из активного ядра?`
      )
    ) {
      return;
    }
    setMutationError(undefined);
    try {
      await browserApiRequest<void>(
        `/app/api/projects/${encodeURIComponent(
          projectId
        )}/keywords/${encodeURIComponent(item.id)}`,
        { method: "DELETE", ifMatch: item.version }
      );
      setItems((current) => current.filter(({ id }) => id !== item.id));
      setPage((current) => ({
        ...current,
        ...(current.totalApprox === undefined
          ? {}
          : { totalApprox: Math.max(0, current.totalApprox - 1) })
      }));
      if (editor?.mode === "edit" && editor.keywordId === item.id) {
        setEditor(undefined);
      }
    } catch (requestError) {
      setMutationError(keywordMutationError(requestError));
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
        <div className="semantic-header-actions">
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
            <button className="secondary-button" type="submit">
              Найти
            </button>
          </form>
          <button className="primary-button" onClick={openCreate} type="button">
            Добавить запрос
          </button>
        </div>
      </header>

      {editor && (
        <form
          className="semantic-editor"
          onSubmit={(event) => void saveKeyword(event)}
        >
          <div className="semantic-editor-heading">
            <div>
              <strong>
                {editor.mode === "create"
                  ? "Новый поисковый запрос"
                  : "Редактирование запроса"}
              </strong>
              <span>
                Изменения сохраняются с проверкой версии — чужая правка не
                будет перезаписана.
              </span>
            </div>
            <button
              className="text-button"
              disabled={saving}
              onClick={() => setEditor(undefined)}
              type="button"
            >
              Закрыть
            </button>
          </div>
          <div className="semantic-editor-grid">
            <label className="semantic-editor-query">
              <span>Запрос</span>
              <input
                autoFocus
                maxLength={2000}
                onChange={(event) => updateDraft({ text: event.target.value })}
                required
                value={editor.draft.text}
              />
            </label>
            <label>
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
            <label>
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
            <label>
              <span>Интент</span>
              <select
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
              </select>
            </label>
            <label>
              <span>Группа</span>
              <select
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
              </select>
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
      )}

      {!editor && mutationError && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{mutationError}</span>
          <button
            className="text-button"
            onClick={() => setMutationError(undefined)}
            type="button"
          >
            Закрыть
          </button>
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
                  <th>Интент</th>
                  <th>Источник</th>
                  <th>Обновлён</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong title={item.textOriginal}>
                        {item.isFavorite ? "★ " : ""}
                        {item.textOriginal}
                      </strong>
                      <small>
                        {item.language.toUpperCase()}
                        {item.isTracked ? " · отслеживается" : ""}
                        {item.priority > 0 ? ` · P${item.priority}` : ""}
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
                    <td>{intentLabel(item.intent)}</td>
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
                    <td>
                      <span className="semantic-row-actions">
                        <button
                          className="text-button"
                          onClick={() => openEdit(item)}
                          type="button"
                        >
                          Изменить
                        </button>
                        <button
                          className="text-button danger-text"
                          onClick={() => void deleteKeyword(item)}
                          type="button"
                        >
                          Удалить
                        </button>
                      </span>
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
    signal ? { signal } : {}
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
