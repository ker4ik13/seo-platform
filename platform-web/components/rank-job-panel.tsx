"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  RankEstimate,
  RankJobResultSummary,
  RankJobSummary
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiRequest
} from "../lib/browser-api";
import type { IdempotentCommand } from "../lib/idempotency";
import {
  RANK_JOB_AUTO_POLL_WINDOW_MS,
  RANK_JOB_GET_TIMEOUT_MS,
  RANK_JOB_MUTATION_TIMEOUT_MS,
  isActiveRankJob,
  isCancellableRankJob,
  parseRankPendingCreateReceipt,
  parseRankJobSessionHint,
  parseRankJobSummary,
  rankJobApiPath,
  rankJobCancelApiPath,
  rankJobCancelFeedback,
  rankJobCreateFeedback,
  rankJobPollDelayMs,
  rankJobPresentation,
  rankJobProgressPercent,
  rankJobReadFeedback,
  rankJobReconciliationTarget,
  rankJobSessionHintKey,
  rankJobStageLabel,
  rankPendingCreateReceiptKey,
  rankRunIdempotencyCommand,
  rankRunInput,
  rankRunPayloadSignature,
  rankRunsApiPath,
  serializeRankPendingCreateReceipt,
  serializeRankJobSessionHint,
  shouldRetainRankPendingCreateReceipt,
  type RankJobFeedback,
  type RankPendingCreateReceipt
} from "../lib/rank-jobs";

type RankJobPanelPhase =
  | "cancelling"
  | "creating"
  | "idle"
  | "polling"
  | "reconciling"
  | "refreshing"
  | "restoring";

interface ReplacementRequest {
  readonly estimateId?: string;
}

