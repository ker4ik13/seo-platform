import {
  legacyRankManifestChunkSize,
  legacyRankProviderKeywordLimit,
  rankManifestSingleTaskChunkSize,
  rankProviderKeywordLimit,
  rankProviderOverflowCount,
  rankEstimateBlockerCodes,
  type CreateRankEstimateInput,
  type RankEstimate,
  type RankEstimateBlockerCode,
  type RankEstimateCredentialFreshness,
  type RankEstimateQuota,
  type RankSearchSource,
  type RankEstimateScopeHash,
  type TrackingContextSummary
} from "@seo-platform/contracts";
import { BrowserApiError } from "./browser-api.ts";
import {
  stableIdempotencyCommand,
  type IdempotentCommand
} from "./idempotency.ts";

export interface RankEstimateFeedback {
  readonly kind:
    | "conflict"
    | "forbidden"
    | "invalid-response"
    | "not-found"
    | "offline"
    | "rate-limited"
    | "recoverable"
    | "rejected";
  readonly message: string;
  readonly requestId?: string;
  readonly retryable: boolean;
}

const blockerLabels: Readonly<
  Record<RankEstimateBlockerCode, string>
> = {
  CONTEXT_ARCHIVED:
    "Контекст находится в архиве. Проверка доступна, но новый съём для него запрещён.",
  NO_ASSIGNED_KEYWORDS:
    "В контекст не назначено ни одного запроса.",
  KEYWORD_LIMIT_EXCEEDED:
    "В запуске более 15 000 запросов. Уменьшите выбор перед запуском.",
  SCOPE_HASH_UNAVAILABLE:
    "Точный хеш состава запросов недоступен для переполненного scope.",
  UNSUPPORTED_SEARCH_ENGINE:
    "Этот поисковик пока не поддерживается первым контуром съёма позиций.",
  UNSUPPORTED_DEPTH:
    "Выбранная глубина выдачи пока не поддерживается провайдером.",
  COUNTRY_MAPPING_UNVERIFIED:
    "Сопоставление страны с параметрами провайдера ещё не подтверждено.",
  REGION_MAPPING_UNVERIFIED:
    "Сопоставление региона с параметрами провайдера ещё не подтверждено.",
  LANGUAGE_MAPPING_UNVERIFIED:
    "Сопоставление языка с параметрами провайдера ещё не подтверждено.",
  SAFE_SEARCH_MAPPING_UNVERIFIED:
    "SafeSearch нельзя безопасно передать провайдеру без подтверждённого сопоставления.",
  DOMAIN_MAPPING_UNVERIFIED:
    "Правило сопоставления домена ещё не подтверждено для формата провайдера.",
  BINDING_NOT_CONFIGURED:
    "Для проекта не настроен источник съёма позиций.",
  BINDING_DISABLED:
    "Источник съёма позиций выключен в настройках проекта.",
  BINDING_NOT_READY:
    "Источник проекта настроен, но пока не готов к работе.",
  BINDING_ROUTE_UNSUPPORTED:
    "Маршрут источника проекта несовместим с первым контуром съёма.",
  CREDENTIAL_NOT_ACTIVE:
    "Выбранный API-ключ не находится в активном состоянии.",
  CREDENTIAL_NOT_FRESH:
    "API-ключ нужно повторно проверить перед будущим запуском.",
  CREDENTIAL_PROVIDER_MISMATCH:
    "API-ключ принадлежит другому провайдеру.",
  CREDENTIAL_MODE_UNSUPPORTED:
    "Первый контур поддерживает только собственный API-ключ пользователя.",
  PROVIDER_CONTRACT_NOT_READY:
    "Контракт выполнения с провайдером ещё не прошёл обязательную проверку.",
  PROVIDER_EXECUTION_DISABLED:
    "Вызовы провайдера временно выключены системным переключателем.",
  ENTITLEMENT_NOT_AVAILABLE:
    "Сервис тарифных разрешений пока не подтвердил доступность операции.",
  ENTITLEMENT_DENIED:
    "Текущий тариф не разрешает новый съём позиций.",
  QUOTA_EXCEEDED:
    "Тарифная квота на операцию исчерпана.",
  MISSING_RUN_PERMISSION:
    "Для запуска потребуется разрешение ranking.run. Проверка готовности остаётся доступной.",
  WORKSPACE_READ_ONLY:
    "Рабочая область доступна только для чтения: результаты сохранены, новые операции запрещены.",
  WORKSPACE_SUSPENDED:
    "Рабочая область приостановлена.",
  PROJECT_NOT_ACTIVE:
    "Проект ещё не переведён в активное состояние.",
  PROJECT_ARCHIVED:
    "Проект архивирован: просмотр сохранён, новые операции запрещены."
};

