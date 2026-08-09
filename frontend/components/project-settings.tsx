"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  canArchiveProject,
  canDeleteProject,
  canRestoreProject,
  canUpdateProject
} from "../lib/app-permissions";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import {
  isDuplicateDomainConflict,
  isVersionConflict,
  projectLifecycleConfirmationMatches,
  projectSettingsDraftAfterSave,
  projectSettingsDirty,
  projectSettingsDraft,
  projectStatusLabel,
  projectUpdateInput,
  tenantApiFieldErrors,
  tenantOperationFailure,
  validateProjectSettings,
  type ProjectSettingsField,
  type TenantOperationFailure,
  type TenantSettingsFieldErrors
} from "../lib/tenant-settings";

const PROJECT_FIELDS = ["name", "domain", "locale", "timezone"] as const;
type LifecycleAction = "archive" | "restore";
type ConflictKind = "save" | LifecycleAction;
interface ProjectDeletionReceipt {
  readonly projectId: string;
  readonly status: "DELETED";
  readonly deletedAt: string;
}

export function ProjectSettings({
  project,
  workspaceRoleCode,
  workspaceStatus
}: Readonly<{
  project: AppProject;
  workspaceRoleCode: string;
  workspaceStatus: AppWorkspace["status"];
}>) {
  const router = useRouter();
  const [server, setServer] = useState(project);
  const [draft, setDraft] = useState(() => projectSettingsDraft(project));
  const [fieldErrors, setFieldErrors] = useState<TenantSettingsFieldErrors>({});
  const [failure, setFailure] = useState<TenantOperationFailure>();
  const [success, setSuccess] = useState<string>();
  const [conflict, setConflict] = useState<ConflictKind>();
  const [duplicateConfirmation, setDuplicateConfirmation] = useState(false);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction>();
  const [confirmationText, setConfirmationText] = useState("");
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [busy, setBusy] = useState<
    "save" | "reload" | "retry" | "delete" | LifecycleAction
  >();
  const [online, setOnline] = useState(true);
  const [runtimeRestriction, setRuntimeRestriction] = useState<
    "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY"
  >();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const deleteConfirmationRef = useRef<HTMLInputElement>(null);

  const dirty = useMemo(
    () => projectSettingsDirty(server, draft),
    [draft, server]
  );
  const workspaceMutable =
    workspaceStatus === "ACTIVE" &&
    runtimeRestriction !== "WORKSPACE_READ_ONLY";
  const lifecycleMutable =
    workspaceMutable && runtimeRestriction !== "MISSING_PERMISSION";
  const roleAllowsUpdate = canUpdateProject(
    workspaceRoleCode,
    server.projectAccessLevel
  );
  const editAllowed =
    roleAllowsUpdate &&
    server.status !== "ARCHIVED" &&
    workspaceMutable &&
    runtimeRestriction !== "MISSING_PERMISSION";
  const canSubmitEdit = editAllowed && online && !busy;
  const editRestriction = projectEditRestrictionMessage(
    server,
    workspaceStatus,
    roleAllowsUpdate,
    runtimeRestriction
  );

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

  useEffect(() => {
    if (!dirty) return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () =>
      window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [dirty]);

  useEffect(() => {
    if (failure || success || conflict) feedbackRef.current?.focus();
  }, [conflict, failure, success]);

  useEffect(() => {
    if (confirmAction) confirmationRef.current?.focus();
  }, [confirmAction]);

  useEffect(() => {
    if (deleteConfirmationOpen) deleteConfirmationRef.current?.focus();
  }, [deleteConfirmationOpen]);

  function updateDraft(field: ProjectSettingsField, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(undefined);
    setDuplicateConfirmation(false);
  }

  function discardDraft(): void {
    setDraft(projectSettingsDraft(server));
    setFieldErrors({});
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(undefined);
    setDuplicateConfirmation(false);
  }

  async function submitSettings(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (!canSubmitEdit || !dirty) return;
    const errors = validateProjectSettings(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFailure({ message: "Проверьте отмеченные поля." });
      focusFirstInvalid();
      return;
    }
    await saveProject(server.version, false, "save");
  }

  async function saveProject(
    version: number,
    confirmDuplicateDomain: boolean,
    operation: "save" | "retry",
    bypassBusy = false
  ): Promise<void> {
    if ((busy && !bypassBusy) || !online) return;
    const submittedDraft = draft;
    setBusy(operation);
    setFailure(undefined);
    setSuccess(undefined);
    setFieldErrors({});
    try {
      const updated = await browserApiRequest<AppProject>(
        projectPath(server.id),
        {
          method: "PATCH",
          ifMatch: version,
          body: projectUpdateInput(submittedDraft, confirmDuplicateDomain)
        }
      );
      acceptUpdatedProject(updated, submittedDraft);
      setSuccess("Настройки проекта сохранены.");
    } catch (error) {
      if (redirectExpiredSession(error, server.id)) return;
      if (isVersionConflict(error)) {
        setConflict("save");
        setDuplicateConfirmation(false);
        setFailure({
          message:
            "Проект изменён другим участником. Ваш черновик сохранён — загрузите серверную версию или повторите поверх новой версии.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
      } else if (isDuplicateDomainConflict(error)) {
        setDuplicateConfirmation(true);
        setFailure({
          message:
            "В рабочей области уже есть проект с этим доменом. Подтвердите осознанное сохранение дубликата.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
      } else {
        handleFailure(error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function reloadConflict(retryDraft: boolean): Promise<void> {
    if (!conflict || busy || !online) return;
    const conflictKind = conflict;
    setBusy(retryDraft ? "retry" : "reload");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const current = await browserApiRequest<AppProject>(projectPath(server.id));
      setServer(current);
      setRuntimeRestriction(undefined);
      if (!retryDraft) {
        setDraft(projectSettingsDraft(current));
        setFieldErrors({});
        setConflict(undefined);
        setConfirmAction(undefined);
        setConfirmationText("");
        setSuccess("Загружена актуальная серверная версия проекта.");
        writeTenantContext(current);
        router.refresh();
        return;
      }
      if (conflictKind === "save") {
        if (current.status === "ARCHIVED" || !workspaceMutable) {
          setConflict(undefined);
          setFailure({
            message:
              "Новая серверная версия доступна только для чтения. Ваш черновик сохранён в форме."
          });
          return;
        }
        await saveProject(current.version, false, "retry", true);
        return;
      }
      setDraft(projectSettingsDraft(current));
      setFieldErrors({});
      if (lifecycleReached(current, conflictKind)) {
        acceptUpdatedProject(current);
        setSuccess(lifecycleSuccessMessage(current, conflictKind));
        return;
      }
      if (!projectLifecycleConfirmationMatches(current, confirmationText)) {
        setConflict(undefined);
        setConfirmAction(conflictKind);
        setConfirmationText("");
        setFailure({
          message:
            "Название проекта изменилось после подтверждения. Проверьте актуальное название и подтвердите действие заново."
        });
        return;
      }
      if (
        !lifecycleAllowed(
          current,
          conflictKind,
          workspaceRoleCode,
          lifecycleMutable
        )
      ) {
        setConflict(undefined);
        setFailure({
          message:
            "Актуальное состояние проекта не позволяет повторить действие. Серверная версия загружена."
        });
        return;
      }
      await mutateLifecycle(conflictKind, current.version, true);
    } catch (error) {
      if (redirectExpiredSession(error, server.id)) return;
      setFailure(tenantOperationFailure(error, navigator.onLine));
    } finally {
      setBusy(undefined);
    }
  }

  function openLifecycle(action: LifecycleAction): void {
    if (busy || !online) return;
    if (dirty) {
      setFailure({
        message:
          "Сначала сохраните или отмените изменения основных данных, затем измените статус проекта."
      });
      return;
    }
    if (
      !lifecycleAllowed(
        server,
        action,
        workspaceRoleCode,
        lifecycleMutable
      )
    ) {
      setFailure({ message: lifecycleUnavailableMessage(action) });
      return;
    }
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(undefined);
    setConfirmAction(action);
    setConfirmationText("");
  }

  async function submitLifecycle(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (
      !confirmAction ||
      !projectLifecycleConfirmationMatches(server, confirmationText) ||
      dirty ||
      !lifecycleAllowed(
        server,
        confirmAction,
        workspaceRoleCode,
        lifecycleMutable
      ) ||
      busy ||
      !online
    ) {
      return;
    }
    await mutateLifecycle(confirmAction, server.version);
  }

  async function mutateLifecycle(
    action: LifecycleAction,
    version: number,
    bypassBusy = false
  ): Promise<void> {
    if ((busy && !bypassBusy) || !online) return;
    setBusy(action);
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const updated = await browserApiRequest<AppProject>(
        `${projectPath(server.id)}/${action}`,
        { method: "POST", ifMatch: version }
      );
      acceptUpdatedProject(updated);
      setSuccess(lifecycleSuccessMessage(updated, action));
    } catch (error) {
      if (redirectExpiredSession(error, server.id)) return;
      if (isVersionConflict(error)) {
        setConflict(action);
        setFailure({
          message:
            "Статус проекта изменён другим участником. Подтверждение сохранено — загрузите серверную версию или повторите действие поверх неё.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
      } else {
        handleFailure(error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  function openDeleteConfirmation(): void {
    if (busy || !online) return;
    if (dirty) {
      setFailure({
        message:
          "Сначала сохраните или отмените изменения основных данных, затем удалите проект."
      });
      return;
    }
    if (
      !workspaceMutable ||
      !canDeleteProject(workspaceRoleCode, server.projectAccessLevel)
    ) {
      setFailure({
        message:
          "Удаление проекта недоступно для текущей роли или состояния рабочей области."
      });
      return;
    }
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(undefined);
    setConfirmAction(undefined);
    setConfirmationText("");
    setDeleteConfirmationText("");
    setDeleteConfirmationOpen(true);
  }

  async function submitDeleteProject(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (
      busy ||
      dirty ||
      !online ||
      deleteConfirmationText !== server.name ||
      !workspaceMutable ||
      !canDeleteProject(workspaceRoleCode, server.projectAccessLevel)
    ) {
      return;
    }
    setBusy("delete");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      await browserApiRequest<ProjectDeletionReceipt>(projectPath(server.id), {
        method: "DELETE",
        ifMatch: server.version,
        body: { confirmation: deleteConfirmationText }
      });
      clearPreference("seo_project");
      router.replace("/app/settings/projects");
      router.refresh();
    } catch (error) {
      if (redirectExpiredSession(error, server.id)) return;
      if (isVersionConflict(error)) {
        setFailure({
          message:
            "Проект изменён другим участником. Обновите страницу и подтвердите удаление ещё раз.",
          ...(error instanceof BrowserApiError && error.requestId
            ? { requestId: error.requestId }
            : {})
        });
      } else if (
        error instanceof BrowserApiError &&
        error.code === "REAUTHENTICATION_REQUIRED"
      ) {
        setFailure({
          message:
            "Для удаления требуется недавний вход. Войдите повторно и вернитесь к настройкам проекта.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
      } else {
        handleFailure(error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  function handleFailure(error: unknown): void {
    if (error instanceof BrowserApiError) {
      const errors = tenantApiFieldErrors(error, PROJECT_FIELDS);
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        focusFirstInvalid();
      }
      if (error.status === 403) setRuntimeRestriction("MISSING_PERMISSION");
      if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
        setRuntimeRestriction("WORKSPACE_READ_ONLY");
      }
    }
    setFailure(tenantOperationFailure(error, online));
  }

  function acceptUpdatedProject(
    updated: AppProject,
    submittedDraft?: Parameters<typeof projectSettingsDraftAfterSave>[1]
  ): void {
    setServer(updated);
    setDraft((current) =>
      submittedDraft
        ? projectSettingsDraftAfterSave(updated, submittedDraft, current)
        : projectSettingsDraft(updated)
    );
    setConflict(undefined);
    setDuplicateConfirmation(false);
    setConfirmAction(undefined);
    setConfirmationText("");
    setRuntimeRestriction(undefined);
    setFieldErrors({});
    writeTenantContext(updated);
    router.refresh();
  }

  function focusFirstInvalid(): void {
    requestAnimationFrame(() => {
      const firstInvalid = document.querySelector<HTMLElement>(
        '#project-settings-form [aria-invalid="true"]'
      );
      (firstInvalid ?? feedbackRef.current)?.focus();
    });
  }

  const lifecyclePermission =
    server.status === "ARCHIVED"
      ? canRestoreProject(workspaceRoleCode, server.projectAccessLevel)
      : canArchiveProject(workspaceRoleCode, server.projectAccessLevel);

  return (
    <div className="settings-stack">
      {!online && (
        <aside className="inline-alert warning" role="status">
          Нет подключения к сети. Черновик сохранён в форме; сохранение и
          изменение статуса временно недоступны.
        </aside>
      )}
      {server.status === "ARCHIVED" && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Проект в архиве</strong>
            <p>
              Данные доступны для просмотра и экспорта. Основные настройки
              заблокированы до восстановления.
            </p>
          </div>
        </aside>
      )}
      {editRestriction && server.status !== "ARCHIVED" && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Редактирование недоступно</strong>
            <p>{editRestriction}</p>
          </div>
        </aside>
      )}
      {(failure || success || conflict || duplicateConfirmation) && (
        <div
          className={`inline-alert ${failure ? "danger" : "success"}`}
          ref={feedbackRef}
          role={failure ? "alert" : "status"}
          tabIndex={-1}
        >
          {failure?.message ?? success}
          {failure?.requestId && (
            <small className="error-reference">
              Код запроса: {failure.requestId}
            </small>
          )}
          {conflict && (
            <div className="security-actions">
              <button
                className="secondary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void reloadConflict(false)}
                type="button"
              >
                {busy === "reload" ? "Загружаем…" : "Загрузить серверную версию"}
              </button>
              <button
                className="secondary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void reloadConflict(true)}
                type="button"
              >
                {busy === "retry" ? "Повторяем…" : "Повторить моё действие"}
              </button>
            </div>
          )}
          {duplicateConfirmation && !conflict && (
            <div className="security-actions">
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setDuplicateConfirmation(false);
                  setFailure(undefined);
                }}
                type="button"
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void saveProject(server.version, true, "save")}
                type="button"
              >
                Сохранить дублирующийся домен
              </button>
            </div>
          )}
        </div>
      )}

      <section className="panel security-card" aria-busy={Boolean(busy)}>
        <header className="security-card-header">
          <div>
            <h2>Основные данные</h2>
            <p>
              Изменение домена не удаляет историю. Проверки дублирования
              выполняются только внутри текущей рабочей области.
            </p>
          </div>
          <span className="security-status">
            {projectStatusLabel(server.status)}
          </span>
        </header>
        <div className="security-facts" aria-label="Состояние проекта">
          <span>
            Slug <strong>{server.slug}</strong>
          </span>
          <span>
            Версия <strong>v{server.version}</strong>
          </span>
          <span>
            Workspace <strong>{server.workspaceId}</strong>
          </span>
        </div>

        <form className="security-flow" id="project-settings-form" onSubmit={submitSettings}>
          <div className="form-row">
            <label className="form-field">
              <span>Название</span>
              <input
                aria-describedby={fieldErrors.name ? "project-name-error" : undefined}
                aria-invalid={Boolean(fieldErrors.name)}
                maxLength={160}
                onChange={(event) => updateDraft("name", event.target.value)}
                readOnly={
                  !editAllowed || Boolean(busy) || Boolean(confirmAction)
                }
                required
                value={draft.name}
              />
              {fieldErrors.name && (
                <small className="field-error" id="project-name-error">
                  {fieldErrors.name}
                </small>
              )}
            </label>
            <label className="form-field">
              <span>Домен</span>
              <input
                aria-describedby={fieldErrors.domain ? "project-domain-error" : "project-domain-hint"}
                aria-invalid={Boolean(fieldErrors.domain)}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={255}
                onChange={(event) => updateDraft("domain", event.target.value)}
                readOnly={
                  !editAllowed || Boolean(busy) || Boolean(confirmAction)
                }
                required
                spellCheck={false}
                value={draft.domain}
              />
              {fieldErrors.domain ? (
                <small className="field-error" id="project-domain-error">
                  {fieldErrors.domain}
                </small>
              ) : (
                <small id="project-domain-hint">Без пути, параметров и номера порта</small>
              )}
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Локаль</span>
              <input
                aria-describedby={fieldErrors.locale ? "project-locale-error" : "project-locale-hint"}
                aria-invalid={Boolean(fieldErrors.locale)}
                autoCapitalize="none"
                maxLength={16}
                onChange={(event) => updateDraft("locale", event.target.value)}
                readOnly={
                  !editAllowed || Boolean(busy) || Boolean(confirmAction)
                }
                required
                value={draft.locale}
              />
              {fieldErrors.locale ? (
                <small className="field-error" id="project-locale-error">
                  {fieldErrors.locale}
                </small>
              ) : (
                <small id="project-locale-hint">BCP 47: ru, en или en-US</small>
              )}
            </label>
            <label className="form-field">
              <span>Часовой пояс</span>
              <input
                aria-describedby={fieldErrors.timezone ? "project-timezone-error" : "project-timezone-hint"}
                aria-invalid={Boolean(fieldErrors.timezone)}
                autoCapitalize="none"
                maxLength={64}
                onChange={(event) => updateDraft("timezone", event.target.value)}
                readOnly={
                  !editAllowed || Boolean(busy) || Boolean(confirmAction)
                }
                required
                value={draft.timezone}
              />
              {fieldErrors.timezone ? (
                <small className="field-error" id="project-timezone-error">
                  {fieldErrors.timezone}
                </small>
              ) : (
                <small id="project-timezone-hint">IANA: Europe/Moscow или UTC</small>
              )}
            </label>
          </div>
          <div className="settings-savebar">
            <span>
              {dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}
            </span>
            <button
              className="secondary-button"
              disabled={!dirty || Boolean(busy)}
              onClick={discardDraft}
              type="button"
            >
              Отменить изменения
            </button>
            <button
              className="primary-button"
              disabled={!canSubmitEdit || !dirty || Boolean(conflict)}
              type="submit"
            >
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel security-card">
        <header className="security-card-header">
          <div>
            <h2>Жизненный цикл проекта</h2>
            <p>
              Архивирование сохраняет данные и останавливает автоматизации.
              Восстановить проект можно без потери данных.
            </p>
          </div>
        </header>
        {!lifecyclePermission || runtimeRestriction === "MISSING_PERMISSION" ? (
          <div className="inline-alert info" role="status">
            Для этого статуса у вашей роли нет разрешения{" "}
            <code>
              {server.status === "ARCHIVED"
                ? "project.restore"
                : "project.archive"}
            </code>
            . Обратитесь к владельцу рабочей области.
          </div>
        ) : !workspaceMutable ? (
          <div className="inline-alert warning" role="status">
            Рабочая область доступна только для чтения или приостановлена.
            Изменение статуса проекта заблокировано.
          </div>
        ) : confirmAction ? (
          <form
            aria-labelledby="project-lifecycle-confirm-title"
            className="security-flow"
            onSubmit={submitLifecycle}
          >
            <div className="inline-alert warning">
              <strong id="project-lifecycle-confirm-title">
                {confirmAction === "archive"
                  ? "Подтвердите архивирование"
                  : "Подтвердите восстановление"}
              </strong>
              <p>
                Введите точное название проекта: <strong>{server.name}</strong>
              </p>
            </div>
            <label className="form-field">
              <span>Название проекта для подтверждения</span>
              <input
                aria-describedby="project-lifecycle-confirm-hint"
                autoComplete="off"
                onChange={(event) => setConfirmationText(event.target.value)}
                readOnly={Boolean(busy)}
                ref={confirmationRef}
                required
                spellCheck={false}
                value={confirmationText}
              />
              <small id="project-lifecycle-confirm-hint" role="status">
                {confirmationText && confirmationText !== server.name
                  ? "Название пока не совпадает. Регистр и пробелы учитываются."
                  : "Подтверждение чувствительно к регистру и пробелам."}
              </small>
            </label>
            <div className="security-actions">
              <button
                className={
                  confirmAction === "archive"
                    ? "danger-button"
                    : "primary-button"
                }
                disabled={
                  confirmationText !== server.name ||
                  dirty ||
                  !online ||
                  Boolean(busy)
                }
                type="submit"
              >
                {busy === confirmAction
                  ? "Выполняем…"
                  : confirmAction === "archive"
                    ? "Архивировать проект"
                    : "Восстановить проект"}
              </button>
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setConfirmAction(undefined);
                  setConfirmationText("");
                }}
                type="button"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <div className="security-flow">
            <p>
              {server.status === "ARCHIVED"
                ? "Восстановление возвращает проект в активный статус, но не запускает расписания автоматически."
                : "После архивирования проект останется доступным для просмотра и экспорта."}
            </p>
            <div className="security-actions">
              <button
                className={
                  server.status === "ARCHIVED"
                    ? "primary-button"
                    : "danger-button"
                }
                disabled={
                  dirty ||
                  !online ||
                  Boolean(busy) ||
                  !lifecycleAllowed(
                    server,
                    server.status === "ARCHIVED" ? "restore" : "archive",
                    workspaceRoleCode,
                    lifecycleMutable
                  )
                }
                onClick={() =>
                  openLifecycle(
                    server.status === "ARCHIVED" ? "restore" : "archive"
                  )
                }
                type="button"
              >
                {server.status === "ARCHIVED"
                  ? "Восстановить проект"
                  : "Архивировать проект"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel security-card danger-zone-card">
        <header className="security-card-header">
          <div>
            <h2>Удаление проекта</h2>
            <p>
              Проект сразу исчезнет из рабочей области и станет недоступен
              участникам. Это действие нельзя отменить в интерфейсе.
            </p>
          </div>
        </header>
        {!canDeleteProject(workspaceRoleCode, server.projectAccessLevel) ||
        runtimeRestriction === "MISSING_PERMISSION" ? (
          <div className="inline-alert info" role="status">
            Для удаления требуется разрешение <code>project.delete</code> и
            полный доступ к проекту.
          </div>
        ) : !workspaceMutable ? (
          <div className="inline-alert warning" role="status">
            Рабочая область доступна только для чтения или приостановлена.
            Удаление заблокировано.
          </div>
        ) : deleteConfirmationOpen ? (
          <form className="security-flow" onSubmit={submitDeleteProject}>
            <div className="inline-alert danger">
              <strong>Подтвердите удаление</strong>
              <p>
                Введите точное название проекта: <strong>{server.name}</strong>
              </p>
            </div>
            <label className="form-field">
              <span>Название проекта для подтверждения</span>
              <input
                autoComplete="off"
                onChange={(event) =>
                  setDeleteConfirmationText(event.target.value)
                }
                readOnly={Boolean(busy)}
                ref={deleteConfirmationRef}
                required
                spellCheck={false}
                value={deleteConfirmationText}
              />
              <small role="status">
                {deleteConfirmationText &&
                deleteConfirmationText !== server.name
                  ? "Название пока не совпадает. Регистр и пробелы учитываются."
                  : "Перед удалением сервис проверит недавнюю авторизацию."}
              </small>
            </label>
            <div className="security-actions">
              <button
                className="danger-button"
                disabled={
                  deleteConfirmationText !== server.name ||
                  !online ||
                  Boolean(busy)
                }
                type="submit"
              >
                {busy === "delete" ? "Удаляем…" : "Удалить проект"}
              </button>
              <button
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setDeleteConfirmationOpen(false);
                  setDeleteConfirmationText("");
                }}
                type="button"
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <div className="security-flow">
            <p>
              Сначала остановите важные фоновые операции и экспортируйте
              данные, которые могут понадобиться вне платформы.
            </p>
            <div className="security-actions">
              <button
                className="danger-button"
                disabled={dirty || !online || Boolean(busy)}
                onClick={openDeleteConfirmation}
                type="button"
              >
                Удалить проект
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function projectPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}`;
}

function lifecycleAllowed(
  project: AppProject,
  action: LifecycleAction,
  workspaceRoleCode: string,
  workspaceMutable: boolean
): boolean {
  if (!workspaceMutable) return false;
  if (action === "archive") {
    return (
      project.status !== "ARCHIVED" &&
      canArchiveProject(workspaceRoleCode, project.projectAccessLevel)
    );
  }
  return (
    project.status === "ARCHIVED" &&
    canRestoreProject(workspaceRoleCode, project.projectAccessLevel)
  );
}

function lifecycleReached(
  project: AppProject,
  action: LifecycleAction
): boolean {
  return action === "archive"
    ? project.status === "ARCHIVED"
    : project.status === "ACTIVE";
}

function lifecycleSuccessMessage(
  project: AppProject,
  action: LifecycleAction
): string {
  return action === "archive"
    ? `Проект «${project.name}» архивирован. Данные сохранены.`
    : `Проект «${project.name}» восстановлен. Расписания не запущены автоматически.`;
}

function lifecycleUnavailableMessage(action: LifecycleAction): string {
  return action === "archive"
    ? "Архивирование недоступно для текущего статуса или роли."
    : "Восстановление недоступно для текущего статуса или роли.";
}

function projectEditRestrictionMessage(
  project: AppProject,
  workspaceStatus: AppWorkspace["status"],
  roleAllowsUpdate: boolean,
  runtimeRestriction: "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY" | undefined
): string | undefined {
  if (project.status === "ARCHIVED") {
    return "Проект архивирован. Восстановите его перед редактированием.";
  }
  if (runtimeRestriction === "MISSING_PERMISSION" || !roleAllowsUpdate) {
    return "Для изменения требуется разрешение project.update. Обратитесь к владельцу рабочей области.";
  }
  if (
    runtimeRestriction === "WORKSPACE_READ_ONLY" ||
    workspaceStatus === "READ_ONLY"
  ) {
    return "Рабочая область переведена в режим только для чтения. Просмотр проекта остаётся доступным.";
  }
  if (workspaceStatus === "SUSPENDED") {
    return "Рабочая область приостановлена. Изменения заблокированы до восстановления доступа.";
  }
  return undefined;
}

function writeTenantContext(project: AppProject): void {
  writePreference("seo_workspace", project.workspaceId);
  writePreference("seo_project", project.id);
}

function writePreference(name: string, value: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

function clearPreference(name: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function redirectExpiredSession(error: unknown, projectId: string): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) return false;
  const returnTo = `/app/projects/${encodeURIComponent(projectId)}/settings/general`;
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
  );
  return true;
}
