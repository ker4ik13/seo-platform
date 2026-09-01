"use client";

import Link from "next/link";
import {
  type ClipboardEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  ApiTokenCollection,
  ApiTokenScope,
  ApiTokenSummary,
  IssuedApiToken
} from "@seo-platform/contracts";
import { apiTokenScopes } from "@seo-platform/contracts";
import type { AppProject } from "../lib/app-types";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import { copyText } from "../lib/clipboard";
import { Icon } from "./icon";
import { SemanticModal } from "./semantic-modal";
import styles from "./api-token-settings.module.css";

interface ScopeGroup {
  readonly title: string;
  readonly description: string;
  readonly scopes: readonly {
    readonly value: ApiTokenScope;
    readonly label: string;
  }[];
}

const scopeGroups: readonly ScopeGroup[] = [
  group("Проекты", "Список и настройки проектов", "projects:read", "projects:write"),
  group("Семантика", "Ключи, папки, кластеры и импорт", "semantics:read", "semantics:write"),
  group("Позиции", "Контексты, запуски и результаты", "positions:read", "positions:run"),
  group("Частотность", "Запуски Wordstat и результаты", "frequency:read", "frequency:run"),
  group("ИИ-ответы", "Съём ответов поисковых ИИ", "ai:read", "ai:run"),
  group("Подбор ключей", "Исследования и расширение семантики", "research:read", "research:run"),
  group("Аудиты", "Технические обходы и результаты", "audits:read", "audits:run"),
  group("Страницы", "Страницы проекта", "pages:read", "pages:write"),
  group("Заметки", "Внутренние заметки проекта", "notes:read", "notes:write"),
  group("Интеграции", "Настройки внешних сервисов", "integrations:read", "integrations:write"),
  {
    title: "Автоматизации",
    description: "Регулярные и отложенные задания",
    scopes: [
      { value: "automations:read", label: "Просмотр" },
      { value: "automations:manage", label: "Управление" }
    ]
  }
];

const defaultScopes: readonly ApiTokenScope[] = [
  "projects:read",
  "positions:read",
  "positions:run",
  "frequency:read",
  "frequency:run"
];

interface Draft {
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
  readonly allProjects: boolean;
  readonly projectIds: readonly string[];
  readonly expiresAt: string;
}