const blockerTitles: Readonly<
  Record<RankEstimateBlockerCode, string>
> = {
  CONTEXT_ARCHIVED: "Контекст архивирован",
  NO_ASSIGNED_KEYWORDS: "Нет назначенных запросов",
  KEYWORD_LIMIT_EXCEEDED: "Превышен лимит запросов",
  SCOPE_HASH_UNAVAILABLE: "Scope hash недоступен",
  UNSUPPORTED_SEARCH_ENGINE: "Поисковик не поддерживается",
  UNSUPPORTED_DEPTH: "Глубина не поддерживается",
  COUNTRY_MAPPING_UNVERIFIED: "Страна не сопоставлена",
  REGION_MAPPING_UNVERIFIED: "Регион не сопоставлен",
  LANGUAGE_MAPPING_UNVERIFIED: "Язык не сопоставлен",
  SAFE_SEARCH_MAPPING_UNVERIFIED: "SafeSearch не сопоставлен",
  DOMAIN_MAPPING_UNVERIFIED: "Правило домена не сопоставлено",
  BINDING_NOT_CONFIGURED: "Источник не настроен",
  BINDING_DISABLED: "Источник выключен",
  BINDING_NOT_READY: "Источник не готов",
  BINDING_ROUTE_UNSUPPORTED: "Маршрут источника не поддерживается",
  CREDENTIAL_NOT_ACTIVE: "API-ключ не активен",
  CREDENTIAL_NOT_FRESH: "Проверка API-ключа устарела",
  CREDENTIAL_PROVIDER_MISMATCH: "API-ключ другого провайдера",
  CREDENTIAL_MODE_UNSUPPORTED: "Режим API-ключа не поддерживается",
  PROVIDER_CONTRACT_NOT_READY: "Контракт провайдера не готов",
  PROVIDER_EXECUTION_DISABLED: "Вызовы провайдера выключены",
  ENTITLEMENT_NOT_AVAILABLE: "Тарифное разрешение недоступно",
  ENTITLEMENT_DENIED: "Операция не входит в тариф",
  QUOTA_EXCEEDED: "Квота исчерпана",
  MISSING_RUN_PERMISSION: "Нет права на запуск",
  WORKSPACE_READ_ONLY: "Рабочая область только для чтения",
  WORKSPACE_SUSPENDED: "Рабочая область приостановлена",
  PROJECT_NOT_ACTIVE: "Проект не активен",
  PROJECT_ARCHIVED: "Проект архивирован"
};

const blockerCodes = new Set<string>(rankEstimateBlockerCodes);

export function rankEstimatesApiPath(projectId: string): string {
  return `/app/api/projects/${encodeURIComponent(projectId)}/rank-estimates`;
}

export function rankEstimateInput(
  trackingContextId: string,
  provider?: "ARSENKIN" | "XMLSTOCK",
  credentialId?: string,
  searchSource?: RankSearchSource
): CreateRankEstimateInput {
  return {
    trackingContextId,
    ...(provider ? { provider } : {}),
    ...(credentialId ? { credentialId } : {}),
    ...(searchSource ? { searchSource } : {})
  };
}

