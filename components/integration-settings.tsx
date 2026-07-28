"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IntegrationCapability,
  IntegrationCredentialMode,
  IntegrationCredentialStatus,
  IntegrationCredentialSummary,
  IntegrationProvider,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

type Provider = IntegrationProvider;
type CredentialStatus = IntegrationCredentialStatus;
type ProviderCatalogItem = IntegrationProviderCatalogItem;
type Credential = IntegrationCredentialSummary;
type CredentialField = "label" | "apiKey" | "accountIdentifier";
type CredentialFieldErrors = Partial<
  Readonly<Record<CredentialField, string>>
>;

interface CredentialDraft {
  readonly provider: Provider;
  readonly label: string;
  readonly apiKey: string;
  readonly accountIdentifier: string;
}

interface IntegrationOperationError {
  readonly message: string;
  readonly reauthenticationRequired: boolean;
}

const EMPTY_DRAFT: CredentialDraft = {
  provider: "XMLSTOCK",
  label: "",
  apiKey: "",
  accountIdentifier: ""
};

export function IntegrationSettings({
  workspaceId,
  canManage,
  readOnly
}: Readonly<{
  workspaceId: string;
  canManage: boolean;
  readOnly: boolean;
}>) {
  const [catalog, setCatalog] = useState<readonly ProviderCatalogItem[]>([]);
  const [credentials, setCredentials] = useState<readonly Credential[]>([]);
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<Credential>();
  const [editLabel, setEditLabel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editAccountIdentifier, setEditAccountIdentifier] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [createError, setCreateError] =
    useState<IntegrationOperationError>();
  const [editError, setEditError] =
    useState<IntegrationOperationError>();
  const [listError, setListError] =
    useState<IntegrationOperationError>();
  const [success, setSuccess] = useState<string>();
  const [createFieldErrors, setCreateFieldErrors] =
    useState<CredentialFieldErrors>({});
  const [editFieldErrors, setEditFieldErrors] =
    useState<CredentialFieldErrors>({});
  const [reload, setReload] = useState(0);
  const createIdempotencyKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    void Promise.all([
      browserApiCollectionRequest<ProviderCatalogItem>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/catalog`,
        { signal: controller.signal }
      ),
      browserApiCollectionRequest<Credential>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials`,
        { signal: controller.signal }
      )
    ])
      .then(([catalogResult, credentialResult]) => {
        if (controller.signal.aborted) return;
        setCatalog(catalogResult.data);
        setCredentials(credentialResult.data);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(integrationErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, workspaceId]);

  const selectedProvider = useMemo(
    () => catalog.find((item) => item.provider === draft.provider),
    [catalog, draft.provider]
  );

  async function createCredential(): Promise<void> {
    if (saving) return;
    const validationErrors = validateCreateCredential(
      draft,
      Boolean(selectedProvider?.requiresAccountIdentifier)
    );
    if (hasFieldErrors(validationErrors)) {
      setCreateFieldErrors(validationErrors);
      setCreateError({
        message: "Проверьте обязательные поля подключения.",
        reauthenticationRequired: false
      });
      setSuccess(undefined);
      return;
    }
    setSaving(true);
    setCreateError(undefined);
    setSuccess(undefined);
    setCreateFieldErrors({});
    try {
      const credential = await browserApiRequest<Credential>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials`,
        {
          method: "POST",
          idempotencyKey:
            createIdempotencyKey.current ??
            (createIdempotencyKey.current = newCredentialIdempotencyKey()),
          body: {
            provider: draft.provider,
            label: draft.label,
            apiKey: draft.apiKey,
            ...(draft.accountIdentifier.trim()
              ? { accountIdentifier: draft.accountIdentifier }
              : {})
          }
        }
      );
      setCredentials((current) => [credential, ...current]);
      createIdempotencyKey.current = undefined;
      setDraft({ ...EMPTY_DRAFT, provider: draft.provider });
      setCreateFieldErrors({});
      setSuccess(
        `${providerLabel(credential.provider)} сохранён в зашифрованном vault`
      );
    } catch (requestError) {
      const fieldErrors = integrationFieldErrors(requestError);
      setCreateFieldErrors(fieldErrors);
      setCreateError(
        hasFieldErrors(fieldErrors)
          ? {
              message: "Проверьте значения в отмеченных полях.",
              reauthenticationRequired: false
            }
          : integrationOperationError(requestError)
      );
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(credential: Credential): void {
    setEditing(credential);
    setEditLabel(credential.label);
    setEditApiKey("");
    setEditAccountIdentifier("");
    setEditFieldErrors({});
    setEditError(undefined);
    setSuccess(undefined);
  }

  function closeEdit(): void {
    setEditing(undefined);
    setEditLabel("");
    setEditApiKey("");
    setEditAccountIdentifier("");
    setEditFieldErrors({});
    setEditError(undefined);
  }

  async function saveEdit(): Promise<void> {
    if (!editing || busyId) return;
    const validationErrors = validateEditCredential(
      editLabel,
      editApiKey,
      editAccountIdentifier,
      editing.provider
    );
    if (hasFieldErrors(validationErrors)) {
      setEditFieldErrors(validationErrors);
      setEditError({
        message: "Проверьте значения в отмеченных полях.",
        reauthenticationRequired: false
      });
      setSuccess(undefined);
      return;
    }
    setBusyId(editing.id);
    setEditError(undefined);
    setSuccess(undefined);
    setEditFieldErrors({});
    try {
      const updated = await browserApiRequest<Credential>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          ifMatch: editing.version,
          body: {
            label: editLabel,
            ...(editApiKey.trim() ? { apiKey: editApiKey } : {}),
            ...(editAccountIdentifier.trim()
              ? { accountIdentifier: editAccountIdentifier }
              : {})
          }
        }
      );
      setCredentials((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      closeEdit();
      setSuccess("Подключение обновлено");
    } catch (requestError) {
      const fieldErrors = integrationFieldErrors(requestError);
      setEditFieldErrors(fieldErrors);
      setEditError(
        hasFieldErrors(fieldErrors)
          ? {
              message: "Проверьте значения в отмеченных полях.",
              reauthenticationRequired: false
            }
          : integrationOperationError(requestError)
      );
    } finally {
      setBusyId(undefined);
    }
  }

  async function revoke(credential: Credential): Promise<void> {
    if (
      busyId ||
      !window.confirm(
        `Отключить «${credential.label}»? Ключ будет отозван и перезаписан в активном vault.`
      )
    ) {
      return;
    }
    setBusyId(credential.id);
    setListError(undefined);
    setSuccess(undefined);
    try {
      await browserApiRequest<{ readonly revoked: true }>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials/${encodeURIComponent(credential.id)}`,
        { method: "DELETE", ifMatch: credential.version }
      );
      setCredentials((current) =>
        current.filter((item) => item.id !== credential.id)
      );
      if (editing?.id === credential.id) closeEdit();
      setSuccess("Подключение отключено, секрет перезаписан в активном vault");
    } catch (requestError) {
      setListError(integrationOperationError(requestError));
    } finally {
      setBusyId(undefined);
    }
  }

  if (loading) {
    return (
      <section className="panel integration-loading" aria-busy="true">
        <span className="spinner" />
        <p>Загружаем каталог интеграций и подключения…</p>
      </section>
    );
  }

  if (catalog.length === 0) {
    return (
      <section className="panel panel-empty compact">
        <strong>Интеграции временно недоступны</strong>
        <p>{loadError ?? "Каталог провайдеров не удалось загрузить."}</p>
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
          type="button"
        >
          Повторить
        </button>
      </section>
    );
  }

  return (
    <div className="integration-settings-stack">
      {success && (
        <div className="inline-alert success" role="status">
          {success}
        </div>
      )}

      <section className="integration-catalog-grid" aria-label="Провайдеры">
        {catalog.map((provider) => (
          <article className="panel integration-provider-card" key={provider.provider}>
            <header>
              <span className="integration-provider-mark">
                {provider.displayName.slice(0, 1)}
              </span>
              <div>
                <h2>{provider.displayName}</h2>
                <p>{providerDescription(provider.provider)}</p>
              </div>
            </header>
            <div className="integration-capabilities">
              {provider.capabilities.map((capability) => (
                <span key={capability}>{capabilityLabel(capability)}</span>
              ))}
            </div>
            <small>{providerNotice(provider.provider)}</small>
          </article>
        ))}
      </section>

      {canManage ? (
        <section
          aria-busy={saving}
          className="panel integration-connect-card"
        >
          <header className="security-card-header">
            <div>
              <h2>Новое подключение</h2>
              <p>
                Браузер передаёт ключ в same-origin API по защищённому
                HTTPS-соединению. Внутри платформы секрет обрабатывается
                сервисом интеграций и сохраняется через AES-256-GCM.
              </p>
            </div>
          </header>
          {createError && (
            <IntegrationErrorAlert error={createError} />
          )}
          <div className="integration-form-grid">
            <label className="form-field">
              <span>Провайдер</span>
              <select
                disabled={saving}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    provider: event.target.value as Provider,
                    accountIdentifier: ""
                  });
                  createIdempotencyKey.current = undefined;
                  setCreateFieldErrors((current) =>
                    withoutFieldError(current, "accountIdentifier")
                  );
                }}
                required
                value={draft.provider}
              >
                {catalog.map((item) => (
                  <option key={item.provider} value={item.provider}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Название подключения (обязательно)</span>
              <input
                aria-describedby={
                  createFieldErrors.label
                    ? "integration-create-label-error"
                    : undefined
                }
                aria-invalid={Boolean(createFieldErrors.label)}
                autoComplete="off"
                disabled={saving}
                maxLength={160}
                minLength={1}
                onChange={(event) => {
                  setDraft({ ...draft, label: event.target.value });
                  createIdempotencyKey.current = undefined;
                  setCreateFieldErrors((current) =>
                    withoutFieldError(current, "label")
                  );
                }}
                placeholder="Например, Основной аккаунт"
                required
                value={draft.label}
              />
              {createFieldErrors.label && (
                <small
                  className="field-error"
                  id="integration-create-label-error"
                >
                  {createFieldErrors.label}
                </small>
              )}
            </label>
            {selectedProvider?.requiresAccountIdentifier && (
              <label className="form-field">
                <span>
                  {selectedProvider.accountIdentifierLabel ??
                    "Идентификатор аккаунта"}{" "}
                  (обязательно)
                </span>
                <input
                  aria-describedby={
                    createFieldErrors.accountIdentifier
                      ? "integration-create-account-error"
                      : undefined
                  }
                  aria-invalid={Boolean(
                    createFieldErrors.accountIdentifier
                  )}
                  autoComplete="off"
                  disabled={saving}
                  maxLength={255}
                  minLength={1}
                  onChange={(event) => {
                    setDraft({
                      ...draft,
                      accountIdentifier: event.target.value
                    });
                    createIdempotencyKey.current = undefined;
                    setCreateFieldErrors((current) =>
                      withoutFieldError(current, "accountIdentifier")
                    );
                  }}
                  required
                  value={draft.accountIdentifier}
                />
                {createFieldErrors.accountIdentifier && (
                  <small
                    className="field-error"
                    id="integration-create-account-error"
                  >
                    {createFieldErrors.accountIdentifier}
                  </small>
                )}
              </label>
            )}
            <label className="form-field">
              <span>API-ключ (обязательно)</span>
              <input
                aria-describedby={
                  createFieldErrors.apiKey
                    ? "integration-create-key-error"
                    : undefined
                }
                aria-invalid={Boolean(createFieldErrors.apiKey)}
                autoComplete="new-password"
                disabled={saving}
                maxLength={2048}
                minLength={8}
                onChange={(event) => {
                  setDraft({ ...draft, apiKey: event.target.value });
                  createIdempotencyKey.current = undefined;
                  setCreateFieldErrors((current) =>
                    withoutFieldError(current, "apiKey")
                  );
                }}
                required
                spellCheck={false}
                type="password"
                value={draft.apiKey}
              />
              {createFieldErrors.apiKey && (
                <small
                  className="field-error"
                  id="integration-create-key-error"
                >
                  {createFieldErrors.apiKey}
                </small>
              )}
            </label>
          </div>
          <div className="integration-form-actions">
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void createCredential()}
              type="button"
            >
              {saving ? "Шифруем…" : "Сохранить ключ"}
            </button>
            <span>
              Новое подключение останется «ожидает проверки» до
              provider-specific server-side test.
            </span>
          </div>
        </section>
      ) : (
        <div className="inline-alert warning">
          {readOnly
            ? "Workspace работает в режиме только для чтения: существующие подключения видны, новые операции временно заблокированы."
            : "Просмотр доступен. Добавлять, менять и удалять workspace-ключи может только владелец или администратор."}
        </div>
      )}

      <section className="panel integration-list-card">
        <header className="security-card-header">
          <div>
            <h2>Сохранённые подключения</h2>
            <p>
              В задания передаётся только ID подключения; plaintext API-ключ в
              очереди, события и ответы не попадает.
            </p>
          </div>
          <span className="security-status">
            {credentials.length} подключений
          </span>
        </header>
        {listError && <IntegrationErrorAlert error={listError} />}

        {credentials.length === 0 ? (
          <div className="panel-empty compact integration-empty">
            <strong>Подключений пока нет</strong>
            <p>
              Добавьте собственный ключ, чтобы позже привязать источник к
              проекту и запускать сбор данных.
            </p>
          </div>
        ) : (
          <div className="integration-list">
            {credentials.map((credential) => (
              <article className="integration-credential-row" key={credential.id}>
                <div className="integration-credential-main">
                  <span className="integration-provider-mark compact">
                    {providerLabel(credential.provider).slice(0, 1)}
                  </span>
                  <div>
                    <strong>{credential.label}</strong>
                    <span>
                      {providerLabel(credential.provider)} ·{" "}
                      <code>{credential.displayHint}</code>
                    </span>
                  </div>
                </div>
                <StatusBadge status={credential.status} />
                <div className="integration-credential-meta">
                  <span>{credentialModeLabel(credential.mode)}</span>
                  <span>
                    Обновлено{" "}
                    {new Intl.DateTimeFormat("ru", {
                      dateStyle: "medium"
                    }).format(new Date(credential.updatedAt))}
                  </span>
                </div>
                {canManage && (
                  <div className="integration-row-actions">
                    <button
                      className="text-button"
                      disabled={Boolean(busyId)}
                      onClick={() => beginEdit(credential)}
                      type="button"
                    >
                      Изменить
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={Boolean(busyId)}
                      onClick={() => void revoke(credential)}
                      type="button"
                    >
                      {busyId === credential.id ? "Отключаем…" : "Отключить"}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <section
          aria-busy={busyId === editing.id}
          aria-label="Изменение подключения"
          className="panel integration-edit-card"
        >
          <header className="security-card-header">
            <div>
              <h2>Изменить «{editing.label}»</h2>
              <p>
                Оставьте новый ключ пустым, чтобы изменить только название.
                При ротации старый секрет будет полностью заменён.
                {editing.provider === "XMLSTOCK"
                  ? " Введите одновременно новый API-ключ и XMLStock user ID."
                  : ""}
              </p>
            </div>
            <button
              className="text-button"
              disabled={busyId === editing.id}
              onClick={closeEdit}
              type="button"
            >
              Закрыть
            </button>
          </header>
          {editError && <IntegrationErrorAlert error={editError} />}
          <div className="integration-form-grid">
            <label className="form-field">
              <span>Название (обязательно)</span>
              <input
                aria-describedby={
                  editFieldErrors.label
                    ? "integration-edit-label-error"
                    : undefined
                }
                aria-invalid={Boolean(editFieldErrors.label)}
                disabled={busyId === editing.id}
                maxLength={160}
                minLength={1}
                onChange={(event) => {
                  setEditLabel(event.target.value);
                  setEditFieldErrors((current) =>
                    withoutFieldError(current, "label")
                  );
                }}
                required
                value={editLabel}
              />
              {editFieldErrors.label && (
                <small
                  className="field-error"
                  id="integration-edit-label-error"
                >
                  {editFieldErrors.label}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>Новый API-ключ</span>
              <input
                aria-describedby={
                  editFieldErrors.apiKey
                    ? "integration-edit-key-error"
                    : undefined
                }
                aria-invalid={Boolean(editFieldErrors.apiKey)}
                autoComplete="new-password"
                disabled={busyId === editing.id}
                maxLength={2048}
                minLength={8}
                onChange={(event) => {
                  setEditApiKey(event.target.value);
                  setEditFieldErrors((current) =>
                    withoutFieldErrors(current, [
                      "apiKey",
                      "accountIdentifier"
                    ])
                  );
                }}
                placeholder="Не менять"
                required={Boolean(editAccountIdentifier.trim())}
                spellCheck={false}
                type="password"
                value={editApiKey}
              />
              {editFieldErrors.apiKey && (
                <small
                  className="field-error"
                  id="integration-edit-key-error"
                >
                  {editFieldErrors.apiKey}
                </small>
              )}
            </label>
            {editing.provider === "XMLSTOCK" && (
              <label className="form-field">
                <span>Новый XMLStock user ID</span>
                <input
                  aria-describedby={
                    editFieldErrors.accountIdentifier
                      ? "integration-edit-account-error"
                      : undefined
                  }
                  aria-invalid={Boolean(
                    editFieldErrors.accountIdentifier
                  )}
                  disabled={busyId === editing.id}
                  maxLength={255}
                  minLength={1}
                  onChange={(event) => {
                    setEditAccountIdentifier(event.target.value);
                    setEditFieldErrors((current) =>
                      withoutFieldErrors(current, [
                        "apiKey",
                        "accountIdentifier"
                      ])
                    );
                  }}
                  placeholder="Введите вместе с новым API-ключом"
                  required={Boolean(editApiKey.trim())}
                  value={editAccountIdentifier}
                />
                {editFieldErrors.accountIdentifier && (
                  <small
                    className="field-error"
                    id="integration-edit-account-error"
                  >
                    {editFieldErrors.accountIdentifier}
                  </small>
                )}
              </label>
            )}
          </div>
          <div className="integration-form-actions">
            <button
              className="primary-button"
              disabled={Boolean(busyId)}
              onClick={() => void saveEdit()}
              type="button"
            >
              {busyId === editing.id ? "Сохраняем…" : "Сохранить"}
            </button>
            {(editApiKey.trim() || editAccountIdentifier.trim()) && (
              <span>
                После ротации статус вернётся в «ожидает проверки».
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusBadge({
  status
}: Readonly<{ status: CredentialStatus }>) {
  const labels: Readonly<
    Record<CredentialStatus, { readonly label: string; readonly tone: string }>
  > = {
    PENDING_VERIFICATION: {
      label: "Ожидает проверки",
      tone: "pending"
    },
    ACTIVE: { label: "Активно", tone: "active" },
    DEGRADED: { label: "Нестабильно", tone: "warning" },
    RATE_LIMITED: { label: "Лимит запросов", tone: "warning" },
    LOW_BALANCE: { label: "Низкий баланс", tone: "warning" },
    EXPIRED: { label: "Истёк", tone: "danger" },
    REVOKED: { label: "Отозван", tone: "danger" },
    INVALID: { label: "Некорректный", tone: "danger" },
    DISABLED: { label: "Отключён", tone: "muted" }
  };
  const value = labels[status];
  return (
    <span className={`integration-status ${value.tone}`}>{value.label}</span>
  );
}

function IntegrationErrorAlert({
  error
}: Readonly<{ error: IntegrationOperationError }>) {
  return (
    <div className="inline-alert danger integration-operation-error" role="alert">
      <span>{error.message}</span>
      {error.reauthenticationRequired && (
        <a
          className="inline-alert-action"
          href="/app/login?returnTo=%2Fapp%2Fsettings%2Fintegrations"
        >
          Подтвердить вход
        </a>
      )}
    </div>
  );
}

function providerLabel(provider: Provider): string {
  const labels: Readonly<Record<Provider, string>> = {
    XMLSTOCK: "XMLStock",
    ARSENKIN: "Arsenkin Tools",
    KEYS_SO: "Keys.so"
  };
  return labels[provider];
}

function providerDescription(provider: Provider): string {
  const descriptions: Readonly<Record<Provider, string>> = {
    XMLSTOCK:
      "Поисковая выдача, съём позиций и Wordstat через ваш аккаунт.",
    ARSENKIN:
      "Кластеризация, проверка индексации и SEO-инструменты через ваш аккаунт.",
    KEYS_SO:
      "Исследование запросов, конкурентов и выдачи через ваш аккаунт."
  };
  return descriptions[provider];
}

function providerNotice(provider: Provider): string {
  const notices: Readonly<Record<Provider, string>> = {
    XMLSTOCK:
      "Запросы оплачиваются по условиям вашего собственного аккаунта XMLStock.",
    ARSENKIN:
      "Тариф Arsenkin Tools с доступом к API оплачивается отдельно.",
    KEYS_SO: "Тариф Keys.so с доступом к REST API оплачивается отдельно."
  };
  return notices[provider];
}

function capabilityLabel(value: IntegrationCapability): string {
  const labels: Readonly<Record<IntegrationCapability, string>> = {
    SERP_RANK_TRACKING: "Съём позиций",
    SERP_COLLECTION: "Выдача",
    WORDSTAT: "Wordstat",
    CLUSTERING: "Кластеризация",
    INDEXATION: "Индексация",
    KEYWORD_RESEARCH: "Ключевые слова",
    COMPETITOR_RESEARCH: "Конкуренты"
  };
  return labels[value];
}

function credentialModeLabel(mode: IntegrationCredentialMode): string {
  const labels: Readonly<Record<IntegrationCredentialMode, string>> = {
    BYOK_API_KEY: "Свой API-ключ",
    BYOK_OAUTH: "Свой OAuth",
    PLATFORM_INCLUDED: "Включено в тариф",
    PLATFORM_PAID: "Баланс платформы",
    FALLBACK_PLATFORM_PAID: "Резерв платформы"
  };
  return labels[mode];
}

function integrationErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "REAUTHENTICATION_REQUIRED") {
      return "Для изменения API-ключей нужно повторно подтвердить вход.";
    }
    if (error.status === 402) {
      return "Workspace перешёл в режим только для чтения. Просмотр сохранён, новые операции заблокированы.";
    }
    if (error.status === 403) {
      return "Недостаточно прав для этой операции.";
    }
    if (error.status === 409 || error.status === 412) {
      return "Подключение уже изменено. Обновите страницу и повторите.";
    }
    return error.message;
  }
  return "Не удалось выполнить операцию с интеграцией";
}

function integrationOperationError(
  error: unknown
): IntegrationOperationError {
  return {
    message: integrationErrorMessage(error),
    reauthenticationRequired:
      error instanceof BrowserApiError &&
      error.code === "REAUTHENTICATION_REQUIRED"
  };
}

function validateCreateCredential(
  draft: CredentialDraft,
  requiresAccountIdentifier: boolean
): CredentialFieldErrors {
  const apiKeyError = apiKeyValidationError(draft.apiKey);
  return {
    ...(!draft.label.trim()
      ? { label: "Укажите название подключения." }
      : {}),
    ...(apiKeyError ? { apiKey: apiKeyError } : {}),
    ...(requiresAccountIdentifier && !draft.accountIdentifier.trim()
      ? {
          accountIdentifier:
            "Укажите идентификатор аккаунта провайдера."
        }
      : {})
  };
}

function validateEditCredential(
  label: string,
  apiKey: string,
  accountIdentifier: string,
  provider: Provider
): CredentialFieldErrors {
  const hasApiKey = Boolean(apiKey.trim());
  const hasAccountIdentifier = Boolean(accountIdentifier.trim());
  const apiKeyError = hasApiKey
    ? apiKeyValidationError(apiKey)
    : hasAccountIdentifier
      ? "Введите новый API-ключ для полной замены секрета."
      : undefined;
  return {
    ...(!label.trim() ? { label: "Укажите название подключения." } : {}),
    ...(apiKeyError ? { apiKey: apiKeyError } : {}),
    ...(provider === "XMLSTOCK" &&
    hasApiKey &&
    !hasAccountIdentifier
      ? {
          accountIdentifier:
            "При ротации XMLStock укажите новый user ID вместе с API-ключом."
        }
      : {})
  };
}

function newCredentialIdempotencyKey(): string {
  return `credential:${globalThis.crypto.randomUUID()}`;
}

function apiKeyValidationError(value: string): string | undefined {
  if (value.trim().length < 8) {
    return "API-ключ должен содержать не менее 8 символов.";
  }
  if (/\s/u.test(value)) {
    return "API-ключ не должен содержать пробелы.";
  }
  return undefined;
}

function integrationFieldErrors(error: unknown): CredentialFieldErrors {
  if (!(error instanceof BrowserApiError)) return {};
  const result: Partial<Record<CredentialField, string>> = {};
  for (const fieldError of error.fieldErrors) {
    const field = credentialField(fieldError.path);
    if (!field || result[field]) continue;
    result[field] = credentialFieldErrorMessage(field);
  }
  return result;
}

function credentialField(value: string): CredentialField | undefined {
  if (
    value === "label" ||
    value === "apiKey" ||
    value === "accountIdentifier"
  ) {
    return value;
  }
  return undefined;
}

function credentialFieldErrorMessage(field: CredentialField): string {
  const messages: Readonly<Record<CredentialField, string>> = {
    label: "Укажите корректное название подключения.",
    apiKey: "Укажите корректный API-ключ без пробелов, не короче 8 символов.",
    accountIdentifier:
      "Укажите корректный идентификатор аккаунта провайдера."
  };
  return messages[field];
}

function hasFieldErrors(errors: CredentialFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

function withoutFieldError(
  errors: CredentialFieldErrors,
  field: CredentialField
): CredentialFieldErrors {
  if (!errors[field]) return errors;
  const next: Partial<Record<CredentialField, string>> = { ...errors };
  delete next[field];
  return next;
}

function withoutFieldErrors(
  errors: CredentialFieldErrors,
  fields: readonly CredentialField[]
): CredentialFieldErrors {
  return fields.reduce(withoutFieldError, errors);
}
