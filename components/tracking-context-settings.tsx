"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type {
  TrackingContextMutationRestriction,
  TrackingContextSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import {
  effectiveTrackingContextRestriction,
  emptyTrackingContextDraft,
  reconcileTrackingContextCreate,
  reconcileTrackingContextEditorRevision,
  trackingContextApiPath,
  trackingContextDraft,
  trackingContextDraftDirty,
  type TrackingContextDraft,
  type TrackingContextDraftErrors,
  type TrackingContextDraftField,
  trackingContextPayloadSignature,
  trackingContextRestrictionMessage,
  trackingContextsApiPath,
  trackingContextsReturnTo,
  trackingContextUpdateInput,
  trackingContextCreateInput,
  validateTrackingContextDraft,
  withTrackingContext
} from "../lib/tracking-contexts";
import {
  type IdempotentCommand,
  stableIdempotencyCommand
} from "../lib/idempotency";
import {
  trackingDeviceLabel as deviceLabel,
  trackingDomainMatchLabel as domainMatchLabel,
  trackingGeographyLabel as geographyLabel,
  trackingSearchEngineLabel as searchEngineLabel
} from "../lib/tracking-context-presentation";
import { TrackingContextEditor } from "./tracking-context-editor";
import { TrackingContextKeywords } from "./tracking-context-keywords";

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

type EditorState =
  | {
      readonly mode: "create";
      readonly draft: TrackingContextDraft;
    }
  | {
      readonly mode: "edit";
      readonly base: TrackingContextSummary;
      readonly draft: TrackingContextDraft;
    };

interface ConflictState {
  readonly server: TrackingContextSummary;
  readonly draft?: TrackingContextDraft;
  readonly kind: "edit" | "archive" | "restore";
}

interface BusyAction {
  readonly contextId: string;
  readonly kind: "archive" | "restore";
}

