"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  RankEstimate,
  TrackingContextSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import type { IdempotentCommand } from "../lib/idempotency";
import {
  parseRankEstimate,
  rankEstimateBlockerLabel,
  rankEstimateBlockerTitle,
  rankEstimateContextSignature,
  rankEstimateCountLabel,
  rankEstimateCredentialFreshnessLabel,
  rankEstimateExpired,
  rankEstimateExpiryDelay,
  rankEstimateFeedback,
  rankEstimateIdempotencyCommand,
  rankEstimateInput,
  rankEstimateQuotaLabel,
  rankEstimatesApiPath,
  rankEstimateShortHash,
  type RankEstimateFeedback
} from "../lib/rank-estimates";
import { RankJobPanel } from "./rank-job-panel";

interface EstimateResult {
  readonly contextSignature: string;
  readonly value: RankEstimate;
}

interface EstimateFailure {
  readonly contextSignature: string;
  readonly value: RankEstimateFeedback;
}

export function RankEstimatePanel({
  context,
  contextLoading,
  online,
  projectId,
  returnTo
}: Readonly<{
  context: TrackingContextSummary;
  contextLoading: boolean;
  online: boolean;
  projectId: string;
  returnTo: string;
}>) {
  const headingId = useId();
  const [phase, setPhase] = useState<"idle" | "calculating">(
    "idle"
  );
  const [result, setResult] = useState<EstimateResult>();
  const [failure, setFailure] = useState<EstimateFailure>();
  const [clock, setClock] = useState(() => Date.now());
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const generationRef = useRef(0);
  const commandRef = useRef<IdempotentCommand | undefined>(undefined);
  const signature = rankEstimateContextSignature(context);
  const signatureRef = useRef(signature);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const estimate =
    result?.contextSignature === signature ? result.value : undefined;
  const requestFailure =
    failure?.contextSignature === signature
      ? failure.value
      : undefined;
  const expired = Boolean(
    estimate && rankEstimateExpired(estimate.expiresAt, clock)
  );
  const calculating = phase === "calculating";
  const calculateDisabled =
    !online || contextLoading || calculating;

  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
    commandRef.current = undefined;
    setPhase("idle");
    setResult(undefined);
    setFailure(undefined);
  }, [signature]);

  useEffect(() => {
    if (online && !contextLoading) return;
    const activeController = controllerRef.current;
    if (!activeController) return;
    generationRef.current += 1;
    activeController.abort();
    controllerRef.current = undefined;
    setPhase("idle");
    if (!online) {
      setFailure({
        contextSignature: signatureRef.current,
        value: rankEstimateFeedback(new TypeError("Offline"), false)
      });
    } else {
      setFailure({
        contextSignature: signatureRef.current,
        value: {
          kind: "recoverable",
          message:
            "Проверка остановлена во время обновления контекста. Безопасный повтор использует тот же Idempotency-Key.",
          retryable: true
        }
      });
    }
  }, [contextLoading, online]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!estimate) return;
    const delay = rankEstimateExpiryDelay(
      estimate.expiresAt,
      Date.now()
    );
    setClock(Date.now());
    if (delay === 0) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(delay + 25, 2_147_483_647)
    );
    return () => window.clearTimeout(timer);
  }, [estimate]);

  useEffect(() => {
    if (calculating) return;
    if (failure) {
      feedbackRef.current?.focus();
    } else if (result) {
      resultRef.current?.focus();
    }
  }, [calculating, failure, result]);

  async function calculate(explicitRecalculation: boolean): Promise<void> {
    if (signatureRef.current !== signature) {
      signatureRef.current = signature;
      generationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      commandRef.current = undefined;
      setResult(undefined);
      setFailure(undefined);
    }
    if (calculateDisabled || controllerRef.current) return;
    const requestSignature = signature;
    commandRef.current = rankEstimateIdempotencyCommand(
      commandRef.current,
      context,
      explicitRecalculation,
      () => `rank-estimate:${globalThis.crypto.randomUUID()}`
    );
    const command = commandRef.current;
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current = controller;
    setPhase("calculating");
    setFailure(undefined);

    try {
      const payload = await browserApiRequest<unknown>(
        rankEstimatesApiPath(projectId),
        {
          method: "POST",
          body: rankEstimateInput(context.id),
          idempotencyKey: command.key,
          signal: controller.signal
        }
      );
      const parsed = parseRankEstimate(payload, {
        projectId,
        trackingContextId: context.id
      });
      if (
        controller.signal.aborted ||
        generationRef.current !== generation ||
        signatureRef.current !== requestSignature
      ) {
        return;
      }
      setClock(Date.now());
      setResult({
        contextSignature: requestSignature,
        value: parsed
      });
      setFailure(undefined);
    } catch (error) {
      if (
        controller.signal.aborted ||
        generationRef.current !== generation ||
        signatureRef.current !== requestSignature ||
        isAbortError(error)
      ) {
        return;
      }
      if (redirectForExpiredSession(error, returnTo)) return;
      setFailure({
        contextSignature: requestSignature,
        value: rankEstimateFeedback(error, navigator.onLine)
      });
    } finally {
      if (
        generationRef.current === generation &&
        controllerRef.current === controller
      ) {
        controllerRef.current = undefined;
        setPhase("idle");
      }
    }
  }

  const readiness = useMemo(() => {
    if (!estimate) return undefined;
    if (expired) {
      return {
        tone: "warning",
        title: "Оценка истекла",
        copy:
          "Версии и состав могли измениться. Для актуального результата выполните новый расчёт."
      } as const;
    }
    if (estimate.status === "BLOCKED") {
      return {
        tone: "warning",
        title: "Запуск заблокирован",
        copy:
          "Ни один вызов провайдера не выполнялся. Ниже перечислены все найденные ограничения."
      } as const;
    }
    return {
      tone: "success",
      title: "Конфигурация готова",
      copy:
        "Проверка без вызова провайдера пройдена. Фактический запуск будет доступен после отдельной безопасной проверки."
    } as const;
  }, [estimate, expired]);

  return (
    <section
      aria-labelledby={headingId}
      className="rank-estimate-panel"
    >
      <header className="rank-estimate-header">
        <div>
          <h3 id={headingId}>Готовность ручного съёма</h3>
          <p>
            Проверка версий, scope, источника и прав без обращения к
            провайдеру и без списания средств.
          </p>
        </div>
        <button
          aria-busy={calculating}
          className="secondary-button"
          disabled={calculateDisabled}
          onClick={() => void calculate(Boolean(estimate))}
          title={
            !online
              ? "Для проверки требуется соединение"
              : contextLoading
                ? "Дождитесь обновления контекста"
                : undefined
          }
          type="button"
        >
          {calculating
            ? "Проверяем…"
            : estimate
              ? "Пересчитать"
              : "Проверить готовность"}
        </button>
      </header>

      <div
        aria-live="polite"
        className="rank-estimate-feedback"
        ref={feedbackRef}
        tabIndex={-1}
      >
        {!online && (
          <div className="inline-alert warning" role="status">
            Офлайн: новая оценка не отправляется и не считается успешно
            завершённой. Уже полученный результат остаётся видимым.
          </div>
        )}
        {contextLoading && online && (
          <div className="inline-alert info" role="status">
            Обновляем актуальную версию контекста перед новой проверкой.
          </div>
        )}
        {calculating && (
          <div
            aria-busy="true"
            className="rank-estimate-progress"
            role="status"
          >
            <span aria-hidden="true" className="spinner" />
            <span>
              Фиксируем версии и считаем ограниченный scope. Провайдер не
              вызывается.
            </span>
          </div>
        )}
        {requestFailure && (
          <div className="inline-alert danger rank-estimate-error" role="alert">
            <div>
              <strong>Не удалось проверить готовность</strong>
              <p>{requestFailure.message}</p>
              {requestFailure.requestId && (
                <small>Код запроса: {requestFailure.requestId}</small>
              )}
            </div>
            {(requestFailure.retryable ||
              requestFailure.kind === "conflict") && (
              <button
                className="secondary-button"
                disabled={calculateDisabled}
                onClick={() =>
                  void calculate(
                    requestFailure.kind === "conflict"
                  )
                }
                type="button"
              >
                {requestFailure.kind === "conflict"
                  ? "Рассчитать заново"
                  : "Повторить безопасно"}
              </button>
            )}
          </div>
        )}
      </div>

      {!estimate && !calculating && !requestFailure && (
        <div className="rank-estimate-idle" role="note">
          <strong>Оценка ещё не рассчитана</strong>
          <span>
            Будут проверены максимум 1 000 запросов, текущая конфигурация
            контекста и собственный API-ключ проекта.
          </span>
        </div>
      )}

      {estimate && readiness && (
        <div
          aria-live="polite"
          className="rank-estimate-result"
          ref={resultRef}
          tabIndex={-1}
        >
          <div
            className={`inline-alert ${readiness.tone} rank-estimate-readiness`}
            role={expired || estimate.status === "BLOCKED" ? "alert" : "status"}
          >
            <div>
              <strong>{readiness.title}</strong>
              <p>{readiness.copy}</p>
            </div>
            <span className="rank-estimate-status">
              {estimate.status === "READY" ? "Готово" : "Есть ограничения"}
            </span>
          </div>

          <dl className="rank-estimate-facts">
            <EstimateFact
              label="Запросы"
              value={rankEstimateCountLabel(
                estimate.scope.keywordCount
              )}
            />
            <EstimateFact
              label="Контексты"
              value={rankEstimateCountLabel(
                estimate.scope.contextCount
              )}
            />
            <EstimateFact
              label="Пары запрос × контекст"
              value={rankEstimateCountLabel(estimate.scope.pairCount)}
            />
            <EstimateFact
              label="Задачи провайдера"
              value={rankEstimateCountLabel(
                estimate.workload.taskCount
              )}
            />
            <EstimateFact
              label="Минимум запросов API"
              value={rankEstimateCountLabel(
                estimate.workload.minimumRequestCount
              )}
            />
            <EstimateFact
              label="Запросы опроса статуса"
              value="Количество неизвестно"
            />
            <EstimateFact
              label="Лимиты провайдера"
              value="Пока недоступны"
            />
            <EstimateFact
              label="Ожидаемое время"
              value="Пока неизвестно"
            />
            <EstimateFact
              label="Списание платформы"
              value={`0 ${estimate.billingCurrency}`}
            />
            <EstimateFact
              label="Тарифная квота"
              value={rankEstimateQuotaLabel(estimate.quota)}
            />
            <EstimateFact
              label="API-ключ"
              value={rankEstimateCredentialFreshnessLabel(
                estimate.credentialFreshness
              )}
            />
            <EstimateFact
              label="Хеш состава"
              {...(estimate.scope.scopeHash.availability === "AVAILABLE"
                ? { title: estimate.scope.scopeHash.value }
                : {})}
              value={rankEstimateShortHash(estimate.scope.scopeHash)}
            />
          </dl>

          <div className="rank-estimate-details">
            <div>
              <span>Источник</span>
              <strong>Арсенкин · свой API-ключ (BYOK)</strong>
            </div>
            <div>
              <span>Нагрузка провайдера</span>
              <strong>
                SET → CHECK → GET · до{" "}
                {rankEstimateCountLabel(
                  estimate.workload.keywordLimitPerTask
                )}{" "}
                запросов в задаче
              </strong>
            </div>
            <div>
              <span>Хранение</span>
              <strong>
                Нормализованная история — долгосрочно; raw SERP не
                собирается
              </strong>
            </div>
            <div>
              <span>Версии</span>
              <strong>
                Контекст {estimate.scope.contextVersion} · конфигурация{" "}
                {estimate.scope.configurationVersion} · политика{" "}
                {estimate.policyVersion}
              </strong>
            </div>
            <div>
              <span>Рассчитано</span>
              <strong>{formatDateTime(estimate.calculatedAt)}</strong>
            </div>
            <div>
              <span>Действует до</span>
              <strong>{formatDateTime(estimate.expiresAt)}</strong>
            </div>
          </div>

          {estimate.blockers.length > 0 && (
            <section
              aria-label="Ограничения запуска"
              className="rank-estimate-blockers"
            >
              <h4>
                Ограничения · {formatInteger(estimate.blockers.length)}
              </h4>
              <ul>
                {estimate.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}:${index}`}>
                    <span aria-hidden="true">!</span>
                    <div>
                      <strong>
                        {rankEstimateBlockerTitle(blocker.code)}
                      </strong>
                      <p>{rankEstimateBlockerLabel(blocker.code)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      )}

      <RankJobPanel
        contextLoading={contextLoading}
        contextSignature={signature}
        estimate={estimate}
        estimateCalculating={calculating}
        estimateExpired={expired}
        online={online}
        onExplicitRecalculation={() => void calculate(true)}
        projectId={projectId}
        returnTo={returnTo}
        trackingContextId={context.id}
        workspaceId={context.workspaceId}
      />
    </section>
  );
}

function EstimateFact({
  label,
  title,
  value
}: Readonly<{
  label: string;
  title?: string;
  value: string;
}>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={title}>{value}</dd>
    </div>
  );
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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