export function rankEstimatePayloadSignature(
  trackingContextId: string,
  provider?: "ARSENKIN" | "XMLSTOCK",
  credentialId?: string,
  searchSource?: RankSearchSource
): string {
  return JSON.stringify(
    rankEstimateInput(trackingContextId, provider, credentialId, searchSource)
  );
}

export function rankEstimateCommandSignature(
  context: TrackingContextSummary,
  provider?: "ARSENKIN" | "XMLSTOCK",
  credentialId?: string,
  searchSource?: RankSearchSource
): string {
  return `${rankEstimatePayloadSignature(
    context.id,
    provider,
    credentialId,
    searchSource
  )}:${rankEstimateContextSignature(context)}`;
}

export function rankEstimateIdempotencyCommand(
  current: IdempotentCommand | undefined,
  context: TrackingContextSummary,
  explicitRecalculation: boolean,
  createKey: () => string,
  provider?: "ARSENKIN" | "XMLSTOCK",
  credentialId?: string,
  searchSource?: RankSearchSource
): IdempotentCommand {
  return stableIdempotencyCommand(
    explicitRecalculation ? undefined : current,
    rankEstimateCommandSignature(context, provider, credentialId, searchSource),
    createKey
  );
}

export function rankEstimateContextSignature(
  context: TrackingContextSummary
): string {
  return [
    context.id,
    context.status,
    String(context.version),
    String(context.configuration.configurationVersion),
    String(context.assignedKeywordCount)
  ].join(":");
}

export function rankEstimateBlockerLabel(
  code: RankEstimateBlockerCode
): string {
  return blockerLabels[code];
}

export function rankEstimateBlockerTitle(
  code: RankEstimateBlockerCode
): string {
  return blockerTitles[code];
}

export function parseRankEstimate(
  value: unknown,
  expected: Readonly<{
    projectId: string;
    trackingContextId: string;
  }>
): RankEstimate {
  const estimate = objectValue(value);
  const id = nonEmptyString(estimate.id);
  const workspaceId = nonEmptyString(estimate.workspaceId);
  const projectId = nonEmptyString(estimate.projectId);
  const trackingContextId = nonEmptyString(
    estimate.trackingContextId
  );
  if (
    !id ||
    !workspaceId ||
    projectId !== expected.projectId ||
    trackingContextId !== expected.trackingContextId
  ) {
    throw invalidEstimate();
  }

  const status =
    estimate.status === "READY" || estimate.status === "BLOCKED"
      ? estimate.status
      : undefined;
  const provider =
    estimate.provider === "ARSENKIN" || estimate.provider === "XMLSTOCK"
      ? estimate.provider
      : undefined;
  const operation =
    estimate.operation === "POSITIONS" ? estimate.operation : undefined;
  const credentialMode =
    estimate.credentialMode === "BYOK_API_KEY"
      ? estimate.credentialMode
      : undefined;
  const scope = parseScope(estimate.scope);
  const workload = scope && provider
    ? parseWorkload(estimate.workload, scope.keywordCount, provider)
    : undefined;
  const providerLimits = objectValue(estimate.providerLimits);
  const expectedDuration = objectValue(estimate.expectedDuration);
  const quota = parseQuota(estimate.quota);
  const credentialFreshness = parseCredentialFreshness(
    estimate.credentialFreshness
  );
  const retention = objectValue(estimate.retention);
  const blockers = Array.isArray(estimate.blockers)
    ? estimate.blockers.map((blocker) => {
        const record = objectValue(blocker);
        if (
          typeof record.code !== "string" ||
          !blockerCodes.has(record.code)
        ) {
          throw invalidEstimate();
        }
        return {
          code: record.code as RankEstimateBlockerCode
        };
      })
    : undefined;
  const executionAllowed =
    typeof estimate.executionAllowed === "boolean"
      ? estimate.executionAllowed
      : undefined;
  const calculatedAt = isoDateString(estimate.calculatedAt);
  const expiresAt = isoDateString(estimate.expiresAt);
  const billingCurrency =
    typeof estimate.billingCurrency === "string" &&
    /^[A-Z]{3}$/u.test(estimate.billingCurrency)
      ? estimate.billingCurrency
      : undefined;
  const policyVersion = nonEmptyString(estimate.policyVersion);

  if (
    !status ||
    !provider ||
    !operation ||
    !credentialMode ||
    !scope ||
    !workload ||
    providerLimits.status !== "NOT_AVAILABLE" ||
    expectedDuration.status !== "NOT_AVAILABLE" ||
    estimate.platformChargeMicro !== "0" ||
    !billingCurrency ||
    !quota ||
    !credentialFreshness ||
    retention.normalizedRankHistory !== "LONG_TERM" ||
    retention.rawSerp !== "NOT_COLLECTED" ||
    !blockers ||
    !orderedUniqueBlockers(blockers) ||
    executionAllowed === undefined ||
    !policyVersion ||
    !calculatedAt ||
    !expiresAt ||
    new Date(expiresAt).getTime() <= new Date(calculatedAt).getTime() ||
    (executionAllowed &&
      (status !== "READY" || blockers.length !== 0)) ||
    (status === "READY" &&
      (!executionAllowed || blockers.length !== 0)) ||
    (status === "BLOCKED" &&
      (executionAllowed || blockers.length === 0))
  ) {
    throw invalidEstimate();
  }

  return {
    id,
    workspaceId,
    projectId,
    trackingContextId,
    status,
    provider,
    operation,
    credentialMode,
    scope,
    workload,
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency,
    quota,
    credentialFreshness,
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    blockers,
    executionAllowed,
    policyVersion,
    calculatedAt,
    expiresAt
  };
}

