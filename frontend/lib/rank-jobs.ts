import {
  connectorRoutingScopes,
  rankJobFailureCodes,
  rankJobStages,
  rankJobStatuses,
  type ConnectorOperationAttemptSummary,
  type ConnectorRoutingScope,
  type CreateRankRunInput,
  type RankJobFailureCode,
  type RankJobResultSummary,
  type RankSearchSource,
  type RankJobStage,
  type RankJobStatus,
  type RankJobSummary
} from "@seo-platform/contracts";
import { BrowserApiError } from "./browser-api.ts";
import {
  stableIdempotencyCommand,
  type IdempotentCommand
} from "./idempotency.ts";

export const RANK_JOB_AUTO_POLL_WINDOW_MS = 5 * 60 * 1_000;
export const RANK_JOB_GET_TIMEOUT_MS = 10_000;
export const RANK_JOB_MUTATION_TIMEOUT_MS = 15_000;
export const RANK_JOB_SESSION_HINT_VERSION = 1;
export const RANK_PENDING_CREATE_RECEIPT_VERSION = 1;

const IDENTIFIER_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/u;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RANK_RUN_IDEMPOTENCY_KEY_PATTERN =
  /^rank-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_DECIMAL_DIGITS = 40;
const MAX_SESSION_HINT_LENGTH = 512;
const MAX_PENDING_CREATE_RECEIPT_LENGTH = 512;

const jobStatuses = new Set<string>(rankJobStatuses);
const jobStages = new Set<string>(rankJobStages);
const failureCodes = new Set<string>(rankJobFailureCodes);
const rankRunConflictReasons = new Set<string>([
  "EQUIVALENT_RUN_ACTIVE",
  "ESTIMATE_EXPIRED",
  "ESTIMATE_STALE",
  "EXECUTION_GRANT_DENIED"
]);
const activeStages = new Set<RankJobStage>([
  "WAITING_EXECUTION_GRANT",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "WAITING_PROVIDER",
  "FETCHING_RESULT",
  "PERSISTING_RESULT",
  "FINALIZING"
]);
const cancellableStages = new Set<RankJobStage>([
  "PREPARING_SCOPE",
  "WAITING_FOR_QUEUE",
  ...[...activeStages].filter((stage) => stage !== "FINALIZING")
]);

export interface RankJobExpectedScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly jobId?: string;
}

export interface RankJobSessionHint {
  readonly version: typeof RANK_JOB_SESSION_HINT_VERSION;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly jobId: string;
}

export interface RankPendingCreateReceipt {
  readonly version: typeof RANK_PENDING_CREATE_RECEIPT_VERSION;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly estimateId: string;
  readonly idempotencyKey: string;
}

export type RankJobFeedbackAction =
  | "ATTACH_EXISTING"
  | "NONE"
  | "RECALCULATE"
  | "REFRESH"
  | "RETRY_CANCEL"
  | "RETRY_SAME_COMMAND";

export interface RankJobFeedback {
  readonly kind:
    | "conflict"
    | "degraded"
    | "forbidden"
    | "invalid-response"
    | "not-found"
    | "offline"
    | "rate-limited"
    | "rejected";
  readonly message: string;
  readonly action: RankJobFeedbackAction;
  readonly attachJobId?: string;
  readonly requestId?: string;
}

export interface RankJobPresentation {
  readonly title: string;
  readonly message: string;
  readonly tone: "danger" | "info" | "muted" | "success" | "warning";
}

const stageLabels: Readonly<Record<RankJobStage, string>> = {
  PREPARING_SCOPE: "Фиксируем состав запросов",
  WAITING_FOR_QUEUE: "Ожидает исполнения",
  WAITING_EXECUTION_GRANT: "Проверяем разрешение на выполнение",
  READY_TO_SUBMIT: "Готовим безопасную отправку",
  SUBMITTING: "Передаём задачу провайдеру",
  WAITING_PROVIDER: "Провайдер обрабатывает задачу",
  FETCHING_RESULT: "Получаем результат",
  PERSISTING_RESULT: "Сохраняем позиции",
  FINALIZING: "Фиксируем итог задачи",
  SUBMIT_OUTCOME_UNKNOWN: "Требуется проверка исхода",
  FINISHED: "Завершено"
};

