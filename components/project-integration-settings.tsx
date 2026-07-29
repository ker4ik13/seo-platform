"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectConnectorBinding,
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  ProjectConnectorSettingsMutationRestriction
} from "@seo-platform/contracts";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  integrationCredentialModeLabel,
  integrationCredentialStatusPresentation,
  integrationProviderLabel
} from "../lib/integration-presentation";
import {
  bindingAvailabilityPresentation,
  canApplyProjectConnectorRevalidation,
  canSubmitProjectConnectorDraft,
  createProjectConnectorBindingInput,
  type IdempotentCreateCommand,
  projectConnectorBinding,
  projectConnectorCreatePayloadSignature,
  projectConnectorDraft,
  projectConnectorDraftDirty,
  projectConnectorIncompatibleOptions,
  projectConnectorOptions,
  projectConnectorRestrictionMessage,
  RANK_TRACKING_CAPABILITY,
  reconcileProjectConnectorCreate,
  sameProjectConnectorBindingRevision,
  stableProjectConnectorCreateCommand,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding,
  type ProjectConnectorDraft
} from "../lib/project-integration-settings";
import { IntegrationStatusBadge } from "./integration-status-badge";

interface RequestFeedback {
  readonly message: string;
  readonly requestId?: string;
}

interface LoadFailure extends RequestFeedback {
  readonly kind:
    | "fatal"
    | "forbidden"
    | "not-found"
    | "offline"
    | "recoverable";
}

interface ConflictState {
  readonly serverSettings: ProjectConnectorSettings;
}

const UNCONFIGURED_PRESENTATION = {
  label: "Не настроено",
  message:
    "Назначьте проверенный собственный API-ключ, чтобы подготовить проект к съёму позиций.",
  tone: "muted"
} as const;

