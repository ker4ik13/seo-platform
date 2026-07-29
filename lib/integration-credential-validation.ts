import type {
  IntegrationCredentialStatus,
  IntegrationCredentialValidationMode,
  IntegrationCredentialValidationStatus,
  IntegrationCredentialValidationSummary
} from "@seo-platform/contracts";

export type CredentialValidationTone =
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface CredentialValidationPresentation {
  readonly message: string;
  readonly terminal: boolean;
  readonly tone: CredentialValidationTone;
}

interface CredentialValidationPollDelayOptions {
  readonly defaultDelayMs: number;
  readonly maxDelayMs: number;
  readonly nowMs: number;
}

const TRANSIENT_RETRY_BASE_DELAY_MS = 750;
const TRANSIENT_RETRY_MAX_DELAY_MS = 8_000;

const TERMINAL_STATUSES: ReadonlySet<IntegrationCredentialValidationStatus> =
  new Set([
    "SUCCEEDED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL",
    "STALE"
  ]);

export function isTerminalCredentialValidationStatus(
  status: IntegrationCredentialValidationStatus
): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function supportsAutomaticCredentialValidation(
  mode: IntegrationCredentialValidationMode | undefined
): boolean {
  return mode === "ACCOUNT_METADATA";
}

export function credentialValidationPresentation(
  status: IntegrationCredentialValidationStatus,
  errorCode?: string
): CredentialValidationPresentation {
  if (status === "QUEUED") {
    return {
      message: "Проверка поставлена в очередь.",
      terminal: false,
      tone: "info"
    };
  }
  if (status === "RUNNING") {
    return {
      message: "Провайдер проверяет доступ по read-only данным аккаунта.",
      terminal: false,
      tone: "info"
    };
  }
  if (status === "RETRY_SCHEDULED") {
    return {
      message:
        "Проверка временно отложена. Повторная попытка запланирована автоматически.",
      terminal: false,
      tone: "warning"
    };
  }
  if (status === "SUCCEEDED") {
    return {
      message: "Провайдер подтвердил доступ к аккаунту.",
      terminal: true,
      tone: "success"
    };
  }
  if (status === "STALE" || errorCode === "CREDENTIAL_CHANGED") {
    return {
      message: "Ключ изменился во время проверки. Запустите её ещё раз.",
      terminal: true,
      tone: "warning"
    };
  }

  return {
    message: credentialValidationFailureMessage(errorCode),
    terminal: true,
    tone: status === "FAILED_RETRYABLE" ? "warning" : "danger"
  };
}

export function persistedCredentialValidationPresentation(
  credentialStatus: IntegrationCredentialStatus,
  errorCode?: string
): CredentialValidationPresentation | undefined {
  if (credentialStatus === "ACTIVE") {
    return credentialValidationPresentation("SUCCEEDED");
  }
  if (!errorCode) return undefined;
  return credentialValidationPresentation(
    credentialStatus === "DEGRADED" ||
      credentialStatus === "RATE_LIMITED"
      ? "FAILED_RETRYABLE"
      : "FAILED_FINAL",
    errorCode
  );
}

export function credentialValidationFailureMessage(
  errorCode: string | undefined
): string {
  const messages: Readonly<Record<string, string>> = {
    INVALID_CREDENTIAL:
      "Провайдер отклонил ключ. Проверьте или замените данные подключения.",
    PROVIDER_RATE_LIMITED:
      "Провайдер временно ограничил запросы. Повторите проверку позже.",
    PROVIDER_UNAVAILABLE:
      "Провайдер временно недоступен. Повторите проверку позже.",
    PROVIDER_PLAN_OR_REQUEST_REJECTED:
      "Провайдер отклонил запрос. Проверьте тариф и доступ к API."
  };
  return errorCode
    ? (messages[errorCode] ??
        "Проверка завершилась ошибкой. Повторите её или обновите подключение.")
    : "Проверка завершилась ошибкой. Повторите её или обновите подключение.";
}

export function credentialValidationPollDelayMs(
  validation: Pick<
    IntegrationCredentialValidationSummary,
    "retryAt" | "status"
  >,
  options: CredentialValidationPollDelayOptions
): number {
  const maxDelayMs = nonNegativeInteger(options.maxDelayMs);
  const defaultDelayMs = Math.min(
    nonNegativeInteger(options.defaultDelayMs),
    maxDelayMs
  );
  if (
    validation.status !== "RETRY_SCHEDULED" ||
    !validation.retryAt
  ) {
    return defaultDelayMs;
  }

  const retryAtMs = Date.parse(validation.retryAt);
  if (!Number.isFinite(retryAtMs) || retryAtMs <= options.nowMs) {
    return defaultDelayMs;
  }
  return Math.min(
    Math.max(defaultDelayMs, Math.ceil(retryAtMs - options.nowMs)),
    maxDelayMs
  );
}

export function isTransientCredentialValidationPollError(
  error: unknown
): boolean {
  const status = browserApiErrorStatus(error);
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  return error instanceof TypeError;
}

export function credentialValidationTransientRetryDelayMs(
  attempt: number,
  randomValue = Math.random()
): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  const exponentialDelay = Math.min(
    TRANSIENT_RETRY_MAX_DELAY_MS,
    TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** Math.min(exponent, 10)
  );
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitteredDelay = exponentialDelay * (0.75 + boundedRandom * 0.5);
  return Math.min(
    TRANSIENT_RETRY_MAX_DELAY_MS,
    Math.max(0, Math.round(jitteredDelay))
  );
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function browserApiErrorStatus(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("name" in error) ||
    error.name !== "BrowserApiError" ||
    !("status" in error) ||
    typeof error.status !== "number"
  ) {
    return undefined;
  }
  return error.status;
}
