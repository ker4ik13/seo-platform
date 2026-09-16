"use client";

import { CustomSelect } from "./custom-select";
import { SemanticRankTargets } from "./semantic-rank-targets";
import { clearRankTargetBatch, persistRankTargetBatch, readRankTargetBatch, readRankTargetPreference, writeRankTargetPreference } from "../lib/rank-target-storage";
import { uniqueRankTargets, type RankTarget } from "../lib/rank-targets";
import { createRankTargetBatch, launchRankTargetBatch, prepareRankTargetBatch, rankTargetBatchCharge, rankTargetBatchReady, rankTargetBatchSignature, type RankTargetBatch, type RankTargetBatchInput } from "../lib/rank-target-batch";
import { rankRetryContextDraft } from "../lib/rank-retry";
import { searchRegionDisplayName } from "../lib/seo-regions";
import { normalizedUiLocale, translateUi } from "../lib/ui-i18n";
import type { RankOperationResult } from "@seo-platform/contracts";

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
  RankEstimate,
  RankJobSummary,
  TrackingContextKeywordReplacementResult,
  TrackingContextSettings,
  TrackingContextSummary,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  rankCommandKeywordLimit,
  trackingContextKeywordPageLimit
} from "@seo-platform/contracts";
import {
  BrowserApiError,
  browserApiCollectionRequest,
  browserApiRequest
} from "../lib/browser-api";
import {
  isProjectConnectorCredentialEligible,
  workspaceConnectorOptions
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
  trackingContextDisplayName,
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
import { SearchEngineLogo } from "./search-engine-logo";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection,
  type SemanticOperationScopeState
} from "./semantic-operation-scope";
import { UiText, useUiLocale } from "./ui-locale";

const NEW_CONTEXT_VALUE = "__new_context__";

