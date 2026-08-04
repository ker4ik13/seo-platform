"use client";

import { useEffect, useRef, useState } from "react";
import type {
  IntegrationCredentialStatus,
  IntegrationCredentialValidationMode,
  IntegrationCredentialValidationSummary,
  IntegrationProvider
} from "@seo-platform/contracts";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  credentialValidationPollDelayMs,
  credentialValidationPresentation,
  credentialValidationTransientRetryDelayMs,
  isTerminalCredentialValidationStatus,
  isTransientCredentialValidationPollError,
  persistedCredentialValidationPresentation,
  supportsAutomaticCredentialValidation
} from "../lib/integration-credential-validation";

const VALIDATION_POLL_INTERVAL_MS = 2_000;
const VALIDATION_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
const VALIDATION_TRANSIENT_GET_RETRY_LIMIT = 4;

type ValidationPhase =
  | "idle"
  | "starting"
  | "polling"
  | "refreshing"
  | "terminal"
  | "error";

interface ValidationRequestError {
  readonly message: string;
  readonly reauthenticationRequired: boolean;
}

export function IntegrationCredentialValidation({
  workspaceId,
  credentialId,
  credentialVersion,
  credentialLabel,
  credentialStatus,
  credentialLastErrorCode,
  activeValidation,
  provider,
  validationMode,
  canTest,
  readOnly,
  operationBlocked,
  onAcquireOperation,
  onReleaseOperation,
  onResolveConflict,
  onTerminal,
  returnTo = "/app/settings/integrations"
}: Readonly<{
  workspaceId: string;
  credentialId: string;
  credentialVersion: number;
  credentialLabel: string;
  credentialStatus: IntegrationCredentialStatus;
  credentialLastErrorCode: string | undefined;
  activeValidation: IntegrationCredentialValidationSummary | undefined;
  provider: IntegrationProvider;
  validationMode: IntegrationCredentialValidationMode | undefined;
  canTest: boolean;
  readOnly: boolean;
  operationBlocked: boolean;
  onAcquireOperation: () => boolean;
  onReleaseOperation: () => void;
  onResolveConflict: () => Promise<
    IntegrationCredentialValidationSummary | undefined
  >;
  onTerminal: (
    validation: IntegrationCredentialValidationSummary
  ) => Promise<void> | void;
  returnTo?: string;
}>) {
  const [showReauthentication, setShowReauthentication] = useState(false);
  const validation = useIntegrationCredentialValidation({
    workspaceId,
    credentialId,
    credentialVersion,
    activeValidation,
    onAcquireOperation,
    onReleaseOperation,
    onResolveConflict,
    onTerminal
  });

  useEffect(() => {
    if (!showReauthentication) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowReauthentication(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showReauthentication]);

  if (!supportsAutomaticCredentialValidation(validationMode)) {
    return (
      <div className="integration-validation-note" role="note">
        <strong>Без автоматической проверки</strong>
        <span>
          {provider === "XMLSTOCK"
            ? "Для XMLStock пока не подтверждён безопасный read-only метод. Платформа не считает локальное чтение секрета проверкой провайдера."
            : "Провайдер пока не поддерживает безопасную автоматическую проверку этого подключения."}
        </span>
      </div>
    );
  }

  const presentation = validation.summary
    ? credentialValidationPresentation(
        validation.summary.status,
        validation.summary.errorCode
      )
    : persistedCredentialValidationPresentation(
        credentialStatus,
        credentialLastErrorCode
      );
  const disabledReason = readOnly
    ? "Проверка недоступна в режиме только для чтения."
    : credentialStatus === "DISABLED"
      ? "Сначала включите или замените отключённое подключение."
      : !canTest
        ? "Недостаточно прав для проверки подключения."
        : operationBlocked
          ? "Дождитесь завершения другой операции с подключениями."
          : undefined;
  const disabledReasonId = `integration-validation-disabled-${credentialId}`;
  const buttonLabel = validationButtonLabel(
    validation.phase,
    credentialStatus,
    Boolean(validation.summary)
  );

  const loginHref = `/app/login?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <>
      <div
        aria-busy={validation.busy}
        className="integration-validation-control"
      >
        <button
          aria-describedby={disabledReason ? disabledReasonId : undefined}
          aria-label={`${buttonLabel} «${credentialLabel}»`}
          className="icon-button integration-validation-button"
          disabled={Boolean(disabledReason) || validation.busy}
          onClick={() => void validation.start()}
          title={disabledReason ?? buttonLabel}
          type="button"
        >
          {validation.busy ? (
            <span aria-hidden="true" className="spinner compact" />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          )}
          <span className="visually-hidden">{buttonLabel}</span>
        </button>

        {disabledReason && (
          <span className="visually-hidden" id={disabledReasonId}>
            {disabledReason}
          </span>
        )}

        {validation.error && (
          <span
            aria-label={validation.error.message}
            className="integration-validation-feedback danger"
            role="alert"
            title={validation.error.message}
          >
            <ValidationStateGlyph tone="danger" />
            <span className="visually-hidden">{validation.error.message}</span>
          </span>
        )}

        {!validation.error && presentation && (
          <span
            aria-label={presentation.message}
            className={`integration-validation-feedback ${presentation.tone}`}
            role={
              presentation.tone === "info" ||
              presentation.tone === "success"
                ? "status"
                : "alert"
            }
            title={presentation.message}
          >
            <ValidationStateGlyph tone={presentation.tone} />
            <span className="visually-hidden">{presentation.message}</span>
          </span>
        )}

        {validation.refreshWarning && (
          <span
            aria-label={validation.refreshWarning}
            className="integration-validation-feedback warning"
            role="alert"
            title={validation.refreshWarning}
          >
            <ValidationStateGlyph tone="warning" />
            <span className="visually-hidden">{validation.refreshWarning}</span>
          </span>
        )}

        {validation.error?.reauthenticationRequired && (
          <button
            className="secondary-button integration-validation-login"
            onClick={() => setShowReauthentication(true)}
            type="button"
          >
            Подтвердить вход
          </button>
        )}
      </div>

      {showReauthentication && (
        <div
          className="integration-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowReauthentication(false);
            }
          }}
        >
          <section
            aria-labelledby={`integration-login-title-${credentialId}`}
            aria-modal="true"
            className="panel integration-reauth-dialog"
            role="dialog"
          >
            <header className="security-card-header">
              <div>
                <h2 id={`integration-login-title-${credentialId}`}>
                  Подтвердить вход
                </h2>
                <p>
                  Сессия истекла. Войдите снова, затем повторите проверку
                  подключения «{credentialLabel}».
                </p>
              </div>
              <button
                aria-label="Закрыть окно"
                className="integration-dialog-close"
                onClick={() => setShowReauthentication(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="integration-dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setShowReauthentication(false)}
                type="button"
              >
                Отмена
              </button>
              <a className="primary-button" href={loginHref}>
                Перейти ко входу
              </a>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ValidationStateGlyph({
  tone
}: Readonly<{
  tone: "danger" | "info" | "success" | "warning";
}>) {
  if (tone === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="m5 10.2 3.1 3.1L15.4 6" />
      </svg>
    );
  }
  if (tone === "info") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="6.6" />
        <path d="M10 9v4M10 6.6v.1" />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M10 3 2.8 16h14.4L10 3Z" />
        <path d="M10 7.2v4.4M10 14.1v.1" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="6.6" />
      <path d="m7.6 7.6 4.8 4.8m0-4.8-4.8 4.8" />
    </svg>
  );
}

export function useIntegrationCredentialValidation({
  workspaceId,
  credentialId,
  credentialVersion,
  activeValidation,
  onAcquireOperation,
  onReleaseOperation,
  onResolveConflict,
  onTerminal
}: Readonly<{
  workspaceId: string;
  credentialId: string;
  credentialVersion: number;
  activeValidation: IntegrationCredentialValidationSummary | undefined;
  onAcquireOperation: () => boolean;
  onReleaseOperation: () => void;
  onResolveConflict: () => Promise<
    IntegrationCredentialValidationSummary | undefined
  >;
  onTerminal: (
    validation: IntegrationCredentialValidationSummary
  ) => Promise<void> | void;
}>) {
  const [phase, setPhase] = useState<ValidationPhase>(
    activeValidation ? "polling" : "idle"
  );
  const [summary, setSummary] =
    useState<IntegrationCredentialValidationSummary | undefined>(
      activeValidation
    );
  const [error, setError] = useState<ValidationRequestError>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const running = useRef(false);
  const runRef = useRef<
    (
      current?: IntegrationCredentialValidationSummary
    ) => Promise<void>
  >(async () => undefined);
  const activeValidationRef = useRef(activeValidation);
  activeValidationRef.current = activeValidation;

  useEffect(() => {
    const initialValidation = activeValidationRef.current;
    idempotencyKey.current = undefined;
    setSummary(initialValidation);
    setError(undefined);
    setRefreshWarning(undefined);
    setPhase(initialValidation ? "polling" : "idle");
    const resumeTimer =
      initialValidation &&
      !isTerminalCredentialValidationStatus(initialValidation.status)
        ? window.setTimeout(
            () => void runRef.current(initialValidation),
            0
          )
        : undefined;
    return () => {
      if (resumeTimer !== undefined) {
        window.clearTimeout(resumeTimer);
      }
      activeRequest.current?.abort();
    };
    // The ref supplies the authoritative snapshot only when identity/version
    // changes. A same-scope disappearance after terminal refresh must not
    // erase the locally observed terminal result or restart polling.
  }, [credentialId, credentialVersion, workspaceId]);

  async function start(): Promise<void> {
    return run(
      summary &&
        !isTerminalCredentialValidationStatus(summary.status)
        ? summary
        : undefined
    );
  }

  async function run(
    existing?: IntegrationCredentialValidationSummary
  ): Promise<void> {
    if (running.current) return;
    if (!onAcquireOperation()) {
      setPhase("idle");
      return;
    }
    running.current = true;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPhase(existing ? "polling" : "starting");
    setSummary(existing);
    setError(undefined);
    setRefreshWarning(undefined);

    try {
      let current = existing;
      if (!current) {
        const requestKey =
          idempotencyKey.current ??
          (idempotencyKey.current =
            newValidationIdempotencyKey(credentialId));
        try {
          current =
            await browserApiRequest<IntegrationCredentialValidationSummary>(
              validationCollectionPath(workspaceId, credentialId),
              {
                method: "POST",
                body: {},
                idempotencyKey: requestKey,
                signal: controller.signal
              }
            );
        } catch (requestError) {
          if (!isCredentialValidationConflict(requestError)) {
            throw requestError;
          }
          setPhase("refreshing");
          current = await onResolveConflict();
          if (!current) {
            idempotencyKey.current = undefined;
            setSummary(undefined);
            setPhase("terminal");
            return;
          }
        }
      }
      setSummary(current);
      const pollingDeadline = Date.now() + VALIDATION_POLL_TIMEOUT_MS;

      while (!isTerminalCredentialValidationStatus(current.status)) {
        const nowMs = Date.now();
        const remainingMs = pollingDeadline - nowMs;
        if (remainingMs <= 0) {
          throw new CredentialValidationPollingTimeout();
        }
        setPhase("polling");
        await waitForNextPoll(
          controller.signal,
          credentialValidationPollDelayMs(current, {
            defaultDelayMs: VALIDATION_POLL_INTERVAL_MS,
            maxDelayMs: remainingMs,
            nowMs
          })
        );
        if (Date.now() >= pollingDeadline) {
          throw new CredentialValidationPollingTimeout();
        }
        current = await pollCredentialValidation(
          validationItemPath(workspaceId, credentialId, current.id),
          controller.signal,
          pollingDeadline
        );
        setSummary(current);
      }

      idempotencyKey.current = undefined;
      setPhase("refreshing");
      try {
        await onTerminal(current);
      } catch {
        setRefreshWarning(
          "Проверка завершена, но статус подключения не обновился. Перезагрузите список."
        );
      }
      setPhase("terminal");
    } catch (requestError) {
      if (!isAbortError(requestError)) {
        setError(validationRequestError(requestError));
        setPhase("error");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = undefined;
      }
      running.current = false;
      onReleaseOperation();
    }
  }
  runRef.current = run;

  return {
    busy:
      phase === "starting" ||
      phase === "polling" ||
      phase === "refreshing",
    error,
    phase,
    refreshWarning,
    start,
    summary
  } as const;
}

function validationButtonLabel(
  phase: ValidationPhase,
  credentialStatus: IntegrationCredentialStatus,
  hasSummary: boolean
): string {
  if (phase === "starting") return "Запускаем проверку…";
  if (phase === "polling") return "Проверяем…";
  if (phase === "refreshing") return "Обновляем статус…";
  if (hasSummary || phase === "error") return "Проверить снова";
  return credentialStatus === "PENDING_VERIFICATION"
    ? "Проверить подключение"
    : "Проверить снова";
}

function validationRequestError(error: unknown): ValidationRequestError {
  if (error instanceof CredentialValidationPollingTimeout) {
    return {
      message:
        "Проверка выполняется дольше обычного и продолжится в фоне. Повторите позже, чтобы получить актуальный статус.",
      reauthenticationRequired: false
    };
  }
  if (error instanceof BrowserApiError) {
    if (error.code === "REAUTHENTICATION_REQUIRED") {
      return {
        message: "Для проверки подключения нужно повторно подтвердить вход.",
        reauthenticationRequired: true
      };
    }
    if (error.status === 402) {
      return {
        message:
          "Workspace работает только для чтения. Новые проверки временно заблокированы.",
        reauthenticationRequired: false
      };
    }
    if (error.status === 403) {
      return {
        message: "Недостаточно прав для проверки этого подключения.",
        reauthenticationRequired: false
      };
    }
    if (error.status === 429) {
      return {
        message:
          "Сервис временно ограничил частоту проверок. Повторите позже.",
        reauthenticationRequired: false
      };
    }
    if (
      error.code === "FEATURE_NOT_AVAILABLE" ||
      error.code === "VALIDATION_UNAVAILABLE"
    ) {
      return {
        message:
          "Безопасная автоматическая проверка для этого провайдера недоступна.",
        reauthenticationRequired: false
      };
    }
    if (error.code === "IDEMPOTENCY_CONFLICT") {
      return {
        message:
          "Запрос проверки конфликтует с предыдущим. Обновите страницу и повторите.",
        reauthenticationRequired: false
      };
    }
    if (error.status === 409) {
      return {
        message:
          "Проверка этого подключения уже выполняется. Дождитесь завершения и обновите список.",
        reauthenticationRequired: false
      };
    }
    if (
      error.code === "DEPENDENCY_UNAVAILABLE" ||
      error.code === "PROVIDER_UNAVAILABLE"
    ) {
      return {
        message: "Сервис проверки временно недоступен. Повторите позже.",
        reauthenticationRequired: false
      };
    }
    return {
      message: error.message,
      reauthenticationRequired: false
    };
  }
  return {
    message: "Не удалось запустить проверку подключения.",
    reauthenticationRequired: false
  };
}

function isCredentialValidationConflict(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 409;
}

class CredentialValidationPollingTimeout extends Error {
  public constructor() {
    super("Credential validation polling timed out");
    this.name = "CredentialValidationPollingTimeout";
  }
}

function validationCollectionPath(
  workspaceId: string,
  credentialId: string
): string {
  return `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/credentials/${encodeURIComponent(credentialId)}/validations`;
}

function validationItemPath(
  workspaceId: string,
  credentialId: string,
  validationId: string
): string {
  return `${validationCollectionPath(workspaceId, credentialId)}/${encodeURIComponent(validationId)}`;
}

function newValidationIdempotencyKey(credentialId: string): string {
  return `credential-validation:${credentialId}:${globalThis.crypto.randomUUID()}`;
}

async function pollCredentialValidation(
  path: string,
  signal: AbortSignal,
  pollingDeadline: number
): Promise<IntegrationCredentialValidationSummary> {
  let transientRetries = 0;
  while (true) {
    try {
      return await browserApiRequest<IntegrationCredentialValidationSummary>(
        path,
        { signal }
      );
    } catch (error) {
      if (
        isAbortError(error) ||
        !isTransientCredentialValidationPollError(error) ||
        transientRetries >= VALIDATION_TRANSIENT_GET_RETRY_LIMIT
      ) {
        throw error;
      }
      transientRetries += 1;
      const remainingMs = pollingDeadline - Date.now();
      if (remainingMs <= 0) {
        throw new CredentialValidationPollingTimeout();
      }
      await waitForNextPoll(
        signal,
        Math.min(
          credentialValidationTransientRetryDelayMs(transientRetries),
          remainingMs
        )
      );
      if (Date.now() >= pollingDeadline) {
        throw new CredentialValidationPollingTimeout();
      }
    }
  }
}

function waitForNextPoll(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("Credential validation aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
