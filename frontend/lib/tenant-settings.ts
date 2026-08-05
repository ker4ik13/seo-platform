import type {
  UpdateProjectInput,
  UpdateWorkspaceInput
} from "@seo-platform/contracts";
import type { AppProject, AppWorkspace } from "./app-types.ts";
import { BrowserApiError } from "./browser-api.ts";

export interface WorkspaceSettingsDraft {
  readonly name: string;
  readonly locale: string;
  readonly timezone: string;
}

export interface ProjectSettingsDraft extends WorkspaceSettingsDraft {
  readonly domain: string;
}

export type WorkspaceSettingsField = keyof WorkspaceSettingsDraft;
export type ProjectSettingsField = keyof ProjectSettingsDraft;
export type TenantSettingsFieldErrors = Readonly<
  Partial<Record<ProjectSettingsField, string>>
>;

export interface TenantOperationFailure {
  readonly message: string;
  readonly requestId?: string;
}

export function workspaceSettingsDraft(
  workspace: AppWorkspace
): WorkspaceSettingsDraft {
  return {
    name: workspace.name,
    locale: workspace.locale,
    timezone: workspace.timezone
  };
}

export function projectSettingsDraft(
  project: AppProject
): ProjectSettingsDraft {
  return {
    name: project.name,
    domain: project.domain,
    locale: project.locale,
    timezone: project.timezone
  };
}

export function workspaceSettingsDraftAfterSave(
  updated: AppWorkspace,
  submitted: WorkspaceSettingsDraft,
  current: WorkspaceSettingsDraft
): WorkspaceSettingsDraft {
  return sameWorkspaceSettingsDraft(submitted, current)
    ? workspaceSettingsDraft(updated)
    : current;
}

export function projectSettingsDraftAfterSave(
  updated: AppProject,
  submitted: ProjectSettingsDraft,
  current: ProjectSettingsDraft
): ProjectSettingsDraft {
  return sameProjectSettingsDraft(submitted, current)
    ? projectSettingsDraft(updated)
    : current;
}

export function projectLifecycleConfirmationMatches(
  project: Pick<AppProject, "name">,
  confirmationText: string
): boolean {
  return confirmationText === project.name;
}

export function workspaceSettingsDirty(
  workspace: AppWorkspace,
  draft: WorkspaceSettingsDraft
): boolean {
  return JSON.stringify(workspaceSettingsDraft(workspace)) !== JSON.stringify(draft);
}

export function projectSettingsDirty(
  project: AppProject,
  draft: ProjectSettingsDraft
): boolean {
  return JSON.stringify(projectSettingsDraft(project)) !== JSON.stringify(draft);
}

export function validateWorkspaceSettings(
  draft: WorkspaceSettingsDraft
): TenantSettingsFieldErrors {
  const errors: Partial<Record<WorkspaceSettingsField, string>> = {};
  validateSharedFields(draft, errors);
  return errors;
}

export function validateProjectSettings(
  draft: ProjectSettingsDraft
): TenantSettingsFieldErrors {
  const errors: Partial<Record<ProjectSettingsField, string>> = {};
  validateSharedFields(draft, errors);
  if (!normalizedDomain(draft.domain)) {
    errors.domain =
      "Укажите домен без пути, параметров, учётных данных и номера порта.";
  }
  return errors;
}

export function workspaceUpdateInput(
  draft: WorkspaceSettingsDraft
): UpdateWorkspaceInput {
  return {
    name: draft.name.trim(),
    locale: draft.locale.trim(),
    timezone: draft.timezone.trim()
  };
}

export function projectUpdateInput(
  draft: ProjectSettingsDraft,
  confirmDuplicateDomain = false
): UpdateProjectInput {
  return {
    name: draft.name.trim(),
    domain: normalizedDomain(draft.domain) ?? draft.domain.trim(),
    locale: draft.locale.trim(),
    timezone: draft.timezone.trim(),
    ...(confirmDuplicateDomain ? { confirmDuplicateDomain: true } : {})
  };
}

export function tenantApiFieldErrors(
  error: BrowserApiError,
  allowed: readonly ProjectSettingsField[]
): TenantSettingsFieldErrors {
  const allowedFields = new Set<ProjectSettingsField>(allowed);
  const errors: Partial<Record<ProjectSettingsField, string>> = {};
  for (const fieldError of error.fieldErrors) {
    const field = fieldError.path.split(".").at(-1);
    if (field && allowedFields.has(field as ProjectSettingsField)) {
      errors[field as ProjectSettingsField] = "Проверьте значение поля.";
    }
  }
  return errors;
}