export function RankJobPanel({
  contextLoading,
  contextSignature,
  estimate,
  estimateCalculating,
  estimateExpired,
  online,
  onExplicitRecalculation,
  projectId,
  returnTo,
  trackingContextId,
  workspaceId
}: Readonly<{
  contextLoading: boolean;
  contextSignature: string;
  estimate: RankEstimate | undefined;
  estimateCalculating: boolean;
  estimateExpired: boolean;
  online: boolean;
  onExplicitRecalculation: () => void;
  projectId: string;
  returnTo: string;
  trackingContextId: string;
  workspaceId: string;
}>) {
  const headingId = useId();
  const [job, setJob] = useState<RankJobSummary>();
  const [hintedJobId, setHintedJobId] = useState<string>();
  const [pendingCreateReceipt, setPendingCreateReceipt] =
    useState<RankPendingCreateReceipt>();
  const [phase, setPhase] = useState<RankJobPanelPhase>("idle");
  const [createFailure, setCreateFailure] =
    useState<RankJobFeedback>();
  const [createFailureEstimateId, setCreateFailureEstimateId] =
    useState<string>();
  const [readFailure, setReadFailure] =
    useState<RankJobFeedback>();
  const [cancelFailure, setCancelFailure] =
    useState<RankJobFeedback>();
  const [cancelForbidden, setCancelForbidden] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [autoPollingExpired, setAutoPollingExpired] =
    useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>();
  const [visible, setVisible] = useState(true);
  const [reconciliationNeeded, setReconciliationNeeded] =
    useState(false);
  const [launchContextSignature, setLaunchContextSignature] =
    useState<string>();
  const [replacementRequest, setReplacementRequest] =
    useState<ReplacementRequest>();
  const commandRef = useRef<IdempotentCommand | undefined>(
    undefined
  );
  const mutationControllerRef = useRef<
    AbortController | undefined
  >(undefined);
  const pollControllerRef = useRef<
    AbortController | undefined
  >(undefined);
  const pollStartedAtRef = useRef<number | undefined>(undefined);
  const scopeGenerationRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const refreshJobRef = useRef<
    (
      jobId: string,
      mode: "polling" | "reconciling" | "refreshing"
    ) => Promise<void>
  >(async () => undefined);
  const storageKey = rankJobSessionHintKey(
    projectId,
    trackingContextId
  );
  const pendingCreateStorageKey = rankPendingCreateReceiptKey(
    projectId,
    trackingContextId
  );

  useEffect(() => {
    setVisible(document.visibilityState === "visible");
    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible";
      setVisible(nextVisible);
      if (!nextVisible) {
        setReconciliationNeeded(true);
        pollControllerRef.current?.abort();
      }
    };
    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );
    return () =>
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
  }, []);

  useEffect(() => {
    scopeGenerationRef.current += 1;
    const generation = scopeGenerationRef.current;
    mutationControllerRef.current?.abort();
    pollControllerRef.current?.abort();
    pollInFlightRef.current = false;
    commandRef.current = undefined;
    pollStartedAtRef.current = undefined;
    setJob(undefined);
    setHintedJobId(undefined);
    setPendingCreateReceipt(undefined);
    setPhase("idle");
    setCreateFailure(undefined);
    setCreateFailureEstimateId(undefined);
    setReadFailure(undefined);
    setCancelFailure(undefined);
    setCancelForbidden(false);
    setConfirmCancel(false);
    setAutoPollingExpired(false);
    setReconciliationNeeded(false);
    setLastUpdatedAt(undefined);
    setLaunchContextSignature(undefined);
    setReplacementRequest(undefined);

    const storedPendingCreate = readSessionHint(
      pendingCreateStorageKey
    );
    const pendingCreate = parseRankPendingCreateReceipt(
      storedPendingCreate,
      {
        projectId,
        trackingContextId
      }
    );
    if (pendingCreate) {
      setPendingCreateReceipt(pendingCreate);
      commandRef.current = {
        payloadSignature: rankRunPayloadSignature(
          pendingCreate.estimateId
        ),
        key: pendingCreate.idempotencyKey
      };
    } else if (storedPendingCreate !== undefined) {
      removeSessionHint(pendingCreateStorageKey);
    }

    const stored = readSessionHint(storageKey);
    const hint = parseRankJobSessionHint(stored, {
      projectId,
      trackingContextId
    });
    if (!hint) {
      if (stored !== undefined) removeSessionHint(storageKey);
      return;
    }
    setHintedJobId(hint.jobId);
    if (!online) {
      setReadFailure(
        rankJobReadFeedback(new TypeError("Offline"), false)
      );
      return;
    }

    const controller = new AbortController();
    pollControllerRef.current = controller;
    pollInFlightRef.current = true;
    setPhase("restoring");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RANK_JOB_GET_TIMEOUT_MS);
    void browserApiRequest<unknown>(
      rankJobApiPath(projectId, hint.jobId),
      { signal: controller.signal }
    )
      .then((payload) => {
        if (
          controller.signal.aborted ||
          scopeGenerationRef.current !== generation
        ) {
          return;
        }
        const restored = parseRankJobSummary(payload, {
          workspaceId,
          projectId,
          trackingContextId,
          jobId: hint.jobId
        });
        pollStartedAtRef.current = Date.now();
        acceptJob(restored);
      })
      .catch((error: unknown) => {
        if (
          scopeGenerationRef.current !== generation ||
          redirectForExpiredSession(error, returnTo)
        ) {
          return;
        }
        if (
          !timedOut &&
          (controller.signal.aborted || isAbortError(error))
        ) {
          return;
        }
        const feedback = rankJobReadFeedback(
          timedOut ? statusReconciliationTimeoutError() : error,
          navigator.onLine
        );
        setReadFailure(feedback);
        if (
          feedback.kind === "forbidden" ||
          feedback.kind === "not-found"
        ) {
          setHintedJobId(undefined);
          removeSessionHint(storageKey);
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (
          pollControllerRef.current === controller &&
          scopeGenerationRef.current === generation
        ) {
          pollControllerRef.current = undefined;
          pollInFlightRef.current = false;
          setPhase("idle");
        }
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // acceptJob intentionally uses only stable scope setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    pendingCreateStorageKey,
    returnTo,
    storageKey,
    trackingContextId,
    workspaceId
  ]);

  useEffect(
    () => () => {
      scopeGenerationRef.current += 1;
      mutationControllerRef.current?.abort();
      pollControllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (online) return;
    if (
      phase === "polling" ||
      phase === "reconciling" ||
      phase === "refreshing"
    ) {
      pollControllerRef.current?.abort();
      pollControllerRef.current = undefined;
      pollInFlightRef.current = false;
      setPhase("idle");
    }
    if (rankJobReconciliationTarget(job, hintedJobId)) {
      setReconciliationNeeded(true);
      setReadFailure(
        rankJobReadFeedback(new TypeError("Offline"), false)
      );
      if (job && isActiveRankJob(job)) {
        setAutoPollingExpired(true);
      }
    }
  }, [hintedJobId, job, online, phase]);

  useEffect(() => {
    const target = rankJobReconciliationTarget(job, hintedJobId);
    if (!online || !visible) {
      if (target) setReconciliationNeeded(true);
      return;
    }
    if (!reconciliationNeeded) return;
    if (!target) {
      setReconciliationNeeded(false);
      return;
    }
    if (
      confirmCancel ||
      phase !== "idle" ||
      pollInFlightRef.current
    ) {
      return;
    }
    setReconciliationNeeded(false);
    void refreshJobRef.current(target, "reconciling");
  }, [
    confirmCancel,
    hintedJobId,
    job,
    online,
    phase,
    reconciliationNeeded,
    visible
  ]);

  useEffect(() => {
    if (
      !job ||
      !isActiveRankJob(job) ||
      !online ||
      !visible ||
      confirmCancel ||
      reconciliationNeeded ||
      phase !== "idle" ||
      readFailure ||
      autoPollingExpired ||
      pollInFlightRef.current
    ) {
      return;
    }
    const startedAt =
      pollStartedAtRef.current ??
      (pollStartedAtRef.current = Date.now());
    const elapsed = Date.now() - startedAt;
    const remaining = RANK_JOB_AUTO_POLL_WINDOW_MS - elapsed;
    const delay = rankJobPollDelayMs(job, elapsed);
    if (delay === undefined) return;
    if (remaining <= delay) {
      const timer = window.setTimeout(
        () => setAutoPollingExpired(true),
        Math.max(0, remaining)
      );
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(
      () => void refreshJobRef.current(job.id, "polling"),
      delay
    );
    return () => window.clearTimeout(timer);
  }, [
    autoPollingExpired,
    confirmCancel,
    job,
    online,
    phase,
    readFailure,
    reconciliationNeeded,
    visible
  ]);

  useEffect(() => {
    if (!job || isActiveRankJob(job)) return;
    setConfirmCancel(false);
    setAutoPollingExpired(false);
  }, [job]);

  useEffect(() => {
    if (!replacementRequest || !estimate) return;
    if (
      replacementRequest.estimateId === undefined ||
      replacementRequest.estimateId !== estimate.id
    ) {
      clearRememberedJob();
      setReplacementRequest(undefined);
    }
    // clearRememberedJob is a local state transition, not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, replacementRequest]);

  useEffect(() => {
    if (
      !createFailure ||
      createFailure.action === "RETRY_SAME_COMMAND" ||
      createFailure.action === "ATTACH_EXISTING" ||
      !createFailureEstimateId ||
      !estimate ||
      createFailureEstimateId === estimate.id
    ) {
      return;
    }
    if (!pendingCreateReceipt) {
      commandRef.current = undefined;
    }
    setCreateFailure(undefined);
    setCreateFailureEstimateId(undefined);
  }, [
    createFailure,
    createFailureEstimateId,
    estimate,
    pendingCreateReceipt
  ]);

  function acceptJob(next: RankJobSummary): void {
    setJob(next);
    setHintedJobId(next.id);
    setLastUpdatedAt(Date.now());
    setCreateFailure(undefined);
    setCreateFailureEstimateId(undefined);
    setReadFailure(undefined);
    setCancelFailure(undefined);
    setAutoPollingExpired(false);
    const hintPersisted = writeSessionHint(
      storageKey,
      serializeRankJobSessionHint({
        version: 1,
        projectId,
        trackingContextId,
        jobId: next.id
      })
    );
    if (hintPersisted) clearPendingCreateReceipt();
  }

  async function createJob(): Promise<void> {
    const replayReceipt = pendingCreateReceipt;
    const exactReplay = replayReceipt !== undefined;
    const estimateId = replayReceipt?.estimateId ?? estimate?.id;
    const initialLaunchAllowed = Boolean(
      estimate &&
        estimate.workspaceId === workspaceId &&
        estimate.projectId === projectId &&
        estimate.trackingContextId === trackingContextId &&
        estimate.status === "READY" &&
        estimate.executionAllowed &&
        !estimateExpired &&
        !estimateCalculating &&
        !contextLoading
    );
    if (
      !estimateId ||
      (!exactReplay && !initialLaunchAllowed) ||
      !online ||
      job ||
      hintedJobId ||
      phase !== "idle"
    ) {
      return;
    }
    const command = replayReceipt
      ? {
          payloadSignature: rankRunPayloadSignature(estimateId),
          key: replayReceipt.idempotencyKey
        }
      : rankRunIdempotencyCommand(
          commandRef.current,
          estimateId,
          () => `rank-run:${globalThis.crypto.randomUUID()}`
        );
    const receipt: RankPendingCreateReceipt =
      replayReceipt ?? {
          version: 1,
          projectId,
          trackingContextId,
          estimateId,
          idempotencyKey: command.key
        };
    if (
      !writeSessionHint(
        pendingCreateStorageKey,
        serializeRankPendingCreateReceipt(receipt)
      )
    ) {
      commandRef.current = undefined;
      setCreateFailure({
        kind: "degraded",
        message:
          "Браузер не смог сохранить безопасный повтор команды. Запуск не отправлен; разрешите хранилище вкладки и пересчитайте готовность.",
        action: "RECALCULATE"
      });
      setCreateFailureEstimateId(estimateId);
      return;
    }
    commandRef.current = command;
    setPendingCreateReceipt(receipt);
    const generation = scopeGenerationRef.current;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setPhase("creating");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RANK_JOB_MUTATION_TIMEOUT_MS);
    if (!exactReplay) {
      setCreateFailure(undefined);
      setCreateFailureEstimateId(undefined);
    }
    setReadFailure(undefined);

    try {
      const payload = await browserApiRequest<unknown>(
        rankRunsApiPath(projectId),
        {
          method: "POST",
          body: rankRunInput(estimateId),
          idempotencyKey: command.key,
          signal: controller.signal
        }
      );
      const accepted = parseRankJobSummary(payload, {
        workspaceId,
        projectId,
        trackingContextId
      });
      if (
        controller.signal.aborted ||
        scopeGenerationRef.current !== generation
      ) {
        return;
      }
      setCreateFailure(undefined);
      setCreateFailureEstimateId(undefined);
      pollStartedAtRef.current = Date.now();
      setLaunchContextSignature(contextSignature);
      acceptJob(accepted);
    } catch (error) {
      if (
        scopeGenerationRef.current !== generation ||
        redirectForExpiredSession(error, returnTo)
      ) {
        return;
      }
      if (
        !timedOut &&
        (controller.signal.aborted || isAbortError(error))
      ) {
        return;
      }
      const createError = timedOut
        ? commandOutcomeTimeoutError()
        : error;
      const feedback = rankJobCreateFeedback(
        createError,
        navigator.onLine
      );
      setCreateFailure(feedback);
      setCreateFailureEstimateId(estimateId);
      if (
        !shouldRetainRankPendingCreateReceipt(
          createError,
          navigator.onLine
        )
      ) {
        clearPendingCreateReceipt();
      }
    } finally {
      window.clearTimeout(timeout);
      if (
        mutationControllerRef.current === controller &&
        scopeGenerationRef.current === generation
      ) {
        mutationControllerRef.current = undefined;
        setPhase("idle");
      }
    }
  }

  function attachExistingJob(jobId: string): void {
    if (
      !pendingCreateReceipt ||
      !online ||
      phase !== "idle" ||
      pollInFlightRef.current
    ) {
      return;
    }
    setCreateFailure(undefined);
    setCreateFailureEstimateId(undefined);
    setReadFailure(undefined);
    setHintedJobId(jobId);
    writeSessionHint(
      storageKey,
      serializeRankJobSessionHint({
        version: 1,
        projectId,
        trackingContextId,
        jobId
      })
    );
    void refreshJob(jobId, "reconciling");
  }

  async function refreshJob(
    jobId: string,
    mode: "polling" | "reconciling" | "refreshing"
  ): Promise<void> {
    if (
      !online ||
      pollInFlightRef.current ||
      phase !== "idle"
    ) {
      return;
    }
    const generation = scopeGenerationRef.current;
    const controller = new AbortController();
    pollControllerRef.current?.abort();
    pollControllerRef.current = controller;
    pollInFlightRef.current = true;
    setPhase(mode);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RANK_JOB_GET_TIMEOUT_MS);
    if (mode === "refreshing") {
      setReadFailure(undefined);
      setAutoPollingExpired(false);
      pollStartedAtRef.current = Date.now();
    }

    try {
      const payload = await browserApiRequest<unknown>(
        rankJobApiPath(projectId, jobId),
        { signal: controller.signal }
      );
      const refreshed = parseRankJobSummary(payload, {
        workspaceId,
        projectId,
        trackingContextId,
        jobId
      });
      if (
        controller.signal.aborted ||
        scopeGenerationRef.current !== generation
      ) {
        return;
      }
      acceptJob(refreshed);
    } catch (error) {
      if (
        scopeGenerationRef.current !== generation ||
        redirectForExpiredSession(error, returnTo)
      ) {
        return;
      }
      if (
        !timedOut &&
        (controller.signal.aborted || isAbortError(error))
      ) {
        return;
      }
      const readError = timedOut
        ? statusReconciliationTimeoutError()
        : error;
      const feedback = rankJobReadFeedback(
        readError,
        navigator.onLine
      );
      setReadFailure(feedback);
      setAutoPollingExpired(true);
      if (
        feedback.kind === "forbidden" ||
        feedback.kind === "not-found"
      ) {
        setJob(undefined);
        setHintedJobId(undefined);
        removeSessionHint(storageKey);
      }
    } finally {
      window.clearTimeout(timeout);
      if (
        pollControllerRef.current === controller &&
        scopeGenerationRef.current === generation
      ) {
        pollControllerRef.current = undefined;
        pollInFlightRef.current = false;
        setPhase("idle");
      }
    }
  }
  refreshJobRef.current = refreshJob;

  async function cancelJob(): Promise<void> {
    if (
      !job ||
      !isCancellableRankJob(job) ||
      cancelForbidden ||
      !online ||
      phase !== "idle"
    ) {
      return;
    }
    const generation = scopeGenerationRef.current;
    pollControllerRef.current?.abort();
    pollControllerRef.current = undefined;
    pollInFlightRef.current = false;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setConfirmCancel(false);
    setCancelFailure(undefined);
    setPhase("cancelling");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, RANK_JOB_MUTATION_TIMEOUT_MS);

    try {
      const payload = await browserApiRequest<unknown>(
        rankJobCancelApiPath(projectId, job.id),
        {
          method: "POST",
          body: {},
          signal: controller.signal
        }
      );
      const cancelled = parseRankJobSummary(payload, {
        workspaceId,
        projectId,
        trackingContextId,
        jobId: job.id
      });
      if (
        controller.signal.aborted ||
        scopeGenerationRef.current !== generation
      ) {
        return;
      }
      pollStartedAtRef.current = Date.now();
      acceptJob(cancelled);
    } catch (error) {
      if (
        scopeGenerationRef.current !== generation ||
        redirectForExpiredSession(error, returnTo)
      ) {
        return;
      }
      if (
        !timedOut &&
        (controller.signal.aborted || isAbortError(error))
      ) {
        return;
      }
      const feedback = rankJobCancelFeedback(
        timedOut ? commandOutcomeTimeoutError() : error,
        navigator.onLine
      );
      setCancelFailure(feedback);
      if (feedback.kind === "forbidden") {
        setCancelForbidden(true);
      }
    } finally {
      window.clearTimeout(timeout);
      if (
        mutationControllerRef.current === controller &&
        scopeGenerationRef.current === generation
      ) {
        mutationControllerRef.current = undefined;
        setPhase("idle");
      }
    }
  }

  function requestRecalculation(): void {
    if (
      !online ||
      contextLoading ||
      estimateCalculating ||
      phase !== "idle"
    ) {
      return;
    }
    if (job && !isActiveRankJob(job) && pendingCreateReceipt) {
      clearPendingCreateReceipt();
    } else if (!pendingCreateReceipt) {
      commandRef.current = undefined;
    }
    setCreateFailure(undefined);
    setCreateFailureEstimateId(undefined);
    setReadFailure(undefined);
    if (job) {
      setReplacementRequest(
        estimate ? { estimateId: estimate.id } : {}
      );
    }
    onExplicitRecalculation();
  }

  function clearPendingCreateReceipt(): void {
    setPendingCreateReceipt(undefined);
    commandRef.current = undefined;
    removeSessionHint(pendingCreateStorageKey);
  }

  function clearRememberedJob(): void {
    setJob(undefined);
    setHintedJobId(undefined);
    setReadFailure(undefined);
    setCancelFailure(undefined);
    setCancelForbidden(false);
    setConfirmCancel(false);
    setAutoPollingExpired(false);
    setLastUpdatedAt(undefined);
    setLaunchContextSignature(undefined);
    pollStartedAtRef.current = undefined;
    removeSessionHint(storageKey);
  }

  const loadingRememberedJob =
    phase === "restoring" && Boolean(hintedJobId) && !job;
  const launchAllowed = Boolean(
    estimate &&
      estimate.status === "READY" &&
      estimate.executionAllowed &&
      !estimateExpired &&
      !estimateCalculating &&
      online &&
      !contextLoading &&
      !job &&
      !hintedJobId &&
      !pendingCreateReceipt &&
      !readFailure &&
      phase === "idle"
  );

  if (
    !estimate &&
    !job &&
    !hintedJobId &&
    !pendingCreateReceipt &&
    !createFailure &&
    !readFailure
  ) {
    return null;
  }

  return (
    <div className="rank-job-stack">
      {estimate &&
        !job &&
        !hintedJobId &&
        !pendingCreateReceipt &&
        !createFailure &&
        !readFailure && (
        <footer className="rank-estimate-actions rank-job-launch">
          <span>{launchCopy(estimate, estimateExpired)}</span>
          {estimateExpired ? (
            <button
              className="primary-button"
              disabled={
                !online ||
                contextLoading ||
                estimateCalculating ||
                phase !== "idle"
              }
              onClick={requestRecalculation}
              type="button"
            >
              {estimateCalculating
                ? "Пересчитываем…"
                : "Пересчитать оценку"}
            </button>
          ) : (
            <button
              aria-busy={phase === "creating"}
              className="primary-button"
              disabled={!launchAllowed}
              onClick={() => void createJob()}
              title={launchDisabledReason({
                contextLoading,
                estimate,
                estimateCalculating,
                online,
                phase
              })}
              type="button"
            >
              {phase === "creating"
                ? "Создаём задачу…"
                : estimate.status === "BLOCKED"
                  ? "Запуск заблокирован"
                  : "Создать задачу"}
            </button>
          )}
        </footer>
      )}

      {createFailure && !job && (
        <Feedback
          feedback={createFailure}
          title="Не удалось подтвердить создание"
        >
          {createFailure.action === "RETRY_SAME_COMMAND" &&
            pendingCreateReceipt && (
            <button
              className="secondary-button"
              disabled={!online || phase !== "idle"}
              onClick={() => void createJob()}
              type="button"
            >
              {phase === "creating"
                ? "Повторяем безопасно…"
                : "Повторить безопасно"}
            </button>
          )}
          {createFailure.action === "ATTACH_EXISTING" &&
            createFailure.attachJobId && (
              <>
                <button
                  className="secondary-button"
                  disabled={!online || phase !== "idle"}
                  onClick={() =>
                    attachExistingJob(createFailure.attachJobId as string)
                  }
                  type="button"
                >
                  Открыть активную задачу
                </button>
                {pendingCreateReceipt && (
                  <button
                    className="text-button"
                    disabled={!online || phase !== "idle"}
                    onClick={() => void createJob()}
                    type="button"
                  >
                    Повторить исходную команду
                  </button>
                )}
              </>
            )}
          {createFailure.action === "RECALCULATE" && (
            <button
              className="secondary-button"
              disabled={!online || phase !== "idle"}
              onClick={requestRecalculation}
              type="button"
            >
              Пересчитать готовность
            </button>
          )}
        </Feedback>
      )}

      {pendingCreateReceipt &&
        !job &&
        !hintedJobId &&
        !createFailure && (
          <section
            aria-busy={phase === "creating"}
            aria-labelledby={headingId}
            className="rank-job-card rank-job-degraded-card"
          >
            <header>
              <div>
                <p className="eyebrow">Безопасное восстановление</p>
                <h4 id={headingId}>
                  Исход создания пока не подтверждён
                </h4>
                <p>
                  Исходная команда сохранена в этой вкладке. Новый запуск
                  заблокирован; POST автоматически не повторяется.
                </p>
              </div>
            </header>
            {readFailure && (
              <Feedback
                feedback={readFailure}
                title="Не удалось сверить задачу"
              />
            )}
            <div className="rank-job-actions">
              <button
                aria-busy={phase === "creating"}
                className="secondary-button"
                disabled={!online || phase !== "idle"}
                onClick={() => void createJob()}
                type="button"
              >
                {phase === "creating"
                  ? "Повторяем исходную команду…"
                  : "Повторить исходную команду"}
              </button>
            </div>
          </section>
        )}

      {readFailure &&
        !job &&
        !hintedJobId &&
        !pendingCreateReceipt && (
        <Feedback
          feedback={readFailure}
          title="Задача больше не подтверждена"
        >
          <button
            className="secondary-button"
            disabled={!online || phase !== "idle"}
            onClick={requestRecalculation}
            type="button"
          >
            Проверить готовность заново
          </button>
        </Feedback>
      )}

      {loadingRememberedJob && (
        <section
          aria-busy="true"
          aria-live="polite"
          className="rank-job-card rank-job-restoring"
        >
          <span aria-hidden="true" className="spinner" />
          <div>
            <strong>Восстанавливаем задачу…</strong>
            <p>
              Проверяем сохранённый в этой вкладке ID через API платформы.
            </p>
          </div>
        </section>
      )}

      {!job && hintedJobId && !loadingRememberedJob && (
        <section
          aria-labelledby={headingId}
          className="rank-job-card rank-job-degraded-card"
        >
          <header>
            <div>
              <p className="eyebrow">Фоновая задача</p>
              <h4 id={headingId}>Статус пока не подтверждён</h4>
              <p>
                ID сохранён только как подсказка. Состояние станет
                доверенным после успешной проверки сервером.
              </p>
            </div>
          </header>
          <JobIdentifier jobId={hintedJobId} />
          {readFailure && (
            <Feedback
              feedback={readFailure}
              title="Не удалось загрузить задачу"
            />
          )}
          <div className="rank-job-actions">
            <button
              className="secondary-button"
              disabled={!online || phase !== "idle"}
              onClick={() =>
                void refreshJob(hintedJobId, "refreshing")
              }
              type="button"
            >
              {online ? "Обновить статус" : "Нет соединения"}
            </button>
          </div>
        </section>
      )}

      {job && (
        <RankJobCard
          autoPollingExpired={autoPollingExpired}
          busy={phase !== "idle"}
          cancelFailure={cancelFailure}
          cancelForbidden={cancelForbidden}
          confirmCancel={confirmCancel}
          contextDrifted={Boolean(
            launchContextSignature &&
              launchContextSignature !== contextSignature
          )}
          headingId={headingId}
          job={job}
          lastUpdatedAt={lastUpdatedAt}
          online={online}
          phase={phase}
          readFailure={readFailure}
          replacementRequested={
            Boolean(replacementRequest) && estimateCalculating
          }
          contextLoading={contextLoading}
          estimateCalculating={estimateCalculating}
          onCancel={() => void cancelJob()}
          onCancelConfirmChange={setConfirmCancel}
          onRecalculate={requestRecalculation}
          onRefresh={() => void refreshJob(job.id, "refreshing")}
        />
      )}
    </div>
  );
}

function RankJobCard({
  autoPollingExpired,
  busy,
  cancelFailure,
  cancelForbidden,
  confirmCancel,
  contextLoading,
  contextDrifted,
  estimateCalculating,
  headingId,
  job,
  lastUpdatedAt,
  online,
  phase,
  readFailure,
  replacementRequested,
  onCancel,
  onCancelConfirmChange,
  onRecalculate,
  onRefresh
}: Readonly<{
  autoPollingExpired: boolean;
  busy: boolean;
  cancelFailure: RankJobFeedback | undefined;
  cancelForbidden: boolean;
  confirmCancel: boolean;
  contextLoading: boolean;
  contextDrifted: boolean;
  estimateCalculating: boolean;
  headingId: string;
  job: RankJobSummary;
  lastUpdatedAt: number | undefined;
  online: boolean;
  phase: RankJobPanelPhase;
  readFailure: RankJobFeedback | undefined;
  replacementRequested: boolean;
  onCancel: () => void;
  onCancelConfirmChange: (value: boolean) => void;
  onRecalculate: () => void;
  onRefresh: () => void;
}>) {
  const presentation = rankJobPresentation(job);
  const active = isActiveRankJob(job);
  const cancellable = isCancellableRankJob(job);
  const progress = rankJobProgressPercent(job);
  const cancelConfirmationId = useId();
  const cancelDismissRef = useRef<HTMLButtonElement>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const jobStatusRef = useRef<HTMLElement>(null);
  const returnCancelFocusRef = useRef(false);

  useEffect(() => {
    if (confirmCancel) {
      cancelDismissRef.current?.focus();
      return;
    }
    if (!returnCancelFocusRef.current) return;
    returnCancelFocusRef.current = false;
    cancelTriggerRef.current?.focus();
  }, [confirmCancel]);

  function closeCancelConfirmation(): void {
    returnCancelFocusRef.current = true;
    onCancelConfirmChange(false);
  }

  function submitCancel(): void {
    returnCancelFocusRef.current = false;
    jobStatusRef.current?.focus();
    onCancel();
  }

  return (
    <section
      aria-busy={busy}
      aria-labelledby={headingId}
      className={`rank-job-card tone-${presentation.tone}`}
    >
      <header
        aria-live="polite"
        className="rank-job-header"
        ref={jobStatusRef}
        role={presentation.tone === "danger" ? "alert" : "status"}
        tabIndex={-1}
      >
        <div>
          <p className="eyebrow">
            Ручной съём · Арсенкин · свой API-ключ
          </p>
          <h4 id={headingId}>{presentation.title}</h4>
          <p>{presentation.message}</p>
        </div>
        <span className={`rank-job-status ${presentation.tone}`}>
          {jobStatusLabel(job)}
        </span>
      </header>

      <div className="rank-job-progress">
        <div>
          <span>{rankJobStageLabel(job.stage)}</span>
          <strong>
            {formatDecimal(job.progress.current)} из{" "}
            {formatDecimal(job.progress.total)}
          </strong>
        </div>
        <div
          aria-label="Прогресс задачи по запросам"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          aria-valuetext={`${formatDecimal(job.progress.current)} из ${formatDecimal(job.progress.total)} запросов`}
          className="rank-job-progress-track"
          role="progressbar"
        >
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>

      <dl className="rank-job-facts">
        <Fact label="Этап" value={rankJobStageLabel(job.stage)} />
        <Fact
          label="Создана"
          value={formatDateTime(job.createdAt)}
        />
        <Fact
          label="Обновлено в этой вкладке"
          value={
            lastUpdatedAt
              ? formatDateTime(new Date(lastUpdatedAt).toISOString())
              : "—"
          }
        />
        <Fact
          label="Списание платформы"
          value={`0 ${job.billingCurrency}`}
        />
      </dl>

      {job.result && <RankJobResult result={job.result} />}

      <JobIdentifier jobId={job.id} />

      {contextDrifted && (
        <div className="inline-alert info" role="note">
          Контекст изменился после создания задачи. Текущий запуск
          продолжает использовать зафиксированный снимок настроек.
        </div>
      )}
      {!online && (
        <div className="inline-alert warning" role="status">
          Офлайн: показан последний подтверждённый статус. Он не изменяется
          локально и не считается актуальным до успешной проверки сервером.
        </div>
      )}
      {autoPollingExpired && active && !readFailure && (
        <div className="inline-alert info" role="status">
          Автоматическое наблюдение ограничено пятью минутами. Задача
          продолжает выполняться в фоне; обновите статус вручную.
        </div>
      )}
      {readFailure && (
        <Feedback
          feedback={readFailure}
          title="Статус временно устарел"
        />
      )}
      {cancelFailure && (
        <Feedback
          feedback={cancelFailure}
          title="Отмена не подтверждена"
        >
          {cancelFailure.action === "RETRY_CANCEL" && (
            <button
              className="secondary-button"
              disabled={!online || busy}
              onClick={submitCancel}
              type="button"
            >
              Повторить отмену
            </button>
          )}
        </Feedback>
      )}
      {cancelForbidden && cancellable && (
        <div className="inline-alert warning" role="note">
          Отмена недоступна без разрешения collector.cancel. Чтение и
          обновление статуса остаются доступными.
        </div>
      )}
      {job.status === "ACTION_REQUIRED" && (
        <div className="inline-alert danger" role="alert">
          <strong>Не создавайте новый запуск автоматически.</strong>
          <span>
            Передайте оператору ID задачи. Пока операция сверки недоступна,
            можно только безопасно читать и обновлять статус.
          </span>
        </div>
      )}

      {confirmCancel && cancellable && (
        <div
          className="inline-alert warning rank-job-cancel-confirm"
          id={cancelConfirmationId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeCancelConfirmation();
          }}
          role="alert"
        >
          <div>
            <strong>Запросить отмену задачи?</strong>
            <p>
              Уже отправленная внешняя операция может завершиться, а
              подтверждённые результаты будут сохранены.
            </p>
          </div>
          <div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={closeCancelConfirmation}
              ref={cancelDismissRef}
              type="button"
            >
              Не отменять
            </button>
            <button
              className="secondary-button danger-button"
              disabled={!online || busy}
              onClick={submitCancel}
              type="button"
            >
              Подтвердить отмену
            </button>
          </div>
        </div>
      )}

      <footer className="rank-job-actions">
        <button
          aria-busy={
            phase === "refreshing" || phase === "polling"
          }
          className="secondary-button"
          disabled={!online || busy}
          onClick={onRefresh}
          type="button"
        >
          {phase === "refreshing"
            ? "Обновляем…"
            : phase === "polling"
              ? "Проверяем статус…"
              : "Обновить статус"}
        </button>
        {cancellable && !cancelForbidden && (
          <button
            aria-controls={cancelConfirmationId}
            aria-expanded={confirmCancel}
            className="text-button danger-text"
            disabled={!online || busy}
            onClick={() =>
              confirmCancel
                ? closeCancelConfirmation()
                : onCancelConfirmChange(true)
            }
            ref={cancelTriggerRef}
            type="button"
          >
            {phase === "cancelling"
              ? "Запрашиваем отмену…"
              : confirmCancel
                ? "Закрыть подтверждение"
                : "Отменить задачу"}
          </button>
        )}
        {!active && job.status !== "ACTION_REQUIRED" && (
          <button
            className="primary-button"
            disabled={
              !online ||
              busy ||
              contextLoading ||
              estimateCalculating ||
              replacementRequested
            }
            onClick={onRecalculate}
            type="button"
          >
            {replacementRequested
              ? "Пересчитываем готовность…"
              : job.status === "FAILED"
                ? "Пересчитать и подготовить новый"
                : "Подготовить новый съём"}
          </button>
        )}
      </footer>
    </section>
  );
}