export function SemanticPositionDialog({
  activeGroupId,
  groups,
  initialSelections,
  initialRun,
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
  initialRun?: RankOperationResult;
  mode?: "positions" | "competitors";
  onClose: () => void;
  onStarted: (job: RankJobSummary, batch?: readonly RankJobSummary[]) => void;
  projectSearchCity?: ProjectSearchCity | undefined;
  projectId: string;
  workspaceId: string;
}>) {
  const { t: uiText, locale: uiLocale } = useUiLocale();
  const competitorMode = mode === "competitors";
  const formId = useId();
  const [settings, setSettings] = useState<TrackingContextSettings>();
  const [workspaceRouting, setWorkspaceRouting] =
    useState<WorkspaceConnectorRoutingSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [selectedContextId, setSelectedContextId] = useState("");
  const [createSavedContext, setCreateSavedContext] = useState(false);
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
    initialRun ? rankRetryContextDraft(initialRun) : defaultContextDraft(undefined, competitorMode, uiLocale)
  );
  const [yandexLiveTurbo, setYandexLiveTurbo] = useState(initialRun?.execution.providerMappingVersion === "xmlstock-yandex-live@3");
  const [saveProjectPosition, setSaveProjectPosition] = useState(initialRun?.execution.saveProjectPosition === true);
  const [additionalTargets, setAdditionalTargets] = useState<readonly RankTarget[]>([]);
  const [, setBatchRevision] = useState(0);
  const multiBatch = useRef<RankTargetBatch | undefined>(undefined);
  const [recoverableBatch, setRecoverableBatch] = useState<RankTargetBatch>();
  const [recoveringBatch, setRecoveringBatch] = useState(false);
  const preferenceRestored = useRef(false);
  const targets = useMemo(() => [{ regionCode: contextDraft.regionCode, regionLabel: contextDraft.regionLabel, device: contextDraft.device }, ...additionalTargets], [contextDraft.regionCode, contextDraft.regionLabel, contextDraft.device, additionalTargets]);
  const createContextCommand = useRef<IdempotentCommand | undefined>(
    undefined
  );
  const estimateCommand = useRef<IdempotentCommand | undefined>(undefined);
  const assignmentCommand = useRef<IdempotentCommand | undefined>(undefined);
  const runCommand = useRef<IdempotentCommand | undefined>(undefined);
  const pendingRun = useRef<PendingSemanticRankRun | undefined>(undefined);
  const oneOffContext = useRef<TrackingContextSummary | undefined>(undefined);
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
    () => workspaceRouting
      ? workspaceConnectorOptions(
          workspaceRouting,
          "SERP_RANK_TRACKING"
        ).filter(
          (source) =>
            source.provider === "ARSENKIN" || source.provider === "XMLSTOCK"
        )
      : [],
    [workspaceRouting]
  );
  const connectedRankSources = useMemo(
    () => (workspaceRouting?.credentialOptions ?? []).filter(
      (source) =>
        (source.provider === "ARSENKIN" || source.provider === "XMLSTOCK") &&
        isProjectConnectorCredentialEligible(source, "SERP_RANK_TRACKING")
    ),
    [workspaceRouting]
  );
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider = selectedSource?.provider === "ARSENKIN"
    ? "ARSENKIN"
    : "XMLSTOCK";
  const batchInput: RankTargetBatchInput | undefined = useMemo(() => selectedSource && contextDraft.regionCode.trim() ? {
    projectId, workspaceId, base: contextDraft, targets, keywordIds: selections.map(({ id }) => id),
    selectedKeywordCount: selections.filter(({ isTracked }) => contextDraft.includeUntracked || isTracked !== false).length,
    source: selectedSource, competitorMode, saveProjectPosition, yandexLiveTurbo,
    saveContexts: !competitorMode && (createSavedContext || Boolean(selectedContextId)),
    forceCreateContexts: createSavedContext,
    ...(createSavedContext ? { contextName: contextDraft.name.trim() } : {}),
    locale: uiLocale
  } : undefined, [projectId, workspaceId, contextDraft, targets, selections, selectedSource, competitorMode, saveProjectPosition, yandexLiveTurbo, selectedContextId, createSavedContext, uiLocale]);
  const batchSignature = useMemo(() => batchInput ? rankTargetBatchSignature(batchInput) : undefined, [batchInput]);
  const currentBatch = recoveringBatch || multiBatch.current?.signature === batchSignature ? multiBatch.current : undefined;
  const batchReady = currentBatch ? rankTargetBatchReady(currentBatch) : false;
  const batchStarted = currentBatch?.entries.filter(entry => entry.job).length ?? 0;
  const batchCharge = currentBatch ? formatPlatformCharge(rankTargetBatchCharge(currentBatch), uiLocale) : undefined;
  useEffect(() => { setRecoverableBatch(readRankTargetBatch(window.localStorage, workspaceId, projectId, competitorMode)); }, [workspaceId, projectId, competitorMode]);
  useEffect(() => {
    if (loading || initialRun || preferenceRestored.current) return;
    preferenceRestored.current = true;
    const preferred = readRankTargetPreference(window.localStorage, projectId, contextDraft.searchEngine, competitorMode);
    if (!preferred?.length) return;
    const [first, ...rest] = preferred;
    setContextDraft(current => ({ ...current, ...first! })); setAdditionalTargets(rest);
  }, [loading, initialRun, projectId, competitorMode, contextDraft.searchEngine]);
  const providerUsage = rankProviderUsageEstimate(
    selectedSource,
    displayedKeywordCount * targets.length,
    contextDraft.searchEngine,
    contextDraft.depth,
    contextDraft.searchSource,
    yandexLiveTurbo ? "TURBO" : undefined,
    competitorMode ? "COMPETITOR_SERP" : "POSITION_TRACKING", uiLocale
  );
  const platformChargeConfirmation =
    estimate?.status === "READY" &&
    estimate.credentialMode === "PLATFORM_PAID" &&
    pendingRun.current?.estimate.id === estimate.id &&
    !rankEstimateExpired(estimate.expiresAt, Date.now())
      ? formatPlatformCharge(estimate.platformChargeMicro, uiLocale)
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
        const currentDescendants = [...current.descendantGroupIds]
          .sort()
          .join(":");
        const nextDescendants = [...(scope.descendantGroupIds ?? [])]
          .sort()
          .join(":");
        return current.scopeMode === scope.mode &&
          currentGroups === nextGroups &&
          currentDescendants === nextDescendants
          ? current
          : {
              ...current,
              scopeMode: scope.mode,
              groupIds: scope.groupIds,
              descendantGroupIds: scope.descendantGroupIds ?? []
            };
      });
    },
    []
  );

  function selectContext(selection: string): void {
    const creating = selection === NEW_CONTEXT_VALUE;
    const contextId = creating ? "" : selection;
    setAdditionalTargets([]);
    multiBatch.current = undefined;
    setYandexLiveTurbo(false);
    setSelectedContextId(contextId);
    setCreateSavedContext(creating);
    oneOffContext.current = undefined;
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
        ...defaultContextDraft(preferredRegions.YANDEX, competitorMode, uiLocale),
        ...(creating ? { name: "" } : {}),
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
      browserApiRequest<WorkspaceConnectorRoutingSettings>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
        { signal: controller.signal }
      ),
      browserApiRequest<{ readonly jobs: readonly RankJobSummary[] }>(
        rankRunsApiPath(projectId),
        { signal: controller.signal }
      ).catch(() => ({ jobs: [] as readonly RankJobSummary[] }))
    ])
      .then(([trackingResult, workspaceResult, rankRuns]) => {
        if (controller.signal.aborted) return;
        const options = workspaceConnectorOptions(
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
          (initialRun ? options.find((source) => source.provider === initialRun.job.provider && source.mode === initialRun.job.credentialMode) : undefined) ??
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
        setSettings(trackingResult);
        setWorkspaceRouting(workspaceResult);
        setCredentialId(preferredSource?.id ?? "");
        setLastUsedCredentialId(exactCredentialId);
        setPreferredRegions(nextPreferredRegions);
        setPreferredRegionSources(nextPreferredRegionSources);
        if (initialRun) {
          setContextDraft(rankRetryContextDraft(initialRun));
        } else {
          setContextDraft((current) => ({
            ...contextDraftWithRegion(
              current,
              nextPreferredRegions[current.searchEngine],
              competitorMode,
              uiLocale
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
        if (!initialRun && !competitorMode && preferredSource?.provider === "ARSENKIN") {
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
  }, [activeGroupId, competitorMode, initialSelections.length, initialRun, projectId, projectSearchCity, uiLocale, workspaceId]);

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
    if (createSavedContext && !contextDraft.name.trim()) {
      setError(uiText("Введите название нового контекста."));
      return;
    }
    if (targets.length > 1 || recoveringBatch) {
      const effectiveInput = recoveringBatch ? multiBatch.current?.input : batchInput;
      if (!effectiveInput || !settings || (!recoveringBatch && (resolvingScope || keywordIds.length === 0))) return;
      setRunning(true); setError(undefined);
      const changed = () => {
        const batch = multiBatch.current;
        if (batch?.entries.some(entry => entry.runKey || entry.job)) persistRankTargetBatch(window.localStorage, batch);
        setBatchRevision(revision => revision + 1);
      };
      try {
        let batch = multiBatch.current;
        if (!batch || (!recoveringBatch && batch.signature !== batchSignature)) {
          batch = createRankTargetBatch(effectiveInput);
          multiBatch.current = batch;
        }
        writeRankTargetPreference(window.localStorage, projectId, effectiveInput.base.searchEngine, competitorMode, effectiveInput.targets);
        if (!rankTargetBatchReady(batch)) {
          await prepareRankTargetBatch(batch, settings, changed);
          return;
        }
        await launchRankTargetBatch(batch, changed);
        const jobs = batch.entries.flatMap(entry => entry.job ? [entry.job] : []);
        if (jobs.length === batch.entries.length) {
          clearRankTargetBatch(window.localStorage, workspaceId, projectId, competitorMode);
          rememberCredential(projectId, effectiveInput.source.id, setLastUsedCredentialId);
          rememberPositionRegion(projectId, contextDraft, setPreferredRegions);
          onStarted(jobs[jobs.length - 1]!, jobs);
        }
      } catch (error) { setError(positionErrorMessage(error)); }
      finally { setRunning(false); }
      return;
    }
    let stage: "PREPARE" | "ESTIMATE" | "RUN" = "PREPARE";
    setRunning(true);
    setError(undefined);
    setEstimate(undefined);
    try {
      if (!workspaceRouting || !selectedSource) {
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
        contextDraft.name.trim() || technicalContextName(contextDraft, competitorMode, uiLocale);
      const launchDraft = {
        ...contextDraft,
        name: contextName
      };
      const shouldSaveContext =
        !competitorMode && (createSavedContext || Boolean(selectedContextId));
      let selectedContext = selectedContextId
        ? settings?.contexts.find(
            ({ id, status }) => id === selectedContextId && status === "ACTIVE"
          )
        : !shouldSaveContext && oneOffContext.current &&
            trackingContextMatchesDraft(oneOffContext.current, launchDraft)
          ? oneOffContext.current
          : undefined;
      if (selectedContext && selectedContextId) {
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
        const isReusable = shouldSaveContext;
        const signature = trackingContextPayloadSignature(launchDraft, {
          isReusable
        });
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
            body: trackingContextCreateInput(launchDraft, {
              isReusable
            })
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
        if (!shouldSaveContext) {
          oneOffContext.current = createdContext;
        } else {
          setSelectedContextId(createdContext.id);
        }
        if (shouldSaveContext) {
          setSettings((current) =>
            current ? withTrackingContext(current, createdContext) : current
          );
        }
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
      if (!shouldSaveContext) {
        oneOffContext.current = selectedContext;
      }
      if (shouldSaveContext) {
        setSettings((current) =>
          current ? withTrackingContext(current, selectedContext!) : current
        );
      }
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
      {...(initialRun ? { description: uiText("Повтор создаст новую операцию только для запросов без результата. Проверьте параметры и новую стоимость.") } : {})}
      {...(competitorMode && !initialRun
        ? {
            description:
              `Сохраняет Топ-${contextDraft.depth} обычной выдачи по каждому запросу. Arsenkin использует Check Top, XMLStock — выбранный тип выдачи.`
          }
        : {})}
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="semantic" /><div><dt><UiText text="Запросов" /></dt><dd>{scopeCount === undefined && resolvingScope ? <UiText text="Считаем…" /> : displayedKeywordCount}</dd></div></div>
            <div>
              <SearchEngineLogo engine={contextDraft.searchEngine} size="compact" />
              <div><dt><UiText text="Поисковик" /></dt><dd>{contextDraft.searchEngine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</dd></div>
            </div>
            <div>
              <ProviderLogo provider={provider} size="compact" />
              <div><dt><UiText text="Провайдер" /></dt><dd>{selectedSource?.label ?? integrationProviderLabel(provider)}</dd></div>
            </div>
            <div><Icon name="frequency" /><div><dt><UiText text="Расход" /></dt><dd><UiText text={(targets.length > 1 && selectedSource?.mode === "PLATFORM_PAID" && batchReady ? batchCharge : undefined) ?? platformChargeConfirmation ?? providerUsage.usage} /></dd></div></div>
            {targets.length > 1 && <div><Icon name="positions" /><div><dt><UiText text="Съёмов" /></dt><dd>{targets.length}</dd></div></div>}
            <div><Icon name="checkDouble" /><div><dt><UiText text="Доступно" /></dt><dd><UiText text={providerUsage.available} /></dd></div></div>
          </dl>
          <div className="semantic-modal-actions">
            <button className="secondary-button" disabled={running} onClick={onClose} type="button"><UiText text="Отмена" /></button>
            <button
              className="primary-button"
              disabled={
                loading ||
                (!recoveringBatch && resolvingScope) ||
                running ||
                (!recoveringBatch && keywordIds.length === 0) ||
                !contextDraft.regionCode.trim() ||
                !settings ||
                !workspaceRouting ||
                (!recoveringBatch && !selectedSource)
              }
              form={formId}
              type="submit"
            >
              {resolvingScope
                ? <UiText text="Загружаем запросы…" />
                : running
                ? competitorMode ? <UiText text="Готовим сбор…" /> : <UiText text="Проверяем и запускаем…" />
                : targets.length > 1 || recoveringBatch
                ? batchReady
                  ? batchStarted > 0 ? <UiText text="Продолжить оставшиеся съёмы" /> : <UiText text="Подтвердить {0} съёмов" values={[String(targets.length)]} />
                  : <UiText text="Рассчитать {0} съёмов" values={[String(targets.length)]} />
                : platformChargeConfirmation
                ? <UiText text="Подтвердить списание {0}" values={[String(platformChargeConfirmation)]} />
                : competitorMode
                  ? <UiText text="Собрать конкурентов ({0})" values={[String(keywordIds.length)]} />
                  : <UiText text="Запустить съём ({0})" values={[String(keywordIds.length)]} />}
            </button>
          </div>
        </div>
      )}
      onClose={running ? () => undefined : onClose}
      presenceKey={competitorMode
        ? "semantic-modal:competitors"
        : "semantic-modal:positions"}
      size="large"
      title={competitorMode ? uiText("Сбор конкурентов") : uiText("Проверка позиций")}
    >
      <form className="semantic-position-dialog semantic-workflow-dialog" id={formId} onSubmit={(event) => void submit(event)}>
        {recoverableBatch && !recoveringBatch && <div className="inline-alert warning"><p><UiText text="Предыдущий запуск не завершён. Можно продолжить его с сохранёнными командами, не повторяя принятые задачи." /></p><button type="button" className="secondary-button" disabled={running} onClick={() => {
          multiBatch.current = recoverableBatch; setRecoveringBatch(true); setCreateSavedContext(Boolean(recoverableBatch.input.forceCreateContexts)); setContextDraft(recoverableBatch.input.base); setAdditionalTargets(recoverableBatch.input.targets.slice(1)); setCredentialId(recoverableBatch.input.source.id); setBatchRevision(value => value + 1);
        }}><UiText text="Восстановить запуск" /></button></div>}
        {loading ? (
          <div className="semantic-dialog-loading" role="status"><UiText text="Проверяем доступные подключения…" /></div>
        ) : (
          <fieldset className="semantic-rank-parameters" disabled={running || batchStarted > 0 || recoveringBatch}>
            <PositionContextSelector
              contexts={settings?.contexts ?? []}
              createSavedContext={createSavedContext}
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
              onChange={draft => {
                if (draft.searchEngine !== contextDraft.searchEngine) setAdditionalTargets([]);
                setContextDraft(createSavedContext
                  ? { ...draft, name: contextDraft.name }
                  : draft);
              }}
              targets={targets}
              onTargetsChange={targets => {
                const [first, ...others] = uniqueRankTargets(targets);
                setContextDraft(current => ({
                  ...current,
                  ...first!,
                  name: createSavedContext
                    ? current.name
                    : contextDisplayName(current.searchEngine, first!.regionLabel, first!.device, competitorMode, uiLocale)
                }));
                setAdditionalTargets(others);
              }}
              credentialId={credentialId}
              hasConnectedSource={connectedRankSources.length > 0}
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
                  ...(!competitorMode && next?.provider === "ARSENKIN" &&
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
                  <UiText text="Загружаем запросы сохранённого контекста…" /></div>
              ) : (
                <SemanticOperationScope
                  activeGroupId={activeGroupId}
                  groups={groups}
                  initialScope={{
                    mode: contextDraft.scopeMode,
                    groupIds: contextDraft.groupIds,
                    descendantGroupIds: contextDraft.descendantGroupIds
                  }}
                  initialSelections={
                    selectedContextId
                      ? assignedKeywordSelections ?? []
                      : initialSelections
                  }
                  key={`${selectedContextId || "new-context"}:ready`}
                  maxItems={rankCommandKeywordLimit}
                  onChange={resolveScope}
                  onCountChange={resolveScopeCount}
                  onScopeChange={resolveScopeState}
                  projectId={projectId}
                />
              )}
            />
          </fieldset>
        )}
        {currentBatch && <section className="semantic-rank-batch-review" aria-live="polite">
          <header><strong><UiText text="План съёма по городам" /></strong><span><UiText text="Принято задач: {0} из {1}" values={[String(batchStarted), String(currentBatch.entries.length)]} /></span></header>
          <p><UiText text="Каждое сочетание города и устройства создаёт отдельную задачу. Принятые задачи продолжат работу после закрытия окна." /></p>
          {selectedSource?.mode === "PLATFORM_PAID" && <p><UiText text="Максимальный расход оставшихся съёмов: {0}" values={[batchCharge ?? "—"]} /></p>}
          <ul>{currentBatch.entries.map(entry => <li key={`${entry.draft.regionCode}:${entry.draft.device}`}>
            <span>{searchRegionDisplayName(entry.draft.searchEngine, entry.draft.regionCode, entry.draft.regionLabel)} · <UiText text={entry.draft.device === "DESKTOP" ? "ПК" : "Телефон"} /></span>
            <strong className={entry.error ? "danger-text" : undefined}>{entry.job ? <UiText text="В очереди" /> : entry.error ? <UiText text={entry.error} /> : entry.estimate?.status === "READY" ? selectedSource?.mode === "PLATFORM_PAID" ? formatPlatformCharge(entry.estimate.platformChargeMicro, uiLocale) : <UiText text="Готов к запуску" /> : <UiText text="Подготовка…" />}</strong>
          </li>)}</ul>
        </section>}
        {(platformChargeConfirmation || estimate?.status === "BLOCKED" || error || scopeError || contextAssignmentError || addedSinceLastRun > 0) && <div className="semantic-workflow-feedback">
          {platformChargeConfirmation && (
            <div className="inline-alert info" role="status">
              <strong><UiText text="Подтвердите списание" /></strong>
              <p>
                <UiText text="Максимальная стоимость съёма:" after=" " />{platformChargeConfirmation} <UiText text="с баланса данных. Оплачиваются принятые запросы, неиспользованный резерв возвращается. Расчёт действует до истечения оценки." before=" " /></p>
            </div>
          )}
          {addedSinceLastRun > 0 && (
            <div className="inline-alert warning" role="status">
              <UiText text="После прошлого запуска в выбранных папках появилось новых запросов:" after=" " /><strong>{addedSinceLastRun}</strong><UiText text=". Они будут включены в этот съём после подтверждения запуска." /></div>
          )}
          {estimate?.status === "BLOCKED" && (
            <div className="inline-alert warning" role="alert">
              <strong><UiText text="Запуск заблокирован" /></strong>
              <ul>{estimate.blockers.map(({ code }) => <li key={code}>{<UiText text={rankEstimateBlockerLabel(code) ?? ""} />}</li>)}</ul>
            </div>
          )}
          {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
          {contextAssignmentError && <div className="inline-alert danger" role="alert">{<UiText text={contextAssignmentError ?? ""} />}</div>}
          {scopeError && <div className="inline-alert warning" role="alert">{<UiText text={scopeError ?? ""} />}</div>}
        </div>}
      </form>
    </SemanticModal>
  );

}

function PositionContextSelector({
  competitorMode,
  contexts,
  createSavedContext,
  draft,
  onDraftChange,
  onSelect,
  projectId,
  selectedContextId
}: Readonly<{
  competitorMode: boolean;
  contexts: readonly TrackingContextSummary[];
  createSavedContext: boolean;
  draft: TrackingContextDraft;
  onDraftChange: (draft: TrackingContextDraft) => void;
  onSelect: (contextId: string) => void;
  projectId: string;
  selectedContextId: string;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <section className="semantic-position-context-bar">
      <div>
        <span className="semantic-position-context-icon">
          <Icon name={competitorMode ? "competitors" : "positions"} />
        </span>
        <div>
          <strong>{competitorMode ? <UiText text="Разовый сбор выдачи" /> : <UiText text="Контекст съёма" />}</strong>
          <small>
            {competitorMode
              ? <UiText text="Параметры применятся только к этому запуску и не сохранятся как профиль." />
              : createSavedContext
                ? <UiText text="Новый профиль сохранится после успешной подготовки запуска." />
                : selectedContextId
                  ? <UiText text="Используются настройки выбранного сохранённого профиля." />
                  : <UiText text="Без контекста параметры применятся только к текущему запуску." />}
          </small>
        </div>
      </div>
      <label>
        <span><UiText text="Профиль запуска" /></span>
        <CustomSelect
          disabled={competitorMode}
          onChange={(event) => onSelect(event.target.value)}
          value={createSavedContext ? NEW_CONTEXT_VALUE : selectedContextId}
        >
          <option value="">
            <span className="semantic-context-option semantic-context-option-none">
              <Icon name={competitorMode ? "competitors" : "positions"} />
              <UiText text="Без контекста" />
            </span>
          </option>
          {!competitorMode && (
            <option value={NEW_CONTEXT_VALUE}>
              <span className="semantic-context-option semantic-context-option-new">
                <Icon name="plus" />
                <UiText text="Новый контекст" />
              </span>
            </option>
          )}
          {!competitorMode && contexts
            .filter(({ status }) => status === "ACTIVE")
            .map((context) => (
              <option key={context.id} value={context.id}>
                <span className="semantic-context-option">
                  <SearchEngineLogo engine={context.configuration.searchEngine} size="compact" />
                  <span>
                    <strong>{trackingContextDisplayName(context)}</strong>
                    <small>{context.assignedKeywordCount} <UiText text="запросов" before=" " /></small>
                  </span>
                </span>
              </option>
            ))}
        </CustomSelect>
      </label>
      {createSavedContext && !competitorMode && (
        <label className="semantic-position-context-name">
          <span><UiText text="Название контекста" /></span>
          <input
            autoFocus
            maxLength={160}
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            placeholder={uiText("Например, Основной мониторинг")}
            value={draft.name}
          />
        </label>
      )}
      <a
        aria-label={uiText("Настройки контекстов")}
        className="semantic-position-context-settings"
        href={`/app/projects/${encodeURIComponent(projectId)}/rankings/contexts`}
        title={uiText("Настройки контекстов")}
      >
        <Icon name="settings" />
      </a>
    </section>
  );
}

function PositionRunParameters({
  competitorMode,
  draft,
  onChange,
  targets,
  onTargetsChange,
  credentialId,
  hasConnectedSource,
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
  targets: readonly RankTarget[];
  onTargetsChange: (targets: readonly RankTarget[]) => void;
  credentialId: string;
  hasConnectedSource: boolean;
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
  const { t: uiText, locale: uiLocale } = useUiLocale();
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider = selectedSource?.provider === "ARSENKIN"
    ? "ARSENKIN"
    : "XMLSTOCK";
  const depthOptions: readonly TrackingContextDraft["depth"][] = competitorMode
    ? [10, 20, 30, 50, 100]
    : draft.searchEngine === "YANDEX" && provider === "ARSENKIN"
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
        !competitorMode && searchEngine === "YANDEX" && provider === "ARSENKIN"
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
        competitorMode,
        uiLocale
      )
    });
    onSearchSourceChange("LIVE");
  }

  return (
    <>
      <div className="semantic-workflow-grid semantic-position-workflow-grid">
        <section className="semantic-workflow-panel semantic-position-source-panel">
          <header>
            <h3><UiText text="Поисковые системы" /></h3>
            <p>
              {competitorMode
                ? <UiText text="Выберите поисковик, тип выдачи, глубину и источник." />
                : <UiText text="Выберите поисковик, тип выдачи и подключение провайдера." />}
            </p>
          </header>
          <div aria-label={uiText("Поисковая система")} className="semantic-engine-cards" role="group">
            {(["YANDEX", "GOOGLE"] as const).map((engine) => (
              <button
                aria-pressed={draft.searchEngine === engine}
                className={draft.searchEngine === engine ? "selected" : undefined}
                key={engine}
                onClick={() => selectSearchEngine(engine)}
                type="button"
              >
                <SearchEngineLogo engine={engine} />
                <span>{engine === "YANDEX" ? <UiText text="Яндекс" /> : "Google"}</span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>
          <label className="semantic-workflow-field">
            <span><UiText text="Источник выдачи" /></span>
            <CustomSelect
              onChange={(event) =>
                onSearchSourceChange(
                  event.target.value as "SEARCH_API" | "LIVE"
                )
              }
              value={searchSource}
            >
              {draft.searchEngine === "YANDEX" && (
                <option value="SEARCH_API"><UiText text="Яндекс XML / Search API" /></option>
              )}
              <option value="LIVE">
                {draft.searchEngine === "YANDEX" ? <UiText text="Яндекс Live" /> : "Google Live"}
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
                  <strong><UiText text="Turbo режим XMLStock" /></strong>
                  <small>
                    <UiText text="Передаёт tbm=turbo, не применяет обычный лимит потоков XMLStock и получает до 50 результатов за страницу. Для максимальной скорости выберите TOP-50 в кабинете XMLStock. Тарифицируется дороже стандартного Live." /></small>
                </span>
              </label>
            )}
          <div className="semantic-provider-field">
            <div className="semantic-provider-field-heading">
              <h4><UiText text="Источник данных" /></h4>
              <a className="semantic-dialog-link" href="/app/settings/integrations"><UiText text="Управлять" /></a>
            </div>
          {sources.length ? (
            <div
              aria-label={competitorMode ? uiText("Источник сбора конкурентов") : uiText("Источник съёма позиций")}
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
                    <strong>{<UiText text={integrationProviderLabel(source.provider) ?? ""} />}</strong>
                    <small>{source.label} <UiText text="· ваш API" before=" " /></small>
                    <b>
                      <UiText text="Подключено" />{source.id === lastUsedCredentialId
                        ? <UiText text="· использовался в прошлый раз" before=" " />
                        : ""}
                    </b>
                  </span>
                  <i aria-hidden="true" className="semantic-provider-radio" />
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-alert warning">
              <span>
                {hasConnectedSource
                  ? <UiText text="Подключение доступно, но для этой операции не выбран маршрут рабочей области." />
                  : competitorMode
                    ? <UiText text="Нет проверенного подключения для сбора конкурентов." />
                    : <UiText text="Нет проверенного подключения для съёма позиций." />}
              </span>{" "}
              <a href="/app/settings/integrations"><UiText text="Настроить маршрутизацию" /></a>
            </div>
          )}
          </div>
        </section>
        <section className="semantic-workflow-panel semantic-position-geo-panel">
          <header>
            <h3><UiText text="География и устройство" /></h3>
            <p>
              {competitorMode
                ? <UiText text="Эти параметры формируют отдельный срез выдачи конкурентов." />
                : <UiText text="Эти параметры формируют отдельную историю позиций." />}
            </p>
          </header>
          <SemanticRankTargets targets={targets} engine={draft.searchEngine} onChange={onTargetsChange} />
          {targets.length === 1 && <small className={`semantic-region-source ${regionSource.toLowerCase()}`}><UiText text={regionSourceLabel(regionSource)} /></small>}
          <fieldset className="semantic-segmented-field semantic-depth-field">
              <legend><UiText text={competitorMode ? "Глубина сбора" : "Глубина проверки"} /></legend>
              <div className="semantic-segmented-control" role="radiogroup" aria-label={uiText("Глубина проверки")}>
                {depthOptions.map((depth) => (
                  <label className={draft.depth === depth ? "selected" : undefined} key={depth}>
                    <input
                      checked={draft.depth === depth}
                      onChange={() => onChange({ ...draft, depth })}
                      type="radio"
                    />
                    <span><UiText text="Топ-" />{depth}</span>
                  </label>
                ))}
              </div>
          </fieldset>
          <div className="semantic-position-compact-fields">
            <label className="semantic-workflow-field">
              <span><UiText text="Страна" /></span>
              <CustomSelect
                onChange={(event) =>
                  onChange({ ...draft, countryCode: event.target.value })
                }
                value={draft.countryCode}
              >
                <option value="RU"><UiText text="Россия · RU" /></option>
              </CustomSelect>
            </label>
            <label className="semantic-workflow-field">
              <span><UiText text="Язык выдачи" /></span>
              <CustomSelect
                disabled={draft.searchEngine === "YANDEX"}
                onChange={(event) =>
                  onChange({ ...draft, language: event.target.value })
                }
                value={draft.language}
              >
                <option value="ru"><UiText text="Русский · ru" /></option>
                {draft.searchEngine === "GOOGLE" && (
                  <option value="en">English · en</option>
                )}
              </CustomSelect>
            </label>
          </div>
          {!draft.regionCode.trim() && (
            <div className="inline-alert warning" role="alert">
              <UiText text="Выберите регион — без него съём позиций запустить нельзя." /></div>
          )}
          {!competitorMode && draft.searchEngine === "YANDEX" && provider === "ARSENKIN" && (
            <div className="inline-alert info" role="status">
              <UiText text="Arsenkin для Яндекса выполняет съём с глубиной Топ-30. При выборе этого подключения глубина переключается автоматически." /></div>
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
                  ? <UiText text="Собирать конкурентов по неотслеживаемым запросам" />
                  : <UiText text="Снимать позиции по неотслеживаемым запросам" />}
              </strong>
              <small>
                {competitorMode
                  ? <UiText text="Включено по умолчанию: статус отслеживания не ограничивает исследование конкурентов." />
                  : <UiText text="По умолчанию запросы с выключенным отслеживанием пропускаются." />}
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
                <strong><UiText text="Сохранять позицию сайта из этой выдачи" /></strong>
                <small>
                  <UiText text="Если сайт проекта найден в собранной выдаче, его позиция попадёт в текущие позиции и историю без отдельного запроса к провайдеру. При выключенной галочке сохраняются только конкуренты." /></small>
              </span>
            </label>
          )}
        </section>
        <section className="semantic-workflow-panel semantic-position-scope-panel">
          <header>
            <h3>{competitorMode ? <UiText text="Охват сбора" /> : <UiText text="Охват проверки" />}</h3>
            <p><UiText text="Выберите все запросы, текущее выделение или папки." /></p>
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
  competitorMode = false,
  locale = "ru"
): TrackingContextDraft {
  return contextDraftWithRegion({
    ...emptyTrackingContextDraft(),
    searchEngine: "YANDEX",
    countryCode: "RU",
    language: "ru",
    device: "DESKTOP",
    depth: competitorMode ? 10 : 50,
    includeUntracked: competitorMode
  }, region, competitorMode, locale);
}

function contextDraftWithRegion(
  draft: TrackingContextDraft,
  region: Readonly<{ code: string; label: string }>,
  competitorMode = false,
  locale = "ru"
): TrackingContextDraft {
  return {
    ...draft,
    name: contextDisplayName(
      draft.searchEngine,
      region.label,
      draft.device,
      competitorMode,
      locale
    ),
    regionCode: region.code,
    regionLabel: region.label
  };
}

function technicalContextName(
  draft: TrackingContextDraft,
  competitorMode = false,
  locale = "ru"
): string {
  const currentLocale = normalizedUiLocale(locale);
  const region = translateUi(
    currentLocale,
    searchRegionDisplayName(
      draft.searchEngine,
      draft.regionCode,
      draft.regionLabel
    )
  );
  const device = translateUi(currentLocale, draft.device === "MOBILE" ? "Мобильное" : "Десктоп");
  const prefix = competitorMode
    ? `${translateUi(currentLocale, "Конкуренты")} · `
    : "";
  return `${prefix}${region} · ${device}`.slice(0, 160);
}

function contextDisplayName(
  searchEngine: TrackingContextDraft["searchEngine"],
  regionLabel: string,
  device: TrackingContextDraft["device"],
  competitorMode: boolean,
  locale = "ru"
): string {
  const currentLocale = normalizedUiLocale(locale);
  const deviceLabel = translateUi(currentLocale, device === "MOBILE" ? "Мобильное" : "Десктоп");
  const region = translateUi(
    currentLocale,
    searchRegionDisplayName(searchEngine, regionLabel, regionLabel)
  );
  const prefix = competitorMode ? `${translateUi(currentLocale, "Конкуренты")} · ` : "";
  return `${prefix}${region} · ${deviceLabel}`;
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

function formatPlatformCharge(microAmount: string, uiLocale: string = "ru-RU"): string {
  const amount = BigInt(microAmount);
  const rubles = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  const decimal = fraction.length === 0
    ? "00"
    : fraction.padEnd(2, "0");
  return `${new Intl.NumberFormat(uiLocale).format(rubles)},${decimal} ₽`;
}

interface PendingSemanticRankRun {
  readonly context: TrackingContextSummary;
  readonly contextSignature: string;
  readonly estimate: RankEstimate;
}