const failureMessages: Readonly<Record<RankJobFailureCode, string>> = {
  ESTIMATE_EXPIRED:
    "Оценка истекла до принятия запуска. Данные не отправлялись повторно; рассчитайте новую оценку.",
  ESTIMATE_STALE:
    "Настройки проекта, контекста или источника изменились. Рассчитайте новую оценку по актуальным данным.",
  EQUIVALENT_RUN_ACTIVE:
    "Существует эквивалентная активная задача, но её ID не получен. Новый запуск заблокирован; доступен только точный повтор исходной команды.",
  EXECUTION_GRANT_DENIED:
    "Текущие права, состояние проекта, тарифа или квоты не разрешили выполнение. Просмотр сохранённых данных доступен.",
  PROVIDER_AUTHENTICATION_FAILED:
    "Провайдер отклонил API-ключ. Проверьте подключение и только затем подготовьте новый запуск.",
  PROVIDER_RATE_LIMITED:
    "Провайдер ограничил частоту запросов. Задача остановлена без автоматического нового запуска.",
  PROVIDER_TEMPORARY_FAILURE:
    "Провайдер временно недоступен. Автоматический новый запуск не создавался.",
  PROVIDER_RESPONSE_INVALID:
    "Ответ провайдера не прошёл проверку. Некорректные данные не были приняты как результат.",
  PERSISTENCE_FAILED:
    "Не удалось надёжно сохранить весь результат. Уже подтверждённые данные отмечены в итогах задачи.",
  INTERNAL_ERROR:
    "Задача остановлена из-за внутренней ошибки. Новый запуск требует новой проверки готовности.",
  SUBMIT_OUTCOME_UNKNOWN:
    "Система не может безопасно доказать исход операции. Автоматическое продолжение и повтор отключены."
};

export function rankRunsApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`;
}

export function rankJobApiPath(
  projectId: string,
  jobId: string
): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}`;
}

export function rankJobCancelApiPath(
  projectId: string,
  jobId: string
): string {
  return `${rankJobApiPath(projectId, jobId)}/cancel`;
}

export function rankRunInput(
  estimateId: string,
  confirmedPlatformChargeMicro: string
): CreateRankRunInput {
  return { estimateId, confirmedPlatformChargeMicro };
}

export function rankRunPayloadSignature(
  estimateId: string,
  confirmedPlatformChargeMicro: string
): string {
  return JSON.stringify(
    rankRunInput(estimateId, confirmedPlatformChargeMicro)
  );
}

export function rankRunIdempotencyCommand(
  current: IdempotentCommand | undefined,
  estimateId: string,
  confirmedPlatformChargeMicro: string,
  createKey: () => string
): IdempotentCommand {
  return stableIdempotencyCommand(
    current,
    rankRunPayloadSignature(estimateId, confirmedPlatformChargeMicro),
    createKey
  );
}

