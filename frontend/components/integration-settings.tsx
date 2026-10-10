"use client";

import { CustomSelect } from "./custom-select";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  IntegrationCredentialSummary,
  IntegrationProvider,
  IntegrationProviderCatalogItem
} from "@seo-platform/contracts";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  integrationCapabilityLabel,
  integrationCredentialModeLabel,
  integrationProviderLabel
} from "../lib/integration-presentation";
import {
  hasEmptyXmlStockBalance,
  supportsAutomaticCredentialValidation
} from "../lib/integration-credential-validation";
import { IntegrationCredentialValidation } from "./integration-credential-validation";
import { ProviderLogo } from "./provider-logo";
import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { WorkspaceIntegrationRouting } from "./workspace-integration-routing";
import { UiText, useUiLocale } from "./ui-locale";
import { isVisibleIntegrationProvider } from "../lib/integration-visibility";


type Provider = IntegrationProvider;
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
}

type CredentialOperationKind =
  | "create"
  | "update"
  | "revoke"
  | "validation";
type CredentialOperationState = Readonly<
  Record<string, CredentialOperationKind | undefined>
>;

const EMPTY_DRAFT: CredentialDraft = {
  provider: "XMLSTOCK",
  label: "",
  apiKey: "",
  accountIdentifier: ""
};
const CREATE_OPERATION_KEY = "__create_credential__";
const REGISTRATION_URLS: Partial<Readonly<Record<Provider, string>>> = {
  XMLSTOCK: "https://xmlstock.com/?refid=14832",
  ARSENKIN: "https://arsenkin.ru/tools/?ref=152654pxfB"
};

