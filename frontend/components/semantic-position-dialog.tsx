"use client";

import { CustomSelect } from "./custom-select";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type {
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  RankEstimate,
  RankJobSummary,
  TrackingContextKeywordReplacementResult,
  TrackingContextSettings,
  TrackingContextSummary,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import { rankProviderKeywordLimit } from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import {
  effectiveProjectConnectorOptions
} from "../lib/project-integration-settings";
import { integrationProviderLabel } from "../lib/integration-presentation";
import { rankProviderUsageEstimate } from "../lib/provider-usage-estimate";
import {
  stableIdempotencyCommand,
  type IdempotentCommand
} from "../lib/idempotency";
import {
  emptyTrackingContextDraft,
  reconcileTrackingContextCreate,
  trackingContextApiPath,
  trackingContextCreateInput,
  trackingContextDraft,
  trackingContextDraftDirty,
  trackingContextMatchesDraft,
  trackingContextPayloadSignature,
  validateTrackingContextDraft,
  withTrackingContext,
  type TrackingContextDraft
} from "../lib/tracking-contexts";
import {
  parseRankEstimate,
  rankEstimateBlockerLabel,
  rankEstimateCommandSignature,
  rankEstimateExpired,
  rankEstimateFeedback,
  rankEstimateIdempotencyCommand,
  rankEstimateInput,
  rankEstimatesApiPath
} from "../lib/rank-estimates";
import {
  parseRankJobSummary,
  rankJobApiPath,
  rankJobCreateFeedback,
  rankRunIdempotencyCommand,
  rankRunInput,
  rankRunsApiPath
} from "../lib/rank-jobs";
import {
  readLastRankCredentialId,
  writeLastRankCredentialId
} from "../lib/rank-credential-preference";
import { SemanticModal } from "./semantic-modal";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SearchEngineLogo } from "./search-engine-logo";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection,
  type SemanticOperationScopeState
} from "./semantic-operation-scope";