export function parseRankJobSummary(
  value: unknown,
  expected: RankJobExpectedScope
): RankJobSummary {
  const input = record(value);
  const id = identifier(input.id);
  const workspaceId = identifier(input.workspaceId);
  const projectId = identifier(input.projectId);
  const trackingContextId = identifier(input.trackingContextId);
  const status = rankJobStatus(input.status);
  const stage = rankJobStage(input.stage);
  const progress = parseProgress(input.progress);
  const createdAt = timestamp(input.createdAt);
  const billingCurrency =
    typeof input.billingCurrency === "string" &&
    CURRENCY_PATTERN.test(input.billingCurrency)
      ? input.billingCurrency
      : undefined;
  const provider =
    input.provider === "ARSENKIN" || input.provider === "XMLSTOCK"
      ? input.provider
      : undefined;
  const executionPresentation = parseRankExecutionPresentation(input);
  const route = parseConnectorRoute(input);
  const credentialMode =
    input.credentialMode === "BYOK_API_KEY" ||
    input.credentialMode === "PLATFORM_PAID"
      ? input.credentialMode
      : undefined;
  const platformChargeMicro =
    typeof input.platformChargeMicro === "string" &&
    /^(?:0|[1-9]\d*)$/u.test(input.platformChargeMicro)
      ? input.platformChargeMicro
      : undefined;

  if (
    !id ||
    !workspaceId ||
    !projectId ||
    !trackingContextId ||
    workspaceId !== expected.workspaceId ||
    projectId !== expected.projectId ||
    trackingContextId !== expected.trackingContextId ||
    (expected.jobId !== undefined && id !== expected.jobId) ||
    input.type !== "MANUAL_RANK_CHECK" ||
    !provider ||
    executionPresentation === null ||
    route === null ||
    input.operation !== "POSITIONS" ||
    !credentialMode ||
    !platformChargeMicro ||
    (credentialMode === "BYOK_API_KEY" && platformChargeMicro !== "0") ||
    (credentialMode === "PLATFORM_PAID" && platformChargeMicro === "0") ||
    !billingCurrency ||
    !status ||
    !stage ||
    !progress ||
    !createdAt
  ) {
    return invalidJob();
  }

  const base = {
    id,
    workspaceId,
    projectId,
    trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider,
    ...executionPresentation,
    ...route,
    operation: "POSITIONS",
    credentialMode,
    progress,
    platformChargeMicro,
    billingCurrency,
    createdAt
  } as const;
  const queuedAt = optionalTimestamp(input.queuedAt);
  const startedAt = optionalTimestamp(input.startedAt);
  const finishedAt = optionalTimestamp(input.finishedAt);
  if (
    queuedAt === null ||
    startedAt === null ||
    finishedAt === null ||
    !orderedExecutionTimes(createdAt, queuedAt, startedAt, finishedAt)
  ) {
    return invalidJob();
  }

  switch (status) {
    case "PREPARING":
      if (
        stage !== "PREPARING_SCOPE" ||
        progress.current !== "0" ||
        queuedAt !== undefined ||
        startedAt !== undefined ||
        finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidJob();
      }
      return { ...base, status, stage };
    case "QUEUED":
      if (
        stage !== "WAITING_FOR_QUEUE" ||
        progress.current !== "0" ||
        queuedAt === undefined ||
        startedAt !== undefined ||
        finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidJob();
      }
      return { ...base, status, stage, queuedAt };
    case "RUNNING":
      if (
        !activeStages.has(stage) ||
        queuedAt === undefined ||
        startedAt === undefined ||
        finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage: stage as Exclude<
          RankJobStage,
          | "PREPARING_SCOPE"
          | "WAITING_FOR_QUEUE"
          | "SUBMIT_OUTCOME_UNKNOWN"
          | "FINISHED"
        >,
        queuedAt,
        startedAt
      };
    case "CANCEL_REQUESTED":
      if (
        !cancellableStages.has(stage) ||
        !validCancellationLifecycle(
          stage,
          progress,
          queuedAt,
          startedAt
        ) ||
        finishedAt !== undefined ||
        input.result !== undefined ||
        input.failure !== undefined
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage: stage as Exclude<
          RankJobStage,
          "SUBMIT_OUTCOME_UNKNOWN" | "FINISHED"
        >,
        ...(queuedAt === undefined ? {} : { queuedAt }),
        ...(startedAt === undefined ? {} : { startedAt })
      };
    case "CANCELLED": {
      const result = optionalResult(input.result, progress);
      if (
        finishedAt === undefined ||
        stage !== "FINISHED" ||
        result === null ||
        input.failure !== undefined
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage,
        ...(result === undefined ? {} : { result }),
        ...(queuedAt === undefined ? {} : { queuedAt }),
        ...(startedAt === undefined ? {} : { startedAt }),
        finishedAt
      };
    }
    case "COMPLETED":
    case "PARTIALLY_COMPLETED": {
      const result = parseResult(input.result, progress);
      if (
        finishedAt === undefined ||
        stage !== "FINISHED" ||
        !result ||
        input.failure !== undefined ||
        !validSuccessResult(status, result)
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage,
        result,
        ...(queuedAt === undefined ? {} : { queuedAt }),
        ...(startedAt === undefined ? {} : { startedAt }),
        finishedAt
      };
    }
    case "FAILED": {
      const result = optionalResult(input.result, progress);
      const failure = parseFailure(input.failure);
      if (
        finishedAt === undefined ||
        stage !== "FINISHED" ||
        result === null ||
        !failure ||
        failure.code === "SUBMIT_OUTCOME_UNKNOWN"
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage,
        ...(result === undefined ? {} : { result }),
        failure: {
          code: failure.code as Exclude<
            RankJobFailureCode,
            "SUBMIT_OUTCOME_UNKNOWN"
          >
        },
        ...(queuedAt === undefined ? {} : { queuedAt }),
        ...(startedAt === undefined ? {} : { startedAt }),
        finishedAt
      };
    }
    case "ACTION_REQUIRED": {
      const result = parseResult(input.result, progress);
      const failure = parseFailure(input.failure);
      if (
        finishedAt === undefined ||
        stage !== "SUBMIT_OUTCOME_UNKNOWN" ||
        !result ||
        failure?.code !== "SUBMIT_OUTCOME_UNKNOWN" ||
        !validActionRequiredResult(result)
      ) {
        return invalidJob();
      }
      return {
        ...base,
        status,
        stage,
        result,
        failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
        ...(queuedAt === undefined ? {} : { queuedAt }),
        ...(startedAt === undefined ? {} : { startedAt }),
        finishedAt
      };
    }
  }
}

export function rankSearchSystemLabel(
  searchEngine: "GOOGLE" | "YANDEX",
  searchSource?: RankSearchSource
): string {
  if (searchEngine === "GOOGLE") {
    return searchSource === "LIVE" ? "Google Live" : "Google";
  }
  if (searchSource === "LIVE") return "Яндекс Live";
  if (searchSource === "SEARCH_API") return "Яндекс XML";
  return "Яндекс";
}