export function ProjectIntegrationSettings({
  projectId,
  projectName,
  projectStatus,
  workspaceStatus
}: Readonly<{
  projectId: string;
  projectName: string;
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
}>) {
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [draft, setDraft] = useState<ProjectConnectorDraft>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState(true);
  const [retryVersion, setRetryVersion] = useState(0);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const [loadFailure, setLoadFailure] = useState<LoadFailure>();
  const [operationError, setOperationError] = useState<RequestFeedback>();
  const [success, setSuccess] = useState<string>();
  const [conflict, setConflict] = useState<ConflictState>();
  const [runtimeRestriction, setRuntimeRestriction] =
    useState<ProjectConnectorSettingsMutationRestriction>();
  const operationLock = useRef(false);
  const loadedProjectId = useRef<string | undefined>(undefined);
  const settingsRef = useRef<ProjectConnectorSettings | undefined>(
    undefined
  );
  const revalidationGeneration = useRef(0);
  const createCommand = useRef<IdempotentCreateCommand | undefined>(
    undefined
  );
  const feedbackRef = useRef<HTMLDivElement>(null);
  const returnTo = projectIntegrationReturnTo(projectId);
  settingsRef.current = settings;

  function invalidateRevalidation(): void {
    revalidationGeneration.current += 1;
  }

  function clearForAccessFailure(error: unknown): boolean {
    if (
      !(error instanceof BrowserApiError) ||
      (error.status !== 403 && error.status !== 404)
    ) {
      return false;
    }
    invalidateRevalidation();
    loadedProjectId.current = undefined;
    setSettings(undefined);
    setDraft(undefined);
    setConflict(undefined);
    setOperationError(undefined);
    setSuccess(undefined);
    setLoadFailure(
      error.status === 403
        ? {
            kind: "forbidden",
            message:
              "Доступ к проектным источникам отозван. Обратитесь к владельцу рабочей области.",
            ...(error.requestId ? { requestId: error.requestId } : {})
          }
        : {
            kind: "not-found",
            message: "Проект удалён или доступ к нему больше недоступен.",
            ...(error.requestId ? { requestId: error.requestId } : {})
          }
    );
    return true;
  }

  useEffect(() => {
    const controller = new AbortController();
    const revalidatingCurrentProject =
      loadedProjectId.current === projectId;
    const startedGeneration = revalidationGeneration.current;
    const startedBinding =
      revalidatingCurrentProject && settingsRef.current
        ? projectConnectorBinding(
            settingsRef.current,
            RANK_TRACKING_CAPABILITY
          )
        : undefined;
    setLoading(true);
    setLoadFailure(undefined);
    if (!revalidatingCurrentProject) {
      revalidationGeneration.current += 1;
      loadedProjectId.current = undefined;
      setSettings(undefined);
      setDraft(undefined);
    }
    void fetchProjectConnectorSettings(projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (revalidatingCurrentProject) {
          const currentSettings = settingsRef.current;
          const currentBinding = currentSettings
            ? projectConnectorBinding(
                currentSettings,
                RANK_TRACKING_CAPABILITY
              )
            : undefined;
          if (
            !canApplyProjectConnectorRevalidation(
              startedGeneration,
              revalidationGeneration.current,
              startedBinding,
              currentBinding
            )
          ) {
            return;
          }
        }
        const binding = projectConnectorBinding(
          result,
          RANK_TRACKING_CAPABILITY
        );
        loadedProjectId.current = projectId;
        setSettings(result);
        setDraft(projectConnectorDraft(binding));
        setConflict(undefined);
        setOperationError(undefined);
        setRuntimeRestriction(undefined);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        if (clearForAccessFailure(error)) return;
        if (
          revalidatingCurrentProject &&
          startedGeneration !== revalidationGeneration.current
        ) {
          return;
        }
        const failure = projectIntegrationLoadFailure(
          error,
          navigator.onLine
        );
        if (
          revalidatingCurrentProject &&
          failure.kind !== "forbidden" &&
          failure.kind !== "not-found"
        ) {
          setOperationError({
            message: failure.message,
            ...(failure.requestId
              ? { requestId: failure.requestId }
              : {})
          });
          return;
        }
        loadedProjectId.current = undefined;
        setSettings(undefined);
        setDraft(undefined);
        setLoadFailure(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, retryVersion, returnTo]);

  useEffect(() => {
    setOnline(navigator.onLine);
    function handleOffline(): void {
      setOnline(false);
    }
    function handleOnline(): void {
      setOnline(true);
      setReconnectVersion((value) => value + 1);
    }
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const binding = useMemo(
    () =>
      settings
        ? projectConnectorBinding(settings, RANK_TRACKING_CAPABILITY)
        : undefined,
    [settings]
  );
  const matchingOptions = useMemo(
    () =>
      settings
        ? projectConnectorOptions(settings, RANK_TRACKING_CAPABILITY)
        : [],
    [settings]
  );
  const eligibleOptions = useMemo(
    () =>
      matchingOptions.filter(
        (credential) => credential.status === "ACTIVE"
      ),
    [matchingOptions]
  );
  const unavailableOptions = useMemo(
    () =>
      matchingOptions.filter(
        (credential) => credential.status !== "ACTIVE"
      ),
    [matchingOptions]
  );
  const incompatibleOptions = useMemo(
    () =>
      settings
        ? projectConnectorIncompatibleOptions(
            settings,
            RANK_TRACKING_CAPABILITY
          )
        : [],
    [settings]
  );
  const dirty = Boolean(
    draft && projectConnectorDraftDirty(binding, draft)
  );

  useEffect(() => {
    if (!dirty) return;
    function protectUnsavedChanges(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () =>
      window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirty]);

  useEffect(() => {
    if (!draft || binding || !createCommand.current) return;
    const signature = projectConnectorCreatePayloadSignature(
      RANK_TRACKING_CAPABILITY,
      draft
    );
    if (createCommand.current.payloadSignature !== signature) {
      createCommand.current = undefined;
    }
  }, [binding, draft]);

  useEffect(() => {
    if (reconnectVersion === 0) return;
    if (!settings || !draft) {
      setRetryVersion((value) => value + 1);
      return;
    }
    const controller = new AbortController();
    const baseBinding = projectConnectorBinding(
      settings,
      RANK_TRACKING_CAPABILITY
    );
    const startedGeneration = revalidationGeneration.current;
    const hadLocalChanges = projectConnectorDraftDirty(baseBinding, draft);
    void fetchProjectConnectorSettings(projectId, controller.signal)
      .then((refreshed) => {
        if (controller.signal.aborted) return;
        const currentSettings = settingsRef.current;
        const currentBinding = currentSettings
          ? projectConnectorBinding(
              currentSettings,
              RANK_TRACKING_CAPABILITY
            )
          : undefined;
        if (
          !canApplyProjectConnectorRevalidation(
            startedGeneration,
            revalidationGeneration.current,
            baseBinding,
            currentBinding
          )
        ) {
          return;
        }
        const refreshedBinding = projectConnectorBinding(
          refreshed,
          RANK_TRACKING_CAPABILITY
        );
        if (
          hadLocalChanges &&
          !sameProjectConnectorBindingRevision(
            baseBinding,
            refreshedBinding
          )
        ) {
          setConflict({ serverSettings: refreshed });
          setOperationError({
            message:
              "Пока соединение отсутствовало, источник изменил другой участник. Ваш черновик сохранён."
          });
          return;
        }
        setSettings(refreshed);
        if (!hadLocalChanges) {
          setDraft(projectConnectorDraft(refreshedBinding));
        }
        setOperationError(undefined);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        if (clearForAccessFailure(error)) return;
        if (startedGeneration !== revalidationGeneration.current) return;
        setOperationError(projectIntegrationOperationError(error));
      });
    return () => controller.abort();
  }, [projectId, reconnectVersion, returnTo]);

  useEffect(() => {
    if (operationError || success || conflict) {
      feedbackRef.current?.focus();
    }
  }, [conflict, operationError, success]);

  async function save(): Promise<void> {
    if (
      !settings ||
      !draft ||
      saving ||
      operationLock.current ||
      !dirty ||
      !online
    ) {
      return;
    }
    const currentBinding = projectConnectorBinding(
      settings,
      RANK_TRACKING_CAPABILITY
    );
    if (
      !canSubmitProjectConnectorDraft(
        currentBinding,
        draft,
        matchingOptions,
        RANK_TRACKING_CAPABILITY
      )
    ) {
      setOperationError({
        message:
          "Выберите активное проверенное подключение либо выключите текущую недоступную привязку."
      });
      setSuccess(undefined);
      return;
    }

    invalidateRevalidation();
    operationLock.current = true;
    setSaving(true);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      let updated: ProjectConnectorBinding;
      let nextSettings: ProjectConnectorSettings;
      if (currentBinding) {
        updated = await browserApiRequest<ProjectConnectorBinding>(
          `${projectIntegrationApiPath(projectId)}/${encodeURIComponent(currentBinding.id)}`,
          {
            method: "PATCH",
            ifMatch: currentBinding.version,
            body: updateProjectConnectorBindingInput(draft)
          }
        );
        nextSettings = withProjectConnectorBinding(settings, updated);
      } else {
        const receipt = await createBinding(projectId, draft);
        const authoritativeSettings =
          await fetchProjectConnectorSettings(projectId);
        const reconciliation = reconcileProjectConnectorCreate(
          receipt,
          authoritativeSettings,
          RANK_TRACKING_CAPABILITY
        );
        createCommand.current = undefined;
        if (reconciliation.superseded) {
          setSettings(authoritativeSettings);
          setDraft(draft);
          setConflict({ serverSettings: authoritativeSettings });
          setOperationError({
            message:
              "Создание источника принято, но после этого другой участник уже изменил его. Ваш исходный выбор сохранён для сравнения."
          });
          return;
        }
        updated = reconciliation.current;
        nextSettings = authoritativeSettings;
      }
      setSettings(nextSettings);
      setDraft(projectConnectorDraft(updated));
      setConflict(undefined);
      createCommand.current = undefined;
      setSuccess(
        updated.enabled
          ? "Источник съёма позиций сохранён"
          : "Источник съёма позиций выключен"
      );
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      if (
        error instanceof BrowserApiError &&
        (error.status === 412 || error.code === "VERSION_CONFLICT")
      ) {
        await loadMutationConflict(error, settings, draft);
      } else if (
        error instanceof BrowserApiError &&
        error.status === 409 &&
        (error.code === "RESOURCE_STATE_CONFLICT" ||
          error.code === "DUPLICATE")
      ) {
        await reconcileResourceConflict(error, settings, draft);
      } else if (
        error instanceof BrowserApiError &&
        (error.status === 402 || error.code === "PAYMENT_REQUIRED")
      ) {
        setRuntimeRestriction("WORKSPACE_READ_ONLY");
        setOperationError(projectIntegrationOperationError(error));
      } else if (clearForAccessFailure(error)) {
        return;
      } else {
        setOperationError(projectIntegrationOperationError(error));
      }
    } finally {
      operationLock.current = false;
      setSaving(false);
    }
  }

  async function createBinding(
    currentProjectId: string,
    currentDraft: ProjectConnectorDraft
  ): Promise<ProjectConnectorBinding> {
    const signature = projectConnectorCreatePayloadSignature(
      RANK_TRACKING_CAPABILITY,
      currentDraft
    );
    createCommand.current = stableProjectConnectorCreateCommand(
      createCommand.current,
      signature,
      () =>
        `project-connector-binding:${globalThis.crypto.randomUUID()}`
    );
    return browserApiRequest<ProjectConnectorBinding>(
      projectIntegrationApiPath(currentProjectId),
      {
        method: "POST",
        idempotencyKey: createCommand.current.key,
        body: createProjectConnectorBindingInput(
          RANK_TRACKING_CAPABILITY,
          currentDraft
        )
      }
    );
  }

  async function loadMutationConflict(
    error: BrowserApiError,
    currentSettings: ProjectConnectorSettings,
    currentDraft: ProjectConnectorDraft
  ): Promise<void> {
    try {
      const serverSettings =
        await fetchProjectConnectorSettings(projectId);
      projectConnectorBinding(serverSettings, RANK_TRACKING_CAPABILITY);
      setConflict({ serverSettings });
      setOperationError({
        message:
          "Источник изменён другим участником. Ваш черновик не потерян — сравните версии перед повтором.",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
      setSettings(currentSettings);
      setDraft(currentDraft);
    } catch (refreshError) {
      if (redirectForExpiredSession(refreshError, returnTo)) return;
      setOperationError({
        message:
          "Источник изменён другим участником, но новую версию пока не удалось загрузить. Ваш черновик сохранён.",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
    }
  }

  async function reconcileResourceConflict(
    error: BrowserApiError,
    currentSettings: ProjectConnectorSettings,
    currentDraft: ProjectConnectorDraft
  ): Promise<void> {
    try {
      const serverSettings =
        await fetchProjectConnectorSettings(projectId);
      const currentBinding = projectConnectorBinding(
        currentSettings,
        RANK_TRACKING_CAPABILITY
      );
      const serverBinding = projectConnectorBinding(
        serverSettings,
        RANK_TRACKING_CAPABILITY
      );
      if (
        !sameProjectConnectorBindingRevision(
          currentBinding,
          serverBinding
        )
      ) {
        setConflict({ serverSettings });
        setOperationError({
          message:
            "Другой участник уже создал или изменил источник. Ваш черновик сохранён.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
        return;
      }
      setSettings(serverSettings);
      setDraft(currentDraft);
      setOperationError({
        message:
          "Выбранное подключение больше нельзя использовать. Проверьте его статус или выберите другой активный ключ.",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
    } catch (refreshError) {
      if (redirectForExpiredSession(refreshError, returnTo)) return;
      setOperationError(projectIntegrationOperationError(error));
    }
  }

  function acceptServerConflict(): void {
    if (!conflict) return;
    invalidateRevalidation();
    const serverBinding = projectConnectorBinding(
      conflict.serverSettings,
      RANK_TRACKING_CAPABILITY
    );
    setSettings(conflict.serverSettings);
    setDraft(projectConnectorDraft(serverBinding));
    setConflict(undefined);
    setOperationError(undefined);
    createCommand.current = undefined;
  }

  function continueWithDraft(): void {
    if (!conflict) return;
    invalidateRevalidation();
    setSettings(conflict.serverSettings);
    setConflict(undefined);
    setOperationError(undefined);
    createCommand.current = undefined;
  }

  function resetDraft(): void {
    if (!settings || saving) return;
    invalidateRevalidation();
    const currentBinding = projectConnectorBinding(
      settings,
      RANK_TRACKING_CAPABILITY
    );
    setDraft(projectConnectorDraft(currentBinding));
    setConflict(undefined);
    setOperationError(undefined);
    setSuccess(undefined);
    createCommand.current = undefined;
  }

  if (loading && !settings) {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="panel project-integration-loading"
      >
        <span aria-hidden="true" className="spinner" />
        <div>
          <strong>Загружаем источники проекта…</strong>
          <p>Проверяем привязку и доступные подключения workspace.</p>
        </div>
      </section>
    );
  }

  if (!settings || !draft) {
    return (
      <ProjectIntegrationFailure
        failure={
          loadFailure ?? {
            kind: "fatal",
            message: "Настройки источников не удалось загрузить."
          }
        }
        online={online}
        onRetry={() => setRetryVersion((value) => value + 1)}
      />
    );
  }

  const restriction = effectiveMutationRestriction(
    settings,
    projectStatus,
    workspaceStatus,
    runtimeRestriction
  );
  const restrictionMessage =
    projectConnectorRestrictionMessage(restriction);
  const canEdit =
    settings.access.canUpdateBindings &&
    restriction === "NONE" &&
    online;
  const canInteract = canEdit && !saving && !conflict;
  const selectedCredential = settings.credentialOptions.find(
    ({ id }) => id === draft.credentialId
  );
  const selectedEligible = eligibleOptions.some(
    ({ id }) => id === draft.credentialId
  );
  const availability = binding
    ? bindingAvailabilityPresentation(binding.availability)
    : UNCONFIGURED_PRESENTATION;
  const submitReady = canSubmitProjectConnectorDraft(
    binding,
    draft,
    matchingOptions,
    RANK_TRACKING_CAPABILITY
  );
  const sourceInvalid =
    draft.enabled &&
    draft.credentialId.length > 0 &&
    !selectedEligible;
  const emptyCredentialTitle = settings.credentialOptionsTruncated
    ? "Среди показанных нет активного подключения для съёма позиций"
    : "Нет активного подключения для съёма позиций";
  const emptyCredentialDescription = settings.credentialOptionsTruncated
    ? "Список ограничен. Откройте подключения workspace, чтобы проверить остальные ключи и их возможности."
    : "Добавьте и проверьте совместимый ключ в настройках workspace. Ключи в ожидании проверки, с ошибкой или после отзыва нельзя назначить новым источником.";

  return (
    <div className="project-integration-stack">
      <div
        className="project-integration-feedback"
        ref={feedbackRef}
        tabIndex={-1}
      >
        {!online && (
          <div className="inline-alert warning" role="status">
            Соединение потеряно. Загруженная привязка остаётся доступной для
            просмотра, черновик сохранён локально, но отправка изменений
            заблокирована.
          </div>
        )}
        {restrictionMessage && (
          <div className="inline-alert warning" role="note">
            {restrictionMessage}
          </div>
        )}
        {operationError && (
          <RequestFeedbackAlert feedback={operationError} />
        )}
        {success && (
          <div className="inline-alert success" role="status">
            {success}
          </div>
        )}
        {conflict && (
          <section
            className="inline-alert warning project-integration-conflict"
            role="alert"
          >
            <div>
              <strong>Найдена более новая версия</strong>
              <p>
                На сервере сейчас{" "}
                {conflictBindingDescription(conflict.serverSettings)}. Ваш
                выбор «{draftCredentialDescription(draft, settings)}» сохранён
                отдельно.
              </p>
            </div>
            <div className="project-integration-conflict-actions">
              <button
                className="secondary-button"
                onClick={acceptServerConflict}
                type="button"
              >
                Принять серверную
              </button>
              <button
                className="primary-button"
                onClick={continueWithDraft}
                type="button"
              >
                Продолжить с моим выбором
              </button>
            </div>
          </section>
        )}
      </div>

      <section
        aria-busy={saving}
        className="panel project-connector-card"
      >
        <header className="security-card-header">
          <div>
            <p className="eyebrow">SERP · основной источник</p>
            <h2>Съём позиций</h2>
            <p>
              Этот срез настраивает только источник `SERP_RANK_TRACKING`.
              Остальные инструменты появятся вместе с рабочими заданиями.
            </p>
          </div>
          <span className={`integration-status ${availability.tone}`}>
            {availability.label}
          </span>
        </header>

        <div
          className={`project-binding-health ${availability.tone}`}
          id="project-connector-binding-health"
          role="status"
        >
          {availability.message}
        </div>

        <div className="project-binding-grid">
          <div className="project-binding-source">
            <label className="form-field">
              <span>Основное подключение</span>
              <select
                aria-describedby="project-connector-source-hint project-connector-binding-health"
                aria-invalid={sourceInvalid}
                disabled={!canInteract || eligibleOptions.length === 0}
                onChange={(event) => {
                  invalidateRevalidation();
                  setDraft({
                    ...draft,
                    credentialId: event.target.value
                  });
                  setOperationError(undefined);
                  setSuccess(undefined);
                }}
                value={draft.credentialId}
              >
                {!draft.credentialId && (
                  <option value="">Выберите активное подключение</option>
                )}
                {draft.credentialId && !selectedEligible && (
                  <option disabled value={draft.credentialId}>
                    {selectedCredential
                      ? `${selectedCredential.label} — ${integrationCredentialStatusPresentation(selectedCredential.status).label}`
                      : `${binding ? integrationProviderLabel(binding.route.provider) : "Подключение"} — отозвано или недоступно`}
                  </option>
                )}
                {eligibleOptions.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.label} ·{" "}
                    {integrationProviderLabel(credential.provider)}
                  </option>
                ))}
              </select>
              <small id="project-connector-source-hint">
                Выбрать можно только проверенный `ACTIVE` BYOK-ключ,
                поддерживающий съём позиций.
              </small>
            </label>

            {selectedCredential ? (
              <div className="project-selected-credential">
                <span className="integration-provider-mark compact">
                  {integrationProviderLabel(
                    selectedCredential.provider
                  ).slice(0, 1)}
                </span>
                <span>
                  <strong>{selectedCredential.label}</strong>
                  <small>
                    {integrationProviderLabel(selectedCredential.provider)} ·{" "}
                    {integrationCredentialModeLabel(selectedCredential.mode)}
                  </small>
                </span>
                <IntegrationStatusBadge status={selectedCredential.status} />
              </div>
            ) : binding ? (
              <div className="project-selected-credential unavailable">
                <span className="integration-provider-mark compact">
                  {integrationProviderLabel(binding.route.provider).slice(
                    0,
                    1
                  )}
                </span>
                <span>
                  <strong>Ранее выбранное подключение</strong>
                  <small>
                    {integrationProviderLabel(binding.route.provider)} ·
                    отозвано или недоступно
                  </small>
                </span>
                <span className="integration-status danger">Недоступно</span>
              </div>
            ) : null}
          </div>

          <aside className="project-binding-facts" aria-label="Условия источника">
            <div>
              <span>Режим</span>
              <strong>Собственный API-ключ</strong>
            </div>
            <div>
              <span>Оплата API</span>
              <strong>На стороне провайдера</strong>
            </div>
            <p>
              Платформа сейчас не списывает стоимость провайдера, но запросы
              тарифицируются по условиям вашего аккаунта у выбранного сервиса.
            </p>
          </aside>
        </div>

        {binding && (
          <label className="project-binding-toggle">
            <span>
              <strong>Использовать источник</strong>
              <small>
                Выключение сохраняет настройку и историю, но запрещает новые
                задания через это подключение.
              </small>
            </span>
            <input
              checked={draft.enabled}
              disabled={!canInteract}
              onChange={(event) => {
                invalidateRevalidation();
                setDraft({ ...draft, enabled: event.target.checked });
                setOperationError(undefined);
                setSuccess(undefined);
              }}
              type="checkbox"
            />
          </label>
        )}

        {eligibleOptions.length === 0 && (
          <div className="project-connector-empty">
            <div>
              <strong>{emptyCredentialTitle}</strong>
              <p>{emptyCredentialDescription}</p>
            </div>
            <a
              className="secondary-button setup-link"
              href="/app/settings/integrations"
            >
              Открыть подключения
            </a>
          </div>
        )}

        {settings.credentialOptionsTruncated && (
          <div
            className="inline-alert info project-credential-options-note"
            role="note"
          >
            <span>
              Показана только часть подключений workspace. Текущий выбранный
              источник включён в список, а остальные доступны на общем экране.
            </span>
            <a
              className="inline-alert-action"
              href="/app/settings/integrations"
            >
              Все подключения
            </a>
          </div>
        )}

        {unavailableOptions.length > 0 && (
          <div className="project-unavailable-credentials">
            <h3>Подключения, которые пока нельзя выбрать</h3>
            <ul>
              {unavailableOptions.map((credential) => (
                <li key={credential.id}>
                  <span>
                    <strong>{credential.label}</strong>
                    <small>
                      {integrationProviderLabel(credential.provider)}
                    </small>
                  </span>
                  <IntegrationStatusBadge status={credential.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {incompatibleOptions.length > 0 && (
          <div className="project-incompatible-credentials">
            <h3>Подключения без функции съёма позиций</h3>
            <p>
              Эти BYOK-ключи доступны в workspace, но их текущие возможности
              не включают `SERP_RANK_TRACKING`.
            </p>
            <ul>
              {incompatibleOptions.map((credential) => (
                <li key={credential.id}>
                  <span>
                    <strong>{credential.label}</strong>
                    <small>
                      {integrationProviderLabel(credential.provider)}
                    </small>
                  </span>
                  <span className="integration-status warning">
                    Нет функции
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel project-locked-features">
        <header className="security-card-header">
          <div>
            <h2>Расширенные возможности</h2>
            <p>
              Эти настройки видны заранее, но не влияют на задания, пока
              соответствующая политика не реализована на сервере.
            </p>
          </div>
        </header>
        <div className="project-locked-grid">
          <LockedFeature
            description="Нет подтверждённой коммерческой схемы, price book и безопасного системного credential pool."
            title="Ключ платформы"
          />
          <LockedFeature
            description="Сбой вашего ключа не переключит задание на другой или платный источник без отдельной явной политики."
            title="Fallback"
          />
          <LockedFeature
            description="Тарификация и списание API-бюджета ещё не подключены, поэтому числовые лимиты не применяются."
            title="Бюджет"
          />
        </div>
      </section>

      <div className="settings-savebar">
        <span aria-live="polite">
          {dirty
            ? "Есть несохранённые изменения"
            : binding
              ? `Сохранено · версия ${binding.version}`
              : `Источник для «${projectName}» не настроен`}
        </span>
        <button
          className="secondary-button"
          disabled={!dirty || saving}
          onClick={resetDraft}
          type="button"
        >
          Отменить
        </button>
        <button
          className="primary-button"
          disabled={
            !dirty ||
            !canEdit ||
            !submitReady ||
            saving ||
            Boolean(conflict)
          }
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function ProjectIntegrationFailure({
  failure,
  online,
  onRetry
}: Readonly<{
  failure: LoadFailure;
  online: boolean;
  onRetry: () => void;
}>) {
  const copy = {
    forbidden: {
      title: "Недостаточно прав",
      action: "Вернуться в приложение"
    },
    "not-found": {
      title: "Проект недоступен",
      action: "К списку проектов"
    },
    offline: {
      title: "Нет соединения",
      action: "Повторить"
    },
    recoverable: {
      title: "Источники временно недоступны",
      action: "Повторить"
    },
    fatal: {
      title: "Не удалось открыть настройки",
      action: "Повторить"
    }
  } as const;
  const value = copy[failure.kind];
  return (
    <section className="panel panel-empty compact project-integration-failure">
      <span aria-hidden="true" className="state-icon">
        {failure.kind === "offline" ? "↻" : "!"}
      </span>
      <strong>{value.title}</strong>
      <p>{failure.message}</p>
      {failure.requestId && (
        <small>Код обращения: {failure.requestId}</small>
      )}
      {failure.kind === "forbidden" || failure.kind === "not-found" ? (
        <a className="secondary-button setup-link" href="/app">
          {value.action}
        </a>
      ) : (
        <button
          className="secondary-button"
          disabled={!online}
          onClick={onRetry}
          type="button"
        >
          {value.action}
        </button>
      )}
    </section>
  );
}

function RequestFeedbackAlert({
  feedback
}: Readonly<{ feedback: RequestFeedback }>) {
  return (
    <div className="inline-alert danger" role="alert">
      <span>{feedback.message}</span>
      {feedback.requestId && (
        <small>Код обращения: {feedback.requestId}</small>
      )}
    </div>
  );
}

function LockedFeature({
  description,
  title
}: Readonly<{ description: string; title: string }>) {
  return (
    <article aria-disabled="true" className="project-locked-card">
      <span className="integration-status muted">Пока недоступно</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function effectiveMutationRestriction(
  settings: ProjectConnectorSettings,
  projectStatus: "DRAFT" | "ACTIVE" | "ARCHIVED",
  workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED",
  runtimeRestriction: ProjectConnectorSettingsMutationRestriction | undefined
): ProjectConnectorSettingsMutationRestriction {
  if (runtimeRestriction) return runtimeRestriction;
  if (projectStatus === "ARCHIVED") return "PROJECT_ARCHIVED";
  if (workspaceStatus !== "ACTIVE") return "WORKSPACE_READ_ONLY";
  if (
    !settings.access.canUpdateBindings ||
    settings.access.mutationRestriction === "MISSING_PERMISSION"
  ) {
    return "MISSING_PERMISSION";
  }
  return settings.access.mutationRestriction;
}

function projectIntegrationLoadFailure(
  error: unknown,
  online: boolean
): LoadFailure {
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Проверьте соединение. Изменения не будут считаться сохранёнными до ответа сервера."
    };
  }
  if (error instanceof BrowserApiError) {
    const requestId = error.requestId
      ? { requestId: error.requestId }
      : {};
    if (error.status === 403) {
      return {
        kind: "forbidden",
        message:
          "Для просмотра проектных источников требуется разрешение integration.view.",
        ...requestId
      };
    }
    if (error.status === 404) {
      return {
        kind: "not-found",
        message: "Проект не найден или доступ к нему был отозван.",
        ...requestId
      };
    }
    if (error.retryable || error.status === 429) {
      return {
        kind: "recoverable",
        message:
          error.status === 429
            ? "Сервис временно ограничил частоту запросов. Повторите позже."
            : "Сервис источников временно недоступен. Повторите запрос — сохранённые настройки не изменились.",
        ...requestId
      };
    }
    return {
      kind: "fatal",
      message:
        error.code === "INVALID_RESPONSE"
          ? "Сервер вернул некорректный ответ."
          : error.message,
      ...requestId
    };
  }
  return {
    kind: "fatal",
    message: "Произошла непредвиденная ошибка при чтении настроек."
  };
}

function projectIntegrationOperationError(
  error: unknown
): RequestFeedback {
  if (error instanceof BrowserApiError) {
    const requestId = error.requestId
      ? { requestId: error.requestId }
      : {};
    if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
      return {
        message:
          "Рабочая область перешла в режим только для чтения. Просмотр сохранён, изменение источника заблокировано.",
        ...requestId
      };
    }
    if (error.status === 429) {
      return {
        message:
          "Сервис временно ограничил частоту изменений. Ваш черновик сохранён — повторите позже.",
        ...requestId
      };
    }
    if (error.code === "FEATURE_NOT_AVAILABLE") {
      return {
        message:
          "Запрошенная политика источника пока недоступна. Platform, fallback и budget остаются выключенными.",
        ...requestId
      };
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return {
        message:
          "Команда создания не совпадает с предыдущей попыткой. Измените выбор или обновите страницу.",
        ...requestId
      };
    }
    if (error.retryable) {
      return {
        message:
          "Сервис временно недоступен. Неизвестно, успел ли сервер принять команду; тот же черновик повторится с тем же ключом.",
        ...requestId
      };
    }
    return { message: error.message, ...requestId };
  }
  return {
    message:
      "Не удалось сохранить источник. Ваш черновик не потерян — проверьте соединение и повторите."
  };
}

function conflictBindingDescription(
  settings: ProjectConnectorSettings
): string {
  const binding = projectConnectorBinding(
    settings,
    RANK_TRACKING_CAPABILITY
  );
  if (!binding) return "источник не настроен";
  const credential = settings.credentialOptions.find(
    ({ id }) => id === binding.route.credentialId
  );
  return credential
    ? `выбрано «${credential.label}», версия ${binding.version}`
    : `${integrationProviderLabel(binding.route.provider)} недоступен, версия ${binding.version}`;
}

function draftCredentialDescription(
  draft: ProjectConnectorDraft,
  settings: ProjectConnectorSettings
): string {
  const credential = settings.credentialOptions.find(
    ({ id }) => id === draft.credentialId
  );
  if (credential) return credential.label;
  return draft.credentialId ? "недоступное подключение" : "не выбрано";
}

function projectIntegrationApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`;
}

function projectIntegrationReturnTo(projectId: string): string {
  return `/app/projects/${encodeURIComponent(projectId)}/settings/integrations`;
}

async function fetchProjectConnectorSettings(
  projectId: string,
  signal?: AbortSignal
): Promise<ProjectConnectorSettings> {
  return browserApiRequest<ProjectConnectorSettings>(
    projectIntegrationApiPath(projectId),
    signal ? { signal } : {}
  );
}

function redirectForExpiredSession(
  error: unknown,
  returnTo: string
): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) {
    return false;
  }
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
  );
  return true;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