export function rankEstimateFeedback(
  error: unknown,
  online: boolean
): RankEstimateFeedback {
  if (!online || error instanceof TypeError) {
    return {
      kind: "offline",
      message:
        "Соединение потеряно. Оценка не считается завершённой; безопасный повтор использует тот же Idempotency-Key.",
      retryable: true
    };
  }
  if (!(error instanceof BrowserApiError)) {
    return {
      kind: "rejected",
      message:
        "Не удалось проверить готовность. Данные контекста не изменились.",
      retryable: true
    };
  }

  const requestId = error.requestId
    ? { requestId: error.requestId }
    : {};
  if (error.code === "INVALID_RESPONSE") {
    return {
      kind: "invalid-response",
      message:
        "Сервис вернул некорректную оценку. Запуск недоступен, пока ответ не будет проверен.",
      retryable: true,
      ...requestId
    };
  }
  if (error.status === 403) {
    return {
      kind: "forbidden",
      message:
        "Право ranking.view было отозвано. Обновите доступ к проекту перед повтором.",
      retryable: false,
      ...requestId
    };
  }
  if (error.status === 404) {
    return {
      kind: "not-found",
      message:
        "Проект или контекст не найден либо доступ к нему был отозван.",
      retryable: false,
      ...requestId
    };
  }
  if (error.status === 409) {
    return {
      kind: "conflict",
      message:
        error.code === "IDEMPOTENCY_CONFLICT"
          ? "Ключ безопасного повтора уже связан с другим запросом. Выполните явный новый расчёт."
          : "Состав или версия контекста изменились. Обновите контекст и рассчитайте оценку заново.",
      retryable: error.code !== "IDEMPOTENCY_CONFLICT",
      ...requestId
    };
  }
  if (error.status === 429) {
    return {
      kind: "rate-limited",
      message:
        "Сервис ограничил частоту проверок. Повторите позже с тем же ключом безопасного повтора.",
      retryable: true,
      ...requestId
    };
  }
  if (error.retryable || error.status >= 500) {
    return {
      kind: "recoverable",
      message:
        "Сервис оценки временно недоступен. Повтор не создаст вторую оценку с другим содержимым.",
      retryable: true,
      ...requestId
    };
  }
  return {
    kind: "rejected",
    message:
      error.status === 402
        ? "Новые операции ограничены биллингом, но просмотр проекта остаётся доступен."
        : error.message || "Сервис отклонил проверку готовности.",
    retryable: false,
    ...requestId
  };
}