function parseRankExecutionPresentation(
  input: Readonly<Record<string, unknown>>
): {
  readonly searchEngine?: "GOOGLE" | "YANDEX";
  readonly searchSource?: RankSearchSource;
  readonly depth?: 30 | 50 | 100;
} | null {
  const searchEngine =
    input.searchEngine === undefined
      ? undefined
      : input.searchEngine === "GOOGLE" || input.searchEngine === "YANDEX"
        ? input.searchEngine
        : null;
  const searchSource =
    input.searchSource === undefined
      ? undefined
      : input.searchSource === "SEARCH_API" || input.searchSource === "LIVE"
        ? input.searchSource
        : null;
  const depth =
    input.depth === undefined
      ? undefined
      : input.depth === 30 || input.depth === 50 || input.depth === 100
        ? input.depth
        : null;
  if (
    searchEngine === null ||
    searchSource === null ||
    depth === null ||
    (searchSource !== undefined && searchEngine === undefined) ||
    (searchEngine === "GOOGLE" && searchSource === "SEARCH_API")
  ) {
    return null;
  }
  return {
    ...(searchEngine ? { searchEngine } : {}),
    ...(searchSource ? { searchSource } : {}),
    ...(depth ? { depth } : {})
  };
}

function parseConnectorRoute(
  input: Readonly<Record<string, unknown>>
): {
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
} | null {
  const hasRoutingScope = input.routingScope !== undefined;
  const hasConnectorAttempts = input.connectorAttempts !== undefined;
  if (hasRoutingScope !== hasConnectorAttempts) return null;
  if (!hasRoutingScope) return {};
  if (
    typeof input.routingScope !== "string" ||
    !connectorRoutingScopes.includes(input.routingScope as ConnectorRoutingScope) ||
    !Array.isArray(input.connectorAttempts) ||
    input.connectorAttempts.length < 1 ||
    input.connectorAttempts.length > 8
  ) {
    return null;
  }
  const attempts: ConnectorOperationAttemptSummary[] = [];
  for (const [index, candidate] of input.connectorAttempts.entries()) {
    const attempt = record(candidate);
    const occurredAt = timestamp(attempt.occurredAt);
    if (
      attempt.sequence !== index + 1 ||
      (attempt.provider !== "XMLSTOCK" &&
        attempt.provider !== "ARSENKIN" &&
        attempt.provider !== "KEYS_SO") ||
      typeof attempt.routingScope !== "string" ||
      !connectorRoutingScopes.includes(
        attempt.routingScope as ConnectorRoutingScope
      ) ||
      (attempt.outcome !== "SELECTED" &&
        attempt.outcome !== "SUCCEEDED" &&
        attempt.outcome !== "FALLBACK" &&
        attempt.outcome !== "FAILED") ||
      !occurredAt ||
      (attempt.reasonCode !== undefined &&
        (typeof attempt.reasonCode !== "string" ||
          !/^[A-Z][A-Z0-9_]{0,63}$/u.test(attempt.reasonCode)))
    ) {
      return null;
    }
    attempts.push({
      sequence: index + 1,
      provider: attempt.provider,
      routingScope: attempt.routingScope as ConnectorRoutingScope,
      outcome: attempt.outcome,
      ...(typeof attempt.reasonCode === "string"
        ? { reasonCode: attempt.reasonCode }
        : {}),
      occurredAt
    });
  }
  return {
    routingScope: input.routingScope as ConnectorRoutingScope,
    connectorAttempts: attempts
  };
}

export function isActiveRankJob(job: RankJobSummary): boolean {
  return [
    "PREPARING",
    "QUEUED",
    "RUNNING",
    "CANCEL_REQUESTED"
  ].includes(job.status);
}

export function isCancellableRankJob(job: RankJobSummary): boolean {
  return ["PREPARING", "QUEUED", "RUNNING"].includes(job.status) &&
    job.stage !== "FINALIZING";
}

export function isTerminalRankJob(job: RankJobSummary): boolean {
  return !isActiveRankJob(job);
}

export function rankJobReconciliationTarget(
  job: RankJobSummary | undefined,
  hintedJobId: string | undefined
): string | undefined {
  if (job) return isActiveRankJob(job) ? job.id : undefined;
  return hintedJobId;
}

export function rankJobPollDelayMs(
  job: RankJobSummary,
  elapsedMs: number
): number | undefined {
  if (!isActiveRankJob(job)) return undefined;
  const elapsed = Math.max(0, elapsedMs);
  if (job.status === "CANCEL_REQUESTED") return 1_500;
  if (job.status === "PREPARING") return elapsed < 15_000 ? 1_500 : 2_500;
  if (job.status === "QUEUED") return elapsed < 30_000 ? 2_500 : 5_000;
  return elapsed < 60_000 ? 2_500 : 5_000;
}

export function rankJobProgressPercent(job: RankJobSummary): number {
  const current = BigInt(job.progress.current);
  const total = BigInt(job.progress.total);
  if (total === 0n) return 0;
  return Number((current * 10_000n) / total) / 100;
}

export function rankJobStageLabel(stage: RankJobStage): string {
  return stageLabels[stage];
}

export function rankJobFailureMessage(
  code: RankJobFailureCode
): string {
  return failureMessages[code];
}

