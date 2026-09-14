"use client";

import type { ProjectLogoContentType } from "@seo-platform/contracts";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
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
import { ProjectFavicon } from "./project-favicon";
import { CustomSelect } from "./custom-select";
import { LocaleSelect, TimezoneSelect } from "./locale-selects";
import { russianSearchCities } from "../lib/seo-regions";
import { UiText, useUiLocale } from "./ui-locale";


const PROJECT_LOGO_MAX_BYTES = 512 * 1_024;

const PROJECT_FIELDS = ["name", "domain", "locale", "timezone", "searchCity"] as const;
type LifecycleAction = "archive" | "restore";
type ConflictKind = "save" | LifecycleAction;
interface ProjectDeletionReceipt {
  readonly projectId: string;
  readonly status: "DELETED";
  readonly deletedAt: string;
}

export function ProjectSettings({
  children,
  project,
  workspaceRoleCode,
  workspaceStatus
}: Readonly<{
  children?: ReactNode;
  project: AppProject;
  workspaceRoleCode: string;
  workspaceStatus: AppWorkspace["status"];
}>) {
  const { t: uiText } = useUiLocale();
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
    | "save"
    | "reload"
    | "retry"
    | "delete"
    | "logo-upload"
    | "logo-delete"
    | LifecycleAction
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

  function updateDraft(
    field: Exclude<ProjectSettingsField, "searchCity">,
    value: string
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(undefined);
    setDuplicateConfirmation(false);
  }

  function updateSearchCity(yandexRegionCode: string): void {
    const searchCity = russianSearchCities.find(
      (city) => city.yandexRegionCode === yandexRegionCode
    );
    setDraft((current) => ({ ...current, searchCity }));
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

  async function uploadLogo(file: File | undefined): Promise<void> {
    if (!file || !editAllowed || busy || !online) return;
    setBusy("logo-upload");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const payload = await projectLogoPayload(file);
      const updated = await browserApiRequest<AppProject>(
        `${projectPath(server.id)}/logo`,
        {
          method: "PUT",
          ifMatch: server.version,
          body: payload
        }
      );
      acceptLogoProject(updated, "Логотип проекта обновлён.");
    } catch (error) {
      if (error instanceof ProjectLogoError) {
        setFailure({ message: error.message });
      } else if (!redirectExpiredSession(error, server.id)) {
        handleFailure(error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function resetLogo(): Promise<void> {
    if (!server.logoSource || !editAllowed || busy || !online) return;
    setBusy("logo-delete");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const updated = await browserApiRequest<AppProject>(
        `${projectPath(server.id)}/logo`,
        { method: "DELETE", ifMatch: server.version }
      );
      acceptLogoProject(
        updated,
        server.logoSource === "CUSTOM"
          ? "Пользовательский логотип удалён. Иконка сайта будет найдена автоматически."
          : "Иконка сайта будет загружена заново."
      );
    } catch (error) {
      if (!redirectExpiredSession(error, server.id)) handleFailure(error);
    } finally {
      setBusy(undefined);
    }
  }

  function acceptLogoProject(updated: AppProject, message: string): void {
    setServer(updated);
    setRuntimeRestriction(undefined);
    setSuccess(message);
    writeTenantContext(updated);
    router.refresh();
  }

  const lifecyclePermission =
    server.status === "ARCHIVED"
      ? canRestoreProject(workspaceRoleCode, server.projectAccessLevel)
      : canArchiveProject(workspaceRoleCode, server.projectAccessLevel);

  return (
    <div className="settings-stack project-settings-stack">
      {!online && (
        <aside className="inline-alert warning" role="status">
          <UiText text="Нет подключения к сети. Черновик сохранён в форме; сохранение и изменение статуса временно недоступны." /></aside>
      )}
      {server.status === "ARCHIVED" && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong><UiText text="Проект в архиве" /></strong>
            <p>
              <UiText text="Данные доступны для просмотра и экспорта. Основные настройки заблокированы до восстановления." /></p>
          </div>
        </aside>
      )}
      {editRestriction && server.status !== "ARCHIVED" && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong><UiText text="Редактирование недоступно" /></strong>
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
              <UiText text="Код запроса:" after=" " />{failure.requestId}
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
                {busy === "reload" ? <UiText text="Загружаем…" /> : <UiText text="Загрузить серверную версию" />}
              </button>
              <button
                className="secondary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void reloadConflict(true)}
                type="button"
              >
                {busy === "retry" ? <UiText text="Повторяем…" /> : <UiText text="Повторить моё действие" />}
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
                <UiText text="Отмена" /></button>
              <button
                className="primary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void saveProject(server.version, true, "save")}
                type="button"
              >
                <UiText text="Сохранить дублирующийся домен" /></button>
            </div>
          )}
        </div>
      )}

      <section
        className="panel security-card workspace-avatar-card"
        aria-busy={busy === "logo-upload" || busy === "logo-delete"}
      >
        <header className="security-card-header">
          <div>
            <h2><UiText text="Логотип проекта" /></h2>
            <p>
              <UiText text="SVG, PNG, JPEG, WebP, ICO, GIF или AVIF до 512 КБ. Пользовательский файл имеет приоритет; иначе платформа безопасно находит лучшую иконку на сайте." /></p>
          </div>
          <span aria-hidden="true" className="project-settings-logo-preview">
            <ProjectFavicon
              className="project-settings-logo"
              project={server}
              size={64}
            />
          </span>
        </header>
        <div className="workspace-avatar-actions">
          <label className={`secondary-button${editAllowed ? "" : " disabled"}`}>
            {busy === "logo-upload"
              ? <UiText text="Загружаем…" />
              : server.logoSource === "CUSTOM"
                ? <UiText text="Заменить логотип" />
                : <UiText text="Загрузить логотип" />}
            <input
              accept=".svg,.png,.jpg,.jpeg,.webp,.ico,.gif,.avif,image/svg+xml,image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,image/gif,image/avif"
              disabled={!editAllowed || Boolean(busy)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void uploadLogo(file);
              }}
              type="file"
            />
          </label>
          {server.logoSource && (
            <button
              className="secondary-button"
              disabled={!editAllowed || Boolean(busy)}
              onClick={() => void resetLogo()}
              type="button"
            >
              {busy === "logo-delete"
                ? <UiText text="Обновляем…" />
                : server.logoSource === "CUSTOM"
                  ? <UiText text="Использовать иконку сайта" />
                  : <UiText text="Обновить с сайта" />}
            </button>
          )}
        </div>
      </section>

      <section className="panel security-card" aria-busy={Boolean(busy)}>
        <header className="security-card-header">
          <div>
            <h2><UiText text="Основные данные" /></h2>
            <p>
              <UiText text="Изменение домена не удаляет историю. Проверки дублирования выполняются только внутри текущей рабочей области." /></p>
          </div>
          <span className="security-status">
            {<UiText text={projectStatusLabel(server.status) ?? ""} />}
          </span>
        </header>
        <div className="security-facts" aria-label={uiText("Состояние проекта")}>
          <span>
            Slug <strong>{server.slug}</strong>
          </span>
          <span>
            <UiText text="Версия" after=" " /><strong>v{server.version}</strong>
          </span>
          <span>
            Workspace <strong>{server.workspaceId}</strong>
          </span>
        </div>

        <form className="security-flow" id="project-settings-form" onSubmit={submitSettings}>
          <div className="form-row">
            <label className="form-field">
              <span><UiText text="Название" /></span>
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
              <span><UiText text="Домен" /></span>
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
                <small id="project-domain-hint"><UiText text="Без пути, параметров и номера порта" /></small>
              )}
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span><UiText text="Город для съёма позиций" /></span>
              <CustomSelect
                disabled={!editAllowed || Boolean(busy) || Boolean(confirmAction)}
                onChange={(event) => updateSearchCity(event.target.value)}
                searchable
                searchPlaceholder={uiText("Найти город")}
                value={draft.searchCity?.yandexRegionCode ?? ""}
              >
                <option value=""><UiText text="Не выбрано" /></option>
                {russianSearchCities.map((city) => (
                  <option key={city.yandexRegionCode} value={city.yandexRegionCode}>
                    {city.name}
                  </option>
                ))}
              </CustomSelect>
              <small>
                <UiText text="Используется для новых проверок в Яндексе и Google. Регион последнего съёма имеет приоритет." /></small>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span><UiText text="Локаль" /></span>
              <LocaleSelect
                aria-describedby={fieldErrors.locale ? "project-locale-error" : "project-locale-hint"}
                aria-invalid={Boolean(fieldErrors.locale)}
                disabled={!editAllowed || Boolean(busy) || Boolean(confirmAction)}
                onChange={(event) => updateDraft("locale", event.target.value)}
                required
                value={draft.locale}
              />
              {fieldErrors.locale ? (
                <small className="field-error" id="project-locale-error">
                  {fieldErrors.locale}
                </small>
              ) : (
                <small id="project-locale-hint"><UiText text="BCP 47: ru, en или en-US" /></small>
              )}
            </label>
            <label className="form-field">
              <span><UiText text="Часовой пояс" /></span>
              <TimezoneSelect
                aria-describedby={fieldErrors.timezone ? "project-timezone-error" : "project-timezone-hint"}
                aria-invalid={Boolean(fieldErrors.timezone)}
                disabled={!editAllowed || Boolean(busy) || Boolean(confirmAction)}
                onChange={(event) => updateDraft("timezone", event.target.value)}
                required
                value={draft.timezone}
              />
              {fieldErrors.timezone ? (
                <small className="field-error" id="project-timezone-error">
                  {fieldErrors.timezone}
                </small>
              ) : (
                <small id="project-timezone-hint"><UiText text="IANA: Europe/Moscow или UTC" /></small>
              )}
            </label>
          </div>
          <div className="settings-savebar">
            <span>
              {dirty ? <UiText text="Есть несохранённые изменения" /> : <UiText text="Все изменения сохранены" />}
            </span>
            <button
              className="secondary-button"
              disabled={!dirty || Boolean(busy)}
              onClick={discardDraft}
              type="button"
            >
              <UiText text="Отменить изменения" /></button>
            <button
              className="primary-button"
              disabled={!canSubmitEdit || !dirty || Boolean(conflict)}
              type="submit"
            >
              {busy === "save" ? <UiText text="Сохраняем…" /> : <UiText text="Сохранить" />}
            </button>
          </div>
        </form>
      </section>

      {children}

      <section className="panel security-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Жизненный цикл проекта" /></h2>
            <p>
              <UiText text="Архивирование сохраняет данные и останавливает автоматизации. Восстановить проект можно без потери данных." /></p>
          </div>
        </header>
        {!lifecyclePermission || runtimeRestriction === "MISSING_PERMISSION" ? (
          <div className="inline-alert info" role="status">
            <UiText text="Для этого статуса у вашей роли нет разрешения" />{" "}
            <code>
              {server.status === "ARCHIVED"
                ? "project.restore"
                : "project.archive"}
            </code>
            <UiText text=". Обратитесь к владельцу рабочей области." /></div>
        ) : !workspaceMutable ? (
          <div className="inline-alert warning" role="status">
            <UiText text="Рабочая область доступна только для чтения или приостановлена. Изменение статуса проекта заблокировано." /></div>
        ) : confirmAction ? (
          <form
            aria-labelledby="project-lifecycle-confirm-title"
            className="security-flow"
            onSubmit={submitLifecycle}
          >
            <div className="inline-alert warning">
              <strong id="project-lifecycle-confirm-title">
                {confirmAction === "archive"
                  ? <UiText text="Подтвердите архивирование" />
                  : <UiText text="Подтвердите восстановление" />}
              </strong>
              <p>
                <UiText text="Введите точное название проекта:" after=" " /><strong>{server.name}</strong>
              </p>
            </div>
            <label className="form-field">
              <span><UiText text="Название проекта для подтверждения" /></span>
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
                  ? <UiText text="Название пока не совпадает. Регистр и пробелы учитываются." />
                  : <UiText text="Подтверждение чувствительно к регистру и пробелам." />}
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
                  ? <UiText text="Выполняем…" />
                  : confirmAction === "archive"
                    ? <UiText text="Архивировать проект" />
                    : <UiText text="Восстановить проект" />}
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
                <UiText text="Отмена" /></button>
            </div>
          </form>
        ) : (
          <div className="security-flow">
            <p>
              {server.status === "ARCHIVED"
                ? <UiText text="Восстановление возвращает проект в активный статус, но не запускает расписания автоматически." />
                : <UiText text="После архивирования проект останется доступным для просмотра и экспорта." />}
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
                  ? <UiText text="Восстановить проект" />
                  : <UiText text="Архивировать проект" />}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel security-card danger-zone-card">
        <header className="security-card-header">
          <div>
            <h2><UiText text="Удаление проекта" /></h2>
            <p>
              <UiText text="Проект сразу исчезнет из рабочей области и станет недоступен участникам. Это действие нельзя отменить в интерфейсе." /></p>
          </div>
        </header>
        {!canDeleteProject(workspaceRoleCode, server.projectAccessLevel) ||
        runtimeRestriction === "MISSING_PERMISSION" ? (
          <div className="inline-alert info" role="status">
            <UiText text="Для удаления требуется разрешение" after=" " /><code>project.delete</code> <UiText text="и полный доступ к проекту." before=" " /></div>
        ) : !workspaceMutable ? (
          <div className="inline-alert warning" role="status">
            <UiText text="Рабочая область доступна только для чтения или приостановлена. Удаление заблокировано." /></div>
        ) : deleteConfirmationOpen ? (
          <form className="security-flow" onSubmit={submitDeleteProject}>
            <div className="inline-alert danger">
              <strong><UiText text="Подтвердите удаление" /></strong>
              <p>
                <UiText text="Введите точное название проекта:" after=" " /><strong>{server.name}</strong>
              </p>
            </div>
            <label className="form-field">
              <span><UiText text="Название проекта для подтверждения" /></span>
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
                  ? <UiText text="Название пока не совпадает. Регистр и пробелы учитываются." />
                  : <UiText text="Перед удалением сервис проверит недавнюю авторизацию." />}
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
                {busy === "delete" ? <UiText text="Удаляем…" /> : <UiText text="Удалить проект" />}
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
                <UiText text="Отмена" /></button>
            </div>
          </form>
        ) : (
          <div className="security-flow">
            <p>
              <UiText text="Сначала остановите важные фоновые операции и экспортируйте данные, которые могут понадобиться вне платформы." /></p>
            <div className="security-actions">
              <button
                className="danger-button"
                disabled={dirty || !online || Boolean(busy)}
                onClick={openDeleteConfirmation}
                type="button"
              >
                <UiText text="Удалить проект" /></button>
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
  if (
    !(error instanceof BrowserApiError) ||
    error.status !== 401
  ) {
    return false;
  }
  const returnTo = `/app/projects/${encodeURIComponent(projectId)}/settings/general`;
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
  );
  return true;
}