export function rankEstimateCountLabel(value: string): string {
  if (value === String(rankProviderOverflowCount)) return "более 15 000";
  if (value === String(legacyRankProviderKeywordLimit + 1)) {
    return "более 1 000";
  }
  return formatDecimalInteger(value);
}

export function rankEstimateShortHash(
  hash: RankEstimateScopeHash
): string {
  if (hash.availability === "UNAVAILABLE") return "Недоступен";
  return `${hash.value.slice(0, 12)}…${hash.value.slice(-8)}`;
}

export function rankEstimateQuotaLabel(
  quota: RankEstimateQuota
): string {
  if (quota.status === "UNLIMITED") {
    return "Без внутреннего лимита";
  }
  if (quota.status === "NOT_AVAILABLE") {
    return "Тарифная квота пока не подключена";
  }
  const summary = `${formatDecimalInteger(
    quota.remaining
  )} из ${formatDecimalInteger(quota.limit)} осталось`;
  const statusLabel = quota.status === "EXHAUSTED"
    ? `Квота исчерпана · ${summary}`
    : summary;
  return quota.resetsAt
    ? `${statusLabel} · обновится ${formatDateTime(quota.resetsAt)}`
    : statusLabel;
}

export function rankEstimateCredentialFreshnessLabel(
  freshness: RankEstimateCredentialFreshness
): string {
  if (freshness.status === "FRESH") {
    return `Проверен ${formatDateTime(freshness.verifiedAt)}`;
  }
  if (freshness.status === "STALE") {
    return freshness.verifiedAt
      ? `Проверка устарела · ${formatDateTime(freshness.verifiedAt)}`
      : "Проверка API-ключа устарела";
  }
  return freshness.status === "UNVERIFIED"
    ? "API-ключ ещё не проверен"
    : "Данные об API-ключе недоступны";
}

export function rankEstimateExpiryDelay(
  expiresAt: string,
  now: number
): number {
  const expires = new Date(expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= now) return 0;
  return Math.min(expires - now, 2_147_483_647);
}

export function rankEstimateExpired(
  expiresAt: string,
  now: number
): boolean {
  const expires = new Date(expiresAt).getTime();
  return !Number.isFinite(expires) || expires <= now;
}

function parseScope(value: unknown): RankEstimate["scope"] | undefined {
  const scope = objectValue(value);
  const keywordCount = boundedScopeCount(scope.keywordCount);
  const pairCount = boundedScopeCount(scope.pairCount);
  const contextVersion = positiveInteger(scope.contextVersion);
  const configurationVersion = positiveInteger(
    scope.configurationVersion
  );
  const scopeHash = parseScopeHash(scope.scopeHash);
  if (
    !keywordCount ||
    !pairCount ||
    keywordCount !== pairCount ||
    scope.contextCount !== "1" ||
    !contextVersion ||
    !configurationVersion ||
    !scopeHash ||
    configurationVersion > contextVersion ||
    ([
      String(legacyRankProviderKeywordLimit + 1),
      String(rankProviderOverflowCount)
    ].includes(keywordCount)) !==
      (scopeHash.availability === "UNAVAILABLE")
  ) {
    return undefined;
  }
  return {
    keywordCount,
    contextCount: "1",
    pairCount,
    scopeHash,
    contextVersion,
    configurationVersion
  };
}