function RankJobResult({
  result
}: Readonly<{ result: RankJobResultSummary }>) {
  return (
    <section
      aria-label="Подтверждённый итог задачи"
      className="rank-job-result"
    >
      <h5>Итог сохранения</h5>
      <dl>
        <Fact
          label="Всего пар"
          value={formatDecimal(result.pairCount)}
        />
        <Fact
          label="Сохранено"
          value={formatDecimal(result.persistedCount)}
        />
        <Fact
          label="Найдено"
          value={formatDecimal(result.foundCount)}
        />
        <Fact
          label="Не найдено"
          value={formatDecimal(result.notFoundCount)}
        />
        <Fact
          label="Ошибки"
          value={formatDecimal(result.failedCount)}
        />
        <Fact
          label="Исход неизвестен"
          value={formatDecimal(result.submitOutcomeUnknownCount)}
        />
      </dl>
    </section>
  );
}

function Feedback({
  children,
  feedback,
  title
}: Readonly<{
  children?: ReactNode;
  feedback: RankJobFeedback;
  title: string;
}>) {
  return (
    <div
      className="inline-alert danger rank-job-feedback"
      role="alert"
    >
      <div>
        <strong>{title}</strong>
        <p>{feedback.message}</p>
        {feedback.requestId && (
          <small>Код запроса: {feedback.requestId}</small>
        )}
      </div>
      {children && <div className="rank-job-feedback-actions">{children}</div>}
    </div>
  );
}

