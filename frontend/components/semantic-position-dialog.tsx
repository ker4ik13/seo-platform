"use client";

import { CustomSelect } from "./custom-select";

import {
  useCallback,
  useEffect,
  useId,
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
import {
  rankProviderKeywordLimit,
  trackingContextKeywordPageLimit
} from "@seo-platform/contracts";
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
import {
  defaultSemanticSearchRegions,
  pairedSemanticSearchRegions,
  projectSemanticSearchRegions,
  readStoredSemanticRegion,
  searchRegionKind,
  writeLastSemanticRegion,
  type SemanticSearchEngine,
  type SemanticSearchRegions
} from "../lib/semantic-region-preference";
import type { ProjectSearchCity } from "@seo-platform/contracts";
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
  mode = "positions",
  onClose,
  onStarted,
  projectSearchCity,
  projectId,
  workspaceId
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticOperationGroup[];
  initialSelections: readonly SemanticOperationSelection[];
  mode?: "positions" | "competitors";
  onClose: () => void;
  onStarted: (job: RankJobSummary) => void;
  projectSearchCity?: ProjectSearchCity | undefined;
  projectId: string;
  workspaceId: string;
}>) {
  const competitorMode = mode === "competitors";
  const formId = useId();
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
  const [scopeCount, setScopeCount] = useState<number | undefined>(
    initialSelections.length
  );
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(
    initialSelections
  );
  const [estimate, setEstimate] = useState<RankEstimate>();
  const [preferredRegions, setPreferredRegions] = useState(
    defaultSemanticSearchRegions
  );
  const [preferredRegionSources, setPreferredRegionSources] = useState<
    SemanticRegionSources
  >({ YANDEX: "DEFAULT", GOOGLE: "DEFAULT" });
  const [contextDraft, setContextDraft] = useState(() =>
    defaultContextDraft(undefined, competitorMode)
  );
  const [yandexLiveTurbo, setYandexLiveTurbo] = useState(false);
  const [saveProjectPosition, setSaveProjectPosition] = useState(false);
  const createContextCommand = useRef<IdempotentCommand | undefined>(
    undefined
  );
  const estimateCommand = useRef<IdempotentCommand | undefined>(undefined);
  const assignmentCommand = useRef<IdempotentCommand | undefined>(undefined);
  const runCommand = useRef<IdempotentCommand | undefined>(undefined);
  const pendingRun = useRef<PendingSemanticRankRun | undefined>(undefined);
  const initialSelectionsRef = useRef(initialSelections);
  const assignmentKeywordIds = selections.map(({ id }) => id);
  const keywordIds = selections
    .filter(({ isTracked }) => contextDraft.includeUntracked || isTracked !== false)
    .map(({ id }) => id);
  const displayedKeywordCount = resolvingScope
    ? scopeCount ?? selections.length
    : keywordIds.length;
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
  const providerUsage = rankProviderUsageEstimate(
    selectedSource,
    displayedKeywordCount,
    contextDraft.searchEngine,
    contextDraft.depth,
    contextDraft.searchSource,
    yandexLiveTurbo ? "TURBO" : undefined,
    competitorMode ? "COMPETITOR_SERP" : "POSITION_TRACKING"
  );
  const platformChargeConfirmation =
    estimate?.status === "READY" &&
    estimate.credentialMode === "PLATFORM_PAID" &&
    pendingRun.current?.estimate.id === estimate.id &&
    !rankEstimateExpired(estimate.expiresAt, Date.now())
      ? formatPlatformCharge(estimate.platformChargeMicro)
      : undefined;
  const resolveScope = useCallback((
    next: readonly SemanticOperationSelection[],
    resolving: boolean,
    nextError?: string
  ) => {
    setSelections(next);
    if (!resolving && !nextError) setScopeCount(next.length);
    setResolvingScope(resolving);
    setScopeError(nextError);
  }, []);
  const resolveScopeCount = useCallback((count: number | undefined) => {
    setScopeCount(count);
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
    setYandexLiveTurbo(false);
    setSelectedContextId(contextId);
    const context = settings?.contexts.find(({ id }) => id === contextId);
    if (context) {
      setSelections([]);
      setScopeCount(context.assignedKeywordCount);
      setAssignedKeywordIds(undefined);
      setAssignedKeywordSelections(undefined);
      setResolvingScope(true);
      setContextAssignmentError(undefined);
      setContextDraft(trackingContextDraft(context));
    } else {
      setSelections(initialSelectionsRef.current);
      setScopeCount(initialSelectionsRef.current.length);
      setAssignedKeywordIds(undefined);
      setAssignedKeywordSelections(initialSelectionsRef.current);
      setResolvingScope(false);
      setScopeError(undefined);
      setContextAssignmentError(undefined);
      setContextDraft({
        ...defaultContextDraft(preferredRegions.YANDEX, competitorMode),
        scopeMode:
          initialSelections.length > 0
            ? "KEYWORDS"
            : activeGroupId
              ? "GROUPS"
              : "ALL",
        groupIds: activeGroupId ? [activeGroupId] : []
      });
    }
    if (!pendingRun.current) setEstimate(undefined);
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
        const previousJob = rankRuns.jobs.find(({ purpose }) =>
          competitorMode
            ? purpose === "COMPETITOR_SERP"
            : (purpose ?? "POSITION_TRACKING") === "POSITION_TRACKING"
        );
        const lastSuccessfulJob = rankRuns.jobs.find(
          ({ purpose, status }) =>
            (status === "COMPLETED" || status === "PARTIALLY_COMPLETED") &&
            (competitorMode
              ? purpose === "COMPETITOR_SERP"
              : (purpose ?? "POSITION_TRACKING") === "POSITION_TRACKING")
        );
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
        const lastRunContext = trackingResult.contexts.find(
          ({ id, status }) =>
            id === lastSuccessfulJob?.trackingContextId && status === "ACTIVE"
        );
        const projectRegions = projectSemanticSearchRegions(projectSearchCity);
        const storedYandex = readStoredSemanticRegion(
          window.localStorage,
          projectId,
          "POSITIONS",
          "YANDEX_RANK"
        );
        const storedGoogle = readStoredSemanticRegion(
          window.localStorage,
          projectId,
          "POSITIONS",
          "GOOGLE_RANK"
        );
        let nextPreferredRegions: SemanticSearchRegions = {
          YANDEX:
            storedYandex ?? projectRegions?.YANDEX ??
            defaultSemanticSearchRegions().YANDEX,
          GOOGLE:
            storedGoogle ?? projectRegions?.GOOGLE ??
            defaultSemanticSearchRegions().GOOGLE
        };
        const nextPreferredRegionSources: SemanticRegionSources = {
          YANDEX: storedYandex
            ? "LAST_RUN"
            : projectRegions
              ? "PROJECT"
              : "DEFAULT",
          GOOGLE: storedGoogle
            ? "LAST_RUN"
            : projectRegions
              ? "PROJECT"
              : "DEFAULT"
        };
        if (lastRunContext) {
          const lastRunDraft = trackingContextDraft(lastRunContext);
          const lastRunRegion = {
            code: lastRunDraft.regionCode,
            label: lastRunDraft.regionLabel
          };
          const paired = pairedSemanticSearchRegions(
            searchRegionKind(lastRunDraft.searchEngine),
            lastRunRegion
          );
          if (paired) {
            nextPreferredRegions = paired;
            nextPreferredRegionSources.YANDEX = "LAST_RUN";
            nextPreferredRegionSources.GOOGLE = "LAST_RUN";
          } else {
            nextPreferredRegions = {
              ...nextPreferredRegions,
              [lastRunDraft.searchEngine]: lastRunRegion
            };
            nextPreferredRegionSources[lastRunDraft.searchEngine] = "LAST_RUN";
          }
          writeLastSemanticRegion(
            window.localStorage,
            projectId,
            "POSITIONS",
            searchRegionKind(lastRunDraft.searchEngine),
            lastRunDraft.regionCode
          );
        }
        const previousContext =
          initialSelections.length === 0 && !activeGroupId
            ? lastRunContext
            : undefined;
        setSettings(trackingResult);
        setConnectorSettings(integrationResult);
        setWorkspaceRouting(workspaceResult);
        setCredentialId(preferredSource?.id ?? "");
        setLastUsedCredentialId(exactCredentialId);
        setPreferredRegions(nextPreferredRegions);
        setPreferredRegionSources(nextPreferredRegionSources);
        if (previousContext) {
          setSelectedContextId(previousContext.id);
          setScopeCount(previousContext.assignedKeywordCount);
          setContextDraft(trackingContextDraft(previousContext));
        } else {
          setContextDraft((current) => ({
            ...contextDraftWithRegion(
              current,
              nextPreferredRegions[current.searchEngine],
              competitorMode
            ),
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
  }, [activeGroupId, competitorMode, initialSelections.length, projectId, projectSearchCity, workspaceId]);

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
          competitorMode
            ? "Нет активного подключения XMLStock или Arsenkin для сбора конкурентов."
            : "Нет активного подключения XMLStock или Arsenkin для съёма позиций."
        );
      }
      if (!contextDraft.regionCode.trim()) {
        throw new Error(
          competitorMode
            ? "Выберите регион перед запуском сбора конкурентов."
            : "Выберите регион перед запуском съёма позиций."
        );
      }
      const draftErrors = validateTrackingContextDraft(contextDraft);
      const firstError = Object.values(draftErrors)[0];
      if (firstError) throw new Error(firstError);
      const contextName =
        contextDraft.name.trim() || technicalContextName(contextDraft, competitorMode);
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
        throw new Error(
          competitorMode
            ? "Недостаточно прав для подготовки параметров сбора конкурентов."
            : "Недостаточно прав для подготовки параметров съёма позиций."
        );
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
        keywordIds: [...assignmentKeywordIds].sort()
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
        assignmentKeywordIds,
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
      const yandexLiveMode =
        yandexLiveTurbo &&
        provider === "XMLSTOCK" &&
        contextDraft.searchEngine === "YANDEX" &&
        contextDraft.searchSource === "LIVE"
          ? "TURBO" as const
          : undefined;
      const contextSignature = rankEstimateCommandSignature(
        launchContext,
        provider,
        selectedSource.id,
        contextDraft.searchSource,
        yandexLiveMode,
        competitorMode ? "COMPETITOR_SERP" : undefined,
        competitorMode ? saveProjectPosition : undefined
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
      let calculatedEstimate = false;
      if (!nextEstimate) {
        stage = "ESTIMATE";
        estimateCommand.current = rankEstimateIdempotencyCommand(
          estimateCommand.current,
          launchContext,
          false,
          () => `rank-estimate:${crypto.randomUUID()}`,
          provider,
          selectedSource.id,
          contextDraft.searchSource,
          yandexLiveMode,
          competitorMode ? "COMPETITOR_SERP" : undefined,
          competitorMode ? saveProjectPosition : undefined
        );
        const estimatePayload = await browserApiRequest<unknown>(
          rankEstimatesApiPath(projectId),
          {
            method: "POST",
            body: rankEstimateInput(
              selectedContext.id,
              provider,
              selectedSource.id,
              contextDraft.searchSource,
              yandexLiveMode,
              competitorMode ? "COMPETITOR_SERP" : undefined,
              competitorMode ? saveProjectPosition : undefined
            ),
            idempotencyKey: estimateCommand.current.key
          }
        );
        nextEstimate = parseRankEstimate(estimatePayload, {
          projectId,
          trackingContextId: selectedContext.id
        });
        calculatedEstimate = true;
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

      if (
        calculatedEstimate &&
        selectedSource.mode === "PLATFORM_PAID"
      ) {
        return;
      }

      stage = "RUN";
      runCommand.current = rankRunIdempotencyCommand(
        runCommand.current,
        nextEstimate.id,
        nextEstimate.platformChargeMicro,
        () => `rank-run:${crypto.randomUUID()}`
      );
      const jobPayload = await browserApiRequest<unknown>(
        rankRunsApiPath(projectId),
        {
          method: "POST",
          body: rankRunInput(
            nextEstimate.id,
            nextEstimate.platformChargeMicro
          ),
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
      rememberPositionRegion(projectId, contextDraft, setPreferredRegions);
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
            rememberPositionRegion(
              projectId,
              contextDraft,
              setPreferredRegions
            );
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
      {...(competitorMode
        ? {
            description:
              "Сохраняет Топ-10 обычной выдачи по каждому запросу. Arsenkin использует Check Top, XMLStock — выбранный тип выдачи."
          }
        : {})}
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="semantic" /><div><dt>Запросов</dt><dd>{scopeCount === undefined && resolvingScope ? "Считаем…" : displayedKeywordCount}</dd></div></div>
            <div>
              <SearchEngineLogo engine={contextDraft.searchEngine} size="compact" />
              <div><dt>Поисковик</dt><dd>{contextDraft.searchEngine === "YANDEX" ? "Яндекс" : "Google"}</dd></div>
            </div>
            <div>
              <ProviderLogo provider={provider} size="compact" />
              <div><dt>Провайдер</dt><dd>{selectedSource?.label ?? integrationProviderLabel(provider)}</dd></div>
            </div>
            <div><Icon name="frequency" /><div><dt>Расход</dt><dd>{platformChargeConfirmation ?? providerUsage.usage}</dd></div></div>
            <div><Icon name="checkDouble" /><div><dt>Доступно</dt><dd>{providerUsage.available}</dd></div></div>
          </dl>
          <div className="semantic-modal-actions">
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
              form={formId}
              type="submit"
            >
              {resolvingScope
                ? "Загружаем запросы…"
                : running
                ? competitorMode ? "Готовим сбор…" : "Проверяем и запускаем…"
                : platformChargeConfirmation
                ? `Подтвердить списание ${platformChargeConfirmation}`
                : competitorMode
                  ? `Собрать конкурентов (${keywordIds.length})`
                  : `Запустить съём (${keywordIds.length})`}
            </button>
          </div>
        </div>
      )}
      onClose={running ? () => undefined : onClose}
      presenceKey={competitorMode
        ? "semantic-modal:competitors"
        : "semantic-modal:positions"}
      size="large"
      title={competitorMode ? "Сбор конкурентов" : "Проверка позиций"}
    >
      <form className="semantic-position-dialog semantic-workflow-dialog" id={formId} onSubmit={(event) => void submit(event)}>
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
              competitorMode={competitorMode}
            />
            <PositionRunParameters
              draft={contextDraft}
              competitorMode={competitorMode}
              onChange={setContextDraft}
              credentialId={credentialId}
              lastUsedCredentialId={lastUsedCredentialId}
              yandexLiveTurbo={yandexLiveTurbo}
              sources={sources}
              onCredentialChange={(nextCredentialId) => {
                const next = sources.find(({ id }) => id === nextCredentialId);
                setCredentialId(nextCredentialId);
                setYandexLiveTurbo(false);
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
                setYandexLiveTurbo(false);
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
              onYandexLiveTurboChange={(enabled) => {
                setYandexLiveTurbo(enabled);
                setEstimate(undefined);
                pendingRun.current = undefined;
                estimateCommand.current = undefined;
                runCommand.current = undefined;
              }}
              preferredRegions={preferredRegions}
              preferredRegionSources={preferredRegionSources}
              saveProjectPosition={saveProjectPosition}
              onSaveProjectPositionChange={(enabled) => {
                setSaveProjectPosition(enabled);
                setEstimate(undefined);
                pendingRun.current = undefined;
                estimateCommand.current = undefined;
                runCommand.current = undefined;
              }}
              scope={selectedContextId &&
              contextDraft.scopeMode === "KEYWORDS" &&
              assignedKeywordSelections === undefined ? (
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
                  onCountChange={resolveScopeCount}
                  onScopeChange={resolveScopeState}
                  projectId={projectId}
                />
              )}
            />
          </>
        )}
        {(platformChargeConfirmation || estimate?.status === "BLOCKED" || error || scopeError || contextAssignmentError || addedSinceLastRun > 0) && <div className="semantic-workflow-feedback">
          {platformChargeConfirmation && (
            <div className="inline-alert info" role="status">
              <strong>Подтвердите списание</strong>
              <p>
                За этот съём будет списано ровно {platformChargeConfirmation} из
                внутренних токенов workspace. Расчёт действует до истечения
                показанной оценки; запуск произойдёт только после повторного
                подтверждения.
              </p>
            </div>
          )}
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
      </form>
    </SemanticModal>
  );

}

function PositionContextSelector({
  competitorMode,
  contexts,
  draft,
  onDraftChange,
  onSelect,
  projectId,
  selectedContextId
}: Readonly<{
  competitorMode: boolean;
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
          <Icon name={competitorMode ? "competitors" : "positions"} />
        </span>
        <div>
          <strong>{competitorMode ? "Контекст выдачи" : "Контекст съёма"}</strong>
          <small>
            {competitorMode
              ? "Хранит папки, поисковик, регион и устройство для Топ-10."
              : "Хранит папки, поисковик, регион, устройство и глубину проверки."}
          </small>
        </div>
      </div>
      <label>
        <span>Сохранённый контекст</span>
        <CustomSelect
          onChange={(event) => onSelect(event.target.value)}
          value={selectedContextId}
        >
          <option value="">
            {competitorMode ? "Новый контекст конкурентов" : "Новый контекст"}
          </option>
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
          placeholder={competitorMode
            ? "Например, Конкуренты · Москва"
            : "Например, Москва · десктоп"}
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
  competitorMode,
  draft,
  onChange,
  credentialId,
  lastUsedCredentialId,
  yandexLiveTurbo,
  sources,
  onCredentialChange,
  searchSource,
  onSearchSourceChange,
  onYandexLiveTurboChange,
  preferredRegions,
  preferredRegionSources,
  saveProjectPosition,
  onSaveProjectPositionChange,
  scope
}: Readonly<{
  competitorMode: boolean;
  draft: TrackingContextDraft;
  onChange: (draft: TrackingContextDraft) => void;
  credentialId: string;
  lastUsedCredentialId: string | undefined;
  yandexLiveTurbo: boolean;
  sources: readonly ProjectConnectorCredentialOption[];
  onCredentialChange: (credentialId: string) => void;
  searchSource: "SEARCH_API" | "LIVE";
  onSearchSourceChange: (source: "SEARCH_API" | "LIVE") => void;
  onYandexLiveTurboChange: (enabled: boolean) => void;
  preferredRegions: SemanticSearchRegions;
  preferredRegionSources: SemanticRegionSources;
  saveProjectPosition: boolean;
  onSaveProjectPositionChange: (enabled: boolean) => void;
  scope: ReactNode;
}>) {
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider = selectedSource?.provider === "ARSENKIN"
    ? "ARSENKIN"
    : "XMLSTOCK";
  const depthOptions: readonly TrackingContextDraft["depth"][] =
    draft.searchEngine === "YANDEX" && provider === "ARSENKIN"
      ? [30]
      : [30, 50, 100];
  const preferredRegion = preferredRegions[draft.searchEngine];
  const regionSource =
    draft.regionCode === preferredRegion.code
      ? preferredRegionSources[draft.searchEngine]
      : "MANUAL";

  function selectSearchEngine(
    searchEngine: TrackingContextDraft["searchEngine"]
  ): void {
    const region = preferredRegions[searchEngine];
    onChange({
      ...draft,
      countryCode: "RU",
      depth:
        searchEngine === "YANDEX" && provider === "ARSENKIN"
          ? 30
          : draft.depth,
      language: "ru",
      searchEngine,
      regionCode: region.code,
      regionLabel: region.label,
      name: contextDisplayName(
        searchEngine,
        region.label,
        draft.device,
        competitorMode
      )
    });
    onSearchSourceChange("LIVE");
  }

  return (
    <>
      <div className="semantic-workflow-grid semantic-position-workflow-grid">
        <section className="semantic-workflow-panel semantic-position-source-panel">
          <header>
            <h3>Поисковые системы</h3>
            <p>
              {competitorMode
                ? "Выберите поисковик, тип выдачи и источник Топ-10."
                : "Выберите поисковик, тип выдачи и подключение провайдера."}
            </p>
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
          {!competitorMode &&
            draft.searchEngine === "YANDEX" &&
            searchSource === "LIVE" &&
            provider === "XMLSTOCK" && (
              <label className="semantic-toggle-line semantic-position-turbo-toggle">
                <input
                  checked={yandexLiveTurbo}
                  onChange={(event) =>
                    onYandexLiveTurboChange(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Turbo режим XMLStock</strong>
                  <small>
                    Передаёт tbm=turbo, не применяет обычный лимит потоков
                    XMLStock и получает до 50 результатов за страницу.
                    Для максимальной скорости выберите TOP-50 в кабинете
                    XMLStock. Тарифицируется дороже стандартного Live.
                  </small>
                </span>
              </label>
            )}
          <div className="semantic-provider-field">
            <div className="semantic-provider-field-heading">
              <h4>Источник данных</h4>
              <a className="semantic-dialog-link" href="/app/settings/integrations">Управлять</a>
            </div>
          {sources.length ? (
            <div
              aria-label={competitorMode
                ? "Источник сбора конкурентов"
                : "Источник съёма позиций"}
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
              {competitorMode
                ? "Нет проверенного подключения для сбора конкурентов."
                : "Нет проверенного подключения для съёма позиций."}
            </div>
          )}
          </div>
        </section>
        <section className="semantic-workflow-panel semantic-position-geo-panel">
          <header>
            <h3>География и устройство</h3>
            <p>
              {competitorMode
                ? "Эти параметры формируют отдельный срез выдачи конкурентов."
                : "Эти параметры формируют отдельную историю позиций."}
            </p>
          </header>
          <label className="semantic-workflow-field">
            <span>Регион</span>
            <SearchableRegionSelect
              kind={draft.searchEngine === "YANDEX" ? "YANDEX_RANK" : "GOOGLE_RANK"}
              onChange={({ code, label }) => onChange({
                ...draft,
                name: contextDisplayName(
                  draft.searchEngine,
                  label,
                  draft.device,
                  competitorMode
                ),
                regionCode: code,
                regionLabel: label
              })}
              value={draft.regionCode}
              valueLabel={draft.regionLabel}
            />
            <small>
              <span className={`semantic-region-source ${regionSource.toLowerCase()}`}>
                {regionSourceLabel(regionSource)}
              </span>
              {regionSource === "LAST_RUN"
                ? " Регион последнего съёма имеет приоритет над городом проекта."
                : regionSource === "PROJECT"
                  ? " Этот город задан в настройках проекта."
                  : regionSource === "DEFAULT"
                    ? " Город проекта не задан."
                    : " Регион изменён только для этого запуска."}
            </small>
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
                  <Icon name={device === "DESKTOP" ? "desktop" : "mobile"} />
                  <span>{device === "DESKTOP" ? "Десктоп" : "Мобильное"}</span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>
          {competitorMode ? (
            <fieldset className="semantic-segmented-field semantic-depth-field">
              <legend>Глубина сбора</legend>
              <div className="semantic-segmented-control" aria-label="Глубина сбора" role="group">
                <label className="selected">
                  <input checked readOnly type="radio" />
                  <span>Топ-10</span>
                </label>
              </div>
            </fieldset>
          ) : (
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
          )}
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
          {!competitorMode && draft.searchEngine === "YANDEX" && provider === "ARSENKIN" && (
            <div className="inline-alert info" role="status">
              Arsenkin для Яндекса выполняет съём с глубиной Топ-30. При
              выборе этого подключения глубина переключается автоматически.
            </div>
          )}
          <label className="semantic-toggle-line semantic-position-untracked-toggle">
            <input
              checked={draft.includeUntracked}
              onChange={(event) => onChange({
                ...draft,
                includeUntracked: event.target.checked
              })}
              type="checkbox"
            />
            <span>
              <strong>
                {competitorMode
                  ? "Собирать конкурентов по неотслеживаемым запросам"
                  : "Снимать позиции по неотслеживаемым запросам"}
              </strong>
              <small>
                {competitorMode
                  ? "Включено по умолчанию: статус отслеживания не ограничивает исследование конкурентов."
                  : "По умолчанию запросы с выключенным отслеживанием пропускаются."}
              </small>
            </span>
          </label>
          {competitorMode && (
            <label className="semantic-toggle-line semantic-competitor-position-toggle">
              <input
                checked={saveProjectPosition}
                onChange={(event) =>
                  onSaveProjectPositionChange(event.target.checked)
                }
                type="checkbox"
              />
              <span>
                <strong>Сохранять позицию сайта из этой выдачи</strong>
                <small>
                  Если сайт проекта найден в собранном Топ-10, его позиция
                  попадёт в текущие позиции и историю без отдельного запроса к
                  провайдеру. При выключенной галочке сохраняются только
                  конкуренты.
                </small>
              </span>
            </label>
          )}
        </section>
        <section className="semantic-workflow-panel semantic-position-scope-panel">
          <header>
            <h3>{competitorMode ? "Охват сбора" : "Охват проверки"}</h3>
            <p>Выберите все запросы, текущее выделение или папки.</p>
          </header>
          {scope}
        </section>
      </div>
    </>
  );
}

type SemanticRegionSource = "LAST_RUN" | "PROJECT" | "DEFAULT" | "MANUAL";
type SemanticRegionSources = Record<
  SemanticSearchEngine,
  Exclude<SemanticRegionSource, "MANUAL">
>;

function regionSourceLabel(source: SemanticRegionSource): string {
  if (source === "LAST_RUN") return "Последний съём";
  if (source === "PROJECT") return "Город проекта";
  if (source === "MANUAL") return "Выбрано вручную";
  return "По умолчанию · Москва";
}

function defaultContextDraft(
  region = defaultSemanticSearchRegions().YANDEX,
  competitorMode = false
): TrackingContextDraft {
  return contextDraftWithRegion({
    ...emptyTrackingContextDraft(),
    searchEngine: "YANDEX",
    countryCode: "RU",
    language: "ru",
    device: "DESKTOP",
    depth: 50,
    includeUntracked: competitorMode
  }, region, competitorMode);
}

function contextDraftWithRegion(
  draft: TrackingContextDraft,
  region: Readonly<{ code: string; label: string }>,
  competitorMode = false
): TrackingContextDraft {
  return {
    ...draft,
    name: contextDisplayName(
      draft.searchEngine,
      region.label,
      draft.device,
      competitorMode
    ),
    regionCode: region.code,
    regionLabel: region.label
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
  draft: TrackingContextDraft,
  competitorMode = false
): string {
  const engine = draft.searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const region = draft.regionLabel.trim() || draft.regionCode.trim() || draft.countryCode.toUpperCase();
  const device = draft.device === "MOBILE" ? "Мобайл" : "Десктоп";
  const prefix = competitorMode ? "Конкуренты" : "Авто";
  return `${prefix} · ${engine} · ${region} · ${device}`.slice(0, 160);
}

function contextDisplayName(
  searchEngine: TrackingContextDraft["searchEngine"],
  regionLabel: string,
  device: TrackingContextDraft["device"],
  competitorMode: boolean
): string {
  const engine = searchEngine === "YANDEX" ? "Яндекс" : "Google";
  const deviceLabel = device === "MOBILE" ? "Мобильное" : "Десктоп";
  return `${competitorMode ? "Конкуренты · " : ""}${engine} · ${regionLabel} · ${deviceLabel}`;
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
    const query = new URLSearchParams({
      limit: String(trackingContextKeywordPageLimit)
    });
    if (cursor) query.set("cursor", cursor);
    const page = await browserApiCollectionRequest<{
      readonly keywordId: string;
      readonly keywordVersion: number;
      readonly textOriginal: string;
      readonly isTracked: boolean;
    }>(
      `${trackingContextApiPath(projectId, contextId)}/keywords?${query.toString()}`,
      { signal }
    );
    for (const assignment of page.data) {
      selections.set(assignment.keywordId, {
        id: assignment.keywordId,
        version: assignment.keywordVersion,
        label: assignment.textOriginal,
        isTracked: assignment.isTracked
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

function rememberPositionRegion(
  projectId: string,
  draft: TrackingContextDraft,
  setPreferredRegions: (
    update: (current: SemanticSearchRegions) => SemanticSearchRegions
  ) => void
): void {
  writeLastSemanticRegion(
    window.localStorage,
    projectId,
    "POSITIONS",
    searchRegionKind(draft.searchEngine),
    draft.regionCode
  );
  setPreferredRegions((current) => ({
    ...current,
    [draft.searchEngine]: {
      code: draft.regionCode,
      label: draft.regionLabel
    }
  }));
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

function formatPlatformCharge(microAmount: string): string {
  const amount = BigInt(microAmount);
  const rubles = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  const decimal = fraction.length === 0
    ? "00"
    : fraction.padEnd(2, "0");
  return `${new Intl.NumberFormat("ru-RU").format(rubles)},${decimal} ₽`;
}

interface PendingSemanticRankRun {
  readonly context: TrackingContextSummary;
  readonly contextSignature: string;
  readonly estimate: RankEstimate;
}
