"use client";

import {
  operationResultDefaultPageSize,
  rankSearchSourceFromProviderMappingVersion
} from "@seo-platform/contracts";
import type {
  AiAnswerOperationResult,
  AiAnswerOperationResultRow,
  AiAnswerOperationSourceSummary,
  ClusteringOperationResult,
  ClusteringProposalApplyResult,
  ClusteringProposalClusterSummary,
  ClusteringProposalResultRow,
  ClusteringProposalSectionResult,
  CrawlOperationResultPage,
  CrawlOperationResultRow,
  ConfirmKeywordResearchRunInput,
  FrequencyOperationResult,
  FrequencyOperationResultRow,
  KeywordResearchCollection,
  KeywordResearchRunSummary,
  OperationResultPageInfo,
  ProjectPresenceMember,
  RankJobSummary,
  RankOperationResult,
  RankOperationResultRow,
  RankRuntimeDiagnosticEntry,
  RankRuntimeDiagnostics,
  SemanticCluster,
  SemanticKeywordGroup,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  clusteringProposalSectionApiPath,
  mergeOperationResultRows,
  operationResultApiPath,
  type OperationResultKind
} from "../lib/operation-result-routes";
import { operationStatusLabel } from "../lib/operation-status-presentation";
import {
  aiAnswerCollectionTitle,
  isCompetitorCollection,
  keywordResearchCollectionTitle,
  rankCollectionDepthLabel,
  rankCollectionTitle
} from "../lib/operation-collection-purpose";
import { projectPresenceAvatarUrl } from "../lib/project-presence";
import {
  rankFailureReason,
  rankPollAttempts
} from "../lib/rank-result-presentation";
import {
  rememberClusterFolderAction,
  rememberClusterFolderDestination,
  serializeClusterFolderOverride,
  type ClusterFolderDecision
} from "../lib/semantic-clustering-folder-decision";
import {
  announceWorkspaceDropdownOpen,
  workspaceDropdownOpenEvent
} from "../lib/dropdown-events";
import {
  rankJobFailureMessage,
  rankSearchSystemLabel
} from "../lib/rank-jobs";
import { rankOperationCounts } from "../lib/rank-operation-counts";
import {
  searchContextDisplayName,
  searchRegionDisplayName,
  seoRegionDisplayName
} from "../lib/seo-regions";
import { ProviderLogo } from "./provider-logo";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { KeywordResearchRunPreview } from "./keyword-research-workspace";
import { SemanticGroupPicker } from "./semantic-group-picker";
import { SemanticModal } from "./semantic-modal";
import { frequencyCollectionParameters, frequencyCollectionTitle } from "../lib/frequency-operation-presentation";
import styles from "./operation-result-workspace.module.css";
import { UiText, useUiLocale } from "./ui-locale";


type OperationResultData =
  | Readonly<{ kind: "frequency"; value: FrequencyOperationResult }>
  | Readonly<{ kind: "ai-answer"; value: AiAnswerOperationResult }>
  | Readonly<{ kind: "clustering"; value: ClusteringOperationResult }>
  | Readonly<{ kind: "rank"; value: RankOperationResult }>
  | Readonly<{ kind: "crawl"; value: CrawlOperationResultPage }>
  | Readonly<{ kind: "research"; value: KeywordResearchRunSummary }>;

export interface RankRuntimeLogState {
  readonly active: boolean;
}