class ProjectLogoError extends Error {}

async function projectLogoPayload(file: File): Promise<{
  readonly contentType: ProjectLogoContentType;
  readonly data: string;
}> {
  const contentType = projectLogoContentType(file);
  if (!contentType) {
    throw new ProjectLogoError(
      "Выберите SVG, PNG, JPEG, WebP, ICO, GIF или AVIF."
    );
  }
  if (file.size < 32 || file.size > PROJECT_LOGO_MAX_BYTES) {
    throw new ProjectLogoError("Размер логотипа должен быть от 32 байт до 512 КБ.");
  }
  return { contentType, data: await logoBlobBase64(file) };
}

function projectLogoContentType(
  file: File
): ProjectLogoContentType | undefined {
  const type = file.type.toLowerCase();
  if (type === "image/vnd.microsoft.icon" || type === "image/x-icon") {
    return "image/x-icon";
  }
  if (
    type === "image/svg+xml" ||
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    type === "image/gif" ||
    type === "image/avif"
  ) {
    return type;
  }
  const extension = file.name.toLowerCase().split(".").pop();
  const byExtension: Readonly<Record<string, ProjectLogoContentType>> = {
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    ico: "image/x-icon",
    gif: "image/gif",
    avif: "image/avif"
  };
  return byExtension[extension ?? ""];
}

function logoBlobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new ProjectLogoError("Не удалось прочитать изображение."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new ProjectLogoError("Не удалось подготовить изображение."));
      } else {
        resolve(result.slice(separator + 1));
      }
    };
    reader.readAsDataURL(blob);
  });
}