export function IntegrationSettings({
  workspaceId,
  canManage,
  canTest,
  readOnly
}: Readonly<{
  workspaceId: string;
  canManage: boolean;
  canTest: boolean;
  readOnly: boolean;
}>) {
  const { t: uiText } = useUiLocale();
  const [catalog, setCatalog] = useState<readonly ProviderCatalogItem[]>([]);
  const visibleCatalog = useMemo(
    () => catalog.filter(({ provider }) => isVisibleIntegrationProvider(provider)),
    [catalog]
  );
  const [credentials, setCredentials] = useState<readonly Credential[]>([]);
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<Credential>();
  const [revokeTarget, setRevokeTarget] = useState<Credential>();
  const [showCreate, setShowCreate] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editAccountIdentifier, setEditAccountIdentifier] = useState("");
  const [loading, setLoading] = useState(true);
  const [credentialOperations, setCredentialOperations] =
    useState<CredentialOperationState>({});
  const [loadError, setLoadError] = useState<string>();
  const [createError, setCreateError] =
    useState<IntegrationOperationError>();
  const [editError, setEditError] =
    useState<IntegrationOperationError>();
  const [revokeError, setRevokeError] =
    useState<IntegrationOperationError>();
  const [listError, setListError] =
    useState<IntegrationOperationError>();
  const [success, setSuccess] = useState<string>();
  const [createFieldErrors, setCreateFieldErrors] =
    useState<CredentialFieldErrors>({});
  const [editFieldErrors, setEditFieldErrors] =
    useState<CredentialFieldErrors>({});
  const [reload, setReload] = useState(0);
  const [routingRevision, setRoutingRevision] = useState(0);
  const createIdempotencyKey = useRef<string | undefined>(undefined);
  const credentialOperationsRef = useRef<Record<
    string,
    CredentialOperationKind | undefined
  >>({});
  const saving =
    credentialOperations[CREATE_OPERATION_KEY] === "create";
  const editingOperation = editing
    ? credentialOperations[editing.id]
    : undefined;
  const revokeOperation = revokeTarget
    ? credentialOperations[revokeTarget.id]
    : undefined;
  const emptyBalanceCredentialIds = new Set(
    credentials
      .filter(hasEmptyXmlStockBalance)
      .map(({ id }) => id)
  );

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

  useEffect(() => {
    if (!showCreate) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setShowCreate(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [saving, showCreate]);

  useEffect(() => {
    if (!editing && !revokeTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editing && !editingOperation) closeEdit();
      if (revokeTarget && !revokeOperation) closeRevoke();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editing, editingOperation, revokeOperation, revokeTarget]);

  const selectedProvider = useMemo(
    () => catalog.find((item) => item.provider === draft.provider),
    [catalog, draft.provider]
  );

  async function refreshCredential(
    credentialId: string
  ): Promise<Credential | undefined> {
    const result = await browserApiCollectionRequest<Credential>(
      `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials`
    );
    const refreshed = result.data.find(
      (credential) => credential.id === credentialId
    );
    setCredentials((current) =>
      refreshed
        ? current.map((credential) =>
            credential.id === credentialId ? refreshed : credential
          )
        : current.filter((credential) => credential.id !== credentialId)
    );
    setEditing((current) =>
      current?.id === credentialId ? refreshed : current
    );
    setListError(undefined);
    return refreshed;
  }

  async function scheduleAutomaticValidation(
    credential: Credential
  ): Promise<Readonly<{ credential: Credential; notice: string }>> {
    const validationMode = catalog.find(
      ({ provider }) => provider === credential.provider
    )?.credentialValidationMode;
    if (
      !canTest ||
      !supportsAutomaticCredentialValidation(validationMode)
    ) {
      return { credential, notice: "" };
    }
    try {
      const activeValidation = await browserApiRequest<
        NonNullable<Credential["activeValidation"]>
      >(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials/${encodeURIComponent(credential.id)}/validations`,
        {
          method: "POST",
          idempotencyKey:
            `automatic-credential-validation:${credential.id}:` +
            globalThis.crypto.randomUUID()
        }
      );
      return {
        credential: { ...credential, activeValidation },
        notice: " Проверка запущена автоматически."
      };
    } catch {
      return {
        credential,
        notice:
          " Автоматическую проверку запустить не удалось — она повторится в фоне."
      };
    }
  }

  async function createCredential(): Promise<void> {
    const validationErrors = validateCreateCredential(
      draft,
      Boolean(selectedProvider?.requiresAccountIdentifier)
    );
    if (hasFieldErrors(validationErrors)) {
      setCreateFieldErrors(validationErrors);
      setCreateError({
        message: "Проверьте обязательные поля подключения."
      });
      setSuccess(undefined);
      return;
    }
    if (!acquireCredentialOperation("create")) return;
    setCreateError(undefined);
    setSuccess(undefined);
    setCreateFieldErrors({});
    try {
      let credential = await browserApiRequest<Credential>(
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
      const validation = await scheduleAutomaticValidation(credential);
      credential = validation.credential;
      setCredentials((current) => [credential, ...current]);
      setRoutingRevision((value) => value + 1);
      createIdempotencyKey.current = undefined;
      setDraft({ ...EMPTY_DRAFT, provider: draft.provider });
      setShowCreate(false);
      setCreateFieldErrors({});
      setSuccess(
        `${integrationProviderLabel(credential.provider)} сохранён в зашифрованном vault.${validation.notice}`
      );
    } catch (requestError) {
      const fieldErrors = integrationFieldErrors(requestError);
      setCreateFieldErrors(fieldErrors);
      setCreateError(
        hasFieldErrors(fieldErrors)
          ? {
              message: "Проверьте значения в отмеченных полях."
            }
          : integrationOperationError(requestError)
      );
    } finally {
      releaseCredentialOperation("create");
    }
  }

  function beginEdit(credential: Credential): void {
    if (isCredentialOperationActive(credential.id)) return;
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
    if (!editing || isCredentialOperationActive(editing.id)) return;
    const validationErrors = validateEditCredential(
      editLabel,
      editApiKey,
      editAccountIdentifier,
      editing.provider
    );
    if (hasFieldErrors(validationErrors)) {
      setEditFieldErrors(validationErrors);
      setEditError({
        message: "Проверьте значения в отмеченных полях."
      });
      setSuccess(undefined);
      return;
    }
    const credentialId = editing.id;
    if (!acquireCredentialOperation("update", credentialId)) return;
    setEditError(undefined);
    setSuccess(undefined);
    setEditFieldErrors({});
    try {
      let updated = await browserApiRequest<Credential>(
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
      const secretChanged = Boolean(
        editApiKey.trim() || editAccountIdentifier.trim()
      );
      const validation = secretChanged
        ? await scheduleAutomaticValidation(updated)
        : { credential: updated, notice: "" };
      updated = validation.credential;
      setCredentials((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      closeEdit();
      setSuccess(
        `Подключение обновлено.${validation.notice}`
      );
    } catch (requestError) {
      const fieldErrors = integrationFieldErrors(requestError);
      setEditFieldErrors(fieldErrors);
      setEditError(
        hasFieldErrors(fieldErrors)
          ? {
              message: "Проверьте значения в отмеченных полях."
            }
          : integrationOperationError(requestError)
      );
    } finally {
      releaseCredentialOperation("update", credentialId);
    }
  }

  function beginRevoke(credential: Credential): void {
    const activeOperation = credentialOperationsRef.current[credential.id];
    if (activeOperation && activeOperation !== "validation") return;
    setRevokeTarget(credential);
    setRevokeError(undefined);
    setSuccess(undefined);
  }

  function closeRevoke(): void {
    setRevokeTarget(undefined);
    setRevokeError(undefined);
  }

  async function revoke(): Promise<void> {
    const credential = revokeTarget;
    if (!credential || isCredentialOperationActive(credential.id)) return;
    if (!acquireCredentialOperation("revoke", credential.id)) return;
    setRevokeError(undefined);
    setSuccess(undefined);
    try {
      await browserApiRequest<{ readonly revoked: true }>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials/${encodeURIComponent(credential.id)}`,
        { method: "DELETE", ifMatch: credential.version }
      );
      setCredentials((current) =>
        current.filter((item) => item.id !== credential.id)
      );
      setRoutingRevision((value) => value + 1);
      if (editing?.id === credential.id) closeEdit();
      closeRevoke();
      setSuccess("Подключение отключено, секрет перезаписан в активном vault");
    } catch (requestError) {
      setRevokeError(integrationOperationError(requestError));
    } finally {
      releaseCredentialOperation("revoke", credential.id);
    }
  }

  function acquireCredentialOperation(
    kind: CredentialOperationKind,
    credentialId?: string
  ): boolean {
    const key = credentialOperationKey(kind, credentialId);
    if (credentialOperationsRef.current[key]) return false;
    const next = {
      ...credentialOperationsRef.current,
      [key]: kind
    };
    credentialOperationsRef.current = next;
    setCredentialOperations(next);
    return true;
  }

  function releaseCredentialOperation(
    kind: CredentialOperationKind,
    credentialId?: string
  ): void {
    const key = credentialOperationKey(kind, credentialId);
    if (credentialOperationsRef.current[key] !== kind) return;
    const next = { ...credentialOperationsRef.current };
    delete next[key];
    credentialOperationsRef.current = next;
    setCredentialOperations(next);
  }

  function isCredentialOperationActive(credentialId: string): boolean {
    return Boolean(credentialOperationsRef.current[credentialId]);
  }

  if (loading) {
    return (
      <section className="panel integration-loading" aria-busy="true">
        <span className="spinner" />
        <p><UiText text="Загружаем каталог интеграций и подключения…" /></p>
      </section>
    );
  }

  if (catalog.length === 0) {
    return (
      <section className="panel panel-empty compact">
        <strong><UiText text="Интеграции временно недоступны" /></strong>
        <p>{loadError ?? <UiText text="Каталог провайдеров не удалось загрузить." />}</p>
        <button
          className="secondary-button"
          onClick={() => setReload((value) => value + 1)}
          type="button"
        >
          <UiText text="Повторить" /></button>
      </section>
    );
  }

  return (
    <div className="integration-settings-stack">
      <div className="integration-page-actions">
        <div>
          <strong><UiText text="Подключения и квоты" /></strong>
          <span>
            <UiText text="Статусы, проверка ключей и фактические остатки провайдеров." /></span>
        </div>
        {canManage && (
          <button
            className="primary-button"
            onClick={() => {
              setCreateError(undefined);
              setShowCreate(true);
            }}
            type="button"
          >
            <UiText text="+ Добавить интеграцию" /></button>
        )}
      </div>
      {success && (
        <div className="inline-alert success" role="status">
          {<UiText text={success ?? ""} />}
        </div>
      )}

      <section
        className="integration-overview-grid"
        aria-label={uiText("Состояние подключений")}
      >
        <IntegrationOverviewStat
          icon="link"
          label={uiText("подключения")}
          value={credentials.length}
        />
        <IntegrationOverviewStat
          icon="success"
          label={uiText("активны")}
          tone="success"
          value={credentials.filter(({ id, status }) =>
            status === "ACTIVE" && !emptyBalanceCredentialIds.has(id)
          ).length}
        />
        <IntegrationOverviewStat
          icon="warning"
          label={uiText("требуют внимания")}
          tone="warning"
          value={credentials.filter(({ id, status }) =>
            emptyBalanceCredentialIds.has(id) ||
            ["DEGRADED", "RATE_LIMITED", "LOW_BALANCE", "EXPIRED", "INVALID"].includes(status)
          ).length}
        />
        <IntegrationOverviewStat
          icon="disabled"
          label={uiText("сервисов в каталоге")}
          value={visibleCatalog.length}
        />
      </section>

      {canManage && showCreate ? (
        <SemanticModal
          bodyClassName="integration-credential-modal-body"
          className="integration-credential-modal"
          closeDisabled={saving}
          onClose={() => setShowCreate(false)}
          size="large"
          title="Новое подключение"
        >
        <div aria-busy={saving} className="integration-connect-card" id="new-integration">
          {createError && (
            <IntegrationErrorAlert error={createError} />
          )}
          <div className="integration-form-grid">
            <label className="form-field">
              <span><UiText text="Провайдер" /></span>
              <CustomSelect
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
                popoverClassName="integration-provider-select-popover"
                popoverMinWidth={360}
                required
                value={draft.provider}
              >
                {visibleCatalog.map((item) => (
                  <option key={item.provider} value={item.provider}>
                    <span className="integration-provider-select-option">
                      <ProviderLogo provider={item.provider} size="compact" />
                      <span>
                        <strong>{item.displayName}</strong>
                        <small>{item.description}</small>
                      </span>
                    </span>
                  </option>
                ))}
              </CustomSelect>
            </label>
            <label className="form-field">
              <span><UiText text="Название подключения (обязательно)" /></span>
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
                placeholder={uiText("Например, Основной аккаунт")}
                required
                value={draft.label}
              />
              {createFieldErrors.label && (
                <small
                  className="field-error"
                  id="integration-create-label-error"
                >
                  <UiText text={createFieldErrors.label ?? ""} />
                </small>
              )}
            </label>
            {selectedProvider?.requiresAccountIdentifier && (
              <label className="form-field">
                <span>
                  {selectedProvider.accountIdentifierLabel ??
                    <UiText text="Идентификатор аккаунта" />}{" "}
                  <UiText text="(обязательно)" /></span>
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
              <span><UiText text="API-ключ (обязательно)" /></span>
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
            <span>
              {selectedProvider?.credentialValidationMode ===
              "ACCOUNT_METADATA"
                ? <UiText text="После сохранения запустите безопасную проверку подключения в списке ниже." />
                : <UiText text="Для XMLStock автоматическая внешняя проверка пока недоступна; подключение останется «ожидает проверки»." />}
            </span>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void createCredential()}
              type="button"
            >
              {saving ? <UiText text="Шифруем…" /> : <UiText text="Сохранить ключ" />}
            </button>
          </div>
        </div>
        </SemanticModal>
      ) : (
        !canManage && <div className="inline-alert warning">
          {readOnly
            ? <UiText text="Workspace работает в режиме только для чтения: существующие подключения видны, новые операции временно заблокированы." />
            : <UiText text="Просмотр доступен. Добавлять, менять и удалять workspace-ключи может только владелец или администратор." />}
        </div>
      )}

      <section className="panel integration-list-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Сохранённые подключения" /></h2>
          </div>
          <span className="security-status">
            {credentials.length} <UiText text="подключений" before=" " /></span>
        </header>
        {listError && <IntegrationErrorAlert error={listError} />}

        {credentials.length === 0 ? (
          <div className="panel-empty compact integration-empty">
            <strong><UiText text="Подключений пока нет" /></strong>
            <p>
              <UiText text="Добавьте собственный API-ключ XMLStock или Arsenkin Tools." /></p>
          </div>
        ) : (
          <div className="integration-list">
            {credentials.map((credential) => (
              <article className="integration-credential-row" key={credential.id}>
                <div className="integration-credential-card-body">
                  <header className="integration-credential-header">
                    <div className="integration-credential-main">
                      <ProviderLogo provider={credential.provider} size="compact" />
                      <div>
                        <strong>{credential.label}</strong>
                        <span>
                          {<UiText text={integrationProviderLabel(credential.provider) ?? ""} />} ·{" "}
                          <code>{credential.displayHint}</code>
                        </span>
                      </div>
                    </div>
                    {revokeTarget?.id === credential.id ? (
                      <div className="integration-validation-note" role="status">
                        <strong><UiText text="Проверка остановлена" /></strong>
                        <span><UiText text="Теперь подключение можно отключить." /></span>
                      </div>
                    ) : <IntegrationCredentialValidation
                      activeValidation={emptyBalanceCredentialIds.has(credential.id)
                        ? undefined
                        : credential.activeValidation}
                      canTest={canTest}
                      credentialId={credential.id}
                      credentialLastErrorCode={credential.lastErrorCode}
                      credentialLabel={credential.label}
                      credentialStatus={emptyBalanceCredentialIds.has(credential.id)
                        ? "LOW_BALANCE"
                        : credential.status}
                      credentialVersion={credential.version}
                      key={`${credential.id}:${credential.version}`}
                      onAcquireOperation={() =>
                        acquireCredentialOperation(
                          "validation",
                          credential.id
                        )
                      }
                      onReleaseOperation={() =>
                        releaseCredentialOperation(
                          "validation",
                          credential.id
                        )
                      }
                      onResolveConflict={async () =>
                        (
                          await refreshCredential(credential.id)
                        )?.activeValidation
                      }
                      onTerminal={async () => {
                        await refreshCredential(credential.id);
                      }}
                      operationBlocked={Boolean(
                        (credentialOperations[credential.id] &&
                          credentialOperations[credential.id] !==
                            "validation") ||
                          editing?.id === credential.id ||
                          revokeTarget?.id === credential.id
                      )}
                      provider={credential.provider}
                      readOnly={readOnly}
                      validationMode={
                        catalog.find(
                          ({ provider }) => provider === credential.provider
                        )?.credentialValidationMode
                      }
                      workspaceId={workspaceId}
                    />}
                  </header>
                  <div className="integration-credential-meta">
                    <span>{<UiText text={integrationCredentialModeLabel(credential.mode) ?? ""} />}</span>
                    <span>
                      <UiText text="Обновлено" />{" "}
                      {new Intl.DateTimeFormat("ru", {
                        dateStyle: "medium"
                      }).format(new Date(credential.updatedAt))}
                    </span>
                    <IntegrationCredentialQuota credential={credential} />
                  </div>
                </div>
                {canManage && (
                  <footer className="integration-row-actions">
                    <div className="integration-credential-actions">
                      {credential.mode === "BYOK_API_KEY" ? (
                        <button
                          className="secondary-button integration-card-action"
                          disabled={Boolean(
                            credentialOperations[credential.id] ||
                              revokeTarget?.id === credential.id
                          )}
                          onClick={() => beginEdit(credential)}
                          type="button"
                        >
                          <UiText text="Изменить" /></button>
                      ) : (
                        <span className="integration-system-managed">
                          <UiText text="Секрет управляется платформой" /></span>
                      )}
                      <button
                        className="secondary-button danger-button integration-card-action"
                        disabled={Boolean(
                          (credentialOperations[credential.id] &&
                            credentialOperations[credential.id] !== "validation") ||
                            editing?.id === credential.id
                        )}
                        onClick={() => beginRevoke(credential)}
                        type="button"
                      >
                        <UiText text="Отключить" /></button>
                    </div>
                  </footer>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <WorkspaceIntegrationRouting
        key={`${workspaceId}:${routingRevision}`}
        workspaceId={workspaceId}
      />

      <section className="integration-catalog-section" aria-label={uiText("Каталог сервисов")}>
        <header>
          <div>
            <h2><UiText text="Каталог сервисов" /></h2>
            <p><UiText text="Доступные источники данных и поддерживаемые возможности." /></p>
          </div>
        </header>
        <div className="integration-catalog-grid">
          {visibleCatalog.map((provider) => {
            const registrationUrl = REGISTRATION_URLS[provider.provider];
            return (
            <article className="panel integration-provider-card" key={provider.provider}>
              <header>
                <ProviderLogo provider={provider.provider} />
                <div>
                  <h2>{provider.displayName}</h2>
                  <p><UiText text={provider.description} /></p>
                </div>
              </header>
              <div className="integration-capabilities">
                {provider.capabilities.map((capability) => (
                  <span key={capability}>
                    {<UiText text={integrationCapabilityLabel(capability) ?? ""} />}
                  </span>
                ))}
              </div>
              <small><UiText text={provider.subscriptionNotice} /></small>
              <div className="integration-provider-actions">
                {registrationUrl && (
                  <a
                    className="primary-button integration-registration-button"
                    href={registrationUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <UiText text="Регистрация" /><span aria-hidden="true">↗</span>
                  </a>
                )}
                {canManage && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setDraft({ ...EMPTY_DRAFT, provider: provider.provider });
                      setCreateError(undefined);
                      setShowCreate(true);
                    }}
                    type="button"
                  >
                    <UiText text="Подключить свой ключ" /></button>
                )}
              </div>
            </article>
            );
          })}
        </div>
      </section>

      {editing && (
        <div
          className="integration-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !editingOperation) {
              closeEdit();
            }
          }}
        >
          <section
            aria-busy={editingOperation === "update"}
            aria-labelledby="integration-edit-title"
            aria-modal="true"
            className="panel integration-edit-card"
            role="dialog"
          >
            <header className="security-card-header">
              <div>
                <h2 id="integration-edit-title">
                  <UiText text="Изменить «" />{editing.label}»
                </h2>
                <p>
                  <UiText text="Оставьте новый ключ пустым, чтобы изменить только название. При ротации старый секрет будет полностью заменён." />{editing.provider === "XMLSTOCK"
                    ? <UiText text="Введите одновременно новый API-ключ и XMLStock user ID." before=" " />
                    : ""}
                </p>
              </div>
              <button
                aria-label={uiText("Закрыть окно")}
                className="integration-dialog-close"
                disabled={Boolean(editingOperation)}
                onClick={closeEdit}
                type="button"
              >
                ×
              </button>
            </header>
            {editError && <IntegrationErrorAlert error={editError} />}
            <div className="integration-form-grid">
            <label className="form-field">
              <span><UiText text="Название (обязательно)" /></span>
              <input
                aria-describedby={
                  editFieldErrors.label
                    ? "integration-edit-label-error"
                    : undefined
                }
                aria-invalid={Boolean(editFieldErrors.label)}
                disabled={Boolean(editingOperation)}
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
                  <UiText text={editFieldErrors.label ?? ""} />
                </small>
              )}
            </label>
            <label className="form-field">
              <span><UiText text="Новый API-ключ" /></span>
              <input
                aria-describedby={
                  editFieldErrors.apiKey
                    ? "integration-edit-key-error"
                    : undefined
                }
                aria-invalid={Boolean(editFieldErrors.apiKey)}
                autoComplete="new-password"
                disabled={Boolean(editingOperation)}
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
                placeholder={uiText("Не менять")}
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
                <span><UiText text="Новый XMLStock user ID" /></span>
                <input
                  aria-describedby={
                    editFieldErrors.accountIdentifier
                      ? "integration-edit-account-error"
                      : undefined
                  }
                  aria-invalid={Boolean(
                    editFieldErrors.accountIdentifier
                  )}
                  disabled={Boolean(editingOperation)}
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
                  placeholder={uiText("Введите вместе с новым API-ключом")}
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
            <div className="integration-form-actions integration-dialog-actions">
              <button
                className="secondary-button"
                disabled={Boolean(editingOperation)}
                onClick={closeEdit}
                type="button"
              >
                <UiText text="Отмена" /></button>
              <button
                className="primary-button"
                disabled={Boolean(editingOperation)}
                onClick={() => void saveEdit()}
                type="button"
              >
                {editingOperation === "update" ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
              </button>
              {(editApiKey.trim() || editAccountIdentifier.trim()) && (
                <span>
                  <UiText text="После ротации статус вернётся в «ожидает проверки»." /></span>
              )}
            </div>
          </section>
        </div>
      )}

      {revokeTarget && (
        <div
          className="integration-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !revokeOperation) {
              closeRevoke();
            }
          }}
        >
          <section
            aria-busy={revokeOperation === "revoke"}
            aria-labelledby="integration-revoke-title"
            aria-modal="true"
            className="panel integration-revoke-dialog"
            role="alertdialog"
          >
            <header className="security-card-header">
              <div>
                <h2 id="integration-revoke-title"><UiText text="Отключить подключение?" /></h2>
                <p>
                  <UiText text="Подключение «{0}» будет отключено." values={[revokeTarget.label]} /></p>
              </div>
              <button
                aria-label={uiText("Закрыть окно")}
                className="integration-dialog-close"
                disabled={Boolean(revokeOperation)}
                onClick={closeRevoke}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="integration-revoke-summary">
              <ProviderLogo provider={revokeTarget.provider} size="compact" />
              <div>
                <strong>{revokeTarget.label}</strong>
                <span>
                  {<UiText text={integrationProviderLabel(revokeTarget.provider) ?? ""} />} ·{" "}
                  <code>{revokeTarget.displayHint}</code>
                </span>
              </div>
            </div>
            {revokeError && <IntegrationErrorAlert error={revokeError} />}
            <ConfirmationActions>
              <button
                className="secondary-button"
                disabled={Boolean(revokeOperation)}
                onClick={closeRevoke}
                type="button"
              >
                <UiText text="Отмена" /></button>
              <button
                className="danger-button"
                disabled={Boolean(revokeOperation)}
                onClick={() => void revoke()}
                type="button"
              >
                {revokeOperation === "revoke" ? <UiText text="Отключаем…" /> : <UiText text="Отключить" />}
              </button>
            </ConfirmationActions>
          </section>
        </div>
      )}
    </div>
  );
}