export function TrackingContextSettings({
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
  const [settings, setSettings] =
    useState<Awaited<ReturnType<typeof fetchTrackingContextSettings>>>();
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure>();
  const [retryVersion, setRetryVersion] = useState(0);
  const [online, setOnline] = useState(true);
  const [editor, setEditor] = useState<EditorState>();
  const [draftErrors, setDraftErrors] =
    useState<TrackingContextDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const [keywordBusy, setKeywordBusy] = useState(false);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string>();
  const [selectedKeywordContextId, setSelectedKeywordContextId] =
    useState<string>();
  const [operationError, setOperationError] =
    useState<RequestFeedback>();
  const [success, setSuccess] = useState<string>();
  const [conflict, setConflict] = useState<ConflictState>();
  const [runtimeRestriction, setRuntimeRestriction] =
    useState<TrackingContextMutationRestriction>();
  const operationLock = useRef(false);
  const settingsRef = useRef<typeof settings>(undefined);
  const createCommand = useRef<IdempotentCommand | undefined>(
    undefined
  );
  const feedbackRef = useRef<HTMLDivElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const returnTo = trackingContextsReturnTo(projectId);
  settingsRef.current = settings;

  useEffect(() => {
    const controller = new AbortController();
    const revalidating = Boolean(settingsRef.current);
    setLoading(true);
    setLoadFailure(undefined);
    void fetchTrackingContextSettings(projectId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setRuntimeRestriction(undefined);
        setOperationError(undefined);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (redirectForExpiredSession(error, returnTo)) return;
        const failure = trackingContextLoadFailure(
          error,
          navigator.onLine
        );
        if (
          revalidating &&
          failure.kind !== "forbidden" &&
          failure.kind !== "not-found"
        ) {
          setOperationError(failure);
        } else {
          setSettings(undefined);
          setLoadFailure(failure);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, retryVersion, returnTo]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const dirty = Boolean(
    editor &&
      trackingContextDraftDirty(
        editor.mode === "edit" ? editor.base : undefined,
        editor.draft
      )
  );

  useEffect(() => {
    if (!dirty) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () =>
      window.removeEventListener(
        "beforeunload",
        protectUnsavedChanges
      );
  }, [dirty]);

  useEffect(() => {
    if (editor?.mode !== "create" || !createCommand.current) return;
    if (
      createCommand.current.payloadSignature !==
      trackingContextPayloadSignature(editor.draft)
    ) {
      createCommand.current = undefined;
    }
  }, [editor]);

  useEffect(() => {
    if (operationError || success || conflict) {
      feedbackRef.current?.focus();
    }
  }, [conflict, operationError, success]);

  const restriction = useMemo(
    () =>
      settings
        ? effectiveTrackingContextRestriction(
            settings,
            projectStatus,
            workspaceStatus,
            runtimeRestriction
          )
        : undefined,
    [
      projectStatus,
      runtimeRestriction,
      settings,
      workspaceStatus
    ]
  );
  const mutationAllowed =
    restriction === "NONE" && online && !loading;
  const anyBusy = saving || Boolean(busyAction) || keywordBusy;

  function updateDraft(next: TrackingContextDraft): void {
    setEditor((current) =>
      current
        ? current.mode === "create"
          ? { mode: "create", draft: next }
          : { ...current, draft: next }
        : current
    );
    setDraftErrors({});
    setOperationError(undefined);
    setSuccess(undefined);
  }

  function openCreate(): void {
    if (!mutationAllowed || anyBusy) return;
    if (!discardCurrentDraft()) return;
    createCommand.current = undefined;
    setEditor({
      mode: "create",
      draft: emptyTrackingContextDraft()
    });
    setDraftErrors({});
    setConflict(undefined);
    setOperationError(undefined);
    setSuccess(undefined);
    setArchiveConfirmId(undefined);
  }

  function openEdit(context: TrackingContextSummary): void {
    if (
      !mutationAllowed ||
      context.status === "ARCHIVED" ||
      (editor?.mode === "edit" && editor.base.id === context.id) ||
      anyBusy
    ) {
      return;
    }
    if (!discardCurrentDraft(context.id)) return;
    createCommand.current = undefined;
    setEditor({
      mode: "edit",
      base: context,
      draft: trackingContextDraft(context)
    });
    setDraftErrors({});
    setConflict(undefined);
    setOperationError(undefined);
    setSuccess(undefined);
    setArchiveConfirmId(undefined);
  }

  function discardCurrentDraft(nextContextId?: string): boolean {
    if (
      !editor ||
      (editor.mode === "edit" && editor.base.id === nextContextId)
    ) {
      return true;
    }
    if (
      dirty &&
      !window.confirm(
        "Отменить несохранённые изменения контекста? Восстановить их после закрытия формы не получится."
      )
    ) {
      return false;
    }
    setEditor(undefined);
    setDraftErrors({});
    setConflict(undefined);
    createCommand.current = undefined;
    return true;
  }

  function closeEditor(): void {
    if (!discardCurrentDraft()) return;
    setEditor(undefined);
  }

  function openKeywords(contextId: string): void {
    if (!discardCurrentDraft()) return;
    setSelectedKeywordContextId((current) =>
      current === contextId ? undefined : contextId
    );
    setOperationError(undefined);
    setSuccess(undefined);
  }

  async function submitEditor(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (
      !editor ||
      !settings ||
      !mutationAllowed ||
      anyBusy ||
      operationLock.current ||
      conflict
    ) {
      return;
    }
    const errors = validateTrackingContextDraft(editor.draft);
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      requestAnimationFrame(() => {
        const firstInvalid =
          errorSummaryRef.current
            ?.closest("form")
            ?.querySelector<HTMLElement>('[aria-invalid="true"]');
        (firstInvalid ?? errorSummaryRef.current)?.focus();
      });
      return;
    }

    operationLock.current = true;
    setSaving(true);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      if (editor.mode === "create") {
        await createContext(editor.draft);
      } else {
        const updated = await browserApiRequest<TrackingContextSummary>(
          trackingContextApiPath(projectId, editor.base.id),
          {
            method: "PATCH",
            ifMatch: editor.base.version,
            body: trackingContextUpdateInput(editor.draft)
          }
        );
        setSettings((current) =>
          current ? withTrackingContext(current, updated) : current
        );
        setEditor(undefined);
        setDraftErrors({});
        setConflict(undefined);
        setSuccess(`Контекст «${updated.name}» сохранён`);
      }
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      if (
        error instanceof BrowserApiError &&
        (error.status === 412 || error.code === "VERSION_CONFLICT") &&
        editor.mode === "edit"
      ) {
        await loadConflict(
          error,
          editor.base.id,
          "edit",
          editor.draft
        );
      } else {
        await handleMutationFailure(error);
      }
    } finally {
      operationLock.current = false;
      setSaving(false);
    }
  }

  async function createContext(
    draft: TrackingContextDraft
  ): Promise<void> {
    const signature = trackingContextPayloadSignature(draft);
    createCommand.current = stableIdempotencyCommand(
      createCommand.current,
      signature,
      () => `tracking-context:${globalThis.crypto.randomUUID()}`
    );
    const receipt = await browserApiRequest<TrackingContextSummary>(
      trackingContextsApiPath(projectId),
      {
        method: "POST",
        idempotencyKey: createCommand.current.key,
        body: trackingContextCreateInput(draft)
      }
    );
    const authoritative = await browserApiRequest<TrackingContextSummary>(
      trackingContextApiPath(projectId, receipt.id)
    );
    const reconciliation = reconcileTrackingContextCreate(
      receipt,
      authoritative
    );
    setSettings((current) =>
      current
        ? withTrackingContext(current, reconciliation.current)
        : current
    );
    createCommand.current = undefined;
    setDraftErrors({});
    if (reconciliation.superseded) {
      setEditor({
        mode: "edit",
        base: reconciliation.current,
        draft
      });
      setConflict({
        kind: "edit",
        server: reconciliation.current,
        draft
      });
      setOperationError({
        message:
          "Контекст создан, но другой участник уже изменил его. Ваш исходный черновик сохранён для сравнения."
      });
      return;
    }
    setEditor(undefined);
    setConflict(undefined);
    setSuccess(`Контекст «${authoritative.name}» создан`);
  }

  async function changeStatus(
    context: TrackingContextSummary,
    kind: "archive" | "restore"
  ): Promise<void> {
    if (
      !settings ||
      !mutationAllowed ||
      anyBusy ||
      operationLock.current
    ) {
      return;
    }
    operationLock.current = true;
    setBusyAction({ contextId: context.id, kind });
    setArchiveConfirmId(undefined);
    setOperationError(undefined);
    setSuccess(undefined);
    try {
      const updated = await browserApiRequest<TrackingContextSummary>(
        `${trackingContextApiPath(projectId, context.id)}/${kind}`,
        {
          method: "POST",
          ifMatch: context.version
        }
      );
      setSettings((current) =>
        current ? withTrackingContext(current, updated) : current
      );
      if (
        editor?.mode === "edit" &&
        editor.base.id === updated.id
      ) {
        setEditor(undefined);
      }
      setConflict(undefined);
      setSuccess(
        kind === "archive"
          ? `Контекст «${updated.name}» архивирован. История и назначения сохранены.`
          : `Контекст «${updated.name}» восстановлен`
      );
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      if (
        error instanceof BrowserApiError &&
        (error.status === 412 || error.code === "VERSION_CONFLICT")
      ) {
        await loadConflict(error, context.id, kind);
      } else {
        await handleMutationFailure(error);
      }
    } finally {
      operationLock.current = false;
      setBusyAction(undefined);
    }
  }

  async function loadConflict(
    error: BrowserApiError,
    contextId: string,
    kind: ConflictState["kind"],
    draft?: TrackingContextDraft
  ): Promise<void> {
    try {
      const server = await browserApiRequest<TrackingContextSummary>(
        trackingContextApiPath(projectId, contextId)
      );
      setConflict({
        server,
        kind,
        ...(draft ? { draft } : {})
      });
      setOperationError({
        message:
          kind === "edit"
            ? "Контекст изменён другим участником. Ваш черновик не потерян — сравните версии перед повтором."
            : "Статус контекста уже изменён другим участником. Обновите локальную версию перед следующим действием.",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
    } catch (refreshError) {
      if (redirectForExpiredSession(refreshError, returnTo)) return;
      setOperationError({
        message:
          "Обнаружена более новая версия, но загрузить её пока не удалось. Ваши несохранённые данные не потеряны.",
        ...(error.requestId ? { requestId: error.requestId } : {})
      });
    }
  }

  async function handleMutationFailure(error: unknown): Promise<void> {
    if (error instanceof BrowserApiError) {
      if (error.fieldErrors.length > 0) {
        const errors = trackingContextFieldErrors(error);
        if (Object.keys(errors).length > 0) {
          setDraftErrors(errors);
          requestAnimationFrame(() =>
            errorSummaryRef.current?.focus()
          );
        }
      }
      if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
        setRuntimeRestriction("WORKSPACE_READ_ONLY");
      }
      if (error.status === 403) {
        setRuntimeRestriction("MISSING_PERMISSION");
        await revalidateSettingsAccess();
      }
      if (
        error.status === 409 &&
        error.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        try {
          const refreshed = await fetchTrackingContextSettings(
            projectId
          );
          setSettings(refreshed);
          if (
            refreshed.access.mutationRestriction !== "NONE"
          ) {
            setRuntimeRestriction(
              refreshed.access.mutationRestriction
            );
          }
          if (editor?.mode === "edit") {
            const current =
              refreshed.contexts.find(
                ({ id }) => id === editor.base.id
              ) ??
              (await browserApiRequest<TrackingContextSummary>(
                trackingContextApiPath(projectId, editor.base.id)
              ));
            setSettings((value) =>
              value ? withTrackingContext(value, current) : value
            );
            setConflict({
              kind: "edit",
              server: current,
              draft: editor.draft
            });
          }
        } catch {
          // The original actionable error remains authoritative.
        }
      }
    }
    setOperationError(trackingContextOperationError(error, online));
  }

  async function revalidateSettingsAccess(): Promise<void> {
    try {
      const refreshed = await fetchTrackingContextSettings(projectId);
      setSettings(refreshed);
      setRuntimeRestriction(
        refreshed.access.mutationRestriction === "NONE"
          ? undefined
          : refreshed.access.mutationRestriction
      );
    } catch (error) {
      if (redirectForExpiredSession(error, returnTo)) return;
      if (
        error instanceof BrowserApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        setSettings(undefined);
        setLoadFailure(
          trackingContextLoadFailure(error, navigator.onLine)
        );
        setEditor(undefined);
        setSelectedKeywordContextId(undefined);
        setConflict(undefined);
        createCommand.current = undefined;
      }
    }
  }

  function acceptServerConflict(): void {
    if (!conflict || !settings) return;
    setSettings((current) =>
      current
        ? withTrackingContext(current, conflict.server)
        : current
    );
    if (conflict.kind === "edit") {
      setEditor(
        conflict.server.status === "ARCHIVED"
          ? undefined
          : {
              mode: "edit",
              base: conflict.server,
              draft: trackingContextDraft(conflict.server)
            }
      );
    } else if (editor?.mode === "edit") {
      const reconciled = reconcileTrackingContextEditorRevision(
        editor,
        conflict.server
      );
      setEditor(
        reconciled
          ? {
              mode: "edit",
              ...reconciled
            }
          : undefined
      );
    }
    setConflict(undefined);
    setOperationError(undefined);
    setDraftErrors({});
  }

  function continueWithDraft(): void {
    if (
      !conflict ||
      conflict.kind !== "edit" ||
      !conflict.draft ||
      !settings ||
      conflict.server.status === "ARCHIVED"
    ) {
      return;
    }
    setSettings((current) =>
      current
        ? withTrackingContext(current, conflict.server)
        : current
    );
    setEditor({
      mode: "edit",
      base: conflict.server,
      draft: conflict.draft
    });
    setConflict(undefined);
    setOperationError(undefined);
    setDraftErrors({});
  }

  if (loading && !settings) {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="panel tracking-context-loading"
      >
        <span aria-hidden="true" className="spinner" />
        <div>
          <strong>Загружаем контексты отслеживания…</strong>
          <p>
            Получаем актуальные версии и права доступа проекта.
          </p>
        </div>
      </section>
    );
  }

  if (!settings) {
    const failure = loadFailure ?? {
      kind: "fatal" as const,
      message: "Не удалось загрузить контексты отслеживания."
    };
    return (
      <section className="panel panel-empty tracking-context-failure">
        <span className="state-icon" aria-hidden="true">
          {failure.kind === "offline" ? "↯" : "!"}
        </span>
        <strong>{loadFailureTitle(failure.kind)}</strong>
        <p>{failure.message}</p>
        {failure.requestId && (
          <small>Код запроса: {failure.requestId}</small>
        )}
        {!["forbidden", "not-found"].includes(failure.kind) && (
          <button
            className="secondary-button"
            disabled={!online}
            onClick={() => setRetryVersion((value) => value + 1)}
            type="button"
          >
            {online ? "Повторить" : "Ждём соединение"}
          </button>
        )}
      </section>
    );
  }

  const restrictionMessage = restriction
    ? trackingContextRestrictionMessage(restriction)
    : undefined;

  return (
    <div className="tracking-context-stack">
      <div
        className="tracking-context-feedback"
        ref={feedbackRef}
        tabIndex={-1}
      >
        {!online && (
          <div className="inline-alert warning" role="status">
            Офлайн-режим: загруженные данные доступны для просмотра, но
            изменения и поиск не ставятся в локальную очередь.
          </div>
        )}
        {online && loading && (
          <div className="inline-alert info" role="status">
            Обновляем контексты, текущие данные остаются видимыми…
          </div>
        )}
        {restrictionMessage && (
          <div className="inline-alert warning" role="note">
            {restrictionMessage}
          </div>
        )}
        {operationError && (
          <FeedbackAlert feedback={operationError} />
        )}
        {success && (
          <div className="inline-alert success" role="status">
            {success}
          </div>
        )}
        {conflict && (
          <section
            className="inline-alert warning tracking-context-conflict"
            role="alert"
          >
            <div>
              <strong>Найдена более новая версия</strong>
              <p>
                На сервере «{conflict.server.name}», версия{" "}
                {conflict.server.version}
                {conflict.server.status === "ARCHIVED"
                  ? ", контекст архивирован"
                  : ""}.
                {conflict.kind === "edit" && conflict.draft
                  ? " Ваш черновик сохранён отдельно."
                  : " Локальный список ещё не перезаписан."}
              </p>
            </div>
            <div className="tracking-context-conflict-actions">
              <button
                className="secondary-button"
                disabled={anyBusy}
                onClick={acceptServerConflict}
                type="button"
              >
                Принять серверную
              </button>
              {conflict.kind === "edit" &&
                conflict.draft &&
                conflict.server.status !== "ARCHIVED" && (
                  <button
                    className="primary-button"
                    disabled={anyBusy}
                    onClick={continueWithDraft}
                    type="button"
                  >
                    Продолжить с черновиком
                  </button>
                )}
            </div>
          </section>
        )}
      </div>

      <section className="panel tracking-context-overview">
        <header className="security-card-header">
          <div>
            <h2>Поисковые конфигурации</h2>
            <p>
              {formatInteger(settings.contexts.length)}{" "}
              {contextCountLabel(settings.contexts.length)} в загруженной
              выборке. Источник данных и автоматизация настраиваются отдельно.
            </p>
          </div>
          <div className="tracking-context-overview-actions">
            <button
              className="secondary-button"
              disabled={!online || loading || anyBusy || Boolean(editor)}
              onClick={() =>
                setRetryVersion((value) => value + 1)
              }
              type="button"
            >
              {loading ? "Обновляем…" : "Обновить"}
            </button>
            <button
              className="primary-button"
              disabled={!mutationAllowed || anyBusy}
              onClick={openCreate}
              title={
                mutationAllowed
                  ? undefined
                  : restrictionMessage ??
                    "Для изменения требуется подключение к сети"
              }
              type="button"
            >
              Создать контекст
            </button>
          </div>
        </header>
        <div className="tracking-context-boundary-note">
          <span>
            Здесь хранятся только engine, страна/регион, язык, устройство,
            глубина, domain match и SafeSearch.
          </span>
          <a
            href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}
          >
            Источники проекта
          </a>
        </div>
        {settings.contextsTruncated && (
          <div className="inline-alert info" role="note">
            Показаны первые 200 контекстов. Коллекция усечена сервером; точный
            контекст после создания всё равно будет добавлен в текущий список.
          </div>
        )}
      </section>

      {editor && (
        <TrackingContextEditor
          draft={editor.draft}
          errors={draftErrors}
          errorSummaryRef={errorSummaryRef}
          mode={editor.mode}
          onCancel={closeEditor}
          onChange={updateDraft}
          onSubmit={submitEditor}
          saving={saving}
          submitDisabled={
            !mutationAllowed ||
            anyBusy ||
            Boolean(conflict) ||
            !dirty
          }
        />
      )}

      {settings.contexts.length === 0 ? (
        <section className="panel panel-empty tracking-context-empty">
          <span className="state-icon" aria-hidden="true">
            0
          </span>
          <strong>Контекстов пока нет</strong>
          <p>
            Создайте первую неизменяемую поисковую конфигурацию, затем
            назначьте ей запросы семантического ядра.
          </p>
          {mutationAllowed && (
            <button
              className="primary-button"
              onClick={openCreate}
              type="button"
            >
              Создать первый контекст
            </button>
          )}
        </section>
      ) : (
        <section
          aria-busy={Boolean(busyAction)}
          aria-label="Список контекстов отслеживания"
          className="tracking-context-list"
        >
          {settings.contexts.map((context) => {
            const actionBusy =
              busyAction?.contextId === context.id
                ? busyAction.kind
                : undefined;
            const confirmingArchive =
              archiveConfirmId === context.id;
            const editingContext =
              editor?.mode === "edit" &&
              editor.base.id === context.id;
            return (
              <article
                className={`panel tracking-context-card ${
                  context.status === "ARCHIVED" ? "archived" : ""
                }`}
                key={context.id}
              >
                <header className="tracking-context-card-header">
                  <div>
                    <span
                      className={`integration-status ${
                        context.status === "ACTIVE"
                          ? "active"
                          : "muted"
                      }`}
                    >
                      {context.status === "ACTIVE"
                        ? "Активен"
                        : "В архиве"}
                    </span>
                    <h2>{context.name}</h2>
                    <p>
                      Версия записи {context.version} · конфигурация{" "}
                      {context.configuration.configurationVersion}
                    </p>
                  </div>
                  <div className="tracking-context-card-actions">
                    <button
                      className="secondary-button"
                      disabled={anyBusy}
                      onClick={() => openKeywords(context.id)}
                      type="button"
                    >
                      {selectedKeywordContextId === context.id
                        ? "Закрыть запросы"
                        : `Запросы · ${formatInteger(
                            context.assignedKeywordCount
                          )}`}
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        !mutationAllowed ||
                        anyBusy ||
                        context.status === "ARCHIVED" ||
                        editingContext
                      }
                      onClick={() => openEdit(context)}
                      title={
                        context.status === "ARCHIVED"
                          ? "Сначала восстановите контекст"
                          : editingContext
                            ? "Форма этого контекста уже открыта"
                          : undefined
                      }
                      type="button"
                    >
                      Изменить
                    </button>
                    {context.status === "ACTIVE" ? (
                      <button
                        className="text-button danger-text"
                        disabled={
                          !mutationAllowed ||
                          anyBusy ||
                          editingContext
                        }
                        onClick={() =>
                          setArchiveConfirmId(
                            confirmingArchive
                              ? undefined
                              : context.id
                          )
                        }
                        title={
                          editingContext
                            ? "Сначала сохраните или закройте форму изменений"
                            : undefined
                        }
                        type="button"
                      >
                        Архивировать
                      </button>
                    ) : (
                      <button
                        className="text-button"
                        disabled={!mutationAllowed || anyBusy}
                        onClick={() =>
                          void changeStatus(context, "restore")
                        }
                        type="button"
                      >
                        {actionBusy === "restore"
                          ? "Восстанавливаем…"
                          : "Восстановить"}
                      </button>
                    )}
                  </div>
                </header>

                <dl className="tracking-context-facts">
                  <Fact
                    label="Поиск"
                    value={searchEngineLabel(
                      context.configuration.searchEngine
                    )}
                  />
                  <Fact
                    label="География"
                    value={geographyLabel(context)}
                  />
                  <Fact
                    label="Язык"
                    value={context.configuration.language}
                  />
                  <Fact
                    label="Устройство"
                    value={deviceLabel(context.configuration.device)}
                  />
                  <Fact
                    label="Глубина"
                    value={`TOP-${context.configuration.depth}`}
                  />
                  <Fact
                    label="Сопоставление"
                    value={domainMatchLabel(
                      context.configuration.domainMatchRule
                    )}
                  />
                  <Fact
                    label="SafeSearch"
                    value={
                      context.configuration.safeSearch
                        ? "Включён"
                        : "Выключен"
                    }
                  />
                  <Fact
                    label="Обновлён"
                    value={formatDate(context.updatedAt)}
                  />
                </dl>

                {confirmingArchive && (
                  <div
                    className="inline-alert warning tracking-context-archive-confirm"
                    role="alert"
                  >
                    <span>
                      Архивировать «{context.name}»? История и назначения
                      останутся доступны, но новые операции для этого
                      контекста будут запрещены.
                    </span>
                    <div>
                      <button
                        className="secondary-button"
                        onClick={() => setArchiveConfirmId(undefined)}
                        type="button"
                      >
                        Отмена
                      </button>
                      <button
                        className="secondary-button danger-button"
                        disabled={!mutationAllowed || anyBusy}
                        onClick={() =>
                          void changeStatus(context, "archive")
                        }
                        type="button"
                      >
                        {actionBusy === "archive"
                          ? "Архивируем…"
                          : "Подтвердить архивирование"}
                      </button>
                    </div>
                  </div>
                )}

                {selectedKeywordContextId === context.id && (
                  <TrackingContextKeywords
                    canMutate={
                      mutationAllowed &&
                      !anyBusy &&
                      context.status === "ACTIVE"
                    }
                    context={context}
                    onAccessRevalidate={revalidateSettingsAccess}
                    onBusyChange={setKeywordBusy}
                    onContextChange={(updated) =>
                      setSettings((current) =>
                        current
                          ? withTrackingContext(current, updated)
                          : current
                      )
                    }
                    onRestriction={setRuntimeRestriction}
                    online={online}
                    projectId={projectId}
                    returnTo={returnTo}
                  />
                )}
              </article>
            );
          })}
        </section>
      )}

      <p className="tracking-context-footnote">
        Контексты не удаляются автоматически. Архивирование сохраняет
        агрегированную историю и доступ к уже полученным результатам проекта
        «{projectName}».
      </p>
    </div>
  );
}