export function rankJobPresentation(
  job: RankJobSummary
): RankJobPresentation {
  switch (job.status) {
    case "PREPARING":
      return {
        title: "Подготавливаем задачу",
        message:
          "Сервер фиксирует неизменяемый состав запросов. Это ещё не означает обращение к провайдеру.",
        tone: "info"
      };
    case "QUEUED":
      return {
        title: "Задача в очереди",
        message:
          "Состав зафиксирован. Серверное разрешение и доступность исполнителя будут проверены до внешней операции.",
        tone: "info"
      };
    case "RUNNING":
      return {
        title: stageLabels[job.stage],
        message:
          "Показывается только подтверждённый сервером этап. Закрытие страницы не отменяет задачу.",
        tone: "info"
      };
    case "CANCEL_REQUESTED":
      return {
        title: "Отмена запрошена",
        message:
          "Worker остановится в безопасной точке. Уже отправленный запрос может завершиться, а подтверждённый результат — сохраниться.",
        tone: "warning"
      };
    case "CANCELLED":
      return {
        title: "Задача отменена",
        message: job.result
          ? "Отмена завершена. Ниже показаны данные, которые успели надёжно сохраниться."
          : "Отмена завершена до сохранения результатов.",
        tone: "muted"
      };
    case "PARTIALLY_COMPLETED":
      return {
        title: "Задача завершена частично",
        message:
          "Сохранена только подтверждённая часть результата. Частичные данные явно отделены от полного замера.",
        tone: "warning"
      };
    case "COMPLETED":
      return {
        title: "Задача завершена",
        message: "Все пары запроса и контекста надёжно сохранены.",
        tone: "success"
      };
    case "FAILED":
      return {
        title: "Задача завершилась с ошибкой",
        message: failureMessages[job.failure.code],
        tone: "danger"
      };
    case "ACTION_REQUIRED":
      return {
        title: "Требуется ручная проверка",
        message:
          "Исход операции нельзя установить безопасно. Автоповтор и новый запуск отключены: обновите статус и передайте ID задачи оператору.",
        tone: "danger"
      };
  }
}

export function rankJobCreateFeedback(
  error: unknown,
  online: boolean
): RankJobFeedback {
  const requestId = feedbackRequestId(error);
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Соединение потеряно после отправки команды. Исход неизвестен; явный безопасный повтор использует тот же Idempotency-Key.",
      action: "RETRY_SAME_COMMAND",
      ...requestId
    };
  }
  if (!(error instanceof BrowserApiError)) {
    return {
      kind: "degraded",
      message:
        "Не удалось подтвердить создание задачи. Не запускайте новую команду — повторите эту же безопасно.",
      action: "RETRY_SAME_COMMAND"
    };
  }
  if (error.code === "INVALID_RESPONSE") {
    return {
      kind: "invalid-response",
      message:
        "Сервис вернул некорректный ответ. Задача могла быть принята; повторите ту же команду безопасно.",
      action: "RETRY_SAME_COMMAND",
      ...requestId
    };
  }
  if (error.status === 403) {
    return {
      kind: "forbidden",
      message:
        "Право ranking.run было отозвано. Задача не считается принятой.",
      action: "NONE",
      ...requestId
    };
  }
  if (error.status === 404) {
    return {
      kind: "not-found",
      message:
        "Проект или оценка больше недоступны. Обновите доступ к проекту.",
      action: "NONE",
      ...requestId
    };
  }
  if (error.status === 402) {
    return {
      kind: "forbidden",
      message:
        "Рабочая область доступна только для чтения. Просмотр сохранённых результатов остаётся доступным.",
      action: "NONE",
      ...requestId
    };
  }
  if (error.status === 409) {
    const reason =
      error.reason ??
      (rankRunConflictReasons.has(error.code)
        ? error.code
        : undefined);
    if (reason === "EQUIVALENT_RUN_ACTIVE") {
      const attachJobId = error.existingJobId;
      return {
        kind: "conflict",
        message:
          attachJobId === undefined
            ? "Сервер подтвердил эквивалентную активную задачу, но не вернул её ID. Новый запуск заблокирован. Можно только явно повторить исходную команду с тем же ключом."
            : "Сервер подтвердил эквивалентную активную задачу. Новый запуск заблокирован; можно безопасно открыть её через проверку статуса.",
        action:
          attachJobId === undefined
            ? "RETRY_SAME_COMMAND"
            : "ATTACH_EXISTING",
        ...(attachJobId === undefined ? {} : { attachJobId }),
        ...requestId
      };
    }
    return {
      kind: "conflict",
      message:
        reason === "ESTIMATE_EXPIRED"
          ? "Оценка истекла. Рассчитайте новую перед следующим запуском."
          : reason === "EXECUTION_GRANT_DENIED"
            ? "Текущие права, состояние проекта или квота изменились. Пересчитайте готовность после устранения ограничения."
            : "Оценка или конфигурация устарела. Выполните явный новый расчёт.",
      action: "RECALCULATE",
      ...requestId
    };
  }
  if (error.status === 429) {
    return {
      kind: "rate-limited",
      message:
        "Сервис ограничил частоту команд. Повторите ту же команду позже; новый ключ не создаётся.",
      action: "RETRY_SAME_COMMAND",
      ...requestId
    };
  }
  if (error.retryable || error.status >= 500) {
    return {
      kind: "degraded",
      message:
        "Сервис задач временно недоступен. Явный безопасный повтор не создаст другую команду.",
      action: "RETRY_SAME_COMMAND",
      ...requestId
    };
  }
  return {
    kind: "rejected",
    message:
      "Сервис отклонил создание задачи. Проверьте ограничения запуска и повторно рассчитайте готовность.",
    action: "NONE",
    ...requestId
  };
}