function credentialOperationKey(
  kind: CredentialOperationKind,
  credentialId: string | undefined
): string {
  if (kind === "create") return CREATE_OPERATION_KEY;
  if (!credentialId) {
    throw new Error(`Credential ID is required for ${kind}`);
  }
  return credentialId;
}

function IntegrationErrorAlert({
  error
}: Readonly<{ error: IntegrationOperationError }>) {
  return (
    <div className="inline-alert danger integration-operation-error" role="alert">
      <span>{<UiText text={error.message ?? ""} />}</span>
    </div>
  );
}

function IntegrationOverviewStat({
  icon,
  label,
  tone = "neutral",
  value
}: Readonly<{
  icon: "disabled" | "link" | "success" | "warning";
  label: string;
  tone?: "neutral" | "success" | "warning";
  value: number;
}>) {
  const glyphs = { disabled: "○", link: "↗", success: "✓", warning: "!" };
  return (
    <article className={`integration-overview-stat ${tone}`}>
      <span aria-hidden="true">{glyphs[icon]}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function IntegrationCredentialQuota({
  credential
}: Readonly<{ credential: IntegrationCredentialSummary }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  if (credential.mode === "PLATFORM_PAID") {
    return (
      <span className="integration-quota-unavailable">
        <UiText text="Точная стоимость во внутренних токенах показывается перед запуском" /></span>
    );
  }
  const quota = credential.quota;
  if (quota.status === "NOT_AVAILABLE") {
    return (
      <span className="integration-quota-unavailable">
        {credential.verifiedAt
          ? <UiText text="Провайдер не вернул числовую квоту" />
          : <UiText text="Проверьте подключение, чтобы получить квоту" />}
      </span>
    );
  }
  const usedRatio =
    quota.limit !== undefined && quota.limit > 0 && quota.used !== undefined
      ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
      : undefined;
  const quotaLabel = quota.unit === "ARSENKIN_LIMITS"
    ? "Лимиты Arsenkin"
    : quota.unit === "XMLSTOCK_REQUESTS"
      ? "Лимиты XMLStock"
      : "API-запросы";
  return (
    <div className="integration-quota" aria-label={uiText("Квота провайдера")}>
      <span>
        {quotaLabel}
        <strong>{formatNumber(quota.remaining, uiLocale)} <UiText text="осталось" before=" " /></strong>
      </span>
      {quota.balance && (
        <strong className="integration-provider-balance">
          <UiText text="Баланс:" after=" " />{formatMoney(quota.balance.amount, quota.balance.currency, uiLocale)}
        </strong>
      )}
      {quota.xmlStockPricing && (
        <section className="integration-xmlstock-pricing">
          <strong>{xmlStockTariffName(quota.xmlStockPricing.tariffCode)}</strong>
          <small>
            Google XML {quota.xmlStockPricing.pricesPerThousand.GOOGLE_LIVE} · Яндекс Live {quota.xmlStockPricing.pricesPerThousand.YANDEX_LIVE} · Search API {quota.xmlStockPricing.pricesPerThousand.YANDEX_SEARCH_API} · Wordstat {quota.xmlStockPricing.pricesPerThousand.WORDSTAT} ₽ / 1000
          </small>
        </section>
      )}
      {(quota.usedToday !== undefined || quota.usedMonth !== undefined) && (
        <small>
          <UiText text="Расход:" after=" " />{formatNumber(quota.usedToday ?? 0, uiLocale)} <UiText text="сегодня ·" before=" " after=" " />{formatNumber(quota.usedMonth ?? 0, uiLocale)} <UiText text="за месяц" before=" " /></small>
      )}
      {quota.limit !== undefined && quota.used !== undefined && (
        <>
          <div
            aria-label={uiText("Использовано {0}%", [String(usedRatio ?? 0)])}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={usedRatio ?? 0}
            role="progressbar"
          >
            <i style={{ width: `${usedRatio ?? 0}%` }} />
          </div>
          <small>
            {formatNumber(quota.used, uiLocale)} <UiText text="из" before=" " after=" " />{formatNumber(quota.limit, uiLocale)} <UiText text="использовано" before=" " /></small>
        </>
      )}
      {quota.observedAt && (
        <small><UiText text="Проверено" after=" " />{formatDateTime(quota.observedAt, uiLocale)}</small>
      )}
    </div>
  );
}

function xmlStockTariffName(
  code: "BASIC" | "OPTIMAL" | "MAXIMUM" | "PREMIUM" | "CUSTOM"
): string {
  if (code === "BASIC") return "Базовый тариф XMLStock";
  if (code === "OPTIMAL") return "Оптимальный тариф XMLStock";
  if (code === "MAXIMUM") return "Тариф XMLStock Максимум";
  if (code === "PREMIUM") return "Премиум тариф XMLStock";
  return "Тариф XMLStock по ставкам аккаунта";
}

function formatNumber(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function formatMoney(value: string, currency: "RUB", uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function integrationErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
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
    message: integrationErrorMessage(error)
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