export function ApiTokenSettings({
  workspaceId,
  projects
}: Readonly<{
  workspaceId: string;
  projects: readonly AppProject[];
}>) {
  const [collection, setCollection] = useState<ApiTokenCollection>();
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Draft>(() => newDraft(projects));
  const [issued, setIssued] = useState<IssuedApiToken>();
  const [issuedCopied, setIssuedCopied] = useState(false);
  const [issuedCopyError, setIssuedCopyError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [copiedIdentifier, setCopiedIdentifier] = useState<string>();
  const editorRef = useRef<HTMLElement>(null);
  const editing = collection?.tokens.find(({ id }) => id === editingId);
  const basePath = `/app/api/workspaces/${encodeURIComponent(workspaceId)}/api-tokens`;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await browserApiRequest<ApiTokenCollection>(
        basePath,
        signal ? { signal } : {}
      );
      if (!signal?.aborted) {
        setCollection(result);
        setError(undefined);
      }
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить API-ключи."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const invalidDraft = useMemo(
    () =>
      !draft.name.trim() ||
      draft.scopes.length === 0 ||
      (!draft.allProjects && draft.projectIds.length === 0),
    [draft]
  );

  async function save(): Promise<void> {
    if (busy || invalidDraft) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const body = {
        name: draft.name.trim(),
        scopes: draft.scopes,
        allProjects: draft.allProjects,
        projectIds: draft.allProjects ? [] : draft.projectIds,
        expiresAt: draft.expiresAt ? localDateToIso(draft.expiresAt) : null
      };
      if (editing) {
        await browserApiRequest<ApiTokenSummary>(
          `${basePath}/${encodeURIComponent(editing.id)}`,
          {
            method: "PATCH",
            ifMatch: editing.version,
            body
          }
        );
        setNotice("Права API-ключа обновлены.");
      } else {
        const result = await browserApiRequest<IssuedApiToken>(basePath, {
          method: "POST",
          body
        });
        revealIssued(result);
        setNotice("API-ключ создан. Скопируйте секрет сейчас.");
      }
      setEditingId(undefined);
      setDraft(newDraft(projects));
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось сохранить API-ключ."));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save();
  }

  function edit(token: ApiTokenSummary): void {
    setEditingId(token.id);
    setDraft({
      name: token.name,
      scopes: token.scopes,
      allProjects: token.allProjects,
      projectIds: token.projectIds,
      expiresAt: token.expiresAt ? isoToLocalDate(token.expiresAt) : ""
    });
    setIssued(undefined);
    setError(undefined);
    setNotice(undefined);
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function resetEditor(): void {
    setEditingId(undefined);
    setDraft(newDraft(projects));
    setError(undefined);
    setNotice(undefined);
  }

  function setReadOnlyScopes(): void {
    setDraft({
      ...draft,
      scopes: apiTokenScopes.filter((scope) => scope.endsWith(":read"))
    });
  }

  async function action(
    token: ApiTokenSummary,
    operation: "rotate" | "revoke"
  ): Promise<void> {
    if (busy) return;
    if (
      operation === "revoke" &&
      !window.confirm("Отозвать API-ключ? Это действие нельзя отменить.")
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await browserApiRequest<ApiTokenSummary | IssuedApiToken>(
        `${basePath}/${encodeURIComponent(token.id)}/${operation}`,
        {
          method: "POST",
          ifMatch: token.version,
          body: {}
        }
      );
      if (operation === "rotate" && "token" in result) {
        revealIssued(result);
        setNotice(
          "API-ключ перевыпущен. Старый секрет действует ещё 10 минут для безопасной замены."
        );
      } else {
        setIssued(undefined);
        setNotice("API-ключ отозван.");
      }
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось изменить API-ключ."));
    } finally {
      setBusy(false);
    }
  }

  async function copyIssuedToken(): Promise<void> {
    if (!issued) return;
    if (await copyText(issued.token)) {
      confirmIssuedTokenCopied();
    } else {
      setIssuedCopyError(
        "Не удалось скопировать ключ. Выделите секрет и скопируйте его вручную."
      );
    }
  }

  function revealIssued(token: IssuedApiToken): void {
    setIssued(token);
    setIssuedCopied(false);
    setIssuedCopyError(undefined);
  }

  function handleIssuedTokenCopy(event: ClipboardEvent<HTMLElement>): void {
    const secretText = event.currentTarget.textContent;
    if (
      !issued ||
      secretText !== issued.token ||
      window.getSelection()?.toString() !== secretText
    ) {
      setIssuedCopyError("Скопируйте ключ целиком, без пропущенных символов.");
      return;
    }
    confirmIssuedTokenCopied();
  }

  function confirmIssuedTokenCopied(): void {
    setIssuedCopied(true);
    setIssuedCopyError(undefined);
    setError(undefined);
    setNotice("API-ключ скопирован в буфер обмена.");
  }

  function closeIssuedToken(): void {
    if (!issuedCopied) return;
    setIssued(undefined);
    setIssuedCopyError(undefined);
    setNotice("Секрет сохранён и больше не будет показан.");
  }

  async function copyIdentifier(value: string): Promise<void> {
    if (await copyText(value)) {
      setCopiedIdentifier(value);
      setError(undefined);
    } else {
      setError(
        "Не удалось скопировать идентификатор. Выделите его и скопируйте вручную."
      );
    }
  }

  return (
    <div className={styles.stack}>
      {error && (
        <div className={`inline-alert danger ${styles.pageAlert}`} role="alert">
          <span>{error}</span>
          {!collection && !loading && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setLoading(true);
                void load();
              }}
              type="button"
            >
              Повторить
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className={`inline-alert success ${styles.pageAlert}`} role="status">
          {notice}
        </div>
      )}

      {issued && (
        <SemanticModal
          className={styles.secretModal ?? ""}
          closeDisabled={!issuedCopied}
          description="Секрет показывается только один раз"
          footer={
            <div className={styles.secretModalFooter}>
              <span aria-live="polite">
                {issuedCopied
                  ? "Ключ скопирован — окно можно закрыть."
                  : "Скопируйте ключ, чтобы закрыть окно."}
              </span>
              <button
                className="primary-button"
                disabled={!issuedCopied}
                onClick={closeIssuedToken}
                type="button"
              >
                Готово
              </button>
            </div>
          }
          onClose={closeIssuedToken}
          title="Сохраните новый API-ключ"
        >
          <div className={styles.secretModalBody}>
            <div className={styles.secretWarning}>
              После закрытия восстановить секрет нельзя — ключ придётся
              перевыпустить. Не отправляйте его в сообщения или промпты.
            </div>
            <code
              aria-label="Секрет API-ключа"
              className={styles.secretValue}
              onCopy={handleIssuedTokenCopy}
              tabIndex={0}
            >
              {issued.token}
            </code>
            {issuedCopyError && (
              <div className="inline-alert danger" role="alert">
                {issuedCopyError}
              </div>
            )}
            <button
              className={`primary-button ${styles.secretCopyButton}`}
              onClick={() => void copyIssuedToken()}
              type="button"
            >
              <Icon name={issuedCopied ? "checkDouble" : "copy"} />
              {issuedCopied ? "Скопировано" : "Копировать ключ"}
            </button>
          </div>
        </SemanticModal>
      )}

      <section className={`${styles.identifiersCard} panel`}>
        <header className="security-card-header">
          <div>
            <span className={styles.sectionKicker}>Идентификаторы API</span>
            <h2>Рабочая область и проекты</h2>
            <p>
              Для ручной настройки UUID можно скопировать здесь. ИИ-агент
              может получить эти же данные самостоятельно через GET /access;
              доступ всё равно ограничивается правами ключа.
            </p>
          </div>
        </header>
        <div className={styles.identifierList}>
          <IdentifierRow
            copied={copiedIdentifier === workspaceId}
            label="Workspace ID"
            onCopy={() => void copyIdentifier(workspaceId)}
            value={workspaceId}
          />
          {projects.map((project) => (
            <IdentifierRow
              copied={copiedIdentifier === project.id}
              key={project.id}
              label={project.name}
              onCopy={() => void copyIdentifier(project.id)}
              secondary={project.domain}
              value={project.id}
            />
          ))}
        </div>
      </section>

      <section className={`${styles.editor} panel`} ref={editorRef}>
        <header className="security-card-header">
          <div>
            <span className={styles.sectionKicker}>
              {editing ? "Редактирование" : "Новый ключ"}
            </span>
            <h2>{editing ? editing.name : "Создать API-ключ"}</h2>
            <p>
              Назначьте только необходимые операции и ограничьте доступ
              конкретными проектами.
            </p>
          </div>
          {editing && (
            <button
              className="secondary-button"
              onClick={resetEditor}
              type="button"
            >
              Отмена
            </button>
          )}
        </header>

        <form className={styles.editorForm} onSubmit={submit}>
          <div className={styles.basicFields}>
            <label className="form-field">
              <span>Название ключа</span>
              <input
                autoComplete="off"
                maxLength={100}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Например, SEO-агент"
                required
                value={draft.name}
              />
              <small>Будет видно только вам в списке подключений.</small>
            </label>
            <label className="form-field">
              <span>Срок действия</span>
              <input
                min={minimumLocalDate()}
                onChange={(event) =>
                  setDraft({ ...draft, expiresAt: event.target.value })
                }
                type="datetime-local"
                value={draft.expiresAt}
              />
              <small>Оставьте пустым, если ключ не должен истекать.</small>
            </label>
          </div>

          <fieldset className={styles.scopeFieldset}>
            <div className={styles.fieldsetHeading}>
              <div>
                <legend>Права API</legend>
                <p>Выдавайте только те операции, которые нужны интеграции.</p>
              </div>
              <div className={styles.quickActions}>
                <button
                  className="text-button"
                  onClick={setReadOnlyScopes}
                  type="button"
                >
                  Только просмотр
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setDraft({ ...draft, scopes: [...apiTokenScopes] })
                  }
                  type="button"
                >
                  Выбрать все
                </button>
                <button
                  className="text-button"
                  onClick={() => setDraft({ ...draft, scopes: [] })}
                  type="button"
                >
                  Снять выбор
                </button>
              </div>
            </div>
            <div className={styles.scopeGrid}>
              {scopeGroups.map((scopeGroup) => (
                <article className={styles.scopeCard} key={scopeGroup.title}>
                  <div className={styles.scopeCopy}>
                    <strong>{scopeGroup.title}</strong>
                    <small>{scopeGroup.description}</small>
                  </div>
                  <div className={styles.scopeChecks}>
                    {scopeGroup.scopes.map((scope) => (
                      <label className="checkbox-field" key={scope.value}>
                        <input
                          checked={draft.scopes.includes(scope.value)}
                          onChange={() =>
                            setDraft({
                              ...draft,
                              scopes: toggleScope(draft.scopes, scope.value)
                            })
                          }
                          type="checkbox"
                        />
                        <span>{scope.label}</span>
                      </label>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.projectFieldset}>
            <div className={styles.fieldsetHeading}>
              <div>
                <legend>Доступ к проектам</legend>
                <p>Ключ не увидит проекты, которые вы не выбрали.</p>
              </div>
              <span className={styles.selectionCount}>
                {draft.allProjects
                  ? "Все проекты"
                  : `${draft.projectIds.length} из ${projects.length}`}
              </span>
            </div>
            <label className={styles.allProjects}>
              <input
                checked={draft.allProjects}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    allProjects: event.target.checked,
                    projectIds: event.target.checked
                      ? []
                      : projects[0]
                        ? [projects[0].id]
                        : []
                  })
                }
                type="checkbox"
              />
              <span>
                <strong>Все доступные проекты</strong>
                <small>Включая проекты, которые появятся позже</small>
              </span>
            </label>
            {!draft.allProjects && projects.length > 0 && (
              <div className={styles.projectList}>
                {projects.map((project) => (
                  <label key={project.id}>
                    <input
                      checked={draft.projectIds.includes(project.id)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          projectIds: toggleId(draft.projectIds, project.id)
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{project.name}</strong>
                      <small>{project.domain}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!draft.allProjects && projects.length === 0 && (
              <div className={styles.emptyProjects} role="status">
                В рабочей области пока нет проектов. Выберите «Все доступные
                проекты», чтобы ключ автоматически получил доступ к будущим.
              </div>
            )}
          </fieldset>

          <div className="settings-savebar">
            <span>
              {draft.scopes.length === 0
                ? "Выберите хотя бы одно право"
                : draft.allProjects
                  ? `${draft.scopes.length} прав · все проекты`
                  : `${draft.scopes.length} прав · ${draft.projectIds.length} проектов`}
            </span>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={resetEditor}
              type="button"
            >
              {editing ? "Отменить" : "Очистить"}
            </button>
            <button
              className="primary-button"
              disabled={busy || invalidDraft}
              type="submit"
            >
              {busy
                ? "Сохраняем…"
                : editing
                  ? "Сохранить права"
                  : "Создать ключ"}
            </button>
          </div>
        </form>
      </section>

      <section className={`${styles.listCard} panel`}>
        <header className="security-card-header">
          <div>
            <span className={styles.sectionKicker}>Активные подключения</span>
            <h2>Ваши API-ключи</h2>
            <p>Секрет не хранится в открытом виде и после выпуска не показывается.</p>
          </div>
        </header>
        {loading && !collection ? (
          <div className={styles.loadingState} aria-busy="true">
            <span className="spinner" />
            <span>Загружаем API-ключи…</span>
          </div>
        ) : collection?.tokens.length ? (
          <div className={styles.tokenList}>
            {collection.tokens.map((token) => (
              <article key={token.id}>
                <div className={styles.tokenMain}>
                  <div>
                    <strong>{token.name}</strong>
                    <code>{token.prefix}…</code>
                  </div>
                  <span className={styles[token.status.toLowerCase()]}>
                    {statusLabel(token.status)}
                  </span>
                </div>
                <p>
                  {token.scopes.length} прав · {projectLabel(token, projects)}
                  {token.lastUsedAt
                    ? ` · использован ${dateLabel(token.lastUsedAt)}`
                    : " · ещё не использован"}
                </p>
                <div className={styles.actions}>
                  <button
                    className={`secondary-button ${styles.tokenAction}`}
                    disabled={busy || token.status === "REVOKED"}
                    onClick={() => edit(token)}
                    type="button"
                  >
                    Изменить права
                  </button>
                  <button
                    className={`secondary-button ${styles.tokenAction}`}
                    disabled={busy || token.status !== "ACTIVE"}
                    onClick={() => void action(token, "rotate")}
                    type="button"
                  >
                    Перевыпустить
                  </button>
                  <button
                    className={`danger-button ${styles.tokenAction}`}
                    disabled={busy || token.status === "REVOKED"}
                    onClick={() => void action(token, "revoke")}
                    type="button"
                  >
                    Отозвать
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState} role="status">
            <strong>API-ключей пока нет</strong>
            <span>Создайте первый ключ для агента или внешнего сервиса.</span>
          </div>
        )}
      </section>

      <section className={`${styles.docsCard} panel`}>
        <div>
          <span className={styles.sectionKicker}>Документация</span>
          <h2>Подключение API и ИИ-агентов</h2>
          <p>
            Полный справочник содержит авторизацию, права, примеры запросов,
            идемпотентность, запуск задач и чтение результатов.
          </p>
        </div>
        <Link
          className="primary-button"
          href="/docs/api"
          rel="noreferrer"
          target="_blank"
        >
          <Icon name="link" />
          Открыть API-документацию
        </Link>
      </section>
    </div>
  );
}

function IdentifierRow({
  copied,
  label,
  onCopy,
  secondary,
  value
}: Readonly<{
  copied: boolean;
  label: string;
  onCopy: () => void;
  secondary?: string;
  value: string;
}>) {
  return (
    <div>
      <span>
        <strong>{label}</strong>
        {secondary && <small>{secondary}</small>}
      </span>
      <code>{value}</code>
      <button
        aria-label={`Скопировать ${label}`}
        className={`secondary-button ${styles.copyButton}`}
        onClick={onCopy}
        type="button"
      >
        <Icon name="copy" />
        {copied ? "Скопировано" : "Копировать"}
      </button>
    </div>
  );
}

function group(
  title: string,
  description: string,
  read: ApiTokenScope,
  write: ApiTokenScope
): ScopeGroup {
  return {
    title,
    description,
    scopes: [
      { value: read, label: "Просмотр" },
      { value: write, label: "Изменение / запуск" }
    ]
  };
}

function newDraft(projects: readonly AppProject[]): Draft {
  return {
    name: "",
    scopes: defaultScopes,
    allProjects: projects.length === 0,
    projectIds: projects[0] ? [projects[0].id] : [],
    expiresAt: ""
  };
}

function toggleScope(
  values: readonly ApiTokenScope[],
  scope: ApiTokenScope
): readonly ApiTokenScope[] {
  const set = new Set(values);
  if (set.has(scope)) set.delete(scope);
  else set.add(scope);
  return apiTokenScopes.filter((value) => set.has(value));
}

function toggleId(values: readonly string[], id: string): readonly string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

function localDateToIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid expiry date");
  return date.toISOString();
}

function isoToLocalDate(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function minimumLocalDate(): string {
  return isoToLocalDate(new Date(Date.now() + 10 * 60_000).toISOString());
}

function statusLabel(status: ApiTokenSummary["status"]): string {
  return {
    ACTIVE: "Активен",
    EXPIRED: "Истёк",
    REVOKED: "Отозван"
  }[status];
}

function projectLabel(
  token: ApiTokenSummary,
  projects: readonly AppProject[]
): string {
  if (token.allProjects) return "все проекты";
  const names = token.projectIds
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length <= 2
    ? names.join(", ") || `${token.projectIds.length} проектов`
    : `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}`;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