export function SemanticPositionDialog({
  activeGroupId,
  groups,
  initialSelections,
  onClose,
  onStarted,
  projectId,
  workspaceId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  onClose: () => void;
  onStarted: (job: RankJobSummary) => void;
  projectId: string;
  workspaceId: string;
}>) {
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [connectorSettings, setConnectorSettings] =
    useState<ProjectConnectorSettings>();
  const [workspaceRouting, setWorkspaceRouting] =
    useState<WorkspaceConnectorRoutingSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [selectedContextId, setSelectedContextId] = useState("");
  const [lastUsedCredentialId, setLastUsedCredentialId] = useState<string>();
  const [assignedKeywordIds, setAssignedKeywordIds] = useState<
    ReadonlySet<string>
  >();
  const [assignedKeywordSelections, setAssignedKeywordSelections] = useState<
    readonly SemanticOperationSelection[] | undefined
  >(initialSelections);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();
  const [contextAssignmentError, setContextAssignmentError] = useState<string>();
  const [resolvingScope, setResolvingScope] = useState(false);
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(
    initialSelections
  );
  const [estimate, setEstimate] = useState<RankEstimate>();
  const [contextDraft, setContextDraft] = useState(defaultContextDraft);
  const createContextCommand = useRef<IdempotentCommand | undefined>(
    undefined
  );
  const estimateCommand = useRef<IdempotentCommand | undefined>(undefined);
  const assignmentCommand = useRef<IdempotentCommand | undefined>(undefined);
  const runCommand = useRef<IdempotentCommand | undefined>(undefined);
  const pendingRun = useRef<PendingSemanticRankRun | undefined>(undefined);
  const initialSelectionsRef = useRef(initialSelections);
  const keywordIds = selections.map(({ id }) => id);
  const addedSinceLastRun =
    selectedContextId &&
    contextDraft.scopeMode === "GROUPS" &&
    assignedKeywordIds
      ? keywordIds.filter((keywordId) => !assignedKeywordIds.has(keywordId)).length
      : 0;
  const sources = useMemo(
    () => connectorSettings && workspaceRouting
      ? effectiveProjectConnectorOptions(
          connectorSettings,
          workspaceRouting,
          "SERP_RANK_TRACKING"
        ).filter(
          (source) =>
            source.provider === "ARSENKIN" || source.provider === "XMLSTOCK"
        )
      : [],
    [connectorSettings, workspaceRouting]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider = selectedSource?.provider === "ARSENKIN"
    ? "ARSENKIN"
    : "XMLSTOCK";
  const resolveScope = useCallback((
    next: readonly SemanticOperationSelection[],
    resolving: boolean,
    nextError?: string
  ) => {
    setSelections(next);
    setResolvingScope(resolving);
    setScopeError(nextError);
  }, []);
  const resolveScopeState = useCallback(
    (scope: SemanticOperationScopeState) => {
      setContextDraft((current) => {
        const currentGroups = [...current.groupIds].sort().join(":");
        const nextGroups = [...scope.groupIds].sort().join(":");
        return current.scopeMode === scope.mode && currentGroups === nextGroups
          ? current
          : {
              ...current,
              scopeMode: scope.mode,
              groupIds: scope.groupIds
            };
      });
    },
    []
  );

  function selectContext(contextId: string): void {
    setSelectedContextId(contextId);
    const context = settings?.contexts.find(({ id }) => id === contextId);
    if (context) {
      setSelections([]);
      setAssignedKeywordIds(undefined);
      setAssignedKeywordSelections(undefined);
      setResolvingScope(true);
      setContextAssignmentError(undefined);
      setContextDraft(trackingContextDraft(context));
    } else {
      setSelections(initialSelectionsRef.current);
      setAssignedKeywordIds(undefined);
      setAssignedKeywordSelections(initialSelectionsRef.current);
      setResolvingScope(false);
      setScopeError(undefined);
      setContextAssignmentError(undefined);
      setContextDraft({
        ...defaultContextDraft(),
        scopeMode:
          initialSelections.length > 0
            ? "KEYWORDS"
            : activeGroupId
              ? "GROUPS"
              : "ALL",
        groupIds: activeGroupId ? [activeGroupId] : []
      });
    }
    setEstimate(undefined);
    pendingRun.current = undefined;
    estimateCommand.current = undefined;
    runCommand.current = undefined;
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      browserApiRequest<TrackingContextSettings>(
        `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
        { signal: controller.signal }
      ),
      browserApiRequest<ProjectConnectorSettings>(
        `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
        { signal: controller.signal }
      ),
      browserApiRequest<WorkspaceConnectorRoutingSettings>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
        { signal: controller.signal }
      ),
      browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
        rankRunsApiPath(projectId),
        { signal: controller.signal }
      )
    ])
      .then(([trackingResult, integrationResult, workspaceResult, rankRuns]) => {
        if (controller.signal.aborted) return;
        const options = effectiveProjectConnectorOptions(
          integrationResult,
          workspaceResult,
          "SERP_RANK_TRACKING"
        ).filter(
          (source) =>
            (source.provider === "ARSENKIN" || source.provider === "XMLSTOCK")
        );
        const previousJob = rankRuns.jobs[0];
        const previousProvider =
          previousJob?.provider === "ARSENKIN" ||
          previousJob?.provider === "XMLSTOCK"
            ? previousJob.provider
            : undefined;
        const exactCredentialId = readLastRankCredentialId(
          window.localStorage,
          projectId,
          options.map(({ id }) => id)
        );
        const preferredSource =
          options.find(({ id }) => id === exactCredentialId) ??
          options.find(({ provider: value }) => value === previousProvider) ??
          options.find(({ provider: value }) => value === "XMLSTOCK") ??
          options[0];
        const previousContext =
          initialSelections.length === 0 && !activeGroupId
            ? trackingResult.contexts.find(
                ({ id, status }) =>
                  id === previousJob?.trackingContextId && status === "ACTIVE"
              )
            : undefined;
        setSettings(trackingResult);
        setConnectorSettings(integrationResult);
        setWorkspaceRouting(workspaceResult);
        setCredentialId(preferredSource?.id ?? "");
        setLastUsedCredentialId(exactCredentialId);
        if (previousContext) {
          setSelectedContextId(previousContext.id);
          setContextDraft(trackingContextDraft(previousContext));
        } else {
          setContextDraft((current) => ({
            ...current,
            scopeMode:
              initialSelections.length > 0
                ? "KEYWORDS"
                : activeGroupId
                  ? "GROUPS"
                  : "ALL",
            groupIds: activeGroupId ? [activeGroupId] : []
          }));
        }
        if (preferredSource?.provider === "ARSENKIN") {
          setContextDraft((current) => ({ ...current, depth: 30 }));
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(positionErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [activeGroupId, initialSelections.length, projectId, workspaceId]);

  useEffect(() => {
    if (!selectedContextId) {
      setAssignedKeywordIds(undefined);
      setAssignedKeywordSelections(initialSelectionsRef.current);
      setContextAssignmentError(undefined);
      return;
    }
    const controller = new AbortController();
    setSelections([]);
    setAssignedKeywordIds(undefined);
    setAssignedKeywordSelections(undefined);
    setResolvingScope(true);
    setScopeError(undefined);
    setContextAssignmentError(undefined);
    void loadAssignedKeywordSelections(
      projectId,
      selectedContextId,
      controller.signal
    )
      .then((assigned) => {
        if (controller.signal.aborted) return;
        setAssignedKeywordIds(new Set(assigned.map(({ id }) => id)));
        setAssignedKeywordSelections(assigned);
        setContextAssignmentError(undefined);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setAssignedKeywordIds(new Set());
        setAssignedKeywordSelections([]);
        setResolvingScope(false);
        setContextAssignmentError(
          loadError instanceof Error
            ? loadError.message
            : "Не удалось загрузить запросы сохранённого контекста."
        );
      });
    return () => controller.abort();
  }, [projectId, selectedContextId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (running) return;
    let stage: "PREPARE" | "ESTIMATE" | "RUN" = "PREPARE";
    setRunning(true);
    setError(undefined);
    setEstimate(undefined);
    try {
      if (!connectorSettings || !selectedSource) {
        throw new Error(
          "Нет активного подключения XMLStock или Arsenkin для съёма позиций."
        );
      }
      if (!contextDraft.regionCode.trim()) {
        throw new Error("Выберите регион перед запуском съёма позиций.");
      }
      const draftErrors = validateTrackingContextDraft(contextDraft);
      const firstError = Object.values(draftErrors)[0];
      if (firstError) throw new Error(firstError);
      const contextName =
        contextDraft.name.trim() || technicalContextName(contextDraft);
      const launchDraft = {
        ...contextDraft,
        name: contextName
      };
      let selectedContext = selectedContextId
        ? settings?.contexts.find(
            ({ id, status }) => id === selectedContextId && status === "ACTIVE"
          )
        : matchingTechnicalContext(settings, launchDraft);
      if (selectedContext) {
        const authoritative = await browserApiRequest<TrackingContextSummary>(
          trackingContextApiPath(projectId, selectedContext.id)
        );
        selectedContext = trackingContextDraftDirty(authoritative, launchDraft)
          ? await browserApiRequest<TrackingContextSummary>(
              trackingContextApiPath(projectId, authoritative.id),
              {
                method: "PATCH",
                ifMatch: authoritative.version,
                body: trackingContextCreateInput(launchDraft)
              }
            )
          : authoritative;
        setSettings((current) =>
          current ? withTrackingContext(current, selectedContext!) : current
        );
      }
      if (!selectedContext && settings?.access.canConfigure) {
        const signature = trackingContextPayloadSignature(launchDraft);
        createContextCommand.current = stableIdempotencyCommand(
          createContextCommand.current,
          signature,
          () => `semantic-tracking-context:${crypto.randomUUID()}`
        );
        const receipt = await browserApiRequest<TrackingContextSummary>(
          `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts`,
          {
            method: "POST",
            idempotencyKey: createContextCommand.current.key,
            body: trackingContextCreateInput(launchDraft)
          }
        );
        const authoritative = await browserApiRequest<TrackingContextSummary>(
          trackingContextApiPath(projectId, receipt.id)
        );
        const createdContext = reconcileTrackingContextCreate(
          receipt,
          authoritative
        ).current;
        createContextCommand.current = undefined;
        selectedContext = createdContext;
        setSelectedContextId(createdContext.id);
        setSettings((current) =>
          current ? withTrackingContext(current, createdContext) : current
        );
      } else if (!selectedContext) {
        throw new Error("Недостаточно прав для подготовки параметров съёма позиций.");
      }
      if (!trackingContextMatchesDraft(selectedContext, launchDraft)) {
        createContextCommand.current = undefined;
        throw new Error(
          "Параметры профиля изменились параллельно. Съём не запущен; повторите попытку с актуальными настройками."
        );
      }
      const assignmentSignature = JSON.stringify({
        contextId: selectedContext.id,
        version: selectedContext.version,
        keywordIds: [...keywordIds].sort()
      });
      assignmentCommand.current = stableIdempotencyCommand(
        assignmentCommand.current,
        assignmentSignature,
        () => `semantic-tracking-scope:${crypto.randomUUID()}`
      );
      const replacement = await synchronizeContextAssignments(
        projectId,
        selectedContext.id,
        selectedContext.version,
        keywordIds,
        assignmentCommand.current.key
      );
      assignmentCommand.current = undefined;
      selectedContext = {
        ...selectedContext,
        assignedKeywordCount: replacement.assignedKeywordCount,
        version: replacement.version
      };
      setSettings((current) =>
        current ? withTrackingContext(current, selectedContext!) : current
      );
      const launchContext = {
        ...selectedContext,
        assignedKeywordCount: replacement.assignedKeywordCount
      };
      const contextSignature = rankEstimateCommandSignature(
        launchContext,
        provider,
        selectedSource.id,
        contextDraft.searchSource
      );
      let reusableRun = pendingRun.current;
      if (
        reusableRun?.contextSignature !== contextSignature ||
        (reusableRun &&
          rankEstimateExpired(reusableRun.estimate.expiresAt, Date.now()))
      ) {
        reusableRun = undefined;
        pendingRun.current = undefined;
        runCommand.current = undefined;
      }

      let nextEstimate = reusableRun?.estimate;
      if (!nextEstimate) {
        stage = "ESTIMATE";
        estimateCommand.current = rankEstimateIdempotencyCommand(
          estimateCommand.current,
          launchContext,
          false,
          () => `rank-estimate:${crypto.randomUUID()}`,
          provider,
          selectedSource.id,
          contextDraft.searchSource
        );
        const estimatePayload = await browserApiRequest<unknown>(
          rankEstimatesApiPath(projectId),
          {
            method: "POST",
            body: rankEstimateInput(
              selectedContext.id,
              provider,
              selectedSource.id,
              contextDraft.searchSource
            ),
            idempotencyKey: estimateCommand.current.key
          }
        );
        nextEstimate = parseRankEstimate(estimatePayload, {
          projectId,
          trackingContextId: selectedContext.id
        });
        estimateCommand.current = undefined;
        if (
          nextEstimate.scope.contextVersion !== selectedContext.version ||
          nextEstimate.scope.configurationVersion !==
            selectedContext.configuration.configurationVersion ||
          nextEstimate.scope.keywordCount !== String(keywordIds.length)
        ) {
          throw new BrowserApiError(
            409,
            "RESOURCE_STATE_CONFLICT",
            "Tracking context changed while preparing the rank run"
          );
        }
        setEstimate(nextEstimate);
        if (
          nextEstimate.status !== "READY" ||
          !nextEstimate.executionAllowed
        ) {
          pendingRun.current = undefined;
          runCommand.current = undefined;
          return;
        }
        reusableRun = {
          context: launchContext,
          contextSignature,
          estimate: nextEstimate
        };
        pendingRun.current = reusableRun;
      } else {
        setEstimate(nextEstimate);
      }

      if (!reusableRun) {
        throw new Error(
          "Не удалось зафиксировать безопасную команду запуска. Рассчитайте съём заново."
        );
      }

      stage = "RUN";
      runCommand.current = rankRunIdempotencyCommand(
        runCommand.current,
        nextEstimate.id,
        () => `rank-run:${crypto.randomUUID()}`
      );
      const jobPayload = await browserApiRequest<unknown>(
        rankRunsApiPath(projectId),
        {
          method: "POST",
          body: rankRunInput(nextEstimate.id),
          idempotencyKey: runCommand.current.key
        }
      );
      const job = parseRankJobSummary(jobPayload, {
        workspaceId: reusableRun.context.workspaceId,
        projectId,
        trackingContextId: reusableRun.context.id
      });
      pendingRun.current = undefined;
      runCommand.current = undefined;
      rememberCredential(projectId, selectedSource.id, setLastUsedCredentialId);
      onStarted(job);
    } catch (requestError) {
      if (stage === "ESTIMATE") {
        const feedback = rankEstimateFeedback(
          requestError,
          navigator.onLine
        );
        if (!feedback.retryable || feedback.kind === "conflict") {
          estimateCommand.current = undefined;
        }
        setError(feedbackMessage(feedback.message, feedback.requestId));
      } else if (stage === "RUN") {
        const feedback = rankJobCreateFeedback(
          requestError,
          navigator.onLine
        );
        if (
          feedback.action === "ATTACH_EXISTING" &&
          feedback.attachJobId &&
          pendingRun.current
        ) {
          try {
            const current = pendingRun.current;
            const jobPayload = await browserApiRequest<unknown>(
              rankJobApiPath(projectId, feedback.attachJobId)
            );
            const job = parseRankJobSummary(jobPayload, {
              workspaceId: current.context.workspaceId,
              projectId,
              trackingContextId: current.context.id,
              jobId: feedback.attachJobId
            });
            pendingRun.current = undefined;
            runCommand.current = undefined;
            if (selectedSource) {
              rememberCredential(
                projectId,
                selectedSource.id,
                setLastUsedCredentialId
              );
            }
            onStarted(job);
            return;
          } catch {
            setError(
              `${feedbackMessage(feedback.message, feedback.requestId)} Не удалось получить подтверждённый статус уже запущенной задачи; повторите эту же команду.`
            );
          }
        } else {
          if (
            feedback.action === "RECALCULATE" ||
            feedback.action === "NONE"
          ) {
            pendingRun.current = undefined;
            runCommand.current = undefined;
            estimateCommand.current = undefined;
          }
          setError(feedbackMessage(feedback.message, feedback.requestId));
        }
      } else {
        setError(positionErrorMessage(requestError));
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      onClose={running ? () => undefined : onClose}
      size="large"
      title="Проверка позиций"
    >
      <form className="semantic-position-dialog semantic-workflow-dialog" onSubmit={(event) => void submit(event)}>
        {loading ? (
          <div className="semantic-dialog-loading" role="status">Проверяем доступные подключения…</div>
        ) : (
          <>
            <PositionContextSelector
              contexts={settings?.contexts ?? []}
              draft={contextDraft}
              onDraftChange={setContextDraft}
              onSelect={selectContext}
              projectId={projectId}
              selectedContextId={selectedContextId}
            />
            <PositionRunParameters
              draft={contextDraft}
              onChange={setContextDraft}
              keywordCount={keywordIds.length}
              credentialId={credentialId}
              lastUsedCredentialId={lastUsedCredentialId}
              sources={sources}
              onCredentialChange={(nextCredentialId) => {
                const next = sources.find(({ id }) => id === nextCredentialId);
                setCredentialId(nextCredentialId);
                setContextDraft((current) => ({
                  ...current,
                  ...(current.searchEngine === "GOOGLE"
                    ? { searchSource: "LIVE" as const }
                    : {}),
                  ...(next?.provider === "ARSENKIN" &&
                  current.searchEngine === "YANDEX"
                    ? { depth: 30 as const }
                    : {})
                }));
                setEstimate(undefined);
                pendingRun.current = undefined;
                estimateCommand.current = undefined;
                runCommand.current = undefined;
              }}
              onSearchSourceChange={(source) => {
                setContextDraft((current) => ({
                  ...current,
                  searchSource: source
                }));
                setEstimate(undefined);
                pendingRun.current = undefined;
                estimateCommand.current = undefined;
                runCommand.current = undefined;
              }}
              searchSource={contextDraft.searchSource}
              scope={selectedContextId && assignedKeywordSelections === undefined ? (
                <div className="semantic-dialog-loading" role="status">
                  Загружаем запросы сохранённого контекста…
                </div>
              ) : (
                <SemanticOperationScope
                  activeGroupId={activeGroupId}
                  groups={groups}
                  initialScope={{
                    mode: contextDraft.scopeMode,
                    groupIds: contextDraft.groupIds
                  }}
                  initialSelections={
                    selectedContextId
                      ? assignedKeywordSelections ?? []
                      : initialSelections
                  }
                  key={`${selectedContextId || "new-context"}:ready`}
                  maxItems={rankProviderKeywordLimit}
                  onChange={resolveScope}
                  onScopeChange={resolveScopeState}
                  projectId={projectId}
                />
              )}
            />
          </>
        )}
        {(estimate?.status === "BLOCKED" || error || scopeError || contextAssignmentError || addedSinceLastRun > 0) && <div className="semantic-workflow-feedback">
          {addedSinceLastRun > 0 && (
            <div className="inline-alert warning" role="status">
              После прошлого запуска в выбранных папках появилось новых
              запросов: <strong>{addedSinceLastRun}</strong>. Они будут включены
              в этот съём после подтверждения запуска.
            </div>
          )}
          {estimate?.status === "BLOCKED" && (
            <div className="inline-alert warning" role="alert">
              <strong>Запуск заблокирован</strong>
              <ul>{estimate.blockers.map(({ code }) => <li key={code}>{rankEstimateBlockerLabel(code)}</li>)}</ul>
            </div>
          )}
          {error && <div className="inline-alert danger" role="alert">{error}</div>}
          {contextAssignmentError && <div className="inline-alert danger" role="alert">{contextAssignmentError}</div>}
          {scopeError && <div className="inline-alert warning" role="alert">{scopeError}</div>}
        </div>}
        <div className="semantic-modal-actions semantic-workflow-footer">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
          <button
            className="primary-button"
            disabled={
              loading ||
              resolvingScope ||
              running ||
              keywordIds.length === 0 ||
              !contextDraft.regionCode.trim() ||
              !settings ||
              !connectorSettings ||
              !selectedSource
            }
            type="submit"
          >
            {resolvingScope
              ? "Загружаем запросы…"
              : running
              ? "Проверяем и запускаем…"
              : `Запустить съём (${keywordIds.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );

}

function PositionContextSelector({
  contexts,
  draft,
  onDraftChange,
  onSelect,
  projectId,
  selectedContextId
}: Readonly<{
  contexts: readonly TrackingContextSummary[];
  draft: TrackingContextDraft;
  onDraftChange: (draft: TrackingContextDraft) => void;
  onSelect: (contextId: string) => void;
  projectId: string;
  selectedContextId: string;
}>) {
  return (
    <section className="semantic-position-context-bar">
      <div>
        <span className="semantic-position-context-icon">
          <Icon name="positions" />
        </span>
        <div>
          <strong>Контекст съёма</strong>
          <small>
            Хранит папки, поисковик, регион, устройство и глубину проверки.
          </small>
        </div>
      </div>
      <label>
        <span>Сохранённый контекст</span>
        <CustomSelect
          onChange={(event) => onSelect(event.target.value)}
          value={selectedContextId}
        >
          <option value="">Новый контекст</option>
          {contexts
            .filter(({ status }) => status === "ACTIVE")
            .map((context) => (
              <option key={context.id} value={context.id}>
                {context.name} · {context.assignedKeywordCount} запросов
              </option>
            ))}
        </CustomSelect>
      </label>
      <label>
        <span>Название</span>
        <input
          maxLength={160}
          onChange={(event) =>
            onDraftChange({ ...draft, name: event.target.value })
          }
          placeholder="Например, Москва · десктоп"
          value={draft.name}
        />
      </label>
      <a
        className="semantic-dialog-link"
        href={`/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`}
      >
        Управлять контекстами
      </a>
    </section>
  );
}

function PositionRunParameters({
  draft,
  onChange,
  keywordCount,
  credentialId,
  lastUsedCredentialId,
  sources,
  onCredentialChange,
  searchSource,
  onSearchSourceChange,
  scope
}: Readonly<{
  draft: TrackingContextDraft;
  onChange: (draft: TrackingContextDraft) => void;
  keywordCount: number;
  credentialId: string;
  lastUsedCredentialId: string | undefined;
  sources: readonly ProjectConnectorCredentialOption[];
  onCredentialChange: (credentialId: string) => void;
  searchSource: "SEARCH_API" | "LIVE";
  onSearchSourceChange: (source: "SEARCH_API" | "LIVE") => void;
  scope: ReactNode;
}>) {
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider = selectedSource?.provider === "ARSENKIN"
    ? "ARSENKIN"
    : "XMLSTOCK";
  const providerUsage = rankProviderUsageEstimate(
    selectedSource,
    keywordCount,
    draft.searchEngine,
    draft.depth,
    searchSource
  );
  const depthOptions: readonly TrackingContextDraft["depth"][] =
    draft.searchEngine === "YANDEX" && provider === "ARSENKIN"
      ? [30]
      : [30, 50, 100];

  function selectSearchEngine(
    searchEngine: TrackingContextDraft["searchEngine"]
  ): void {
    onChange({
      ...draft,
      countryCode: "RU",
      depth:
        searchEngine === "YANDEX" && provider === "ARSENKIN"
          ? 30
          : draft.depth,
      language: "ru",
      searchEngine,
      regionCode: "",
      regionLabel: "",
      name: `${searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ${draft.device === "MOBILE" ? "Мобильное" : "Десктоп"}`
    });
    onSearchSourceChange("LIVE");
  }

  return (
    <>
      <div className="semantic-workflow-grid semantic-position-workflow-grid">
        <section className="semantic-workflow-panel semantic-position-source-panel">
          <header>
            <h3>Поисковые системы</h3>
            <p>Выберите поисковик, тип выдачи и подключение провайдера.</p>
          </header>
          <div aria-label="Поисковая система" className="semantic-engine-cards" role="group">
            {(["YANDEX", "GOOGLE"] as const).map((engine) => (
              <button
                aria-pressed={draft.searchEngine === engine}
                className={draft.searchEngine === engine ? "selected" : undefined}
                key={engine}
                onClick={() => selectSearchEngine(engine)}
                type="button"
              >
                <SearchEngineLogo engine={engine} />
                <span>{engine === "YANDEX" ? "Яндекс" : "Google"}</span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>
          <label className="semantic-workflow-field">
            <span>Источник выдачи</span>
            <CustomSelect
              onChange={(event) =>
                onSearchSourceChange(
                  event.target.value as "SEARCH_API" | "LIVE"
                )
              }
              value={searchSource}
            >
              {draft.searchEngine === "YANDEX" && (
                <option value="SEARCH_API">Яндекс XML / Search API</option>
              )}
              <option value="LIVE">
                {draft.searchEngine === "YANDEX" ? "Яндекс Live" : "Google Live"}
              </option>
            </CustomSelect>
          </label>
          <div className="semantic-provider-field">
            <h4>Источник данных</h4>
          {sources.length ? (
            <div
              aria-label="Источник съёма позиций"
              className="semantic-provider-list"
              role="radiogroup"
            >
              {sources.map((source) => (
                <button
                  aria-checked={source.id === credentialId}
                  className={`semantic-provider-card ${source.id === credentialId ? "selected" : ""}`}
                  key={source.id}
                  onClick={() => onCredentialChange(source.id)}
                  role="radio"
                  type="button"
                >
                  <ProviderLogo provider={source.provider} />
                  <span className="semantic-provider-card-copy">
                    <strong>{integrationProviderLabel(source.provider)}</strong>
                    <small>{source.label} · ваш API</small>
                    <b>
                      Подключено
                      {source.id === lastUsedCredentialId
                        ? " · использовался в прошлый раз"
                        : ""}
                    </b>
                  </span>
                  <i aria-hidden="true" className="semantic-provider-radio" />
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-alert warning">
              Нет проверенного подключения для съёма позиций.
            </div>
          )}
          </div>
          <a className="semantic-dialog-link" href="/app/settings/integrations">Управление подключениями</a>
        </section>
        <section className="semantic-workflow-panel semantic-position-geo-panel">
          <header>
            <h3>География и устройство</h3>
            <p>Эти параметры формируют отдельную историю позиций.</p>
          </header>
          <label className="semantic-workflow-field">
            <span>Регион</span>
            <SearchableRegionSelect
              kind={draft.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
              onChange={({ code, label }) => onChange({
                ...draft,
                name: `${draft.searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ${label} · ${draft.device === "MOBILE" ? "Мобильное" : "Десктоп"}`,
                regionCode: code,
                regionLabel: label
              })}
              value={draft.regionCode}
            />
          </label>
          <fieldset className="semantic-device-cards">
            <legend>Устройство</legend>
            <div>
              {(["DESKTOP", "MOBILE"] as const).map((device) => (
                <label className={draft.device === device ? "selected" : undefined} key={device}>
                  <input
                    checked={draft.device === device}
                    onChange={() => onChange({ ...draft, device })}
                    type="radio"
                  />
                  <Icon name={device === "DESKTOP" ? "dashboard" : "pages"} />
                  <span>{device === "DESKTOP" ? "Десктоп" : "Мобильное"}</span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="semantic-segmented-field semantic-depth-field">
            <legend>Глубина проверки</legend>
            <div className="semantic-segmented-control" role="radiogroup" aria-label="Глубина проверки">
              {depthOptions.map((depth) => (
                <label className={draft.depth === depth ? "selected" : undefined} key={depth}>
                  <input
                    checked={draft.depth === depth}
                    onChange={() => onChange({ ...draft, depth })}
                    type="radio"
                  />
                  <span>Топ-{depth}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="semantic-position-compact-fields">
            <label className="semantic-workflow-field">
              <span>Страна</span>
              <CustomSelect
                onChange={(event) =>
                  onChange({ ...draft, countryCode: event.target.value })
                }
                value={draft.countryCode}
              >
                <option value="RU">Россия · RU</option>
              </CustomSelect>
            </label>
            <label className="semantic-workflow-field">
              <span>Язык выдачи</span>
              <CustomSelect
                disabled={draft.searchEngine === "YANDEX"}
                onChange={(event) =>
                  onChange({ ...draft, language: event.target.value })
                }
                value={draft.language}
              >
                <option value="ru">Русский · ru</option>
                {draft.searchEngine === "GOOGLE" && (
                  <option value="en">English · en</option>
                )}
              </CustomSelect>
            </label>
          </div>
          {!draft.regionCode.trim() && (
            <div className="inline-alert warning" role="alert">
              Выберите регион — без него съём позиций запустить нельзя.
            </div>
          )}
          {draft.searchEngine === "YANDEX" && provider === "ARSENKIN" && (
            <div className="inline-alert info" role="status">
              Arsenkin для Яндекса выполняет съём с глубиной Топ-30. При
              выборе этого подключения глубина переключается автоматически.
            </div>
          )}
        </section>
        <section className="semantic-workflow-panel semantic-position-scope-panel">
          <header>
            <h3>Охват проверки</h3>
            <p>Выберите все запросы, текущее выделение или папки.</p>
          </header>
          {scope}
        </section>
      </div>
      <dl className="semantic-dialog-estimate">
        <div><Icon name="semantic" /><div><dt>Запросов</dt><dd>{keywordCount}</dd></div></div>
        <div>
          <SearchEngineLogo engine={draft.searchEngine} size="compact" />
          <div><dt>Поисковик</dt><dd>{draft.searchEngine === "YANDEX" ? "Яндекс" : "Google"}</dd></div>
        </div>
        <div>
          <ProviderLogo provider={provider} size="compact" />
          <div><dt>Провайдер</dt><dd>{selectedSource?.label ?? integrationProviderLabel(provider)}</dd></div>
        </div>
        <div><Icon name="frequency" /><div><dt>Расход</dt><dd>{providerUsage.usage}</dd></div></div>
        <div><Icon name="checkDouble" /><div><dt>Доступно</dt><dd>{providerUsage.available}</dd></div></div>
      </dl>
    </>
  );
}

function defaultContextDraft(): TrackingContextDraft {
  return {
    ...emptyTrackingContextDraft(),
    name: "Яндекс · Москва · Десктоп",
    searchEngine: "YANDEX",
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP",
    depth: 50
  };
}

function matchingTechnicalContext(
  settings: TrackingContextSettings | undefined,
  draft: TrackingContextDraft
): TrackingContextSummary | undefined {
  return settings?.contexts.find((context) =>
    context.status === "ACTIVE" &&
    trackingContextMatchesDraft(context, draft)
  );
}

function technicalContextName(
  draft: TrackingContextDraft
): string {
  const engine = draft.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const region = draft.regionLabel.trim() || draft.regionCode.trim() || draft.countryCode.toUpperCase();
  const device = draft.device === "MOBILE" ? "Мобайл" : "Десктоп";
  return `Авто · ${engine} · ${region} · ${device}`.slice(0, 160);
}

async function synchronizeContextAssignments(
  projectId: string,
  contextId: string,
  version: number,
  keywordIds: readonly string[],
  idempotencyKey: string
): Promise<TrackingContextKeywordReplacementResult> {
  const result = await browserApiRequest<TrackingContextKeywordReplacementResult>(
    `/app/api/projects/${encodeURIComponent(projectId)}/tracking-contexts/${encodeURIComponent(contextId)}/keywords`,
    {
      method: "PUT",
      ifMatch: version,
      idempotencyKey,
      body: { keywordIds }
    }
  );
  const localHash = await keywordSetHash(keywordIds);
  if (
    result.contextId !== contextId ||
    result.assignedKeywordCount !== keywordIds.length ||
    result.keywordSetHash.algorithm !== "SHA_256" ||
    result.keywordSetHash.value !== localHash
  ) {
    throw new BrowserApiError(
      502,
      "INVALID_RESPONSE",
      "Tracking context replacement returned an invalid scope proof"
    );
  }
  return result;
}

async function loadAssignedKeywordSelections(
  projectId: string,
  contextId: string,
  signal: AbortSignal
): Promise<readonly SemanticOperationSelection[]> {
  const selections = new Map<string, SemanticOperationSelection>();
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "200" });
    if (cursor) query.set("cursor", cursor);
    const page = await browserApiCollectionRequest<{
      readonly keywordId: string;
      readonly keywordVersion: number;
      readonly textOriginal: string;
    }>(
      `${trackingContextApiPath(projectId, contextId)}/keywords?${query.toString()}`,
      { signal }
    );
    for (const assignment of page.data) {
      selections.set(assignment.keywordId, {
        id: assignment.keywordId,
        version: assignment.keywordVersion,
        label: assignment.textOriginal
      });
    }
    cursor = page.page.hasNext ? page.page.nextCursor : undefined;
  } while (cursor);
  return [...selections.values()];
}

function rememberCredential(
  projectId: string,
  credentialId: string,
  setLastUsedCredentialId: (credentialId: string) => void
): void {
  writeLastRankCredentialId(window.localStorage, projectId, credentialId);
  setLastUsedCredentialId(credentialId);
}

async function keywordSetHash(keywordIds: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...keywordIds].sort().join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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

function feedbackMessage(
  message: string,
  requestId: string | undefined
): string {
  return requestId ? `${message} Код запроса: ${requestId}.` : message;
}

interface PendingSemanticRankRun {
  readonly context: TrackingContextSummary;
  readonly contextSignature: string;
  readonly estimate: RankEstimate;
}