function JobIdentifier({
  jobId
}: Readonly<{ jobId: string }>) {
  return (
    <div className="rank-job-identifier">
      <span>ID задачи</span>
      <code>{jobId}</code>
    </div>
  );
}

function Fact({
  label,
  value
}: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function launchCopy(
  estimate: RankEstimate,
  expired: boolean
): string {
  if (expired) {
    return "Срок оценки истёк. Устаревшая оценка не будет отправлена на сервер запуска.";
  }
  if (estimate.status === "BLOCKED") {
    return "Сервер не разрешил выполнение. Интерфейс не обходит ограничения и не обращается к провайдеру.";
  }
  return "Будет создана задача в статусе «Подготовка» только по ID оценки. До внешней операции сервер повторно проверит версии, права, квоту и допуск к запуску.";
}

function launchDisabledReason({
  contextLoading,
  estimate,
  estimateCalculating,
  online,
  phase
}: Readonly<{
  contextLoading: boolean;
  estimate: RankEstimate;
  estimateCalculating: boolean;
  online: boolean;
  phase: RankJobPanelPhase;
}>): string | undefined {
  if (!online) return "Для создания задачи требуется соединение";
  if (contextLoading) return "Дождитесь обновления контекста";
  if (estimateCalculating) return "Дождитесь новой оценки";
  if (phase !== "idle") return "Дождитесь завершения текущей операции";
  if (estimate.status === "BLOCKED" || !estimate.executionAllowed) {
    return "Серверная оценка содержит ограничения запуска";
  }
  return undefined;
}

function jobStatusLabel(job: RankJobSummary): string {
  const labels: Readonly<Record<RankJobSummary["status"], string>> = {
    ACTION_REQUIRED: "Нужна проверка",
    CANCELLED: "Отменена",
    CANCEL_REQUESTED: "Отменяется",
    COMPLETED: "Завершена",
    FAILED: "Ошибка",
    PARTIALLY_COMPLETED: "Частично",
    PREPARING: "Подготовка",
    QUEUED: "В очереди",
    RUNNING: "Выполняется"
  };
  return labels[job.status];
}

function formatDecimal(value: string): string {
  try {
    return new Intl.NumberFormat("ru-RU").format(BigInt(value));
  } catch {
    return value;
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function readSessionHint(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionHint(key: string, value: string): boolean {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    // The server remains authoritative; persistence is only a resume hint.
    return false;
  }
}

function removeSessionHint(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // A failed cleanup cannot authorize or mutate a server Job.
  }
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

function statusReconciliationTimeoutError(): BrowserApiError {
  return new BrowserApiError(
    504,
    "STATUS_RECONCILIATION_TIMEOUT",
    "Status reconciliation timed out",
    [],
    undefined,
    true
  );
}

function commandOutcomeTimeoutError(): BrowserApiError {
  return new BrowserApiError(
    504,
    "COMMAND_OUTCOME_TIMEOUT",
    "Command outcome timed out",
    [],
    undefined,
    true
  );
}
