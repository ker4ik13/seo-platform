"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { canUpdateWorkspace } from "../lib/app-permissions";
import type { AppWorkspace } from "../lib/app-types";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import {
  isVersionConflict,
  tenantApiFieldErrors,
  tenantOperationFailure,
  validateWorkspaceSettings,
  workspaceSettingsDraftAfterSave,
  workspaceSettingsDirty,
  workspaceSettingsDraft,
  workspaceStatusLabel,
  workspaceUpdateInput,
  type TenantOperationFailure,
  type TenantSettingsFieldErrors,
  type WorkspaceSettingsField
} from "../lib/tenant-settings";

const WORKSPACE_FIELDS = ["name", "locale", "timezone"] as const;

export function WorkspaceSettings({
  workspace
}: Readonly<{ workspace: AppWorkspace }>) {
  const router = useRouter();
  const [server, setServer] = useState(workspace);
  const [draft, setDraft] = useState(() => workspaceSettingsDraft(workspace));
  const [fieldErrors, setFieldErrors] = useState<TenantSettingsFieldErrors>({});
  const [failure, setFailure] = useState<TenantOperationFailure>();
  const [success, setSuccess] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"save" | "reload" | "retry">();
  const [online, setOnline] = useState(true);
  const [runtimeRestriction, setRuntimeRestriction] = useState<
    "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY"
  >();
  const feedbackRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(
    () => workspaceSettingsDirty(server, draft),
    [draft, server]
  );
  const roleAllowsUpdate = canUpdateWorkspace(server.roleCode);
  const statusAllowsUpdate = server.status === "ACTIVE";
  const canMutate =
    roleAllowsUpdate &&
    statusAllowsUpdate &&
    !runtimeRestriction &&
    online &&
    !busy;
  const restriction = workspaceRestrictionMessage(
    server,
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

  function updateDraft(
    field: WorkspaceSettingsField,
    value: string
  ): void {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(false);
  }

  function discardDraft(): void {
    setDraft(workspaceSettingsDraft(server));
    setFieldErrors({});
    setFailure(undefined);
    setSuccess(undefined);
    setConflict(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canMutate || !dirty) return;
    const errors = validateWorkspaceSettings(draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFailure({ message: "Проверьте отмеченные поля." });
      focusFirstInvalid();
      return;
    }
    await save(server.version, "save");
  }

  async function save(
    version: number,
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
      const updated = await browserApiRequest<AppWorkspace>(
        workspacePath(server.id),
        {
          method: "PATCH",
          ifMatch: version,
          body: workspaceUpdateInput(submittedDraft)
        }
      );
      acceptUpdatedWorkspace(updated, submittedDraft);
      setSuccess("Настройки рабочей области сохранены.");
    } catch (error) {
      if (redirectExpiredSession(error)) return;
      if (isVersionConflict(error)) {
        setConflict(true);
        setFailure({
          message:
            "Рабочая область изменена другим участником. Ваш черновик сохранён — загрузите серверную версию или повторите поверх новой версии.",
          ...(error.requestId ? { requestId: error.requestId } : {})
        });
      } else {
        handleFailure(error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function reload(retryDraft: boolean): Promise<void> {
    if (busy || !online) return;
    setBusy(retryDraft ? "retry" : "reload");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const current = await browserApiRequest<AppWorkspace>(
        workspacePath(server.id)
      );
      setServer(current);
      setRuntimeRestriction(undefined);
      if (retryDraft) {
        if (current.status !== "ACTIVE" || !canUpdateWorkspace(current.roleCode)) {
          setFailure({
            message:
              "Новая серверная версия доступна только для чтения. Черновик сохранён в форме."
          });
          setConflict(false);
          return;
        }
        await save(current.version, "retry", true);
        return;
      }
      setDraft(workspaceSettingsDraft(current));
      setFieldErrors({});
      setConflict(false);
      setSuccess("Загружена актуальная серверная версия.");
      router.refresh();
    } catch (error) {
      if (redirectExpiredSession(error)) return;
      setFailure(tenantOperationFailure(error, navigator.onLine));
    } finally {
      setBusy(undefined);
    }
  }

  function handleFailure(error: unknown): void {
    if (error instanceof BrowserApiError) {
      const errors = tenantApiFieldErrors(error, WORKSPACE_FIELDS);
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

  function acceptUpdatedWorkspace(
    updated: AppWorkspace,
    submittedDraft: Parameters<typeof workspaceSettingsDraftAfterSave>[1]
  ): void {
    setServer(updated);
    setDraft((current) =>
      workspaceSettingsDraftAfterSave(updated, submittedDraft, current)
    );
    setConflict(false);
    setRuntimeRestriction(undefined);
    setFieldErrors({});
    router.refresh();
  }

  function focusFirstInvalid(): void {
    requestAnimationFrame(() => {
      const firstInvalid = document.querySelector<HTMLElement>(
        '#workspace-settings-form [aria-invalid="true"]'
      );
      (firstInvalid ?? feedbackRef.current)?.focus();
    });
  }

  return (
    <div className="settings-stack">
      {!online && (
        <aside className="inline-alert warning" role="status">
          Нет подключения к сети. Поля остаются доступными, отправка изменений
          возобновится после подключения.
        </aside>
      )}
      {restriction && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Редактирование недоступно</strong>
            <p>{restriction}</p>
          </div>
        </aside>
      )}
      {(failure || success || conflict) && (
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
                onClick={() => void reload(false)}
                type="button"
              >
                {busy === "reload" ? "Загружаем…" : "Загрузить серверную версию"}
              </button>
              <button
                className="secondary-button"
                disabled={!online || Boolean(busy)}
                onClick={() => void reload(true)}
                type="button"
              >
                {busy === "retry" ? "Повторяем…" : "Повторить с моим черновиком"}
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
              Slug остаётся неизменным; название, локаль и часовой пояс можно
              обновлять независимо.
            </p>
          </div>
          <span className="security-status">
            {workspaceStatusLabel(server.status)}
          </span>
        </header>
        <div className="security-facts" aria-label="Состояние рабочей области">
          <span>
            Slug <strong>{server.slug}</strong>
          </span>
          <span>
            Версия <strong>v{server.version}</strong>
          </span>
          <span>
            Роль <strong>{server.roleCode}</strong>
          </span>
        </div>

        <form className="security-flow" id="workspace-settings-form" onSubmit={submit}>
          <label className="form-field">
            <span>Название</span>
            <input
              aria-describedby={fieldErrors.name ? "workspace-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
              maxLength={160}
              onChange={(event) => updateDraft("name", event.target.value)}
              readOnly={
                !roleAllowsUpdate ||
                !statusAllowsUpdate ||
                Boolean(runtimeRestriction) ||
                Boolean(busy)
              }
              required
              value={draft.name}
            />
            {fieldErrors.name && (
              <small className="field-error" id="workspace-name-error">
                {fieldErrors.name}
              </small>
            )}
          </label>
          <div className="form-row">
            <label className="form-field">
              <span>Локаль</span>
              <input
                aria-describedby={fieldErrors.locale ? "workspace-locale-error" : "workspace-locale-hint"}
                aria-invalid={Boolean(fieldErrors.locale)}
                autoCapitalize="none"
                maxLength={16}
                onChange={(event) => updateDraft("locale", event.target.value)}
                readOnly={
                  !roleAllowsUpdate ||
                  !statusAllowsUpdate ||
                  Boolean(runtimeRestriction) ||
                  Boolean(busy)
                }
                required
                value={draft.locale}
              />
              {fieldErrors.locale ? (
                <small className="field-error" id="workspace-locale-error">
                  {fieldErrors.locale}
                </small>
              ) : (
                <small id="workspace-locale-hint">BCP 47: ru, en или en-US</small>
              )}
            </label>
            <label className="form-field">
              <span>Часовой пояс</span>
              <input
                aria-describedby={fieldErrors.timezone ? "workspace-timezone-error" : "workspace-timezone-hint"}
                aria-invalid={Boolean(fieldErrors.timezone)}
                autoCapitalize="none"
                maxLength={64}
                onChange={(event) => updateDraft("timezone", event.target.value)}
                readOnly={
                  !roleAllowsUpdate ||
                  !statusAllowsUpdate ||
                  Boolean(runtimeRestriction) ||
                  Boolean(busy)
                }
                required
                value={draft.timezone}
              />
              {fieldErrors.timezone ? (
                <small className="field-error" id="workspace-timezone-error">
                  {fieldErrors.timezone}
                </small>
              ) : (
                <small id="workspace-timezone-hint">IANA: Europe/Moscow или UTC</small>
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
              disabled={!canMutate || !dirty || conflict}
              type="submit"
            >
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function workspacePath(workspaceId: string): string {
  return `/app/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

function workspaceRestrictionMessage(
  workspace: AppWorkspace,
  roleAllowsUpdate: boolean,
  runtimeRestriction: "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY" | undefined
): string | undefined {
  if (runtimeRestriction === "MISSING_PERMISSION" || !roleAllowsUpdate) {
    return "Для изменения требуется разрешение workspace.update. Обратитесь к владельцу рабочей области.";
  }
  if (runtimeRestriction === "WORKSPACE_READ_ONLY" || workspace.status === "READ_ONLY") {
    return "Рабочая область переведена в режим только для чтения. Просмотр данных остаётся доступным.";
  }
  if (workspace.status === "SUSPENDED") {
    return "Рабочая область приостановлена. Изменения заблокированы до восстановления доступа.";
  }
  return undefined;
}

function redirectExpiredSession(error: unknown): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) return false;
  const returnTo = "/app/settings/workspace";
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`
  );
  return true;
}