function parseWorkload(
  value: unknown,
  keywordCount: string,
  provider: "ARSENKIN" | "XMLSTOCK"
): RankEstimate["workload"] | undefined {
  const workload = objectValue(value);
  const polling = objectValue(workload.pollingRequestCount);
  const taskCount = decimalInteger(workload.taskCount)
    ? BigInt(workload.taskCount)
    : undefined;
  const minimumRequestCount = decimalInteger(
    workload.minimumRequestCount
  )
    ? BigInt(workload.minimumRequestCount)
    : undefined;
  const count = BigInt(keywordCount);
  const legacyWorkload =
    workload.keywordLimitPerTask === String(legacyRankManifestChunkSize) &&
    workload.keywordLimitPerCommand === String(legacyRankProviderKeywordLimit);
  const currentWorkload =
    workload.keywordLimitPerTask === String(rankManifestSingleTaskChunkSize) &&
    workload.keywordLimitPerCommand === String(rankProviderKeywordLimit);
  const expectedTaskCount = legacyWorkload
    ? count > BigInt(legacyRankProviderKeywordLimit)
      ? 0n
      : (count + BigInt(legacyRankManifestChunkSize - 1)) /
        BigInt(legacyRankManifestChunkSize)
    : currentWorkload
      ? count > BigInt(rankProviderKeywordLimit)
        ? 0n
        : count === 0n
          ? 0n
          : 1n
      : -1n;
  const xmlStockWorkload =
    workload.keywordLimitPerTask === "1" &&
    workload.keywordLimitPerCommand === String(rankProviderKeywordLimit);
  const xmlStockTasks = count > BigInt(rankProviderKeywordLimit) ? 0n : count;
  const requestStages = workload.requestStages;
  const arsenkinStages =
    Array.isArray(requestStages) &&
    requestStages.length === 3 &&
    requestStages[0] === "SET" &&
    requestStages[1] === "CHECK" &&
    requestStages[2] === "GET";
  const xmlStockYandexStages =
    Array.isArray(requestStages) &&
    requestStages.length === 2 &&
    requestStages[0] === "SUBMIT" &&
    requestStages[1] === "POLL";
  const xmlStockGoogleStages =
    Array.isArray(requestStages) &&
    requestStages.length === 1 &&
    requestStages[0] === "GET";
  const xmlStockGooglePageCount =
    xmlStockTasks === 0n
      ? minimumRequestCount === 0n ? 0n : -1n
      : minimumRequestCount !== undefined &&
          minimumRequestCount % xmlStockTasks === 0n
        ? minimumRequestCount / xmlStockTasks
        : -1n;
  const validArsenkin =
    provider === "ARSENKIN" &&
    (legacyWorkload || currentWorkload) &&
    taskCount === expectedTaskCount &&
    minimumRequestCount === expectedTaskCount * 3n &&
    arsenkinStages;
  const validXmlStock =
    provider === "XMLSTOCK" &&
    xmlStockWorkload &&
    taskCount === xmlStockTasks &&
    minimumRequestCount !== undefined &&
    ((xmlStockYandexStages && minimumRequestCount === xmlStockTasks * 2n) ||
      (xmlStockGoogleStages &&
        (xmlStockTasks === 0n ||
          [3n, 5n, 10n].includes(xmlStockGooglePageCount))));
  const normalizedRequestStages: RankEstimate["workload"]["requestStages"] =
    arsenkinStages
      ? ["SET", "CHECK", "GET"]
      : xmlStockYandexStages
        ? ["SUBMIT", "POLL"]
        : ["GET"];
  if (
    taskCount === undefined ||
    minimumRequestCount === undefined ||
    (!validArsenkin && !validXmlStock) ||
    polling.status !== "NOT_AVAILABLE" ||
    workload.format !== "SIMPLE" ||
    workload.rawSerp !== false ||
    workload.fallbackMode !== "NONE"
  ) {
    return undefined;
  }
  return {
    taskCount: taskCount.toString(),
    minimumRequestCount: minimumRequestCount.toString(),
    pollingRequestCount: { status: "NOT_AVAILABLE" },
    requestStages: normalizedRequestStages,
    keywordLimitPerTask: workload.keywordLimitPerTask as
      | "1"
      | "250"
      | "15000",
    keywordLimitPerCommand: workload.keywordLimitPerCommand as
      | "1000"
      | "15000",
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE"
  };
}