export function shouldRetainRankPendingCreateReceipt(
  error: unknown,
  online: boolean
): boolean {
  if (!online || error instanceof TypeError) return true;
  if (!(error instanceof BrowserApiError)) return true;
  if (
    error.code === "INVALID_RESPONSE" ||
    error.status === 401 ||
    error.status === 429 ||
    error.retryable ||
    error.status >= 500
  ) {
    return true;
  }
  const reason =
    error.reason ??
    (rankRunConflictReasons.has(error.code)
      ? error.code
      : undefined);
  return error.status === 409 && reason === "EQUIVALENT_RUN_ACTIVE";
}

export function rankJobReadFeedback(
  error: unknown,
  online: boolean
): RankJobFeedback {
  const requestId = feedbackRequestId(error);
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Нет соединения. Последний подтверждённый статус сохранён локально как устаревший и не изменяется.",
      action: "REFRESH",
      ...requestId
    };
  }
  if (error instanceof BrowserApiError) {
    if (error.status === 403) {
      return {
        kind: "forbidden",
        message: "Право ranking.view было отозвано.",
        action: "NONE",
        ...requestId
      };
    }
    if (error.status === 404) {
      return {
        kind: "not-found",
        message:
          "Задача не найдена в этом проекте или доступ к ней отозван.",
        action: "NONE",
        ...requestId
      };
    }
    if (error.code === "INVALID_RESPONSE") {
      return {
        kind: "invalid-response",
        message:
          "Сервис вернул некорректный статус. Последнее валидное состояние оставлено без изменений.",
        action: "REFRESH",
        ...requestId
      };
    }
    if (error.status === 429) {
      return {
        kind: "rate-limited",
        message:
          "Слишком много обновлений статуса. Подождите и обновите вручную.",
        action: "REFRESH",
        ...requestId
      };
    }
    if (error.retryable || error.status >= 500) {
      return {
        kind: "degraded",
        message:
          "Статус временно недоступен. Последнее подтверждённое состояние остаётся видимым.",
        action: "REFRESH",
        ...requestId
      };
    }
    return {
      kind: "rejected",
      message:
        "Сервис отклонил обновление статуса. Последнее подтверждённое состояние оставлено без изменений.",
      action: "REFRESH",
      ...requestId
    };
  }
  return {
    kind: "degraded",
    message:
      "Не удалось обновить статус задачи. Последнее подтверждённое состояние не изменено.",
    action: "REFRESH"
  };
}

export function rankJobCancelFeedback(
  error: unknown,
  online: boolean
): RankJobFeedback {
  const requestId = feedbackRequestId(error);
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Не удалось подтвердить отмену. Команда отмены идемпотентна, но повтор выполняется только явно.",
      action: "RETRY_CANCEL",
      ...requestId
    };
  }
  if (error instanceof BrowserApiError) {
    if (error.status === 403) {
      return {
        kind: "forbidden",
        message:
          "Для отмены требуется разрешение collector.cancel. Просмотр задачи остаётся доступным.",
        action: "NONE",
        ...requestId
      };
    }
    if (error.status === 404) {
      return {
        kind: "not-found",
        message:
          "Задача больше не доступна в этом проекте. Обновите её статус.",
        action: "REFRESH",
        ...requestId
      };
    }
    if (
      error.code === "INVALID_RESPONSE" ||
      error.status === 429 ||
      error.retryable ||
      error.status >= 500
    ) {
      return {
        kind:
          error.code === "INVALID_RESPONSE"
            ? "invalid-response"
            : error.status === 429
              ? "rate-limited"
              : "degraded",
        message:
          "Исход отмены не подтверждён. Повторите ту же идемпотентную отмену или обновите статус.",
        action: "RETRY_CANCEL",
        ...requestId
      };
    }
    return {
      kind: "rejected",
      message:
        "Сервис отклонил отмену задачи. Обновите статус перед следующим действием.",
      action: "NONE",
      ...requestId
    };
  }
  return {
    kind: "degraded",
    message:
      "Не удалось подтвердить отмену. Обновите статус перед следующим действием.",
    action: "REFRESH"
  };
}

export function rankJobSessionHintKey(
  projectId: string,
  trackingContextId: string
): string {
  return `rank-job:v${RANK_JOB_SESSION_HINT_VERSION}:${projectId}:${trackingContextId}`;
}