function Fact({
  label,
  value
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FeedbackAlert({
  feedback
}: Readonly<{ feedback: RequestFeedback }>) {
  return (
    <div className="inline-alert danger" role="alert">
      <span>{feedback.message}</span>
      {feedback.requestId && (
        <small>Код запроса: {feedback.requestId}</small>
      )}
    </div>
  );
}

function trackingContextFieldErrors(
  error: BrowserApiError
): TrackingContextDraftErrors {
  const pathToField: Readonly<
    Record<string, TrackingContextDraftField>
  > = {
    name: "name",
    "configuration.countryCode": "countryCode",
    "configuration.regionCode": "regionCode",
    "configuration.regionLabel": "regionLabel",
    "configuration.language": "language",
    "configuration.domainMatchRule": "domainMatchValue",
    "configuration.domainMatchRule.value": "domainMatchValue"
  };
  const result: Partial<
    Record<TrackingContextDraftField, string>
  > = {};
  for (const fieldError of error.fieldErrors) {
    const field = pathToField[fieldError.path];
    if (field) {
      result[field] =
        fieldError.message ?? "Сервер отклонил это значение.";
    }
  }
  return result;
}

function trackingContextLoadFailure(
  error: unknown,
  online: boolean
): LoadFailure {
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Проверьте соединение. Без authoritative GET локальные данные не считаются актуальными."
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
          "Для просмотра контекстов требуется разрешение ranking.view.",
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
            ? "Сервис ограничил частоту запросов. Повторите позже."
            : "Сервис контекстов временно недоступен. Сохранённые данные не изменились.",
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
    message: "Произошла непредвиденная ошибка при чтении контекстов."
  };
}

function trackingContextOperationError(
  error: unknown,
  online: boolean
): RequestFeedback {
  if (!online || error instanceof TypeError) {
    return {
      message:
        "Соединение потеряно. Команда не добавлена в локальную очередь; черновик сохранён только в этой вкладке."
    };
  }
  if (error instanceof BrowserApiError) {
    const requestId = error.requestId
      ? { requestId: error.requestId }
      : {};
    if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
      return {
        message:
          "Рабочая область перешла в режим только для чтения. Просмотр истории остаётся доступен.",
        ...requestId
      };
    }
    if (error.status === 403) {
      return {
        message:
          "Право изменения контекстов отозвано. Текущий черновик не отправлен.",
        ...requestId
      };
    }
    if (error.status === 409) {
      return {
        message:
          error.code === "IDEMPOTENCY_CONFLICT"
            ? "Ключ повтора уже связан с другим содержимым. Измените черновик или обновите страницу."
            : "Состояние проекта или контекста изменилось. Обновите данные перед повтором.",
        ...requestId
      };
    }
    if (error.status === 429) {
      return {
        message:
          "Сервис временно ограничил частоту изменений. Черновик сохранён — повторите позже.",
        ...requestId
      };
    }
    if (error.retryable) {
      return {
        message:
          "Сервис временно недоступен. Для создания тот же черновик будет повторён с тем же Idempotency-Key.",
        ...requestId
      };
    }
    return { message: error.message, ...requestId };
  }
  return {
    message:
      "Не удалось сохранить изменения. Черновик остаётся в этой вкладке."
  };
}

async function fetchTrackingContextSettings(
  projectId: string,
  signal?: AbortSignal
) {
  return browserApiRequest<
    import("@seo-platform/contracts").TrackingContextSettings
  >(trackingContextsApiPath(projectId), signal ? { signal } : {});
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function contextCountLabel(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "контекстов";
  if (mod10 === 1) return "контекст";
  if (mod10 >= 2 && mod10 <= 4) return "контекста";
  return "контекстов";
}

function loadFailureTitle(kind: LoadFailure["kind"]): string {
  const titles: Readonly<Record<LoadFailure["kind"], string>> = {
    fatal: "Не удалось открыть контексты",
    forbidden: "Недостаточно прав",
    "not-found": "Проект недоступен",
    offline: "Нет соединения",
    recoverable: "Сервис временно недоступен"
  };
  return titles[kind];
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