function parseScopeHash(
  value: unknown
): RankEstimateScopeHash | undefined {
  const hash = objectValue(value);
  if (hash.availability === "UNAVAILABLE") {
    return { availability: "UNAVAILABLE" };
  }
  if (
    hash.availability === "AVAILABLE" &&
    hash.algorithm === "SHA_256" &&
    typeof hash.value === "string" &&
    /^[a-f0-9]{64}$/u.test(hash.value)
  ) {
    return {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: hash.value
    };
  }
  return undefined;
}

function parseQuota(value: unknown): RankEstimateQuota | undefined {
  const quota = objectValue(value);
  if (quota.status === "UNLIMITED") {
    return { status: "UNLIMITED" };
  }
  if (quota.status === "NOT_AVAILABLE") {
    return { status: "NOT_AVAILABLE" };
  }
  if (
    (quota.status === "AVAILABLE" ||
      quota.status === "EXHAUSTED") &&
    decimalInteger(quota.limit) &&
    decimalInteger(quota.used) &&
    decimalInteger(quota.remaining) &&
    (quota.resetsAt === undefined || isoDateString(quota.resetsAt))
  ) {
    return {
      status: quota.status,
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
      ...(typeof quota.resetsAt === "string"
        ? { resetsAt: quota.resetsAt }
        : {})
    };
  }
  return undefined;
}

function parseCredentialFreshness(
  value: unknown
): RankEstimateCredentialFreshness | undefined {
  const freshness = objectValue(value);
  const verifiedAt = isoDateString(freshness.verifiedAt);
  if (
    freshness.status === "FRESH" &&
    verifiedAt
  ) {
    return {
      status: "FRESH",
      verifiedAt
    };
  }
  if (freshness.status === "STALE") {
    if (
      freshness.verifiedAt !== undefined &&
      !isoDateString(freshness.verifiedAt)
    ) {
      return undefined;
    }
    return {
      status: "STALE",
      ...(typeof freshness.verifiedAt === "string"
        ? { verifiedAt: freshness.verifiedAt }
        : {})
    };
  }
  if (
    freshness.status === "UNVERIFIED" ||
    freshness.status === "NOT_AVAILABLE"
  ) {
    return { status: freshness.status };
  }
  return undefined;
}

function boundedScopeCount(value: unknown): string | undefined {
  if (!decimalInteger(value)) return undefined;
  const numeric = Number(value);
  return numeric <= rankProviderOverflowCount ? value : undefined;
}

function orderedUniqueBlockers(
  blockers: RankEstimate["blockers"]
): boolean {
  if (blockers.length > rankEstimateBlockerCodes.length) return false;
  let previousIndex = -1;
  for (const blocker of blockers) {
    const currentIndex = rankEstimateBlockerCodes.indexOf(blocker.code);
    if (currentIndex <= previousIndex) return false;
    previousIndex = currentIndex;
  }
  return true;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function decimalInteger(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    ? value
    : undefined;
}

function isoDateString(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

function objectValue(
  value: unknown
): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function invalidEstimate(): BrowserApiError {
  return new BrowserApiError(
    502,
    "INVALID_RESPONSE",
    "Сервис вернул некорректную оценку"
  );
}

function formatDecimalInteger(value: string): string {
  try {
    return new Intl.NumberFormat("ru-RU").format(BigInt(value));
  } catch {
    return value;
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