export function isVersionConflict(error: unknown): error is BrowserApiError {
  return (
    error instanceof BrowserApiError &&
    (error.status === 412 || error.code === "VERSION_CONFLICT")
  );
}

export function isDuplicateDomainConflict(
  error: unknown
): error is BrowserApiError {
  return (
    error instanceof BrowserApiError &&
    error.status === 409 &&
    error.code === "RESOURCE_STATE_CONFLICT"
  );
}

export function tenantOperationFailure(
  error: unknown,
  online: boolean
): TenantOperationFailure {
  if (!online) {
    return {
      message:
        "Нет подключения к сети. Черновик сохранён в форме — повторите после восстановления соединения."
    };
  }
  if (!(error instanceof BrowserApiError)) {
    return { message: "Не удалось связаться с сервером. Повторите попытку." };
  }

  const requestId = error.requestId;
  const withRequestId = (message: string): TenantOperationFailure => ({
    message,
    ...(requestId ? { requestId } : {})
  });
  if (error.status === 401) {
    return withRequestId("Сессия истекла. Обновите страницу и войдите снова.");
  }
  if (error.status === 403) {
    return withRequestId(
      "Недостаточно прав для этого изменения. Актуальные данные оставлены в форме."
    );
  }
  if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
    return withRequestId(
      "Рабочая область перешла в режим только для чтения. Изменения не отправлены."
    );
  }
  if (error.status === 404) {
    return withRequestId(
      "Объект больше недоступен или был удалён. Обновите страницу."
    );
  }
  if (error.status === 409) {
    return withRequestId(
      "Текущее состояние не позволяет выполнить действие. Обновите данные и повторите попытку."
    );
  }
  if (
    error.fieldErrors.length > 0 ||
    error.status === 422 ||
    error.code === "VALIDATION_ERROR"
  ) {
    return withRequestId("Проверьте отмеченные поля и повторите попытку.");
  }
  if (error.status >= 500 || error.retryable) {
    return withRequestId(
      "Сервис временно недоступен. Черновик не потерян — повторите попытку позже."
    );
  }
  return withRequestId("Не удалось сохранить изменения. Повторите попытку.");
}

export function workspaceStatusLabel(status: AppWorkspace["status"]): string {
  return {
    ACTIVE: "Активна",
    READ_ONLY: "Только чтение",
    SUSPENDED: "Приостановлена"
  }[status];
}

export function projectStatusLabel(status: AppProject["status"]): string {
  return {
    DRAFT: "Черновик",
    ACTIVE: "Активен",
    ARCHIVED: "В архиве"
  }[status];
}

function validateSharedFields(
  draft: WorkspaceSettingsDraft,
  errors: Partial<Record<WorkspaceSettingsField, string>>
): void {
  const name = draft.name.trim();
  if (!name) {
    errors.name = "Введите название.";
  } else if (name.length > 160) {
    errors.name = "Название должно содержать не более 160 символов.";
  }

  const locale = draft.locale.trim();
  if (
    locale.length < 2 ||
    locale.length > 16 ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(locale)
  ) {
    errors.locale = "Укажите локаль BCP 47, например ru или en-US.";
  }

  const timezone = draft.timezone.trim();
  if (!timezone || timezone.length > 64 || !isTimeZone(timezone)) {
    errors.timezone =
      "Укажите часовой пояс IANA, например Europe/Moscow или UTC.";
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function sameWorkspaceSettingsDraft(
  left: WorkspaceSettingsDraft,
  right: WorkspaceSettingsDraft
): boolean {
  return (
    left.name === right.name &&
    left.locale === right.locale &&
    left.timezone === right.timezone
  );
}

function sameProjectSettingsDraft(
  left: ProjectSettingsDraft,
  right: ProjectSettingsDraft
): boolean {
  return (
    sameWorkspaceSettingsDraft(left, right) && left.domain === right.domain
  );
}

function normalizedDomain(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 255) return undefined;
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  return hostname.includes(".") && hostname.length <= 255
    ? hostname
    : undefined;
}
