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
import { SemanticModal } from "./semantic-modal";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SearchEngineLogo } from "./search-engine-logo";
import {
  SemanticOperationScope,
  type SemanticOperationGroup,
  type SemanticOperationSelection
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
  const [searchSource, setSearchSource] =
    useState<"SEARCH_API" | "LIVE">("LIVE");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();
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
  const keywordIds = selections.map(({ id }) => id);
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
      )
    ])
      .then(([trackingResult, integrationResult, workspaceResult]) => {
        if (controller.signal.aborted) return;
        const options = effectiveProjectConnectorOptions(
          integrationResult,
          workspaceResult,
          "SERP_RANK_TRACKING"
        ).filter(
          (source) =>
            (source.provider === "ARSENKIN" || source.provider === "XMLSTOCK")
        );
        const preferredSource =
          options.find(({ provider: value }) => value === "XMLSTOCK") ??
          options[0];
        setSettings(trackingResult);
        setConnectorSettings(integrationResult);
        setWorkspaceRouting(workspaceResult);
        setCredentialId(preferredSource?.id ?? "");
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
  }, [projectId, workspaceId]);

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
      const draftErrors = validateTrackingContextDraft(contextDraft);
      const firstError = Object.values(draftErrors)[0];
      if (firstError) throw new Error(firstError);
      const contextName = technicalContextName(contextDraft);
      const launchDraft = {
        ...contextDraft,
        name: contextName
      };
      let selectedContext = matchingTechnicalContext(
        settings,
        launchDraft
      );
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
        setSettings((current) =>
          current ? withTrackingContext(current, createdContext) : current
        );
      } else if (!selectedContext) {
        throw new Error("Недостаточно прав для подготовки параметров съёма позиций.");
      }
      const authoritativeContext = await browserApiRequest<TrackingContextSummary>(
        trackingContextApiPath(projectId, selectedContext.id)
      );
      setSettings((current) =>
        current ? withTrackingContext(current, authoritativeContext) : current
      );
      if (!trackingContextMatchesDraft(authoritativeContext, launchDraft)) {
        createContextCommand.current = undefined;
        throw new Error(
          "Параметры профиля изменились параллельно. Съём не запущен; повторите попытку с актуальными настройками."
        );
      }
      selectedContext = authoritativeContext;
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
        searchSource
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
          searchSource
        );
        const estimatePayload = await browserApiRequest<unknown>(
          rankEstimatesApiPath(projectId),
          {
            method: "POST",
            body: rankEstimateInput(
              selectedContext.id,
              provider,
              selectedSource.id,
              searchSource
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
          <PositionRunParameters
            draft={contextDraft}
            onChange={setContextDraft}
            keywordCount={keywordIds.length}
            credentialId={credentialId}
            sources={sources}
            onCredentialChange={(nextCredentialId) => {
              const next = sources.find(({ id }) => id === nextCredentialId);
              setCredentialId(nextCredentialId);
              if (contextDraft.searchEngine === "GOOGLE") setSearchSource("LIVE");
              if (
                next?.provider === "ARSENKIN" &&
                contextDraft.searchEngine === "YANDEX"
              ) {
                setContextDraft((current) => ({ ...current, depth: 30 }));
              }
              setEstimate(undefined);
              pendingRun.current = undefined;
              estimateCommand.current = undefined;
              runCommand.current = undefined;
            }}
            onSearchSourceChange={(source) => {
              setSearchSource(source);
              setEstimate(undefined);
              pendingRun.current = undefined;
              estimateCommand.current = undefined;
              runCommand.current = undefined;
            }}
            searchSource={searchSource}
            scope={
              <SemanticOperationScope
                activeGroupId={activeGroupId}
                groups={groups}
                initialSelections={initialSelections}
                maxItems={rankProviderKeywordLimit}
                onChange={resolveScope}
                projectId={projectId}
              />
            }
          />
        )}
        {(estimate?.status === "BLOCKED" || error || scopeError) && <div className="semantic-workflow-feedback">
          {estimate?.status === "BLOCKED" && (
            <div className="inline-alert warning" role="alert">
              <strong>Запуск заблокирован</strong>
              <ul>{estimate.blockers.map(({ code }) => <li key={code}>{rankEstimateBlockerLabel(code)}</li>)}</ul>
            </div>
          )}
          {error && <div className="inline-alert danger" role="alert">{error}</div>}
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

function PositionRunParameters({
  draft,
  onChange,
  keywordCount,
  credentialId,
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
                    <b>Подключено</b>
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