export function serializeRankJobSessionHint(
  hint: RankJobSessionHint
): string {
  const parsed = validateRankJobSessionHint(hint, {
    projectId: hint.projectId,
    trackingContextId: hint.trackingContextId
  });
  if (!parsed) throw new TypeError("Invalid rank Job session hint");
  return JSON.stringify(parsed);
}

export function parseRankJobSessionHint(
  value: string | null | undefined,
  expected: Readonly<{
    projectId: string;
    trackingContextId: string;
  }>
): RankJobSessionHint | undefined {
  if (!value || value.length > MAX_SESSION_HINT_LENGTH) return undefined;
  try {
    return validateRankJobSessionHint(JSON.parse(value), expected);
  } catch {
    return undefined;
  }
}

export function rankPendingCreateReceiptKey(
  projectId: string,
  trackingContextId: string
): string {
  return `rank-create:v${RANK_PENDING_CREATE_RECEIPT_VERSION}:${projectId}:${trackingContextId}`;
}

export function serializeRankPendingCreateReceipt(
  receipt: RankPendingCreateReceipt
): string {
  const parsed = validateRankPendingCreateReceipt(receipt, {
    projectId: receipt.projectId,
    trackingContextId: receipt.trackingContextId
  });
  if (!parsed) {
    throw new TypeError("Invalid rank pending create receipt");
  }
  return JSON.stringify(parsed);
}

export function parseRankPendingCreateReceipt(
  value: string | null | undefined,
  expected: Readonly<{
    projectId: string;
    trackingContextId: string;
  }>
): RankPendingCreateReceipt | undefined {
  if (!value || value.length > MAX_PENDING_CREATE_RECEIPT_LENGTH) {
    return undefined;
  }
  try {
    return validateRankPendingCreateReceipt(
      JSON.parse(value),
      expected
    );
  } catch {
    return undefined;
  }
}

function validateRankJobSessionHint(
  value: unknown,
  expected: Readonly<{
    projectId: string;
    trackingContextId: string;
  }>
): RankJobSessionHint | undefined {
  const hint = record(value);
  const keys = Object.keys(hint).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "jobId" ||
    keys[1] !== "projectId" ||
    keys[2] !== "trackingContextId" ||
    keys[3] !== "version" ||
    hint.version !== RANK_JOB_SESSION_HINT_VERSION
  ) {
    return undefined;
  }
  const projectId = identifier(hint.projectId);
  const trackingContextId = identifier(hint.trackingContextId);
  const jobId = identifier(hint.jobId);
  if (
    !projectId ||
    !trackingContextId ||
    !jobId ||
    projectId !== expected.projectId ||
    trackingContextId !== expected.trackingContextId
  ) {
    return undefined;
  }
  return {
    version: RANK_JOB_SESSION_HINT_VERSION,
    projectId,
    trackingContextId,
    jobId
  };
}

function validateRankPendingCreateReceipt(
  value: unknown,
  expected: Readonly<{
    projectId: string;
    trackingContextId: string;
  }>
): RankPendingCreateReceipt | undefined {
  const receipt = record(value);
  const keys = Object.keys(receipt).sort();
  if (
    keys.length !== 5 ||
    keys[0] !== "estimateId" ||
    keys[1] !== "idempotencyKey" ||
    keys[2] !== "projectId" ||
    keys[3] !== "trackingContextId" ||
    keys[4] !== "version" ||
    receipt.version !== RANK_PENDING_CREATE_RECEIPT_VERSION
  ) {
    return undefined;
  }
  const projectId = identifier(receipt.projectId);
  const trackingContextId = identifier(receipt.trackingContextId);
  const estimateId = identifier(receipt.estimateId);
  const idempotencyKey =
    typeof receipt.idempotencyKey === "string" &&
    RANK_RUN_IDEMPOTENCY_KEY_PATTERN.test(receipt.idempotencyKey)
      ? receipt.idempotencyKey
      : undefined;
  if (
    !projectId ||
    !trackingContextId ||
    !estimateId ||
    !idempotencyKey ||
    projectId !== expected.projectId ||
    trackingContextId !== expected.trackingContextId
  ) {
    return undefined;
  }
  return {
    version: RANK_PENDING_CREATE_RECEIPT_VERSION,
    projectId,
    trackingContextId,
    estimateId,
    idempotencyKey
  };
}

function parseProgress(
  value: unknown
): RankJobSummary["progress"] | undefined {
  const progress = record(value);
  const current = decimal(progress.current);
  const total = decimal(progress.total);
  if (
    !current ||
    !total ||
    progress.unit !== "KEYWORD" ||
    BigInt(total) < 1n ||
    BigInt(current) > BigInt(total)
  ) {
    return undefined;
  }
  return { current, total, unit: "KEYWORD" };
}

