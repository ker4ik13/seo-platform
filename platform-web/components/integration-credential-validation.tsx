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

  return (
    <div
      aria-busy={validation.busy}
      className="integration-validation-control"
    >
      <button
        aria-describedby={disabledReason ? disabledReasonId : undefined}
        aria-label={`${buttonLabel} «${credentialLabel}»`}
        className="text-button integration-validation-button"
        disabled={Boolean(disabledReason) || validation.busy}
        onClick={() => void validation.start()}
        title={disabledReason}
        type="button"
      >
        {validation.busy && (
          <span aria-hidden="true" className="spinner compact" />
        )}
        {buttonLabel}
      </button>

      {disabledReason && <small id={disabledReasonId}>{disabledReason}</small>}

      {validation.error && (
        <div
          className="inline-alert danger compact integration-validation-feedback"
          role="alert"
        >
          <span>{validation.error.message}</span>
          {validation.error.reauthenticationRequired && (
            <a
              className="inline-alert-action"
              href={`/app/login?returnTo=${encodeURIComponent(returnTo)}`}
            >
              Подтвердить вход
            </a>
          )}
        </div>
      )}

      {!validation.error && presentation && (
        <div
          className={`inline-alert ${presentation.tone} compact integration-validation-feedback`}
          role={
            presentation.tone === "info" ||
            presentation.tone === "success"
              ? "status"
              : "alert"
          }
        >
          {presentation.message}
        </div>
      )}

      {validation.refreshWarning && (
        <div
          className="inline-alert warning compact integration-validation-feedback"
          role="alert"
        >
          {validation.refreshWarning}
        </div>
      )}
    </div>
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

  useEffect(() => {
    idempotencyKey.current = undefined;
    setSummary(activeValidation);
    setError(undefined);
    setRefreshWarning(undefined);
    setPhase(activeValidation ? "polling" : "idle");
    const resumeTimer =
      activeValidation &&
      !isTerminalCredentialValidationStatus(activeValidation.status)
        ? window.setTimeout(
            () => void runRef.current(activeValidation),
            0
          )
        : undefined;
    return () => {
      if (resumeTimer !== undefined) {
        window.clearTimeout(resumeTimer);
      }
      activeRequest.current?.abort();
    };
    // activeValidation is an initial authoritative snapshot. Its disappearance
    // after terminal refresh must not erase the local terminal result.
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
