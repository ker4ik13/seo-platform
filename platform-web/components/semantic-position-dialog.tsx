"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  RankEstimate,
  RankJobSummary,
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  parseRankEstimate,
  rankEstimateBlockerLabel
} from "../lib/rank-estimates";
import { parseRankJobSummary } from "../lib/rank-jobs";
import { SemanticModal } from "./semantic-modal";

export function SemanticPositionDialog({
  keywordIds,
  onClose,
  onStarted,
  projectId
}: Readonly<{
  keywordIds: readonly string[];
  onClose: () => void;
  onStarted: (job: RankJobSummary) => void;
  projectId: string;
}>) {
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [contextId, setContextId] = useState("");
  const [assignKeywords, setAssignKeywords] = useState(true);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [estimate, setEstimate] = useState<RankEstimate>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void browserApiRequest<TrackingContextSettings>(
      `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setContextId(result.contexts.find(({ status }) => status === "ACTIVE")?.id ?? "");
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(positionErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  const context = useMemo(
    () => settings?.contexts.find(({ id }) => id === contextId),
    [contextId, settings]
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!context || running) return;
    setRunning(true);
    setError(undefined);
    setEstimate(undefined);
    try {
      if (assignKeywords) {
        const assignments = await Promise.allSettled(
          keywordIds.map((keywordId) =>
            browserApiRequest(
              `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts/${encodeURIComponent(context.id)}/keywords/${encodeURIComponent(keywordId)}`,
              { method: "PUT" }
            )
          )
        );
        const failed = assignments.filter(({ status }) => status === "rejected").length;
        if (failed > 0) {
          throw new Error(
            `Не удалось назначить ${failed} из ${keywordIds.length} запросов. Контекст перечитан не был; обновите выбор и повторите.`
          );
        }
      }
      const estimatePayload = await browserApiRequest<unknown>(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-estimates`,
        {
          method: "POST",
          body: { trackingContextId: context.id },
          idempotencyKey: `semantic-rank-estimate:${crypto.randomUUID()}`
        }
      );
      const nextEstimate = parseRankEstimate(estimatePayload, {
        projectId,
        trackingContextId: context.id
      });
      setEstimate(nextEstimate);
      if (nextEstimate.status !== "READY" || !nextEstimate.executionAllowed) return;
      const jobPayload = await browserApiRequest<unknown>(
        `/app/api/projects/${encodeURIComponent(projectId)}/rank-runs`,
        {
          method: "POST",
          body: { estimateId: nextEstimate.id },
          idempotencyKey: `semantic-rank-run:${crypto.randomUUID()}`
        }
      );
      const job = parseRankJobSummary(jobPayload, {
        workspaceId: context.workspaceId,
        projectId,
        trackingContextId: context.id
      });
      onStarted(job);
    } catch (requestError) {
      setError(positionErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      description="Назначьте выбранные запросы контексту, получите provider-free оценку и только затем запустите реальную фоновую проверку."
      onClose={running ? () => undefined : onClose}
      size="large"
      title="Проверка позиций"
    >
      <form className="semantic-position-dialog" onSubmit={(event) => void submit(event)}>
        {loading ? (
          <div className="semantic-dialog-loading" role="status">Загружаем контексты отслеживания…</div>
        ) : settings?.contexts.length ? (
          <>
            <div className="semantic-position-grid">
              <section>
                <h3>Контекст поиска</h3>
                <label>
                  <span>Поисковая система, регион и устройство</span>
                  <select autoFocus onChange={(event) => setContextId(event.target.value)} value={contextId}>
                    {settings.contexts.map((item) => (
                      <option disabled={item.status !== "ACTIVE"} key={item.id} value={item.id}>
                        {item.name} · {engineLabel(item)} · {item.configuration.regionLabel ?? item.configuration.regionCode ?? item.configuration.countryCode}
                      </option>
                    ))}
                  </select>
                </label>
                <a className="semantic-dialog-link" href={`/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`}>
                  Настроить контексты
                </a>
                <a className="semantic-dialog-link" href={`/app/projects/${encodeURIComponent(projectId)}/rankings/automations`}>
                  Настроить регулярное расписание
                </a>
              </section>
              <section>
                <h3>Параметры</h3>
                {context && <ContextFacts context={context} />}
              </section>
              <section>
                <h3>Объём</h3>
                <dl className="semantic-dialog-facts">
                  <div><dt>Выбрано запросов</dt><dd>{keywordIds.length}</dd></div>
                  <div><dt>Контекстов</dt><dd>1</dd></div>
                  <div><dt>Провайдер</dt><dd>Arsenkin BYOK</dd></div>
                  <div><dt>Стоимость платформы</dt><dd>0</dd></div>
                </dl>
              </section>
            </div>
            <label className="semantic-dialog-checkbox">
              <input checked={assignKeywords} onChange={(event) => setAssignKeywords(event.target.checked)} type="checkbox" />
              <span>Назначить выбранные запросы этому контексту перед запуском</span>
            </label>
          </>
        ) : (
          <div className="semantic-inspector-empty">
            <strong>Нет контекстов отслеживания</strong>
            <span>Создайте контекст с поисковой системой, регионом, устройством и BYOK-маршрутом.</span>
            <a className="primary-button" href={`/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`}>Создать контекст</a>
          </div>
        )}
        {estimate?.status === "BLOCKED" && (
          <div className="inline-alert warning" role="alert">
            <strong>Запуск заблокирован</strong>
            <ul>{estimate.blockers.map(({ code }) => <li key={code}>{rankEstimateBlockerLabel(code)}</li>)}</ul>
          </div>
        )}
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={loading || running || !context} type="submit">
            {running ? "Проверяем и запускаем…" : `Запустить проверку (${keywordIds.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function ContextFacts({ context }: Readonly<{ context: TrackingContextSummary }>) {
  return (
    <dl className="semantic-dialog-facts">
      <div><dt>Система</dt><dd>{engineLabel(context)}</dd></div>
      <div><dt>Устройство</dt><dd>{context.configuration.device === "DESKTOP" ? "Десктоп" : "Мобильное"}</dd></div>
      <div><dt>Глубина</dt><dd>Топ-{context.configuration.depth}</dd></div>
      <div><dt>Язык</dt><dd>{context.configuration.language}</dd></div>
    </dl>
  );
}

function engineLabel(context: TrackingContextSummary): string {
  return context.configuration.searchEngine === "YANDEX" ? "Яндекс" : "Google";
}

function positionErrorMessage(error: unknown): string {
  if (error instanceof Error && !(error instanceof BrowserApiError)) return error.message;
  if (error instanceof BrowserApiError) {
    if (error.code === "FORBIDDEN") return "Недостаточно прав для настройки или запуска проверки позиций.";
    if (error.code === "PAYMENT_REQUIRED") return "Workspace доступен только для чтения; результаты сохранены, новые проверки заблокированы.";
    if (error.code === "VERSION_CONFLICT") return "Контекст или состав запросов изменился. Рассчитайте запуск заново.";
    return error.message;
  }
  return "Не удалось подготовить проверку позиций.";
}