function parseResult(
  value: unknown,
  progress: RankJobSummary["progress"]
): RankJobResultSummary | undefined {
  const input = record(value);
  const pairCount = decimal(input.pairCount);
  const persistedCount = decimal(input.persistedCount);
  const foundCount = decimal(input.foundCount);
  const notFoundCount = decimal(input.notFoundCount);
  const failedCount = decimal(input.failedCount);
  const submitOutcomeUnknownCount = decimal(
    input.submitOutcomeUnknownCount
  );
  if (
    !pairCount ||
    !persistedCount ||
    !foundCount ||
    !notFoundCount ||
    !failedCount ||
    !submitOutcomeUnknownCount
  ) {
    return undefined;
  }
  const pair = BigInt(pairCount);
  const persisted = BigInt(persistedCount);
  const found = BigInt(foundCount);
  const notFound = BigInt(notFoundCount);
  const failed = BigInt(failedCount);
  const unknown = BigInt(submitOutcomeUnknownCount);
  if (
    pairCount !== progress.total ||
    persisted !== found + notFound ||
    persisted > pair ||
    failed > pair - persisted ||
    unknown > pair - persisted - failed ||
    persistedCount !== progress.current
  ) {
    return undefined;
  }
  return {
    pairCount,
    persistedCount,
    foundCount,
    notFoundCount,
    failedCount,
    submitOutcomeUnknownCount
  };
}

function optionalResult(
  value: unknown,
  progress: RankJobSummary["progress"]
): RankJobResultSummary | undefined | null {
  return value === undefined ? undefined : parseResult(value, progress) ?? null;
}

function validSuccessResult(
  status: "COMPLETED" | "PARTIALLY_COMPLETED",
  result: RankJobResultSummary
): boolean {
  const pair = BigInt(result.pairCount);
  const persisted = BigInt(result.persistedCount);
  const failed = BigInt(result.failedCount);
  const unknown = BigInt(result.submitOutcomeUnknownCount);
  if (status === "COMPLETED") {
    return persisted === pair && failed === 0n && unknown === 0n;
  }
  return (
    persisted > 0n &&
    persisted < pair &&
    persisted + failed + unknown === pair
  );
}

function validActionRequiredResult(
  result: RankJobResultSummary
): boolean {
  return (
    result.persistedCount === "0" &&
    result.foundCount === "0" &&
    result.notFoundCount === "0" &&
    result.failedCount === "0" &&
    result.submitOutcomeUnknownCount === result.pairCount
  );
}

function validCancellationLifecycle(
  stage: RankJobStage,
  progress: RankJobSummary["progress"],
  queuedAt: string | undefined,
  startedAt: string | undefined
): boolean {
  if (stage === "PREPARING_SCOPE") {
    return (
      progress.current === "0" &&
      queuedAt === undefined &&
      startedAt === undefined
    );
  }
  if (stage === "WAITING_FOR_QUEUE") {
    return (
      progress.current === "0" &&
      queuedAt !== undefined &&
      startedAt === undefined
    );
  }
  return (
    activeStages.has(stage) &&
    queuedAt !== undefined &&
    startedAt !== undefined
  );
}

function parseFailure(
  value: unknown
): { readonly code: RankJobFailureCode } | undefined {
  const input = record(value);
  if (
    typeof input.code !== "string" ||
    !failureCodes.has(input.code)
  ) {
    return undefined;
  }
  return { code: input.code as RankJobFailureCode };
}

function orderedExecutionTimes(
  createdAt: string,
  queuedAt: string | undefined,
  startedAt: string | undefined,
  finishedAt: string | undefined
): boolean {
  const created = Date.parse(createdAt);
  const queued = queuedAt === undefined ? undefined : Date.parse(queuedAt);
  const started =
    startedAt === undefined ? undefined : Date.parse(startedAt);
  const finished =
    finishedAt === undefined ? undefined : Date.parse(finishedAt);
  return (
    (queued === undefined || queued >= created) &&
    (started === undefined ||
      (queued !== undefined && started >= queued)) &&
    (finished === undefined ||
      finished >= (started ?? queued ?? created))
  );
}

function rankJobStatus(value: unknown): RankJobStatus | undefined {
  return typeof value === "string" && jobStatuses.has(value)
    ? (value as RankJobStatus)
    : undefined;
}

function rankJobStage(value: unknown): RankJobStage | undefined {
  return typeof value === "string" && jobStages.has(value)
    ? (value as RankJobStage)
    : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value)
    ? value
    : undefined;
}

function decimal(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= MAX_DECIMAL_DIGITS &&
    DECIMAL_PATTERN.test(value)
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !TIMESTAMP_PATTERN.test(value)
  ) {
    return undefined;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) &&
    new Date(epoch).toISOString() === value
    ? value
    : undefined;
}

function optionalTimestamp(
  value: unknown
): string | undefined | null {
  return value === undefined ? undefined : timestamp(value) ?? null;
}

function record(
  value: unknown
): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function feedbackRequestId(
  error: unknown
): { readonly requestId?: string } {
  return error instanceof BrowserApiError && error.requestId
    ? { requestId: error.requestId }
    : {};
}

function invalidJob(): never {
  throw new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервис вернул некорректную задачу"
  );
}