export function OperationResultWorkspace({
  embedded = false,
  kind,
  operationId,
  onClusteringApplied,
  onDirtyChange,
  onRankRuntimeLogStateChange,
  projectId
}: Readonly<{
  embedded?: boolean;
  kind: OperationResultKind;
  operationId: string;
  onClusteringApplied?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRankRuntimeLogStateChange?: (state?: RankRuntimeLogState) => void;
  projectId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [data, setData] = useState<OperationResultData>();
  const [rankJobWithoutResult, setRankJobWithoutResult] = useState<RankJobSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [pageError, setPageError] = useState<Readonly<{
    cursor: string;
    message: string;
  }>>();
  const [rankDiagnosticsOpen, setRankDiagnosticsOpen] = useState(false);
  const [projectMembers, setProjectMembers] = useState<
    readonly ProjectPresenceMember[]
  >([]);
  const scopeKey = `${projectId}:${kind}:${operationId}`;
  const tablePanelRef = useRef<HTMLDivElement>(null);
  const infiniteSentinelRef = useRef<HTMLDivElement>(null);
  const activeScopeRef = useRef(scopeKey);
  const tailCursorRef = useRef<string | undefined>(undefined);
  const requestedCursorsRef = useRef(new Set<string>());

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    const requestScope = scopeKey;
    const requestCursor = quiet ? tailCursorRef.current : undefined;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(undefined);
    try {
      const result = await loadOperationResult(
        projectId,
        kind,
        operationId,
        operationResultPageRequest(
          kind,
          requestCursor
        ),
        signal
      );
      if (
        !signal?.aborted &&
        activeScopeRef.current === requestScope &&
        (!quiet || tailCursorRef.current === requestCursor)
      ) {
        setData((current) => quiet
          ? mergeOperationResultData(current, result)
          : result
        );
        setRankJobWithoutResult(undefined);
      }
    } catch (requestError) {
      if (!signal?.aborted && activeScopeRef.current === requestScope) {
        const rankJob = await loadRankJobWithoutResult(
          projectId,
          kind,
          operationId,
          requestError,
          signal
        );
        if (
          !signal?.aborted &&
          activeScopeRef.current === requestScope &&
          rankJob
        ) {
          setRankJobWithoutResult(rankJob);
          setError(undefined);
        } else if (
          !signal?.aborted &&
          activeScopeRef.current === requestScope
        ) {
          setRankJobWithoutResult(undefined);
          setError(operationResultError(requestError));
        }
      }
    } finally {
      if (!signal?.aborted && activeScopeRef.current === requestScope) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [kind, operationId, projectId, scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    activeScopeRef.current = scopeKey;
    tailCursorRef.current = undefined;
    requestedCursorsRef.current.clear();
    setData(undefined);
    setRankJobWithoutResult(undefined);
    setError(undefined);
    setPageError(undefined);
    setLoadingMore(false);
    setRankDiagnosticsOpen(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, scopeKey]);

  useEffect(() => {
    const controller = new AbortController();
    void browserApiRequest<readonly ProjectPresenceMember[]>(
      `/app/api/projects/${encodeURIComponent(projectId)}/presence-members`,
      { signal: controller.signal }
    ).then((members) => {
      if (!controller.signal.aborted) setProjectMembers(members);
    }).catch(() => {
      if (!controller.signal.aborted) setProjectMembers([]);
    });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (
      (!data || !isActiveOperation(data)) &&
      (!rankJobWithoutResult || !isActiveStatus(rankJobWithoutResult.status))
    ) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal, true);
    }, 2_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [data, load, rankJobWithoutResult]);

  const rankRuntimeJob = data?.kind === "rank"
    ? data.value.job
    : rankJobWithoutResult;
  const rankRuntimeLogAvailable = rankRuntimeJob?.provider === "XMLSTOCK";
  const rankRuntimeLogActive = rankRuntimeJob
    ? isActiveStatus(rankRuntimeJob.status)
    : false;

  useEffect(() => {
    onRankRuntimeLogStateChange?.(
      rankRuntimeLogAvailable
        ? { active: rankRuntimeLogActive }
        : undefined
    );
  }, [
    onRankRuntimeLogStateChange,
    rankRuntimeLogActive,
    rankRuntimeLogAvailable
  ]);

  const loadMore = useCallback(async (): Promise<void> => {
    const page = data ? operationResultPage(data) : undefined;
    const cursor = page?.nextCursor;
    if (
      !data ||
      data.kind === "research" ||
      !page?.hasNext ||
      !cursor ||
      loadingMore ||
      requestedCursorsRef.current.has(cursor)
    ) {
      return;
    }
    const requestScope = scopeKey;
    requestedCursorsRef.current.add(cursor);
    setLoadingMore(true);
    setError(undefined);
    setPageError(undefined);
    try {
      const next = await loadOperationResult(
        projectId,
        data.kind,
        operationId,
        operationResultPageRequest(data.kind, cursor)
      );
      if (activeScopeRef.current !== requestScope) return;
      tailCursorRef.current = cursor;
      setPageError(undefined);
      setData((current) => mergeOperationResultData(current, next));
    } catch (requestError) {
      if (activeScopeRef.current === requestScope) {
        setPageError({ cursor, message: operationResultError(requestError) });
      }
    } finally {
      if (activeScopeRef.current === requestScope) setLoadingMore(false);
    }
  }, [data, loadingMore, operationId, projectId, scopeKey]);

  const resultPage = data ? operationResultPage(data) : undefined;
  const nextCursor = resultPage?.hasNext ? resultPage.nextCursor : undefined;
  const autoLoadCursor = nextCursor && pageError?.cursor !== nextCursor
    ? nextCursor
    : undefined;

  useEffect(() => {
    const root = tablePanelRef.current;
    const target = infiniteSentinelRef.current;
    if (!root || !target || !autoLoadCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "320px 0px", threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [autoLoadCursor, loadMore]);

  function retryResultLoad(): void {
    if (pageError) {
      requestedCursorsRef.current.delete(pageError.cursor);
      setPageError(undefined);
      void loadMore();
      return;
    }
    void load(undefined, true);
  }

  function reloadAfterClusteringMutation(): void {
    tailCursorRef.current = undefined;
    requestedCursorsRef.current.clear();
    setPageError(undefined);
    onClusteringApplied?.();
    void load();
  }

  if (loading && !data) {
    return (
      <section className={workspaceClass(embedded)}>
        <div className={styles.state} role="status">
          <span className={styles.spinner} />
          <strong><UiText text="Загружаем результат операции…" /></strong>
          <p><UiText text="Получаем только данные этого запуска в текущем проекте." /></p>
        </div>
      </section>
    );
  }

  if (!data) {
    if (rankJobWithoutResult) {
      const active = isActiveStatus(rankJobWithoutResult.status);
      return (
        <>
          <section className={workspaceClass(embedded)}>
            <div
              className={`${styles.state} ${active ? "" : styles.error}`}
              role={active ? "status" : "alert"}
            >
              {active && <span className={styles.spinner} />}
              <strong>{active ? <UiText text="Результат ещё формируется" /> : <UiText text="Результат не сформирован" />}</strong>
              <p>
                {active
                  ? <UiText text="{0} · {1} из {2}" values={[String(operationStatusLabel(rankJobWithoutResult.status)), String(rankJobWithoutResult.progress.current), String(rankJobWithoutResult.progress.total)]} />
                  : rankJobWithoutResult.failure
                    ? rankJobFailureMessage(rankJobWithoutResult.failure.code)
                    : <UiText text="Операция завершена со статусом «{0}»." values={[String(operationStatusLabel(rankJobWithoutResult.status))]} />}
              </p>
              {!embedded && rankJobWithoutResult.provider === "XMLSTOCK" && (
                <button
                  className={styles.runtimeLogButton}
                  onClick={() => setRankDiagnosticsOpen(true)}
                  type="button"
                >
                  <span aria-hidden="true" />
                  <UiText text="Логи XMLStock" /></button>
              )}
              {!active && (
                <button onClick={() => void load(undefined, true)} type="button">
                  <UiText text="Повторить загрузку" /></button>
              )}
            </div>
          </section>
          {!embedded && rankDiagnosticsOpen && rankJobWithoutResult.provider === "XMLSTOCK" && (
            <RankRuntimeDiagnosticsModal
              active={active}
              onClose={() => setRankDiagnosticsOpen(false)}
              operationId={operationId}
              projectId={projectId}
            />
          )}
        </>
      );
    }
    return (
      <section className={workspaceClass(embedded)}>
        <div className={`${styles.state} ${styles.error}`} role="alert">
          <strong><UiText text="Не удалось открыть результат" /></strong>
          <p>{error ?? <UiText text="Результат операции временно недоступен." />}</p>
          <button onClick={() => void load(undefined, true)} type="button">
            <UiText text="Повторить" /></button>
        </div>
      </section>
    );
  }

  const summary = operationSummary(data, uiLocale);
  const visibleError = pageError?.message ?? error;
  const actorId = operationActorId(data);
  const actor = actorId
    ? projectMembers.find(({ userId }) => userId === actorId)
    : undefined;

  return (
    <section className={workspaceClass(embedded)}>
      {!embedded && (
        <header className={styles.header}>
          <div className={styles.heading}>
            <div className={styles.titleRow}>
              {summary.provider && <ProviderLogo provider={summary.provider} />}
              <div>
                <h1>{summary.title}</h1>
                <p>{summary.description}</p>
              </div>
            </div>
          </div>
          <div className={styles.headerActions}>
            {data.kind === "rank" && data.value.job.provider === "XMLSTOCK" && (
              <button
                className={styles.runtimeLogButton}
                onClick={() => setRankDiagnosticsOpen(true)}
                type="button"
              >
                <span aria-hidden="true" />
                <UiText text="Логи XMLStock" /></button>
            )}
            <button
              disabled={refreshing}
              onClick={() => void load(undefined, true)}
              type="button"
            >
              {refreshing ? <UiText text="Обновляем…" /> : <UiText text="Обновить" />}
            </button>
            <a href="/app/tasks"><UiText text="История операций" /></a>
          </div>
        </header>
      )}

      <div className={styles.contextBar}>
        {summary.context && (
          <span className={styles.contextItem}>
            <Icon name="projects" />
            <span><small><UiText text="Контекст" /></small><strong>{summary.context}</strong></span>
          </span>
        )}
        <span className={styles.contextItem}>
          {actor?.avatarUpdatedAt ? (
            <img
              alt=""
              src={projectPresenceAvatarUrl(projectId, actor)}
            />
          ) : (
            <i>{actor ? initials(actor.displayName) : "A"}</i>
          )}
          <span>
            <small><UiText text="Пользователь" /></small>
            <strong>{actor?.displayName ?? (actorId ? "Участник проекта" : "Автоматический запуск")}</strong>
          </span>
        </span>
        <span className={styles.contextDescription}>{summary.description}</span>
      </div>

      <div className={`${styles.summary}${data.kind === "clustering" ? ` ${styles.summaryClustering}` : ""}`}>
        <div className={styles.statusBlock}>
          <span className={`${styles.status} ${styles[`status${summary.tone}`]}`}>
            {summary.status}
          </span>
          <strong>{summary.progress}</strong>
          <span className={styles.progress}>
            <i style={{ width: `${summary.progressPercent}%` }} />
          </span>
        </div>
        {summary.facts.map((fact) => (
          <div className={styles.fact} key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>

      {visibleError && (
        <div className={styles.inlineError} role="alert">
          <span>{<UiText text={visibleError ?? ""} />}</span>
          <button onClick={retryResultLoad} type="button"><UiText text="Повторить" /></button>
        </div>
      )}

      {data.kind === "clustering" && (
        <ClusteringApplyPanel
          onChanged={reloadAfterClusteringMutation}
          {...(onDirtyChange ? { onDirtyChange } : {})}
          operationId={operationId}
          projectId={projectId}
          result={data.value}
        />
      )}

      {data.kind === "research" && (
        <ResearchApplyPanel
          onChanged={() => void load()}
          {...(onDirtyChange ? { onDirtyChange } : {})}
          projectId={projectId}
          result={data.value}
        />
      )}

      {data.kind !== "clustering" && data.kind !== "research" && <div className={styles.tablePanel} ref={tablePanelRef}>
        <OperationTable data={data} />
        {nextCursor && (
          <div
            aria-hidden="true"
            className={styles.infiniteSentinel}
            ref={infiniteSentinelRef}
          >
            {loadingMore && <span className={styles.inlineSpinner} />}
          </div>
        )}
      </div>}
      {resultPage && data.kind !== "clustering" && (
        <div className={styles.resultPager} aria-label={uiText("Состояние загрузки результата")}>
          <span>{operationResultRange(data, uiLocale)}</span>
          <span aria-live="polite" className={styles.resultLoadState}>
            {loadingMore
              ? <UiText text="Подгружаем следующие строки…" />
              : resultPage.hasNext
                ? <UiText text="Прокрутите ниже — строки загрузятся автоматически" />
                : isActiveOperation(data)
                  ? <UiText text="Все доступные строки загружены · ждём новые" />
                  : <UiText text="Все строки загружены" />}
          </span>
        </div>
      )}
      {!embedded && rankDiagnosticsOpen && data.kind === "rank" && (
        <RankRuntimeDiagnosticsModal
          active={isActiveStatus(data.value.job.status)}
          onClose={() => setRankDiagnosticsOpen(false)}
          operationId={operationId}
          projectId={projectId}
        />
      )}
    </section>
  );
}

function OperationTable({ data }: Readonly<{ data: OperationResultData }>) {
  if (data.kind === "frequency") return <FrequencyTable result={data.value} />;
  if (data.kind === "ai-answer") return <AiAnswerTable result={data.value} />;
  if (data.kind === "clustering") return null;
  if (data.kind === "rank") return <RankTable result={data.value} />;
  if (data.kind === "crawl") return <CrawlTable result={data.value} />;
  return <ResearchTable result={data.value} />;
}

function ResearchApplyPanel({
  onChanged,
  onDirtyChange,
  projectId,
  result
}: Readonly<{
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  projectId: string;
  result: KeywordResearchRunSummary;
}>) {
  const [collection, setCollection] = useState<KeywordResearchCollection>();
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(result.rows.map(({ id }) => id))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rowSignature = result.rows.map(({ id }) => id).join("\n");

  useEffect(() => {
    setSelected(new Set(rowSignature ? rowSignature.split("\n") : []));
  }, [result.id, rowSignature]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      browserApiRequest<KeywordResearchCollection>(
        `/app/api/v1/projects/${encodeURIComponent(projectId)}/keyword-research-runs`,
        { signal: controller.signal }
      ),
      browserApiRequest<readonly SemanticKeywordGroup[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
        { signal: controller.signal }
      )
    ]).then(([nextCollection, nextGroups]) => {
      if (controller.signal.aborted) return;
      setCollection(nextCollection);
      setGroups(nextGroups);
      setError(undefined);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        setError(operationResultError(requestError));
      }
    });
    return () => controller.abort();
  }, [projectId]);

  async function confirm(input: ConfirmKeywordResearchRunInput): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/v1/projects/${encodeURIComponent(projectId)}/keyword-research-runs/${encodeURIComponent(result.id)}/confirm`,
        { method: "POST", ifMatch: result.version, body: input }
      );
      onDirtyChange?.(false);
      onChanged();
    } catch (requestError) {
      setError(operationResultError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/v1/projects/${encodeURIComponent(projectId)}/keyword-research-runs/${encodeURIComponent(result.id)}/cancel`,
        { method: "POST", ifMatch: result.version, body: {} }
      );
      onDirtyChange?.(false);
      onChanged();
    } catch (requestError) {
      setError(operationResultError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function retryImport(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/v1/projects/${encodeURIComponent(projectId)}/keyword-research-runs/${encodeURIComponent(result.id)}/retry-import`,
        { method: "POST", ifMatch: result.version, body: {} }
      );
      onChanged();
    } catch (requestError) {
      setError(operationResultError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.researchApplyPanel}>
      {error && <div className={styles.inlineError} role="alert">{<UiText text={error ?? ""} />}</div>}
      <KeywordResearchRunPreview
        busy={busy}
        canCancel={collection?.access.canCancel === true}
        canImport={collection?.access.canImport === true}
        groups={groups}
        onCancel={() => void cancel()}
        onConfirm={(input) => void confirm(input)}
        onRetryImport={() => void retryImport()}
        {...(onDirtyChange ? { onDirtyChange } : {})}
        onSelected={setSelected}
        run={result}
        selected={selected}
      />
    </div>
  );
}

function ClusteringApplyPanel({
  onChanged,
  onDirtyChange,
  operationId,
  projectId,
  result
}: Readonly<{
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  operationId: string;
  projectId: string;
  result: ClusteringOperationResult;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const proposal = result.proposal;
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [semanticClusters, setSemanticClusters] = useState<readonly SemanticCluster[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const folderMode = "CREATE_SUBGROUPS" as const;
  const [unclusteredFolderAction, setUnclusteredFolderAction] = useState<"KEEP" | "NEW">("KEEP");
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<ReadonlySet<string>>(new Set());
  const [nameOverrides, setNameOverrides] = useState<ReadonlyMap<string, string>>(new Map());
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<ReadonlySet<string>>(new Set());
  const [assignmentGroupId, setAssignmentGroupId] = useState("");
  const [keywordGroupOverrides, setKeywordGroupOverrides] = useState<ReadonlyMap<string, string>>(new Map());
  const [clusterAssignmentOverrides, setClusterAssignmentOverrides] = useState<ReadonlyMap<string, ClusterAssignmentDecision>>(new Map());
  const [clusterFolderOverrides, setClusterFolderOverrides] = useState<ReadonlyMap<string, ClusterFolderDecision>>(new Map());
  const [openClusterFolder, setOpenClusterFolder] = useState<OpenClusterFolderPicker>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"APPLY" | "REJECT">();
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setUnclusteredFolderAction("KEEP");
    setCollapsedSectionIds(new Set());
    setNameOverrides(new Map());
    setSelectedKeywordIds(new Set());
    setAssignmentGroupId("");
    setKeywordGroupOverrides(new Map());
    setClusterAssignmentOverrides(new Map());
    setClusterFolderOverrides(new Map());
    setOpenClusterFolder(undefined);
    setConfirmReject(false);
    setError(undefined);
  }, [proposal?.id, proposal?.version]);

  const dirty =
    unclusteredFolderAction !== "KEEP" ||
    nameOverrides.size > 0 ||
    selectedKeywordIds.size > 0 ||
    keywordGroupOverrides.size > 0 ||
    clusterAssignmentOverrides.size > 0 ||
    clusterFolderOverrides.size > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (proposal?.status !== "READY") return;
    const controller = new AbortController();
    setGroupsLoading(true);
    setSemanticClusters([]);
    void Promise.allSettled([
      browserApiRequest<readonly SemanticKeywordGroup[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
        { signal: controller.signal }
      ),
      browserApiRequest<readonly SemanticCluster[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/clusters`,
        { signal: controller.signal }
      )
    ])
      .then(([groupResult, clusterResult]) => {
        if (controller.signal.aborted) return;
        if (groupResult.status === "fulfilled") {
          setGroups(groupResult.value.filter(({ systemKind }) => systemKind === undefined));
        }
        if (clusterResult.status === "fulfilled") {
          setSemanticClusters(clusterResult.value);
        }
        const failed = groupResult.status === "rejected"
          ? groupResult.reason
          : clusterResult.status === "rejected"
            ? clusterResult.reason
            : undefined;
        if (failed !== undefined) setError(clusteringMutationError(failed));
      })
      .finally(() => {
        if (!controller.signal.aborted) setGroupsLoading(false);
      });
    return () => controller.abort();
  }, [projectId, proposal?.status]);

  if (!proposal) {
    if (!isActiveStatus(result.run.status)) return null;
    return (
      <section className={styles.clusteringPending}>
        <span className={styles.inlineSpinner} />
        <div><strong><UiText text="Arsenkin формирует группы" /></strong><small><UiText text="Черновик раскладки появится здесь после получения и проверки результата." /></small></div>
      </section>
    );
  }

  const ready = proposal.status === "READY";
  const proposalVersion = proposal.version;

  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const clusterSections = clusteringSections(result, normalizedQuery);
  const renderedSections = clusterSections.slice(0, 500);
  const invalidExistingFolder = [...clusterFolderOverrides.values()].some(
    ({ action, groupId }) => action === "EXISTING" && !groupId
  );
  const clusterAssignments = result.clusters.map((cluster) =>
    clusterAssignmentOverrides.get(cluster.id) ?? defaultClusterAssignment(
      cluster,
      result.run.replaceExistingClusters
    )
  );
  const semanticClusterAssignmentCount = clusterAssignments.filter(
    ({ action }) => action !== "KEEP"
  ).length;
  const newSemanticClusterCount = clusterAssignments.filter(
    ({ action }) => action === "NEW"
  ).length;
  const invalidRequiredName = result.clusters.some((cluster) => {
    const assignment = clusterAssignmentOverrides.get(cluster.id) ??
      defaultClusterAssignment(cluster, result.run.replaceExistingClusters);
    const folderAction = clusterFolderOverrides.get(cluster.id)?.action ?? "NEW";
    if (assignment.action !== "NEW" && folderAction !== "NEW") return false;
    return !(nameOverrides.get(cluster.id) ?? cluster.name).trim();
  });
  const newFolderCount = result.clusters.reduce(
    (count, cluster) => (clusterFolderOverrides.get(cluster.id)?.action ?? "NEW") === "NEW"
      ? count + 1
      : count,
    unclusteredFolderAction === "NEW" && proposal.unclusteredCount > 0 ? 1 : 0
  );
  const existingFolderClusterCount = [...clusterFolderOverrides.values()].filter(
    ({ action, groupId }) => action === "EXISTING" && Boolean(groupId)
  ).length;
  const canApply = !invalidExistingFolder && (
    keywordGroupOverrides.size > 0 ||
    semanticClusterAssignmentCount > 0 ||
    newFolderCount > 0 ||
    existingFolderClusterCount > 0
  );
  const renderedSectionIds = renderedSections.map(({ cluster }) => cluster?.id ?? "unclustered");
  const allSectionsCollapsed = renderedSectionIds.length > 0 && renderedSectionIds.every(
    (sectionId) => collapsedSectionIds.has(sectionId)
  );
  const resultLoadState = isActiveStatus(result.run.status)
    ? "Результат ещё формируется · запросы подгружаются внутри кластеров"
    : "Запросы подгружаются отдельно внутри каждого кластера";

  function updateName(cluster: ClusteringProposalClusterSummary, value: string): void {
    setNameOverrides((current) => {
      const next = new Map(current);
      if (value === cluster.name) next.delete(cluster.id);
      else next.set(cluster.id, value);
      return next;
    });
  }

  function toggleSection(sectionId: string): void {
    setCollapsedSectionIds((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function toggleAllSections(): void {
    setCollapsedSectionIds((current) => {
      const next = new Set(current);
      for (const sectionId of renderedSectionIds) {
        if (allSectionsCollapsed) next.delete(sectionId);
        else next.add(sectionId);
      }
      return next;
    });
  }

  function toggleKeyword(keywordId: string): void {
    setSelectedKeywordIds((current) => {
      const next = new Set(current);
      if (next.has(keywordId)) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  function assignSelectedKeywords(): void {
    setKeywordGroupOverrides((current) => {
      const next = new Map(current);
      for (const keywordId of selectedKeywordIds) {
        if (assignmentGroupId) next.set(keywordId, assignmentGroupId);
        else next.delete(keywordId);
      }
      return next;
    });
    setSelectedKeywordIds(new Set());
  }

  function updateClusterFolderDecision(
    proposalClusterId: string,
    action: "NEW" | "KEEP" | "EXISTING"
  ): void {
    setClusterFolderOverrides((current) => {
      const next = new Map(current);
      const previous = current.get(proposalClusterId);
      next.set(proposalClusterId, rememberClusterFolderAction(previous, action));
      return next;
    });
    setOpenClusterFolder(undefined);
  }

  function updateClusterAssignment(
    cluster: ClusteringProposalClusterSummary,
    value: string
  ): void {
    const nextDecision: ClusterAssignmentDecision = value === "NEW"
      ? { action: "NEW" }
      : value === "KEEP"
        ? { action: "KEEP" }
        : { action: "EXISTING", clusterId: value.slice("EXISTING:".length) };
    const defaultDecision = defaultClusterAssignment(
      cluster,
      result.run.replaceExistingClusters
    );
    setClusterAssignmentOverrides((current) => {
      const next = new Map(current);
      if (sameClusterAssignment(nextDecision, defaultDecision)) next.delete(cluster.id);
      else next.set(cluster.id, nextDecision);
      return next;
    });
  }

  function updateClusterDestination(
    proposalClusterId: string,
    groupId: string
  ): void {
    setClusterFolderOverrides((current) => {
      const next = new Map(current);
      const decision = current.get(proposalClusterId) ?? { action: "NEW" as const };
      next.set(
        proposalClusterId,
        rememberClusterFolderDestination(decision, groupId)
      );
      return next;
    });
    setOpenClusterFolder(undefined);
  }

  async function apply(): Promise<void> {
    if (!canApply || busy) return;
    setBusy("APPLY");
    setError(undefined);
    try {
      const overrides = [...nameOverrides]
        .map(([proposalClusterId, name]) => ({ proposalClusterId, name: name.trim() }))
        .filter(({ name }) => name.length > 0);
      await browserApiRequest<ClusteringProposalApplyResult>(
        `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs/${encodeURIComponent(operationId)}/apply`,
        {
          method: "POST",
          body: {
            proposalVersion,
            excludedClusterIds: [],
            clusterNameOverrides: overrides,
            clusterAssignmentOverrides: result.clusters.map((cluster) => {
              const decision = clusterAssignmentOverrides.get(cluster.id) ??
                defaultClusterAssignment(cluster, result.run.replaceExistingClusters);
              return {
                proposalClusterId: cluster.id,
                action: decision.action,
                ...(decision.action === "EXISTING"
                  ? { clusterId: decision.clusterId }
                  : {})
              };
            }),
            keywordGroupOverrides: [...keywordGroupOverrides].map(
              ([keywordId, groupId]) => ({ keywordId, groupId })
            ),
            clusterFolderOverrides: [...clusterFolderOverrides].map(
              ([proposalClusterId, override]) => serializeClusterFolderOverride(
                proposalClusterId,
                override
              )
            ),
            folderMode,
            createUnclusteredGroup: unclusteredFolderAction === "NEW"
          }
        }
      );
      onChanged();
    } catch (requestError) {
      setError(clusteringMutationError(requestError));
    } finally {
      setBusy(undefined);
    }
  }

  async function reject(): Promise<void> {
    if (busy) return;
    if (!confirmReject) {
      setConfirmReject(true);
      return;
    }
    setBusy("REJECT");
    setError(undefined);
    try {
      await browserApiRequest(
        `/app/api/projects/${encodeURIComponent(projectId)}/clustering-runs/${encodeURIComponent(operationId)}/reject`,
        { method: "POST", body: { proposalVersion } }
      );
      onChanged();
    } catch (requestError) {
      setError(clusteringMutationError(requestError));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className={`${styles.clusteringApply}${ready ? "" : ` ${styles.clusteringReadOnly}`}`}>
      <header className={styles.clusteringApplyHeader}>
        <div>
          <strong>{ready ? <UiText text="Распределите запросы по SEO-кластерам и папкам" /> : proposal.status === "APPLIED" ? <UiText text="Раскладка применена" /> : <UiText text="Черновик отклонён" />}</strong>
          <small>{ready
            ? <UiText text="Для каждого результата отдельно выберите SEO-кластер и папку. Текущие назначения можно безопасно оставить." />
            : proposal.status === "APPLIED"
              ? <UiText text="{0} запросов обновлено · {1} папок создано." values={[String(formatInteger(proposal.appliedKeywordCount, uiLocale)), String(formatInteger(proposal.createdGroupCount, uiLocale))]} />
              : <UiText text="Кластеры и папки проекта не изменялись." />}</small>
        </div>
        <span>{ready ? <UiText text="{0} можно применить" values={[String(formatInteger(proposal.readyCount, uiLocale))]} /> : proposal.status === "APPLIED" ? <UiText text="Применено" /> : <UiText text="Отклонено" />}</span>
      </header>
      <div className={styles.clusteringApplyBody}>
        <div className={styles.clusteringClusterPicker}>
          <div className={styles.clusteringClusterTools}>
            <label><Icon name="search" /><input aria-label={uiText("Поиск кластера")} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Найти запрос, кластер или URL")} type="search" value={query} /></label>
            <button disabled={renderedSectionIds.length === 0} onClick={toggleAllSections} type="button">
              {allSectionsCollapsed ? <UiText text="Развернуть все" /> : <UiText text="Свернуть все" />}
            </button>
          </div>
          <div className={styles.clusteringSectionList}>
            {renderedSections.map(({ cluster, rowFilter, rows }) => {
              const sectionId = cluster?.id ?? "unclustered";
              const topUrls = cluster?.topUrls.length
                ? cluster.topUrls
                : cluster?.topUrl
                  ? [{ url: cluster.topUrl }]
                  : [];
              const folderDecision = cluster
                ? clusterFolderOverrides.get(cluster.id)
                : undefined;
              const folderDecisionValue = cluster
                ? folderDecision?.action ?? "NEW"
                : unclusteredFolderAction;
              const clusterAssignment = cluster
                ? clusterAssignmentOverrides.get(cluster.id) ?? defaultClusterAssignment(
                    cluster,
                    result.run.replaceExistingClusters
                  )
                : undefined;
              const clusterAssignmentValue = clusterAssignment?.action === "EXISTING"
                ? `EXISTING:${clusterAssignment.clusterId}`
                : clusterAssignment?.action ?? "KEEP";
              const namePurpose = cluster && clusterAssignment?.action === "NEW" && folderDecisionValue === "NEW"
                ? "Название нового SEO-кластера и папки"
                : clusterAssignment?.action === "NEW"
                  ? "Название нового SEO-кластера"
                  : "Название новой папки";
              const canRename = Boolean(
                cluster && (clusterAssignment?.action === "NEW" || folderDecisionValue === "NEW")
              );
              const expanded = Boolean(normalizedQuery) || !collapsedSectionIds.has(sectionId);
              const destinationLabel = folderDecisionValue === "NEW"
                ? `Внутри: ${groupPath(groups, folderDecision?.parentGroupId ?? "", "Корневая папка")}`
                : `В папку: ${groupPath(groups, folderDecision?.groupId ?? "", "Выберите папку")}`;
              return (
                <article className={`${styles.clusteringSection} ${styles.clusteringClusterIncluded}${expanded ? "" : ` ${styles.clusteringSectionCollapsed}`}`} key={`${proposalVersion}:${sectionId}`}>
                  <header>
                    <button
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Свернуть" : "Развернуть"} ${cluster?.name ?? "Некластеризовано"}`}
                      className={styles.clusteringDisclosure}
                      onClick={() => toggleSection(sectionId)}
                      type="button"
                    >
                      <Icon name="chevronRight" />
                    </button>
                    <Icon name={cluster ? "folderPlus" : "inbox"} />
                    {cluster && ready && canRename ? (
                      <label
                        className={styles.clusteringFolderNameField}
                        title={uiText("Название можно изменить перед применением")}
                      >
                        <Icon name="edit" />
                        <span>{namePurpose}</span>
                        <input
                          aria-label={`${namePurpose}: ${cluster.name}`}
                          maxLength={255}
                          onChange={(event) => updateName(cluster, event.target.value)}
                          value={nameOverrides.get(cluster.id) ?? cluster.name}
                        />
                      </label>
                    ) : <strong>{cluster?.name ?? <UiText text="Некластеризовано" />}</strong>}
                    <span>{formatInteger(cluster?.keywordCount ?? rows.length, uiLocale)} <UiText text="запросов" before=" " /></span>
                    {ready && <div className={`${styles.clusteringClusterControls}${cluster ? "" : ` ${styles.clusteringFolderControlsOnly}`}`}>
                      {cluster && <CustomSelect
                        aria-label={uiText("SEO-кластер для результата {0}", [String(cluster.name)])}
                        className={styles.clusteringSemanticClusterSelect ?? ""}
                        disabled={groupsLoading}
                        emptyMessage={uiText("SEO-кластеры не найдены")}
                        onChange={(event) => updateClusterAssignment(cluster, event.target.value)}
                        searchable={semanticClusters.length > 8}
                        searchPlaceholder={uiText("Найти SEO-кластер")}
                        value={clusterAssignmentValue}
                      >
                        <option value="NEW"><UiText text="Создать новый SEO-кластер" /></option>
                        <option value="KEEP">
                          {cluster.currentClusterKeywordCount > 0
                            ? <UiText text="Оставить текущие SEO-кластеры · {0}" values={[String(formatInteger(cluster.currentClusterKeywordCount, uiLocale))]} />
                            : <UiText text="Оставить без SEO-кластера" />}
                        </option>
                        {semanticClusters.map((semanticCluster) => (
                          <option
                            disabled={semanticCluster.isLocked || semanticCluster.excludeFromReclustering}
                            key={semanticCluster.id}
                            value={`EXISTING:${semanticCluster.id}`}
                          >
                            {<UiText text="В существующий: {0} · {1}" values={[String(semanticCluster.name), String(formatInteger(semanticCluster.keywordCount, uiLocale))]} />}
                          </option>
                        ))}
                      </CustomSelect>}
                      <div className={styles.clusteringClusterDestination}>
                        <CustomSelect
                          aria-label={uiText("Куда перенести {0}", [String(cluster ? `результат ${cluster.name}` : "некластеризованные запросы")])}
                          className={styles.clusteringDestinationSelect ?? ""}
                          onChange={(event) => {
                            const value = event.target.value as "NEW" | "KEEP" | "EXISTING";
                            if (cluster) updateClusterFolderDecision(cluster.id, value);
                            else setUnclusteredFolderAction(value === "NEW" ? "NEW" : "KEEP");
                          }}
                          value={folderDecisionValue}
                        >
                          <option value="NEW">{cluster ? <UiText text="Создать новую папку" /> : <UiText text="Создать папку «Некластеризовано»" />}</option>
                          {cluster && <option value="EXISTING"><UiText text="Перенести в существующую папку" /></option>}
                          <option value="KEEP"><UiText text="Оставить в текущих папках" /></option>
                        </CustomSelect>
                        {cluster && folderDecisionValue !== "KEEP" && (
                          <button
                            aria-expanded={openClusterFolder?.proposalClusterId === cluster.id}
                            aria-haspopup="dialog"
                            onClick={(event) => {
                              const anchor = event.currentTarget;
                              setOpenClusterFolder((current) =>
                                current?.proposalClusterId === cluster.id
                                  ? undefined
                                  : { anchor, proposalClusterId: cluster.id }
                              );
                            }}
                            title={destinationLabel}
                            type="button"
                          >
                            <Icon name="inbox" />
                            <span>{destinationLabel}</span>
                          </button>
                        )}
                      </div>
                    </div>}
                  </header>
                  {ready && cluster && openClusterFolder?.proposalClusterId === cluster.id && folderDecisionValue !== "KEEP" && (
                    <ClusteringFolderPopover
                      anchor={openClusterFolder.anchor}
                      groups={groups}
                      loading={groupsLoading}
                      mode={folderDecisionValue}
                      onChange={(groupId) => updateClusterDestination(cluster.id, groupId)}
                      onClose={() => setOpenClusterFolder(undefined)}
                      selectedLabel={groupPath(
                        groups,
                        folderDecisionValue === "NEW"
                          ? folderDecision?.parentGroupId ?? ""
                          : folderDecision?.groupId ?? "",
                        folderDecisionValue === "NEW" ? "Корневая папка" : "Папка не выбрана"
                      )}
                      value={folderDecisionValue === "NEW" ? folderDecision?.parentGroupId ?? "" : folderDecision?.groupId ?? ""}
                    />
                  )}
                  {expanded && <div className={styles.clusteringSectionBody}>
                    <ClusteringSectionQueries
                      expectedCount={cluster?.keywordCount ?? proposal.unclusteredCount}
                      groups={groups}
                      initialRows={rows}
                      keywordGroupOverrides={keywordGroupOverrides}
                      onToggleKeyword={toggleKeyword}
                      operationId={operationId}
                      projectId={projectId}
                      proposalVersion={proposalVersion}
                      ready={ready}
                      {...(rowFilter ? { rowFilter } : {})}
                      sectionId={sectionId}
                      selectedKeywordIds={selectedKeywordIds}
                    />
                    <aside className={styles.clusteringUrls}>
                      <div className={styles.clusteringColumnTitle}><strong><UiText text="URL в выдаче" /></strong><span>{formatInteger(topUrls.length, uiLocale)}</span></div>
                      {topUrls.length > 0 ? topUrls.map(({ url, overlapCount }, index) => (
                        <a href={url} key={`${url}:${index}`} rel="noreferrer" target="_blank" title={url}>
                          <span>{url}</span>
                          <b>{overlapCount === undefined ? "—" : formatInteger(overlapCount, uiLocale)}</b>
                        </a>
                      )) : <p><UiText text="Arsenkin не передал URL для этого кластера." /></p>}
                    </aside>
                  </div>}
                </article>
              );
            })}
            {clusterSections.length === 0 && <p><UiText text="Запросы и кластеры по поиску не найдены." /></p>}
            {clusterSections.length > renderedSections.length && (
              <p><UiText text="Показаны первые 500 из" after=" " />{formatInteger(clusterSections.length, uiLocale)}<UiText text=". Уточните поиск для остальных." /></p>
            )}
          </div>
          {ready && selectedKeywordIds.size > 0 && (
            <div className={styles.clusteringSelectionBar}>
              <div><strong><UiText text="Выбрано запросов:" after=" " />{formatInteger(selectedKeywordIds.size, uiLocale)}</strong><small><UiText text="Назначение ниже имеет приоритет над решением для кластера." /></small></div>
              <details className={styles.clusteringBatchFolderPicker}>
                <summary>
                  <span><Icon name="inbox" />{groupPath(groups, assignmentGroupId, "Папка кластера (авто)")}</span>
                  <Icon name="chevronRight" />
                </summary>
                <div className={styles.clusteringSelectionPicker}>
                  <SemanticGroupPicker
                    className={styles.clusteringGroupPicker ?? ""}
                    groups={groups}
                    onChange={setAssignmentGroupId}
                    rootIcon="cluster"
                    rootLabel="Папка кластера (авто)"
                    searchPlaceholder={uiText("Найти целевую папку")}
                    value={assignmentGroupId}
                  />
                </div>
              </details>
              <button disabled={groupsLoading} onClick={assignSelectedKeywords} type="button">
                {assignmentGroupId ? <UiText text="Назначить папку" /> : <UiText text="Вернуть автоназначение" />}
              </button>
              <button className={styles.clusteringSelectionClear} onClick={() => setSelectedKeywordIds(new Set())} type="button"><UiText text="Снять выбор" /></button>
            </div>
          )}
        </div>
      </div>
      {ready && error && <div className={styles.clusteringApplyError} role="alert">{<UiText text={error ?? ""} />}</div>}
      {ready && confirmReject && !busy && (
        <div className={styles.clusteringRejectConfirm} role="alert">
          <span><UiText text="Черновик будет закрыт без изменений в проекте." /></span>
          <button onClick={() => setConfirmReject(false)} type="button"><UiText text="Отмена" /></button>
        </div>
      )}
      <footer className={styles.clusteringApplyActions}>
        <div className={styles.clusteringFooterStatus}>
          <strong>{ready
            ? <UiText text="Новых SEO-кластеров: {0} · новых папок: {1}" values={[String(formatInteger(newSemanticClusterCount, uiLocale)), String(formatInteger(newFolderCount, uiLocale))]} />
            : operationResultRange({ kind: "clustering", value: result }, uiLocale)}</strong>
          <span aria-live="polite">{resultLoadState}</span>
        </div>
        {ready && <div className={styles.clusteringFooterButtons}>
          <button className={styles.clusteringReject} disabled={Boolean(busy)} onClick={() => void reject()} type="button">
            {busy === "REJECT" ? <UiText text="Отклоняем…" /> : confirmReject ? <UiText text="Подтвердить отклонение" /> : <UiText text="Отклонить результат" />}
          </button>
          <button className={styles.clusteringApplyButton} disabled={Boolean(busy) || !canApply || invalidRequiredName} onClick={() => void apply()} type="button">
            {busy === "APPLY"
              ? <UiText text="Применяем…" />
              : newSemanticClusterCount > 0 || newFolderCount > 0
                ? <UiText text="Создать и применить · {0} / {1}" values={[String(formatInteger(newSemanticClusterCount, uiLocale)), String(formatInteger(newFolderCount, uiLocale))]} />
                : <UiText text="Применить раскладку" />}
          </button>
        </div>}
      </footer>
    </section>
  );
}

function ClusteringSectionQueries({
  expectedCount,
  groups,
  initialRows,
  keywordGroupOverrides,
  onToggleKeyword,
  operationId,
  projectId,
  proposalVersion,
  ready,
  rowFilter,
  sectionId,
  selectedKeywordIds
}: Readonly<{
  expectedCount: number;
  groups: readonly SemanticKeywordGroup[];
  initialRows: readonly ClusteringProposalResultRow[];
  keywordGroupOverrides: ReadonlyMap<string, string>;
  onToggleKeyword: (keywordId: string) => void;
  operationId: string;
  projectId: string;
  proposalVersion: number;
  ready: boolean;
  rowFilter?: string;
  sectionId: string;
  selectedKeywordIds: ReadonlySet<string>;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [rows, setRows] = useState(initialRows);
  const [page, setPage] = useState<OperationResultPageInfo>();
  const [requestedFirstPage, setRequestedFirstPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  const scopeRef = useRef(
    `${projectId}:${operationId}:${proposalVersion}:${sectionId}`
  );
  const visibleRows = rowFilter
    ? rows.filter(({ keyword }) =>
        keyword.toLocaleLowerCase("ru-RU").includes(rowFilter)
      )
    : rows;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setRows((current) => mergeOperationResultRows(current, initialRows));
  }, [initialRows]);

  const loadPage = useCallback(async () => {
    if (loadingRef.current) return;
    const cursor = requestedFirstPage ? page?.nextCursor : undefined;
    if (requestedFirstPage && !error && !cursor) return;
    const requestScope = scopeRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const result = await browserApiRequest<ClusteringProposalSectionResult>(
        clusteringProposalSectionApiPath(
          projectId,
          operationId,
          sectionId,
          {
            limit: operationResultDefaultPageSize,
            ...(cursor ? { cursor } : {})
          }
        )
      );
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      setRows((current) => mergeOperationResultRows(current, result.rows));
      setPage(result.page);
      setRequestedFirstPage(true);
    } catch (requestError) {
      if (!mountedRef.current || scopeRef.current !== requestScope) return;
      setRequestedFirstPage(true);
      setError(operationResultError(requestError));
    } finally {
      if (mountedRef.current && scopeRef.current === requestScope) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [error, operationId, page?.nextCursor, projectId, requestedFirstPage, sectionId]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (
      !target ||
      loading ||
      requestedFirstPage ||
      rows.length >= expectedCount
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadPage();
      },
      { rootMargin: "240px 0px", threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [expectedCount, loadPage, loading, requestedFirstPage, rows.length]);

  return (
    <div className={styles.clusteringQueries}>
      <div className={styles.clusteringColumnTitle}>
        <strong><UiText text="Запросы" /></strong>
        <span>
          {rowFilter
            ? <UiText text="Найдено {0} · загружено {1} из {2}" values={[String(formatInteger(visibleRows.length, uiLocale)), String(formatInteger(rows.length, uiLocale)), String(formatInteger(expectedCount, uiLocale))]} />
            : <UiText text="Показано {0} из {1}" values={[String(formatInteger(rows.length, uiLocale)), String(formatInteger(expectedCount, uiLocale))]} />}
        </span>
      </div>
      {visibleRows.map((row) => {
        const destination = keywordGroupOverrides.get(row.keywordId);
        return (
          <label className={styles.clusteringQueryRow} key={row.keywordId}>
            {ready && (
              <input
                checked={selectedKeywordIds.has(row.keywordId)}
                disabled={row.state !== "READY"}
                onChange={() => onToggleKeyword(row.keywordId)}
                type="checkbox"
              />
            )}
            <span>
              <strong>{row.keyword}</strong>
              <small>{<UiText text={clusteringRowStateLabel(row) ?? ""} />}</small>
            </span>
            {destination && (
              <b title={groupPath(groups, destination, destination)}>
                <Icon name="inbox" />
                {groupPath(groups, destination, "Папка")}
              </b>
            )}
          </label>
        );
      })}
      {rows.length < expectedCount && !requestedFirstPage && (
        <div
          aria-label={uiText("Подгрузка запросов кластера")}
          className={styles.clusteringQuerySentinel}
          ref={sentinelRef}
        >
          <span className={styles.inlineSpinner} />
          <span><UiText text="Загружаем запросы этого кластера…" /></span>
        </div>
      )}
      {loading && requestedFirstPage && (
        <div className={styles.clusteringQuerySentinel} role="status">
          <span className={styles.inlineSpinner} />
          <span><UiText text="Загружаем следующую часть…" /></span>
        </div>
      )}
      {error && (
        <div className={styles.clusteringQueryError} role="alert">
          <span>{<UiText text={error ?? ""} />}</span>
          <button onClick={() => void loadPage()} type="button">
            <UiText text="Повторить" /></button>
        </div>
      )}
      {!error && page?.hasNext && !loading && (
        <button
          className={styles.clusteringLoadMore}
          onClick={() => void loadPage()}
          type="button"
        >
          <UiText text="Загрузить ещё запросы" /></button>
      )}
      {!loading && !error && requestedFirstPage && rows.length === 0 && (
        <p className={styles.clusteringQueryEmpty}>
          <UiText text="В этом кластере больше нет доступных запросов." /></p>
      )}
    </div>
  );
}

function clusteringSections(
  result: ClusteringOperationResult,
  query: string
): readonly Readonly<{
  cluster?: ClusteringProposalClusterSummary;
  rowFilter?: string;
  rows: readonly ClusteringProposalResultRow[];
}>[] {
  const rowsByClusterId = new Map<string, ClusteringProposalResultRow[]>();
  const unclustered: ClusteringProposalResultRow[] = [];
  for (const row of result.rows) {
    const clusterId = row.proposedCluster?.id;
    if (!clusterId) {
      unclustered.push(row);
      continue;
    }
    const rows = rowsByClusterId.get(clusterId) ?? [];
    rows.push(row);
    rowsByClusterId.set(clusterId, rows);
  }
  const sections: Array<Readonly<{
    cluster?: ClusteringProposalClusterSummary;
    rowFilter?: string;
    rows: readonly ClusteringProposalResultRow[];
  }>> = result.clusters.map((cluster) => ({
    cluster,
    rows: rowsByClusterId.get(cluster.id) ?? []
  }));
  if ((result.proposal?.unclusteredCount ?? unclustered.length) > 0) {
    sections.push({ rows: unclustered });
  }
  if (!query) return sections;
  return sections.flatMap((section) => {
    const clusterMatches = section.cluster && `${section.cluster.name} ${section.cluster.topUrl ?? ""} ${section.cluster.topUrls.map(({ url }) => url).join(" ")}`.toLocaleLowerCase("ru-RU").includes(query);
    const matchingRows = section.rows.filter(({ keyword }) => keyword.toLocaleLowerCase("ru-RU").includes(query));
    return clusterMatches
      ? [section]
      : matchingRows.length > 0
        ? [{ ...section, rowFilter: query, rows: matchingRows }]
        : [];
  });
}

function groupPath(
  groups: readonly SemanticKeywordGroup[],
  groupId: string,
  fallback: string
): string {
  return groups.find(({ id }) => id === groupId)?.path ?? fallback;
}

type ClusterAssignmentDecision =
  | Readonly<{ action: "NEW" }>
  | Readonly<{ action: "KEEP" }>
  | Readonly<{ action: "EXISTING"; clusterId: string }>;

function defaultClusterAssignment(
  cluster: ClusteringProposalClusterSummary,
  replaceExistingClusters: boolean
): ClusterAssignmentDecision {
  return !replaceExistingClusters && cluster.currentClusterKeywordCount > 0
    ? { action: "KEEP" }
    : { action: "NEW" };
}

function sameClusterAssignment(
  left: ClusterAssignmentDecision,
  right: ClusterAssignmentDecision
): boolean {
  return left.action === right.action &&
    (left.action !== "EXISTING" ||
      (right.action === "EXISTING" && left.clusterId === right.clusterId));
}

interface OpenClusterFolderPicker {
  readonly anchor: HTMLButtonElement;
  readonly proposalClusterId: string;
}

function ClusteringFolderPopover({
  anchor,
  groups,
  loading,
  mode,
  onChange,
  onClose,
  selectedLabel,
  value
}: Readonly<{
  anchor: HTMLButtonElement;
  groups: readonly SemanticKeywordGroup[];
  loading: boolean;
  mode: "NEW" | "EXISTING";
  onChange: (groupId: string) => void;
  onClose: () => void;
  selectedLabel: string;
  value: string;
}>) {
  const { t: uiText } = useUiLocale();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  const updatePosition = useCallback(() => {
    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 6;
    const width = Math.min(460, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      window.innerWidth - width - viewportPadding
    );
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const opensUpward = spaceBelow < 270 && spaceAbove > spaceBelow;
    const availableHeight = opensUpward ? spaceAbove : spaceBelow;
    setPosition({
      bottom: opensUpward ? window.innerHeight - rect.top + gap : undefined,
      left,
      maxHeight: Math.max(180, Math.min(380, availableHeight)),
      top: opensUpward ? undefined : rect.bottom + gap,
      width
    });
  }, [anchor]);

  useLayoutEffect(() => {
    setPortalTarget(
      anchor.closest<HTMLElement>("[data-dropdown-portal-root]") ??
        anchor.closest<HTMLDialogElement>("dialog[open]") ??
        anchor.ownerDocument.body
    );
    updatePosition();
    announceWorkspaceDropdownOpen(anchor);
  }, [anchor, updatePosition]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.contains(target) && !popoverRef.current?.contains(target)) onClose();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      requestAnimationFrame(() => anchor.focus());
    };
    const closeForAnotherDropdown = (event: Event) => {
      if ((event as CustomEvent<EventTarget>).detail !== anchor) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener(workspaceDropdownOpenEvent, closeForAnotherDropdown);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener(workspaceDropdownOpenEvent, closeForAnotherDropdown);
    };
  }, [anchor, onClose, updatePosition]);

  if (!portalTarget) return null;
  const title = mode === "NEW" ? "Родитель новой папки" : "Папка для кластера";
  return createPortal(
    <div
      aria-label={title}
      className={styles.clusteringFolderPopover}
      data-exclusive-dropdown-layer
      ref={popoverRef}
      role="dialog"
      style={position}
    >
      <header>
        <strong>{title}</strong>
        <span title={selectedLabel}>{selectedLabel}</span>
        <button aria-label={uiText("Закрыть выбор папки")} onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      {loading ? (
        <div className={styles.clusteringFolderPopoverLoading}><UiText text="Загружаем папки…" /></div>
      ) : mode === "EXISTING" && groups.length === 0 ? (
        <div className={styles.clusteringFolderPopoverLoading}><UiText text="В проекте пока нет папок." /></div>
      ) : (
        <div className={styles.clusteringFolderPopoverBody}>
          <SemanticGroupPicker
            autoFocus
            className={styles.clusteringGroupPicker ?? ""}
            groups={groups}
            onChange={onChange}
            rootIcon="projects"
            rootLabel="Корневая папка"
            searchPlaceholder={uiText("Найти папку")}
            showRootOption={mode === "NEW"}
            value={value}
          />
        </div>
      )}
    </div>,
    portalTarget
  );
}

function AiAnswerTable({ result }: Readonly<{ result: AiAnswerOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  if (isCompetitorCollection(result.collection)) {
    return <AiCompetitorTable result={result} />;
  }
  if (result.rows.length === 0) {
    return <EmptyRows active={isActiveStatus(result.collection.status)} />;
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption><UiText text="Журнал сбора ИИ-ответов этого запуска" /></caption>
        <thead>
          <tr>
            <th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Статус" /></th><th><UiText text="Провайдер" /></th>
            <th><UiText text="ИИ-ответ" /></th><th><UiText text="Сайт найден" /></th><th><UiText text="ИИ-позиция" /></th>
            <th><UiText text="Источники" /></th><th><UiText text="Обновлено" /></th>
          </tr>
        </thead>
        <tbody>{result.rows.map((row) => (
          <tr key={`${row.sequence}:${row.keywordId}`}>
            <td>{row.sequence + 1}</td>
            <td className={styles.primaryCell}>
              <strong>{row.keyword}</strong>
            </td>
            <td><ItemStatus status={row.status} {...(row.errorCode ? { errorCode: row.errorCode } : {})} /></td>
            <td>
              {row.providerSubmitted ? <UiText text="Отправлен" /> : <UiText text="Ожидает отправки" />}
              <small><UiText text="Попытка" after=" " />{row.attempt}</small>
            </td>
            <td>{row.snapshot ? (row.snapshot.answerPresent ? "Есть" : "Нет") : "—"}</td>
            <td>{row.snapshot ? (row.snapshot.siteFound ? "Да" : "Нет") : "—"}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.snapshot?.position, uiLocale)}</td>
            <td className={styles.numberCell}>{row.snapshot ? formatInteger(row.snapshot.sourceCount, uiLocale) : "—"}</td>
            <td>{formatDateTime(row.snapshot?.observedAt ?? row.updatedAt, uiLocale)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

interface AiCompetitorSourceRow {
  readonly operation: AiAnswerOperationResultRow;
  readonly source?: AiAnswerOperationSourceSummary;
}

function AiCompetitorTable({
  result
}: Readonly<{ result: AiAnswerOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  if (result.rows.length === 0) {
    return <EmptyRows active={isActiveStatus(result.collection.status)} />;
  }
  const sourceRows: readonly AiCompetitorSourceRow[] = result.rows.flatMap(
    (operation) => {
      const sources = operation.snapshot?.sources ?? [];
      return sources.length > 0
        ? sources.map((source) => ({ operation, source }))
        : [{ operation }];
    }
  );
  return (
    <div className={styles.tableScroll}>
      <table className={`${styles.table} ${styles.competitorTable}`}>
        <caption><UiText text="Источники ИИ-выдачи конкурентов этого запуска" /></caption>
        <thead>
          <tr>
            <th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Статус" /></th><th><UiText text="Место" /></th>
            <th><UiText text="URL источника" /></th><th><UiText text="Заголовок" /></th><th><UiText text="Описание" /></th>
            <th><UiText text="Проверено" /></th>
          </tr>
        </thead>
        <tbody>{sourceRows.map(({ operation, source }) => (
          <tr key={`${operation.sequence}:${operation.keywordId}:${source?.position ?? "empty"}`}>
            <td>{operation.sequence + 1}</td>
            <td className={styles.primaryCell}><strong>{operation.keyword}</strong></td>
            <td>
              <ItemStatus
                status={operation.status}
                {...(operation.errorCode ? { errorCode: operation.errorCode } : {})}
              />
            </td>
            <td className={styles.numberCell}>{formatOptionalNumber(source?.position, uiLocale)}</td>
            <td className={styles.urlCell}>
              {source
                ? <ExternalUrl value={source.url} />
                : operation.snapshot
                  ? <span className={styles.mutedCell}><UiText text="Источников нет" /></span>
                  : "—"}
            </td>
            <td className={styles.longCell} title={source?.title}>{source?.title ?? "—"}</td>
            <td className={styles.longCell} title={source?.description}>{source?.description ?? "—"}</td>
            <td>{formatDateTime(operation.snapshot?.observedAt ?? operation.updatedAt, uiLocale)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FrequencyTable({ result }: Readonly<{ result: FrequencyOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.collection.status)} />;
  if (result.collection.mode === "SEASONALITY") {
    return <SeasonalityResultTable result={result} />;
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption><UiText text="Частотность запросов этого запуска" /></caption>
        <thead><tr><th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Статус" /></th><th><UiText text="Я База" /></th><th><UiText text="Я &quot;&quot;" /></th><th><UiText text="Я &quot;!&quot;" /></th><th><UiText text="Источник" /></th><th><UiText text="Обновлено" /></th></tr></thead>
        <tbody>{result.rows.map((row) => (
          <tr key={row.keywordId}>
            <td>{row.sequence + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keywordAvailable === false ? <UiText text="Запрос недоступен" /> : row.keyword}</strong></td>
            <td><ItemStatus status={row.status} {...(row.errorCode ? { errorCode: row.errorCode } : {})} /></td>
            <FrequencyCell row={row} type="BASE" />
            <FrequencyCell row={row} type="EXACT" />
            <FrequencyCell row={row} type="FIXED" />
            <td>{frequencyProvider(row)}</td>
            <td>{frequencyObservedAt(row, uiLocale)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SeasonalityResultTable({ result }: Readonly<{ result: FrequencyOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption><UiText text="Сезонность запросов этого запуска" /></caption>
        <thead><tr><th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Тип" /></th><th><UiText text="Статус" /></th><th><UiText text="Периодов" /></th><th><UiText text="Первое значение" /></th><th><UiText text="Последнее значение" /></th><th><UiText text="Изменение" /></th><th><UiText text="Период" /></th><th><UiText text="Источник" /></th></tr></thead>
        <tbody>{result.rows.flatMap((row) => result.collection.types.map((type) => {
          const points = row.seasonality
            .filter((point) => point.type === type)
            .toSorted((left, right) => left.periodStart.localeCompare(right.periodStart));
          const first = points[0];
          const last = points.at(-1);
          const delta = first && last ? Number(last.value) - Number(first.value) : undefined;
          return <tr key={`${row.keywordId}:${type}`}>
            <td>{row.sequence + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keywordAvailable === false ? <UiText text="Запрос недоступен" /> : row.keyword}</strong></td>
            <td><UiText text={seasonalityFrequencyTypeLabel(type)} /></td>
            <td><ItemStatus status={row.status} {...(row.errorCode ? { errorCode: row.errorCode } : {})} /></td>
            <td className={styles.numberCell}>{points.length}</td>
            <td className={styles.numberCell}>{first ? formatDecimal(first.value, uiLocale) : "—"}</td>
            <td className={styles.numberCell}>{last ? formatDecimal(last.value, uiLocale) : "—"}</td>
            <td className={styles.numberCell}>{delta === undefined ? "—" : `${delta > 0 ? "+" : ""}${new Intl.NumberFormat(uiLocale).format(delta)}`}</td>
            <td>{first && last ? `${first.periodStart} — ${last.periodStart}` : "—"}</td>
            <td>{first?.provider ?? result.collection.provider}</td>
          </tr>;
        }))}</tbody>
      </table>
    </div>
  );
}

function FrequencyCell({ row, type }: Readonly<{ row: FrequencyOperationResultRow; type: SemanticFrequencyType }>) {
  const uiLocale = useUiLocale().locale;
  const snapshot = row.snapshots.find((item) => item.type === type);
  return <td className={styles.numberCell}>{snapshot?.value === undefined ? "—" : formatDecimal(snapshot.value, uiLocale)}</td>;
}

function seasonalityFrequencyTypeLabel(type: SemanticFrequencyType): string {
  return { BASE: "Базовая", EXACT: "Фразовая", FIXED: "Точная словоформа" }[type];
}

interface RankRuntimeLogEvent extends RankRuntimeDiagnosticEntry {
  readonly eventKey: string;
}

export function RankRuntimeDiagnosticsModal({
  active,
  onClose,
  operationId,
  projectId
}: Readonly<{
  active: boolean;
  onClose: () => void;
  operationId: string;
  projectId: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [snapshot, setSnapshot] = useState<RankRuntimeDiagnostics>();
  const [events, setEvents] = useState<readonly RankRuntimeLogEvent[]>([]);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const signaturesRef = useRef(new Map<number, string>());

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const next = await browserApiRequest<RankRuntimeDiagnostics>(
        `/app/api/v1/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(operationId)}/runtime-diagnostics`,
        signal ? { signal } : {}
      );
      if (signal?.aborted) return;
      const changed: RankRuntimeLogEvent[] = [];
      for (const entry of next.entries) {
        const signature = rankRuntimeEntrySignature(entry);
        if (signaturesRef.current.get(entry.sequence) !== signature) {
          signaturesRef.current.set(entry.sequence, signature);
          changed.push({
            ...entry,
            eventKey: `${entry.sequence}:${entry.updatedAt}:${signature}`
          });
        }
      }
      if (changed.length > 0) {
        setEvents((current) => [...changed, ...current].slice(0, 500));
      }
      setSnapshot(next);
      setError(undefined);
    } catch (requestError) {
      if (!signal?.aborted) setError(operationResultError(requestError));
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, [operationId, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const tick = async (): Promise<void> => {
      await load(controller.signal);
      if (!controller.signal.aborted && active) {
        timer = window.setTimeout(() => void tick(), 1_000);
      }
    };
    void tick();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, load]);

  const activeLanes = snapshot?.entries
    .filter((entry) => entry.active)
    .map(({ lane }) => lane)
    .filter((lane, index, values) => values.indexOf(lane) === index)
    .sort((left, right) => left - right) ?? [];

  return (
    <SemanticModal
      bodyClassName={styles.runtimeLogBody ?? ""}
      description={uiText("Безопасный live-монитор запросов: обновление раз в секунду, без API-ключей и provider req_id.")}
      footer={(
        <div className={styles.runtimeLogFooter}>
          <span>
            {active
              ? <UiText text="Мониторинг продолжится, пока открыто окно" />
              : <UiText text="Операция завершена · показан финальный снимок" />}
          </span>
          <button onClick={onClose} type="button"><UiText text="Закрыть" /></button>
        </div>
      )}
      onClose={onClose}
      presenceKey={`rank-runtime-diagnostics:${operationId}`}
      size="large"
      title={uiText("Логи XMLStock")}
    >
      <div className={styles.runtimeLogWorkspace}>
        <div className={styles.runtimeLogOverview}>
          <div className={styles.runtimeLiveState}>
            <span className={active ? styles.runtimeLiveDot : styles.runtimeDoneDot} />
            <div>
              <strong>{active ? <UiText text="В реальном времени" /> : <UiText text="Операция завершена" />}</strong>
              <small>{snapshot ? rankRuntimeProductLabel(snapshot.policy.product) : <UiText text="Подключаем монитор…" />}</small>
            </div>
          </div>
          <RuntimeMetric label={uiText("Активных потоков")} value={snapshot?.totals.active ?? 0} />
          <RuntimeMetric label={uiText("Ожидают провайдера")} value={snapshot?.totals.waitingProvider ?? 0} />
          <RuntimeMetric label={uiText("Завершено")} value={snapshot?.totals.completed ?? 0} />
          <RuntimeMetric label={uiText("Ошибок")} value={snapshot?.totals.failed ?? 0} tone="error" />
          <div className={styles.runtimePolicy}>
            <small><UiText text="Лимит подключения" /></small>
            <strong>
              {snapshot
                ? <UiText text="{0} потоков · {1} запросов/с" values={[String(snapshot.policy.concurrency), String(snapshot.policy.requestsPerSecond)]} />
                : "—"}
            </strong>
          </div>
        </div>

        <div className={styles.runtimeLaneBar}>
          <strong><UiText text="Сейчас выполняются" /></strong>
          <div>
            {activeLanes.length > 0 ? activeLanes.map((lane) => (
              <span
                key={lane}
                style={{ "--runtime-lane-color": rankRuntimeLaneColor(lane) } as CSSProperties}
              >
                <UiText text="Поток" after=" " />{lane}
              </span>
            )) : <small>{refreshing ? <UiText text="Обновляем…" /> : <UiText text="Свободные потоки ожидают запросы" />}</small>}
          </div>
          <button
            disabled={refreshing}
            onClick={() => void load()}
            type="button"
          >
            {refreshing ? <UiText text="Обновление…" /> : <UiText text="Обновить" />}
          </button>
        </div>

        {error && <div className={styles.runtimeLogError} role="alert">{<UiText text={error ?? ""} />}</div>}

        <div className={styles.runtimeLogTableWrap}>
          <table className={styles.runtimeLogTable}>
            <caption><UiText text="Живой журнал выполнения XMLStock" /></caption>
            <thead>
              <tr>
                <th><UiText text="Время" /></th>
                <th><UiText text="Поток" /></th>
                <th><UiText text="Запрос" /></th>
                <th><UiText text="Состояние" /></th>
                <th><UiText text="HTTP-попытки" /></th>
                <th><UiText text="Страницы" /></th>
                <th><UiText text="Следующее действие" /></th>
              </tr>
            </thead>
            <tbody>
              {events.map((entry) => (
                <tr key={entry.eventKey}>
                  <td>{formatRuntimeTime(entry.updatedAt, uiLocale)}</td>
                  <td>
                    <span
                      className={styles.runtimeLane}
                      style={{ "--runtime-lane-color": rankRuntimeLaneColor(entry.lane) } as CSSProperties}
                    >
                      {entry.lane}
                    </span>
                  </td>
                  <td className={styles.runtimeKeyword}>
                    <strong>{entry.keyword}</strong>
                    <small><UiText text="Строка" after=" " />{entry.sequence + 1} <UiText text="· попытка" before=" " after=" " />{entry.executionAttempt}</small>
                  </td>
                  <td>
                    <span className={`${styles.runtimeState ?? ""} ${styles[`runtimeState${entry.state}`] ?? ""}`}>
                      {<UiText text={rankRuntimeStateLabel(entry.state) ?? ""} />}
                    </span>
                  </td>
                  <td>{entry.submitAttempts + entry.pollAttempts}<small>{entry.submitAttempts} <UiText text="отправка ·" before=" " after=" " />{entry.pollAttempts} <UiText text="опрос" before=" " /></small></td>
                  <td>{entry.completedPages} <UiText text="из" before=" " after=" " />{entry.totalPages}</td>
                  <td className={entry.errorCode ? styles.runtimeErrorCode : undefined}>
                    {entry.errorCode ?? formatRuntimeNextAction(entry.nextActionAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && (
            <div className={styles.runtimeLogEmpty}>
              <span className={styles.inlineSpinner} />
              <strong><UiText text="Ждём первые события" /></strong>
              <small><UiText text="Подготовленные запросы появятся здесь автоматически." /></small>
            </div>
          )}
        </div>
      </div>
    </SemanticModal>
  );
}

function RuntimeMetric({
  label,
  tone,
  value
}: Readonly<{ label: string; tone?: "error"; value: number }>) {
  const uiLocale = useUiLocale().locale;
  return (
    <div className={tone === "error" ? styles.runtimeMetricError : styles.runtimeMetric}>
      <small>{label}</small>
      <strong>{formatInteger(value, uiLocale)}</strong>
    </div>
  );
}

function rankRuntimeEntrySignature(entry: RankRuntimeDiagnosticEntry): string {
  return [
    entry.state,
    entry.executionAttempt,
    entry.submitAttempts,
    entry.pollAttempts,
    entry.completedPages,
    entry.totalPages,
    entry.active ? 1 : 0,
    entry.nextActionAt ?? "",
    entry.errorCode ?? ""
  ].join(":");
}

function rankRuntimeProductLabel(value: RankRuntimeDiagnostics["policy"]["product"]): string {
  return ({
    YANDEX_LIVE: "Яндекс Live",
    GOOGLE_LIVE: "Google Live",
    YANDEX_SEARCH_API: "Яндекс XML Proxy"
  } as const)[value];
}

function rankRuntimeStateLabel(value: RankRuntimeDiagnosticEntry["state"]): string {
  return ({
    QUEUED: "Подготовлен",
    REQUESTING: "HTTP-запрос",
    WAITING_PROVIDER: "Ждёт XMLStock",
    WAITING_NEXT_PAGE: "Следующая страница",
    SAVING: "Сохранение",
    COMPLETED: "Готово",
    RETRY_WAIT: "Повтор",
    FAILED: "Ошибка"
  } as const)[value];
}

function rankRuntimeLaneColor(lane: number): string {
  return `hsl(${(lane * 47 + 238) % 360} 72% 52%)`;
}

function formatRuntimeTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(date);
}

function formatRuntimeNextAction(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const delay = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  return delay > 0 ? `через ${delay} с` : "сейчас";
}

function RankTable({ result }: Readonly<{ result: RankOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.job.status)} />;
  if (isCompetitorCollection(result.execution)) {
    return <CompetitorRankTable result={result} />;
  }
  const active = isActiveStatus(result.job.status);
  const failedRows = active
    ? []
    : result.rows.filter(({ state }) => state === "PENDING");
  const resultRows = failedRows.length === 0
    ? result.rows
    : result.rows.filter(({ state }) => state !== "PENDING");
  return (
    <div className={styles.rankResults}>
      {resultRows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption><UiText text="Позиции запросов этого запуска" /></caption>
            <thead><tr><th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Результат" /></th><th><UiText text="Позиция" /></th><th><UiText text="Релевантный URL" /></th><th><UiText text="Заголовок" /></th><th><UiText text="Проверено" /></th></tr></thead>
            <tbody>{resultRows.map((row) => (
              <tr key={`${row.sequence}:${row.keywordId}`}>
                <td>{row.sequence + 1}</td>
                <td className={styles.primaryCell}><strong>{row.keyword}</strong></td>
                <td><RankState state={row.state} /></td>
                <td className={styles.numberCell}>{rankPosition(row, uiLocale)}</td>
                <td className={styles.urlCell}><ExternalUrl value={row.rankingUrl} /></td>
                <td className={styles.longCell} title={row.title ?? row.snippet}>{row.title ?? row.snippet ?? "—"}</td>
                <td>{formatDateTime(row.observedAt, uiLocale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <RankFailures
        competitorCollection={false}
        provider={result.job.provider}
        rows={failedRows}
      />
    </div>
  );
}

interface CompetitorRankResultRow {
  readonly operation: RankOperationResultRow;
  readonly result?: NonNullable<RankOperationResultRow["serpResults"]>[number];
}

function CompetitorRankTable({
  result
}: Readonly<{ result: RankOperationResult }>) {
  const uiLocale = useUiLocale().locale;
  const active = isActiveStatus(result.job.status);
  const failedRows = active
    ? []
    : result.rows.filter(({ state }) => state === "PENDING");
  const completedRows = failedRows.length === 0
    ? result.rows
    : result.rows.filter(({ state }) => state !== "PENDING");
  const serpRows: readonly CompetitorRankResultRow[] = completedRows.flatMap(
    (operation) => {
      const rows = operation.serpResults ?? [];
      return rows.length > 0
        ? rows.map((row) => ({ operation, result: row }))
        : [{ operation }];
    }
  );
  return (
    <div className={styles.rankResults}>
      {serpRows.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.competitorTable}`}>
            <caption><UiText text="Органическая выдача конкурентов Топ-10 этого запуска" /></caption>
            <thead>
              <tr>
                <th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Результат" /></th><th><UiText text="Место" /></th>
                <th><UiText text="URL конкурента" /></th><th><UiText text="Заголовок" /></th><th><UiText text="Описание" /></th>
                <th><UiText text="Проверено" /></th>
              </tr>
            </thead>
            <tbody>{serpRows.map(({ operation, result: serpResult }) => (
              <tr key={`${operation.sequence}:${operation.keywordId}:${serpResult?.position ?? "empty"}`}>
                <td>{operation.sequence + 1}</td>
                <td className={styles.primaryCell}><strong>{operation.keyword}</strong></td>
                <td>
                  <span className={`${styles.itemStatus} ${operation.state === "PENDING" ? "" : styles.found}`}>
                    {operation.state === "PENDING" ? <UiText text="В работе" /> : <UiText text="Собрано" />}
                  </span>
                </td>
                <td className={styles.numberCell}>{formatOptionalNumber(serpResult?.position, uiLocale)}</td>
                <td className={styles.urlCell}>
                  {serpResult
                    ? <ExternalUrl value={serpResult.rankingUrl} />
                    : operation.state === "PENDING"
                      ? "—"
                      : <span className={styles.mutedCell}><UiText text="Выдача пуста" /></span>}
                </td>
                <td className={styles.longCell} title={serpResult?.title}>{serpResult?.title ?? "—"}</td>
                <td className={styles.longCell} title={serpResult?.snippet}>{serpResult?.snippet ?? "—"}</td>
                <td>{formatDateTime(operation.observedAt, uiLocale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <RankFailures
        competitorCollection
        provider={result.job.provider}
        rows={failedRows}
      />
    </div>
  );
}

function RankFailures({
  competitorCollection,
  provider,
  rows
}: Readonly<{
  competitorCollection: boolean;
  provider: RankJobSummary["provider"];
  rows: readonly RankOperationResultRow[];
}>) {
  const uiLocale = useUiLocale().locale;
  if (rows.length === 0) return null;
  const titleId = competitorCollection
    ? "competitor-rank-failures-title"
    : "rank-failures-title";
  return (
    <section className={styles.rankFailures} aria-labelledby={titleId}>
      <header>
        <div>
          <strong id={titleId}>
            {competitorCollection
              ? <UiText text="Не удалось собрать выдачу конкурентов" />
              : <UiText text="Не удалось снять позиции" />}
          </strong>
          <small>
            <UiText text="Эти запросы завершены с ошибкой и больше не выполняются в этом запуске." /></small>
        </div>
        <span>{formatInteger(rows.length, uiLocale)}</span>
      </header>
      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.rankFailureTable}`}>
          <caption><UiText text="Запросы без результата после завершения сбора" /></caption>
          <thead><tr><th>#</th><th><UiText text="Запрос" /></th><th><UiText text="Результат" /></th><th><UiText text="Причина" /></th><th><UiText text="Попытки провайдера" /></th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={`failed:${row.sequence}:${row.keywordId}`}>
              <td>{row.sequence + 1}</td>
              <td className={styles.primaryCell}><strong>{row.keyword}</strong></td>
              <td>
                <span className={`${styles.itemStatus} ${styles.failed}`}>
                  {competitorCollection ? <UiText text="Не собран" /> : <UiText text="Не снят" />}
                </span>
              </td>
              <td className={styles.rankFailureReason} title={row.errorCode}>
                <strong>{rankFailureReason(row, provider)}</strong>
                {row.errorCode && <small>{row.errorCode}</small>}
              </td>
              <td className={styles.numberCell}>{rankPollAttempts(row, uiLocale)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function CrawlTable({ result }: Readonly<{ result: CrawlOperationResultPage }>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CrawlStatusFilter>("ALL");
  const [sort, setSort] = useState<CrawlSort>("SEQUENCE_ASC");
  const rows = useMemo(
    () => crawlRows(result.rows, query, statusFilter, sort),
    [query, result.rows, sort, statusFilter]
  );
  if (result.rows.length === 0) {
    return <EmptyRows active={isActiveStatus(result.crawl.status)} />;
  }
  const httpStatusCheck = result.crawl.config.purpose === "HTTP_STATUS_CHECK";
  return (
    <div className={styles.crawlResult}>
      <div className={styles.crawlToolbar}>
        <label>
          <span className={styles.visuallyHidden}><UiText text="Поиск URL" /></span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Найти URL")}
            type="search"
            value={query}
          />
        </label>
        <CustomSelect
          aria-label={uiText("Фильтр HTTP-ответов")}
          onChange={(event) => setStatusFilter(event.target.value as CrawlStatusFilter)}
          value={statusFilter}
        >
          <option value="ALL"><UiText text="Все ответы" /></option>
          <option value="2XX"><UiText text="Успешные · 2xx" /></option>
          <option value="3XX"><UiText text="Ответы · 3xx" /></option>
          <option value="4XX"><UiText text="Ошибки клиента · 4xx" /></option>
          <option value="5XX"><UiText text="Ошибки сервера · 5xx" /></option>
          <option value="REDIRECTS"><UiText text="Только редиректы" /></option>
          <option value="ISSUES"><UiText text="Только с проблемами" /></option>
        </CustomSelect>
        <CustomSelect
          aria-label={uiText("Сортировка результатов")}
          onChange={(event) => setSort(event.target.value as CrawlSort)}
          value={sort}
        >
          <option value="SEQUENCE_ASC"><UiText text="В порядке обхода" /></option>
          <option value="STATUS_ASC"><UiText text="HTTP-код · по возрастанию" /></option>
          <option value="STATUS_DESC"><UiText text="HTTP-код · по убыванию" /></option>
          <option value="TIME_DESC"><UiText text="Самые медленные" /></option>
          <option value="TIME_ASC"><UiText text="Самые быстрые" /></option>
          <option value="URL_ASC"><UiText text="URL · А—Я" /></option>
        </CustomSelect>
        <span>{formatInteger(rows.length, uiLocale)} <UiText text="из" before=" " after=" " />{formatInteger(result.rows.length, uiLocale)}</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.filteredEmpty}>
          <strong><UiText text="По выбранным условиям страниц нет" /></strong>
          <button onClick={() => { setQuery(""); setStatusFilter("ALL"); }} type="button"><UiText text="Сбросить фильтры" /></button>
        </div>
      ) : httpStatusCheck ? (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.httpTable}`}>
            <caption><UiText text="HTTP-ответы этого запуска" /></caption>
            <thead><tr><th>#</th><th>URL</th><th>HTTP</th><th className={styles.centerCell}><UiText text="Цепочка редиректов" /></th><th className={styles.centerCell}><UiText text="Время" /></th><th className={styles.centerCell}><UiText text="Размер" /></th><th className={styles.centerCell}><UiText text="Тип ответа" /></th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sequence}:${row.requestedUrl}`}>
                <td>{row.sequence + 1}</td>
                <td className={`${styles.primaryCell} ${styles.urlCell}`}><ExternalUrl value={row.finalUrl} />{row.requestedUrl !== row.finalUrl && <small><UiText text="Запрошено:" after=" " />{row.requestedUrl}</small>}</td>
                <td><HttpStatus status={row.statusCode} /></td>
                <td className={styles.centerCell}><RedirectChain row={row} /></td>
                <td className={`${styles.numberCell} ${styles.centerCell}`}>{formatInteger(row.responseTimeMs, uiLocale)} <UiText text="мс" before=" " /></td>
                <td className={`${styles.numberCell} ${styles.centerCell}`}>{formatBytes(row.sizeBytes)}</td>
                <td className={styles.centerCell}>{row.contentType || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.wideTable}`}>
            <caption><UiText text="Страницы технического аудита" /></caption>
            <thead><tr><th>#</th><th>URL</th><th>HTTP</th><th><UiText text="Индексируемость" /></th><th>Title / H1</th><th><UiText text="Проблемы" /></th><th><UiText text="Время" /></th><th><UiText text="Размер" /></th><th><UiText text="Слова" /></th><th><UiText text="Ссылки" /></th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sequence}:${row.requestedUrl}`}>
                <td>{row.sequence + 1}</td>
                <td className={`${styles.primaryCell} ${styles.urlCell}`}><ExternalUrl value={row.finalUrl} />{row.requestedUrl !== row.finalUrl && <small><UiText text="Запрошено:" after=" " />{row.requestedUrl}</small>}</td>
                <td><HttpStatus status={row.statusCode} /></td>
                <td>{<UiText text={indexabilityLabel(row.indexability) ?? ""} />}</td>
                <td className={styles.longCell}><strong>{row.title ?? <UiText text="Без title" />}</strong><small>{row.h1 ?? <UiText text="Без H1" />}</small></td>
                <td><IssueSummary row={row} /></td>
                <td className={styles.numberCell}>{formatInteger(row.responseTimeMs, uiLocale)} <UiText text="мс" before=" " /></td>
                <td className={styles.numberCell}>{formatBytes(row.sizeBytes)}</td>
                <td className={styles.numberCell}>{formatInteger(row.wordCount, uiLocale)}</td>
                <td className={styles.numberCell}>{formatInteger(row.internalLinkCount, uiLocale)} / {formatInteger(row.externalLinkCount, uiLocale)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type CrawlStatusFilter = "ALL" | "2XX" | "3XX" | "4XX" | "5XX" | "REDIRECTS" | "ISSUES";
type CrawlSort = "SEQUENCE_ASC" | "STATUS_ASC" | "STATUS_DESC" | "TIME_ASC" | "TIME_DESC" | "URL_ASC";

function crawlRows(
  source: readonly CrawlOperationResultRow[],
  query: string,
  statusFilter: CrawlStatusFilter,
  sort: CrawlSort
): readonly CrawlOperationResultRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filtered = source.filter((row) => {
    if (normalizedQuery && !`${row.requestedUrl} ${row.finalUrl}`.toLocaleLowerCase("ru").includes(normalizedQuery)) return false;
    if (statusFilter === "REDIRECTS") return row.redirectChain.length > 0 || (row.statusCode >= 300 && row.statusCode < 400);
    if (statusFilter === "ISSUES") return row.issues.length > 0 || row.statusCode >= 400;
    if (statusFilter === "2XX") return row.statusCode >= 200 && row.statusCode < 300;
    if (statusFilter === "3XX") return row.statusCode >= 300 && row.statusCode < 400;
    if (statusFilter === "4XX") return row.statusCode >= 400 && row.statusCode < 500;
    if (statusFilter === "5XX") return row.statusCode >= 500;
    return true;
  });
  return [...filtered].sort((left, right) => {
    if (sort === "STATUS_ASC") return left.statusCode - right.statusCode || left.sequence - right.sequence;
    if (sort === "STATUS_DESC") return right.statusCode - left.statusCode || left.sequence - right.sequence;
    if (sort === "TIME_ASC") return left.responseTimeMs - right.responseTimeMs || left.sequence - right.sequence;
    if (sort === "TIME_DESC") return right.responseTimeMs - left.responseTimeMs || left.sequence - right.sequence;
    if (sort === "URL_ASC") return left.requestedUrl.localeCompare(right.requestedUrl, "ru");
    return left.sequence - right.sequence;
  });
}

function RedirectChain({ row }: Readonly<{ row: CrawlOperationResultRow }>) {
  if (row.redirectChain.length === 0) return <span className={styles.noIssues}><UiText text="Нет" /></span>;
  const chain = [row.requestedUrl, ...row.redirectChain];
  if (chain.at(-1) !== row.finalUrl) chain.push(row.finalUrl);
  return (
    <details className={styles.redirectChain}>
      <summary>{row.redirectChain.length} {pluralRedirect(row.redirectChain.length)}</summary>
      <ol>{chain.map((url, index) => <li key={`${index}:${url}`}><ExternalUrl value={url} /></li>)}</ol>
    </details>
  );
}

function pluralRedirect(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "переходов";
  if (mod10 === 1) return "переход";
  if (mod10 >= 2 && mod10 <= 4) return "перехода";
  return "переходов";
}

function ResearchTable({ result }: Readonly<{ result: KeywordResearchRunSummary }>) {
  const uiLocale = useUiLocale().locale;
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.status)} />;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption><UiText text="Ключевые слова, найденные в Keys.so" /></caption>
        <thead><tr><th>#</th><th><UiText text="Запрос" /></th><th>URL</th><th><UiText text="База" /></th><th>&quot;&quot;</th><th>&quot;!&quot;</th><th><UiText text="Позиция" /></th><th>KEI</th><th><UiText text="Импорт" /></th></tr></thead>
        <tbody>{result.rows.map((row, index) => (
          <tr key={row.id}>
            <td>{index + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keyword}</strong></td>
            <td className={styles.urlCell}><ExternalUrl value={row.url} /></td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyBase, uiLocale)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyExact, uiLocale)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyFixed, uiLocale)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.position, uiLocale)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.kei, uiLocale)}</td>
            <td>{row.selected ? <UiText text="Выбрано" /> : <UiText text="Не выбрано" />}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function EmptyRows({ active }: Readonly<{ active: boolean }>) {
  return (
    <div className={styles.emptyRows}>
      <strong>{active ? <UiText text="Результаты ещё формируются" /> : <UiText text="В этой операции нет строк результата" />}</strong>
      <p>{active ? <UiText text="Таблица обновится автоматически по мере обработки." /> : <UiText text="Проверьте статус и входные параметры операции в истории." />}</p>
    </div>
  );
}

function ItemStatus({ status, errorCode }: Readonly<{ status: string; errorCode?: string }>) {
  return <span className={styles.itemStatus} title={errorCode}>{<UiText text={itemStatusLabel(status) ?? ""} />}{errorCode ? ` · ${errorCode}` : ""}</span>;
}

function RankState({ state }: Readonly<{ state: RankOperationResultRow["state"] }>) {
  return <span className={`${styles.itemStatus} ${state === "FOUND" ? styles.found : state === "NOT_FOUND" ? styles.notFound : ""}`}>{state === "FOUND" ? <UiText text="Найден" /> : state === "NOT_FOUND" ? <UiText text="Не найден" /> : <UiText text="Ожидает" />}</span>;
}

function HttpStatus({ status }: Readonly<{ status: number }>) {
  const tone = status >= 500 ? styles.httpError : status >= 400 ? styles.httpWarning : status >= 300 ? styles.httpRedirect : styles.httpSuccess;
  return <span className={`${styles.httpStatus} ${tone}`}>{status}</span>;
}

function IssueSummary({ row }: Readonly<{ row: CrawlOperationResultRow }>) {
  if (row.issues.length === 0) return <span className={styles.noIssues}><UiText text="Нет" /></span>;
  return <span className={styles.issueSummary} title={row.issues.map(({ title }) => title).join("\n")}>{row.issues.length} · {row.issues.slice(0, 2).map(({ title }) => title).join(", ")}</span>;
}

function ExternalUrl({ value }: Readonly<{ value: string | undefined }>) {
  const { t: uiText } = useUiLocale();
  if (!value) return <>—</>;
  const href = safeExternalUrl(value);
  return href ? <a href={href} rel="noreferrer" target="_blank">{value}</a> : <span title={uiText("Некорректный внешний URL")}>{value}</span>;
}

interface SummaryView {
  readonly title: string;
  readonly description: string;
  readonly context?: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly status: string;
  readonly tone: "Active" | "Success" | "Warning" | "Error" | "Neutral";
  readonly progress: string;
  readonly progressPercent: number;
  readonly facts: readonly Readonly<{ label: string; value: string }>[];
}

function operationSummary(data: OperationResultData, uiLocale: string = "ru-RU"): SummaryView {
  if (data.kind === "frequency") {
    const value = data.value.collection;
    const current = value.completedKeywords + value.failedKeywords;
    return {
      title: frequencyCollectionTitle(value),
      description: value.mode === "SEASONALITY"
        ? `${providerLabel(value.provider)} · ${frequencyCollectionParameters(value)}`
        : `${providerLabel(value.provider)} · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
      provider: value.provider,
      ...summaryStatus(
        value.status,
        current,
        value.selectedKeywords,
        value.stage, uiLocale
      ),
      facts: [
        { label: "Обработано", value: formatInteger(current, uiLocale) },
        { label: "Ошибок", value: formatInteger(value.failedKeywords, uiLocale) },
        { label: "Регион", value: seoRegionDisplayName("WORDSTAT", value.regionCode) },
        { label: "Устройство", value: deviceLabel(value.device) },
        ...(value.failureCode
          ? [{ label: "Код ошибки", value: value.failureCode }]
          : [])
      ]
    };
  }
  if (data.kind === "ai-answer") {
    const value = data.value.collection;
    const current = value.completedKeywords + value.failedKeywords;
    const competitorCollection = isCompetitorCollection(value);
    const loadedSourceCount = data.value.rows.reduce(
      (total, row) => total + (row.snapshot?.sources?.length ?? 0),
      0
    );
    return {
      title: aiAnswerCollectionTitle(value),
      description: `Arsenkin Tools · ${value.searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ${deviceLabel(value.device)}${competitorCollection ? " · источники ИИ-выдачи" : ""}`,
      provider: "ARSENKIN",
      ...summaryStatus(value.status, current, value.selectedKeywords, value.stage, uiLocale),
      facts: [
        { label: "Обработано", value: formatInteger(current, uiLocale) },
        {
          label: competitorCollection ? "Источников загружено" : "Успешно",
          value: formatInteger(
            competitorCollection ? loadedSourceCount : value.completedKeywords, uiLocale
          )
        },
        { label: "Ошибок", value: formatInteger(value.failedKeywords, uiLocale) },
        { label: "Регион", value: searchRegionDisplayName(value.searchEngine, value.regionCode) },
        ...(value.failureCode ? [{ label: "Код ошибки", value: value.failureCode }] : [])
      ]
    };
  }
  if (data.kind === "clustering") {
    const value = data.value.run;
    const proposal = data.value.proposal;
    const current = value.completedKeywords + value.failedKeywords;
    const settledStatus = proposal?.status === "READY"
      ? { status: "Готово к применению", tone: "Warning" as const }
      : proposal?.status === "APPLIED"
        ? { status: "Применено", tone: "Success" as const }
        : proposal?.status === "REJECTED"
          ? { status: "Отклонено", tone: "Neutral" as const }
          : undefined;
    return {
      title: "Кластеризация запросов",
      description: `Arsenkin Tools · ${value.searchEngine === "YANDEX" ? "Яндекс" : "Google"} · ${value.method === "SOFT" ? "мягкая" : "жёсткая"}`,
      provider: "ARSENKIN",
      ...summaryStatus(value.status, current, value.selectedKeywords, value.stage, uiLocale),
      ...settledStatus,
      facts: [
        { label: "Кластеров", value: formatInteger(value.clusterCount ?? proposal?.clusterCount ?? 0, uiLocale) },
        { label: "Без кластера", value: formatInteger(value.unclusteredCount ?? proposal?.unclusteredCount ?? 0, uiLocale) },
        { label: "Совпадений", value: String(value.overlapCount) },
        { label: "Глубина", value: `ТОП-${value.depth}` },
        ...(value.failureCode ? [{ label: "Код ошибки", value: value.failureCode }] : [])
      ]
    };
  }
  if (data.kind === "rank") {
    const value = data.value;
    const competitorCollection = isCompetitorCollection(value.execution);
    const current = Number(value.job.progress.current);
    const total = Number(value.job.progress.total);
    const { found, notFound, failed } = rankOperationCounts(value);
    const searchSource = rankSearchSourceFromProviderMappingVersion(
      value.execution.searchEngine,
      value.execution.providerMappingVersion
    );
    const searchSystem = rankSearchSystemLabel(
      value.execution.searchEngine,
      searchSource
    );
    return {
      title: rankCollectionTitle(value.execution),
      description: `${searchSystem} · ${deviceLabel(value.execution.device)}${competitorCollection ? " · органическая выдача" : ""}`,
      context: searchContextDisplayName(
        value.contextName,
        value.execution.searchEngine,
        value.execution.regionCode
      ),
      provider: value.job.provider,
      ...summaryStatus(value.job.status, current, total, undefined, uiLocale),
      facts: [
        ...(competitorCollection
          ? [
              {
                label: "Срезов",
                value: formatInteger(
                  Number(value.job.result?.persistedCount ?? current - failed), uiLocale
                )
              },
              {
                label: "Результатов загружено",
                value: formatInteger(
                  value.rows.reduce(
                    (total, row) => total + (row.serpResults?.length ?? 0),
                    0
                  ), uiLocale
                )
              }
            ]
          : [
              { label: "Найдено", value: formatInteger(found, uiLocale) },
              { label: "Не найдено", value: formatInteger(notFound, uiLocale) }
            ]),
        { label: "Ошибок", value: formatInteger(failed, uiLocale) },
        { label: "Регион", value: searchRegionDisplayName(value.execution.searchEngine, value.execution.regionCode) },
        { label: "Глубина", value: rankCollectionDepthLabel(value.execution, value.execution.depth) ?? "—" },
        ...("failure" in value.job && value.job.failure
          ? [{ label: "Код ошибки", value: value.job.failure.code }]
          : [])
      ]
    };
  }
  if (data.kind === "crawl") {
    const value = data.value.crawl;
    const total = Math.max(value.discoveredUrls, value.processedUrls);
    return {
      title: value.config.purpose === "HTTP_STATUS_CHECK" ? "Обход сайта" : "Технический аудит",
      description: `${value.config.startUrls.length} стартовых URL · до ${formatInteger(value.config.maxUrls, uiLocale)} страниц`,
      ...summaryStatus(value.status, value.processedUrls, total, undefined, uiLocale),
      facts: [
        { label: "Обработано", value: formatInteger(value.processedUrls, uiLocale) },
        { label: "Ошибок", value: formatInteger(value.failedUrls, uiLocale) },
        ...(value.config.purpose === "HTTP_STATUS_CHECK"
          ? []
          : [{ label: "SEO-проблем", value: formatInteger(value.issueCount, uiLocale) }]),
        { label: "Успешно", value: formatInteger(value.successfulUrls, uiLocale) },
        ...(value.failureCode
          ? [{ label: "Код ошибки", value: value.failureCode }]
          : [])
      ]
    };
  }
  const value = data.value;
  const current = value.importedKeywords > 0 ? value.importedKeywords : value.collectedKeywords;
  const total = value.totalAvailable ?? value.maxKeywords;
  const keysSo = value.source === "KEYS_SO";
  const wordstatProvider = value.source === "XMLSTOCK_WORDSTAT"
    ? "XMLSTOCK"
    : "ARSENKIN";
  return {
    title: keywordResearchCollectionTitle(value),
    description: keysSo
      ? `Keys.so · ${value.domain ?? "—"} · ${(value.database ?? "msk").toUpperCase()}`
      : `${wordstatProvider === "XMLSTOCK" ? "XMLStock" : "Arsenkin"} · ${value.seedCount ?? 0} исходных фраз · ${seoRegionDisplayName("WORDSTAT", value.regionCode ?? "225")}`,
    provider: keysSo ? "KEYS_SO" : wordstatProvider,
    ...summaryStatus(value.status, current, total, undefined, uiLocale),
    facts: [
      { label: "Найдено", value: formatInteger(value.collectedKeywords, uiLocale) },
      { label: "Выбрано", value: formatInteger(value.selectedKeywords, uiLocale) },
      { label: "Импортировано", value: formatInteger(value.importedKeywords, uiLocale) },
      { label: "Доступно", value: value.totalAvailable === undefined ? "—" : formatInteger(value.totalAvailable, uiLocale) },
      ...(value.failureCode
        ? [{ label: "Код ошибки", value: value.failureCode }]
        : [])
    ]
  };
}

function summaryStatus(status: string, current: number, total: number, stage?: string, uiLocale: string = "ru-RU"): Pick<SummaryView, "status" | "tone" | "progress" | "progressPercent"> {
  return {
    status: operationStatusLabel(status, stage),
    tone: statusTone(status),
    progress: total > 0 ? `${formatInteger(current, uiLocale)} из ${formatInteger(total, uiLocale)}` : "Ожидает данных",
    progressPercent: total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0
  };
}

async function loadOperationResult(
  projectId: string,
  kind: OperationResultKind,
  operationId: string,
  page?: Readonly<{ cursor?: string; limit?: number }>,
  signal?: AbortSignal
): Promise<OperationResultData> {
  const path = operationResultApiPath(projectId, kind, operationId, page);
  if (kind === "frequency") return { kind, value: await browserApiRequest<FrequencyOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "ai-answer") return { kind, value: await browserApiRequest<AiAnswerOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "clustering") return { kind, value: await browserApiRequest<ClusteringOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "rank") return { kind, value: await browserApiRequest<RankOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "crawl") return { kind, value: await browserApiRequest<CrawlOperationResultPage>(path, signal ? { signal } : {}) };
  return { kind, value: await browserApiRequest<KeywordResearchRunSummary>(path, signal ? { signal } : {}) };
}

function operationResultRange(
  data: OperationResultData, uiLocale: string = "ru-RU"
): string {
  if (data.kind === "research") return "";
  const loaded = data.value.rows.length;
  const total = operationResultTotal(data);
  if (loaded === 0) return "Строк пока нет";
  return total > 0
    ? `Загружено ${formatInteger(loaded, uiLocale)} из ${formatInteger(Math.max(loaded, total), uiLocale)}`
    : `Загружено ${formatInteger(loaded, uiLocale)}`;
}

function operationResultPageRequest(
  kind: OperationResultKind,
  cursor?: string
): Readonly<{ cursor?: string; limit: number }> | undefined {
  if (kind === "research") return undefined;
  return {
    limit: kind === "crawl" ? 1_000 : operationResultDefaultPageSize,
    ...(cursor ? { cursor } : {})
  };
}

function operationResultPage(
  data: OperationResultData
): OperationResultPageInfo | undefined {
  return data.kind === "research" ? undefined : data.value.page;
}

function operationResultTotal(data: OperationResultData): number {
  if (data.kind === "frequency") return data.value.collection.selectedKeywords;
  if (data.kind === "ai-answer") return data.value.collection.selectedKeywords;
  if (data.kind === "clustering") return data.value.run.selectedKeywords;
  if (data.kind === "rank") return Number(data.value.job.progress.total);
  if (data.kind === "crawl") {
    return Math.max(
      data.value.rows.length,
      data.value.crawl.discoveredUrls,
      data.value.crawl.processedUrls
    );
  }
  return 0;
}

function mergeOperationResultData(
  current: OperationResultData | undefined,
  incoming: OperationResultData
): OperationResultData {
  if (!current || current.kind !== incoming.kind) return incoming;
  if (incoming.kind === "frequency" && current.kind === "frequency") {
    return {
      kind: "frequency",
      value: {
        ...incoming.value,
        rows: mergeOperationResultRows(current.value.rows, incoming.value.rows)
      }
    };
  }
  if (incoming.kind === "ai-answer" && current.kind === "ai-answer") {
    return {
      kind: "ai-answer",
      value: {
        ...incoming.value,
        rows: mergeOperationResultRows(current.value.rows, incoming.value.rows)
      }
    };
  }
  if (incoming.kind === "clustering" && current.kind === "clustering") {
    return {
      kind: "clustering",
      value: {
        ...incoming.value,
        rows: mergeOperationResultRows(current.value.rows, incoming.value.rows)
      }
    };
  }
  if (incoming.kind === "rank" && current.kind === "rank") {
    return {
      kind: "rank",
      value: {
        ...incoming.value,
        rows: mergeOperationResultRows(current.value.rows, incoming.value.rows)
      }
    };
  }
  if (incoming.kind === "crawl" && current.kind === "crawl") {
    return {
      kind: "crawl",
      value: {
        ...incoming.value,
        rows: mergeOperationResultRows(current.value.rows, incoming.value.rows)
      }
    };
  }
  return incoming;
}

async function loadRankJobWithoutResult(
  projectId: string,
  kind: OperationResultKind,
  operationId: string,
  resultError: unknown,
  signal?: AbortSignal
): Promise<RankJobSummary | undefined> {
  if (
    kind !== "rank" ||
    !(resultError instanceof BrowserApiError) ||
    resultError.status !== 404
  ) {
    return undefined;
  }
  try {
    const job = await browserApiRequest<RankJobSummary>(
      `/app/api/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(operationId)}`,
      signal ? { signal } : {}
    );
    return job;
  } catch {
    return undefined;
  }
}

function isActiveOperation(data: OperationResultData): boolean {
  if (data.kind === "frequency") return isActiveStatus(data.value.collection.status);
  if (data.kind === "ai-answer") return isActiveStatus(data.value.collection.status);
  if (data.kind === "clustering") return isActiveStatus(data.value.run.status);
  if (data.kind === "rank") return isActiveStatus(data.value.job.status);
  if (data.kind === "crawl") return isActiveStatus(data.value.crawl.status);
  return isActiveStatus(data.value.status);
}

function isActiveStatus(status: string): boolean {
  return ["PREPARING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE", "CANCEL_REQUESTED", "IMPORT_QUEUED", "IMPORTING"].includes(status);
}

function operationActorId(data: OperationResultData): string | undefined {
  if (data.kind === "frequency") return data.value.collection.actorId;
  if (data.kind === "ai-answer") return data.value.collection.actorId;
  if (data.kind === "clustering") return data.value.run.actorId;
  if (data.kind === "rank") return data.value.job.actorId;
  if (data.kind === "crawl") return data.value.crawl.actorId;
  return data.value.actorId;
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("") || "У";
}

function frequencyProvider(row: FrequencyOperationResultRow): string { return row.snapshots[0]?.provider ?? "—"; }
function frequencyObservedAt(row: FrequencyOperationResultRow, uiLocale: string = "ru-RU"): string { return formatDateTime(row.snapshots[0]?.observedAt, uiLocale); }
function rankPosition(row: RankOperationResultRow, uiLocale: string = "ru-RU"): string { return row.state === "FOUND" ? formatOptionalNumber(row.position ?? row.absolutePosition, uiLocale) : row.state === "NOT_FOUND" ? "Не найден" : "—"; }
function formatOptionalNumber(value: number | undefined, uiLocale: string = "ru-RU"): string { return value === undefined ? "—" : formatInteger(value, uiLocale); }
function formatDecimal(value: string, uiLocale: string = "ru-RU"): string { const number = Number(value); return Number.isSafeInteger(number) ? formatInteger(number, uiLocale) : value; }
function formatInteger(value: number, uiLocale: string = "ru-RU"): string { return new Intl.NumberFormat(uiLocale).format(value); }
function formatBytes(value: number): string { if (value < 1024) return `${value} Б`; if (value < 1_048_576) return `${(value / 1024).toFixed(1)} КБ`; return `${(value / 1_048_576).toFixed(1)} МБ`; }
function formatDateTime(value: string | undefined, uiLocale: string = "ru-RU"): string { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(uiLocale, { dateStyle: "short", timeStyle: "short" }).format(date); }
function safeExternalUrl(value: string): string | undefined { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }
function providerLabel(provider: "XMLSTOCK" | "ARSENKIN"): string { return provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"; }
function frequencyTypeLabel(type: string): string { return ({ BASE: "База", EXACT: '""', FIXED: '"!"' } as Readonly<Record<string, string>>)[type] ?? type; }
function deviceLabel(device: string): string { return ({ ALL: "Все устройства", DESKTOP: "Десктоп", MOBILE: "Мобильные", PHONE_ONLY: "Телефоны", TABLET_ONLY: "Планшеты" } as Readonly<Record<string, string>>)[device] ?? device; }
function indexabilityLabel(value: string): string { return ({ INDEXABLE: "Индексируется", NOINDEX: "Noindex", CANONICALIZED: "Canonical на другой URL", REDIRECTED: "Редирект", ERROR: "Ошибка", UNKNOWN: "Не определено" } as Readonly<Record<string, string>>)[value] ?? value; }
function clusteringRowStateLabel(row: ClusteringProposalResultRow): string {
  const currentCluster = row.currentClusterName
    ? `SEO-кластер «${row.currentClusterName}»`
    : "текущий SEO-кластер";
  if (row.state === "READY") {
    return row.currentClusterName
      ? `Сейчас: ${currentCluster} · назначение можно изменить или оставить`
      : "Готов к применению";
  }
  if (row.state === "UNCHANGED") {
    return row.currentClusterName
      ? `Уже находится в SEO-кластере «${row.currentClusterName}»`
      : "Изменения не требуются";
  }
  if (row.state === "LOCKED") return `${currentCluster} защищён от изменений`;
  if (row.state === "EXCLUDED") return `${currentCluster} исключён из перекластеризации`;
  if (row.state === "UNAVAILABLE") return "Запрос удалён или больше недоступен";
  if (row.conflictReason === "KEYWORD_CHANGED") {
    return "Запрос изменён после запуска — запустите кластеризацию заново";
  }
  return "Состояние запроса изменилось после запуска";
}
function itemStatusLabel(value: string): string { return ({ PENDING: "Ожидает", QUEUED: "В очереди", RUNNING: "Выполняется", COMPLETED: "Готово", FAILED_RETRYABLE: "Повтор", FAILED_FINAL: "Ошибка", CANCELLED: "Отменено" } as Readonly<Record<string, string>>)[value] ?? value; }
function statusTone(value: string): SummaryView["tone"] { if (["COMPLETED"].includes(value)) return "Success"; if (["FAILED", "FAILED_FINAL"].includes(value)) return "Error"; if (["ACTION_REQUIRED", "PARTIALLY_COMPLETED", "READY_TO_IMPORT"].includes(value)) return "Warning"; if (isActiveStatus(value)) return "Active"; return "Neutral"; }
function operationResultError(error: unknown): string { if (!(error instanceof BrowserApiError)) return "Не удалось получить результат операции."; if (error.status === 403) return "У вас нет доступа к результату этой операции."; if (error.status === 404) return "Операция не найдена в текущем проекте."; return error.message; }
function clusteringMutationError(error: unknown): string { if (!(error instanceof BrowserApiError)) return "Не удалось применить результат кластеризации."; if (error.code === "QUOTA_EXCEEDED") return "Для новых папок не хватает лимита тарифа. Выберите существующие папки, «Не переносить» для части кластеров или уменьшите число новых папок."; if (error.status === 409) return "Проект изменился после расчёта. Обновите результат и проверьте конфликты."; if (error.status === 403) return "Недостаточно прав для изменения кластеров и папок."; return error.message; }
function workspaceClass(embedded: boolean): string {
  const workspace = styles.workspace ?? "";
  return embedded ? `${workspace} ${styles.embedded ?? ""}` : workspace;
}
