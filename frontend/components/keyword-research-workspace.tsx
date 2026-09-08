"use client";
import { prepareOperationAttempt, type OperationAttempt } from "../lib/operation-attempt";

import {
  keysSoDatabases,
  type ConfirmKeywordResearchRunInput,
  type CreateKeywordResearchRunInput,
  type CreateWordstatExpansionRunInput,
  type KeywordResearchCollection,
  type KeywordResearchRow,
  type KeywordResearchRowPage,
  type KeywordResearchRunSummary,
  type KeysSoDatabase,
  type ProjectConnectorBinding,
  type ProjectConnectorSettings,
  type ProjectSearchCity,
  type SemanticImportDuplicatePolicy,
  type SemanticKeywordGroup,
  type WorkspaceConnectorRoutingSettings,
  type WordstatExpansionDevice,
  type WordstatImportDistributionMode
} from "@seo-platform/contracts";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { preparedProjectIntegrations } from "../lib/prepared-project-integrations";
import { integrationProviderLabel } from "../lib/integration-presentation";
import {
  createProjectConnectorBindingInput,
  type IdempotentCreateCommand,
  projectConnectorBinding,
  projectConnectorCreatePayloadSignature,
  type ProjectConnectorDraft,
  stableProjectConnectorCreateCommand,
  updateProjectConnectorBindingInput,
  withProjectConnectorBinding
} from "../lib/project-integration-settings";
import {
  wordstatExpansionSourceOptions,
  wordstatResultLimit,
  wordstatScopeIsResolving
} from "../lib/wordstat-expansion-form";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchableRegionSelect } from "./searchable-region-select";
import { SemanticGroupPickerField } from "./semantic-group-picker";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import {
  SemanticOperationScope,
  type SemanticOperationSelection
} from "./semantic-operation-scope";
import { SemanticModal } from "./semantic-modal";
import { UiText, useUiLocale } from "./ui-locale";


const ACTIVE = new Set([
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "IMPORT_QUEUED",
  "IMPORTING"
]);
const CANCELLABLE = new Set([
  "QUEUED",
  "RUNNING",
  "RETRY_SCHEDULED",
  "READY_TO_IMPORT"
]);
const PRIMARY_DESTINATION = "__PRIMARY_DESTINATION__";
type ResearchTab = "KEYS_SO" | "WORDSTAT";

export function KeywordResearchWorkspace({
  projectId,
  projectDomain,
  projectSearchCity,
  workspaceId
}: Readonly<{
  projectId: string;
  projectDomain: string;
  projectSearchCity?: ProjectSearchCity | undefined;
  workspaceId: string;
}>) {
  const { t: uiText } = useUiLocale();
  const [collection, setCollection] = useState<KeywordResearchCollection>();
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [source, setSource] = useState<ResearchTab>("KEYS_SO");
  const [domain, setDomain] = useState(projectDomain);
  const [database, setDatabase] = useState<KeysSoDatabase>("msk");
  const [maxKeywords, setMaxKeywords] = useState("100");
  const [expandedRunId, setExpandedRunId] = useState<string>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [wordstatOpen, setWordstatOpen] = useState(false);
  const [wordstatSeeds, setWordstatSeeds] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const createCommand = useRef<
    OperationAttempt | undefined
  >(undefined);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [next, nextGroups] = await Promise.all([
        browserApiRequest<KeywordResearchCollection>(
          path(projectId),
          signal ? { signal } : {}
        ),
        browserApiRequest<readonly SemanticKeywordGroup[]>(
          `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`,
          signal ? { signal } : {}
        ).catch(() => [] as readonly SemanticKeywordGroup[])
      ]);
      setCollection(next);
      setGroups(nextGroups);
      setError(undefined);
      setExpandedRunId((current) =>
        current ?? next.runs.find(({ status }) => status === "READY_TO_IMPORT")?.id ?? next.runs[0]?.id
      );
    } catch (caught) {
      if (!signal?.aborted) {
        setError(message(caught, "Не удалось загрузить данные Keys.so и Wordstat."));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasActive = useMemo(
    () => collection?.runs.some(({ status }) => ACTIVE.has(status)) ?? false,
    [collection]
  );
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void load(), 4_000);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

  const expanded = collection?.runs.find(({ id }) => id === expandedRunId);
  const expandedId = expanded?.id;
  const expandedRowIds = expanded?.rows.map(({ id }) => id).join("\n") ?? "";
  useEffect(() => {
    setSelected(new Set(expandedRowIds ? expandedRowIds.split("\n") : []));
  }, [expandedId, expandedRowIds]);

  const visibleRuns = collection?.runs.filter((run) =>
    source === "KEYS_SO" ? run.source === "KEYS_SO" : run.source !== "KEYS_SO"
  ) ?? [];
  const latestKeysRun = collection?.runs.find(
    (run) => run.source === "KEYS_SO" && run.overview !== undefined
  );

  async function createRun(
    input: CreateKeywordResearchRunInput,
    prefix: "keyword-research" | "wordstat-expansion"
  ): Promise<KeywordResearchRunSummary> {
    createCommand.current = prepareOperationAttempt(createCommand.current, path(projectId), input, input.source, prefix);
    const run = await browserApiRequest<KeywordResearchRunSummary>(path(projectId), {
      method: "POST",
      operationAttempt: createCommand.current,
      body: input
    });
    createCommand.current = undefined;
    return run;
  }

  async function startKeys(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || collection?.access.canRun !== true) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const run = await createRun({
        source: "KEYS_SO",
        domain: domain.trim(),
        database,
        maxKeywords: Number(maxKeywords)
      }, "keyword-research");
      setExpandedRunId(run.id);
      setNotice("Анализ Keys.so поставлен в очередь.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось запустить анализ Keys.so."));
    } finally {
      setBusy(false);
    }
  }

  async function startWordstat(input: CreateWordstatExpansionRunInput): Promise<void> {
    const run = await createRun(input, "wordstat-expansion");
    setSource("WORDSTAT");
    setExpandedRunId(run.id);
    setNotice("Парсинг Wordstat поставлен в очередь. Результат появится автоматически.");
    await load();
  }

  async function confirm(
    run: KeywordResearchRunSummary,
    input: ConfirmKeywordResearchRunInput
  ): Promise<void> {
    if (busy || collection?.access.canImport !== true) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<KeywordResearchRunSummary>(
        `${path(projectId)}/${encodeURIComponent(run.id)}/confirm`,
        { method: "POST", ifMatch: run.version, body: input }
      );
      setNotice("Запросы поставлены в очередь импорта.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось подтвердить импорт."));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(run: KeywordResearchRunSummary): Promise<void> {
    if (busy || !collection?.access.canCancel) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<KeywordResearchRunSummary>(
        `${path(projectId)}/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST", ifMatch: run.version, body: {} }
      );
      setNotice("Операция отменена.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось отменить операцию."));
    } finally {
      setBusy(false);
    }
  }

  async function retryImport(run: KeywordResearchRunSummary): Promise<void> {
    if (busy || collection?.access.canImport !== true) return;
    setBusy(true);
    setError(undefined);
    try {
      await browserApiRequest<KeywordResearchRunSummary>(
        `${path(projectId)}/${encodeURIComponent(run.id)}/retry-import`,
        { method: "POST", ifMatch: run.version, body: {} }
      );
      setNotice("Импорт перезапущен с сохранёнными настройками.");
      await load();
    } catch (caught) {
      setError(message(caught, "Не удалось повторить импорт."));
    } finally {
      setBusy(false);
    }
  }

  function openWordstat(seeds: readonly string[] = []): void {
    setWordstatSeeds(seeds.join("\n"));
    setWordstatOpen(true);
  }

  if (loading && !collection) {
    return <section className="panel panel-empty" aria-busy="true"><span className="spinner" /><p><UiText text="Загружаем данные…" /></p></section>;
  }

  return (
    <div className="keyword-research-workspace settings-stack">
      {error && <div className="inline-error" role="alert">{<UiText text={error ?? ""} />}</div>}
      {notice && <div className="inline-success" role="status">{<UiText text={notice ?? ""} />}</div>}

      <div className="keyword-research-source-tabs" role="tablist" aria-label={uiText("Источник данных")}>
        <button aria-selected={source === "KEYS_SO"} className={source === "KEYS_SO" ? "selected" : undefined} onClick={() => setSource("KEYS_SO")} role="tab" type="button">
          <ProviderLogo provider="KEYS_SO" size="compact" /> Keys.so
        </button>
        <button aria-selected={source === "WORDSTAT"} className={source === "WORDSTAT" ? "selected" : undefined} onClick={() => setSource("WORDSTAT")} role="tab" type="button">
          <span className="keyword-research-provider-pair"><ProviderLogo provider="XMLSTOCK" size="compact" /><ProviderLogo provider="ARSENKIN" size="compact" /></span> <UiText text="Парсинг Wordstat" before=" " /></button>
      </div>

      {source === "KEYS_SO" ? (
        <>
          <section className="panel keyword-research-launch-card">
            <div className="section-heading">
              <div><p className="eyebrow"><UiText text="Аналитика домена" /></p><h2><UiText text="Ключи и конкуренты из Keys.so" /></h2><p><UiText text="Получите сводку по ТОПу, органические запросы и ближайших конкурентов." /></p></div>
              <a className="secondary-button" href="/app/settings/integrations"><UiText text="Настроить API" /></a>
            </div>
            <form className="keyword-research-launch-form" onSubmit={startKeys}>
              <label className="form-field"><span><UiText text="Домен" /></span><input autoComplete="off" onChange={(event) => setDomain(event.target.value)} placeholder="example.ru" required value={domain} /></label>
              <label className="form-field"><span><UiText text="База" /></span><CustomSelect onChange={(event) => setDatabase(event.target.value as KeysSoDatabase)} value={database}>{keysSoDatabases.map((code) => <option key={code} value={code}>{<UiText text={databaseLabel(code) ?? ""} />}</option>)}</CustomSelect></label>
              <label className="form-field"><span><UiText text="Ключей" /></span><input max={500} min={25} onChange={(event) => setMaxKeywords(event.target.value)} required step={25} type="number" value={maxKeywords} /></label>
              <button className="primary-button" disabled={busy || collection?.access.canRun !== true} type="submit">{busy ? <UiText text="Запускаем…" /> : <UiText text="Получить данные" />}</button>
            </form>
          </section>
          {latestKeysRun?.overview && <KeysOverview run={latestKeysRun} />}
        </>
      ) : (
        <section className="panel keyword-research-wordstat-card">
          <div className="section-heading">
            <div><p className="eyebrow">XMLStock · Arsenkin Tools</p><h2><UiText text="Расширить семантику через Wordstat" /></h2><p><UiText text="Выберите провайдера, вставьте до 500 исходных фраз или возьмите запросы проекта. Перед импортом результат можно проверить." /></p></div>
            <div className="button-row">
              <a className="secondary-button" href="/app/settings/integrations"><UiText text="Настроить провайдеров" /></a>
              <button className="primary-button" disabled={collection?.access.canRun !== true} onClick={() => openWordstat()} type="button"><Icon name="plus" /> <UiText text="Запустить парсинг" before=" " /></button>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow"><UiText text="Операции" /></p><h2>{source === "KEYS_SO" ? <UiText text="Сборы Keys.so" /> : <UiText text="Парсинги Wordstat" />}</h2></div>{visibleRuns.some(({ status }) => ACTIVE.has(status)) && <span className="status-badge"><UiText text="Выполняется" /></span>}</div>
        {visibleRuns.length === 0 ? (
          <div className="panel-empty"><strong><UiText text="Операций пока нет" /></strong><p><UiText text="Запустите первый сбор — он появится здесь." /></p></div>
        ) : (
          <div className="keyword-research-run-list">
            {visibleRuns.map((run) => (
              <article className="subpanel" key={run.id}>
                <button className="semantic-row-button" onClick={() => setExpandedRunId(run.id)} type="button">
                  <span><strong>{runTitle(run)}</strong><small>{runMeta(run)}</small></span>
                  <span className={`status-badge status-${run.status.toLowerCase()}`}>{<UiText text={statusLabel(run.status) ?? ""} />}</span>
                </button>
                {expanded?.id === run.id && (
                  <KeywordResearchRunPreview
                    busy={busy}
                    canCancel={collection?.access.canCancel === true}
                    canImport={collection?.access.canImport === true}
                    groups={groups}
                    onCancel={() => void cancel(run)}
                    onConfirm={(input) => void confirm(run, input)}
                    onOpenWordstat={(seeds) => openWordstat(seeds)}
                    onRetryImport={() => void retryImport(run)}
                    onSelected={setSelected}
                    key={run.id}
                    run={run}
                    selected={selected}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {wordstatOpen && (
        <WordstatExpansionDialog
          groups={groups}
          initialText={wordstatSeeds}
          onClose={() => setWordstatOpen(false)}
          onSubmit={async (input) => {
            await startWordstat(input);
            setWordstatOpen(false);
          }}
          projectId={projectId}
          projectSearchCity={projectSearchCity}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}

function KeysOverview({ run }: Readonly<{ run: KeywordResearchRunSummary }>) {
  const uiLocale = useUiLocale().locale;
  const [tab, setTab] = useState<"OVERVIEW" | "KEYWORDS" | "COMPETITORS">("OVERVIEW");
  const overview = run.overview;
  return (
    <section className="panel keyword-research-result-panel">
      <div className="keyword-research-result-tabs" role="tablist">
        {([ ["OVERVIEW", "Обзор"], ["KEYWORDS", `Ключи · ${run.totalAvailable ?? run.collectedKeywords}`], ["COMPETITORS", `Конкуренты · ${run.competitors?.length ?? 0}`] ] as const).map(([value, label]) => <button className={tab === value ? "selected" : undefined} key={value} onClick={() => setTab(value)} role="tab" type="button">{label}</button>)}
      </div>
      {tab === "OVERVIEW" && overview && <div className="keyword-research-metric-grid">{([ ["ТОП-1", overview.top1], ["ТОП-3", overview.top3], ["ТОП-5", overview.top5], ["ТОП-10", overview.top10], ["ТОП-50", overview.top50], ["Видимость", overview.visibility ?? "—"] ] as const).map(([label, value]) => <article key={label}><span>{label}</span><strong>{typeof value === "number" ? formatInteger(value, uiLocale) : value}</strong></article>)}</div>}
      {tab === "KEYWORDS" && <SimpleKeywordTable run={run} />}
      {tab === "COMPETITORS" && <CompetitorTable run={run} />}
    </section>
  );
}

function SimpleKeywordTable({ run }: Readonly<{ run: KeywordResearchRunSummary }>) {
  return <div className="table-scroll"><table className="data-table"><thead><tr><th><UiText text="Запрос" /></th><th><UiText text="Позиция" /></th><th><UiText text="Частотность" /></th><th>URL</th></tr></thead><tbody>{run.rows.map((row) => <tr key={row.id}><td><strong>{row.keyword}</strong></td><td>{row.position ?? "—"}</td><td>{row.frequencyBase ?? "—"}</td><td><span className="table-secondary">{row.url ?? "—"}</span></td></tr>)}</tbody></table></div>;
}

function CompetitorTable({ run }: Readonly<{ run: KeywordResearchRunSummary }>) {
  const uiLocale = useUiLocale().locale;
  if (!run.competitors?.length) return <div className="panel-empty"><p><UiText text="Keys.so не вернул конкурентов для этого домена." /></p></div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th><UiText text="Домен" /></th><th><UiText text="Общие ключи" /></th><th><UiText text="Сходство" /></th><th><UiText text="ТОП-10" /></th><th><UiText text="Видимость" /></th></tr></thead><tbody>{run.competitors.map((item) => <tr key={item.domain}><td><strong>{item.domain}</strong></td><td>{formatInteger(item.commonKeywords, uiLocale)}</td><td>{item.similarity ?? "—"}</td><td>{item.top10 ?? "—"}</td><td>{item.visibility ?? "—"}</td></tr>)}</tbody></table></div>;
}

export function KeywordResearchRunPreview({
  run,
  selected,
  onSelected,
  onConfirm,
  onCancel,
  onOpenWordstat,
  onRetryImport,
  groups,
  canImport,
  canCancel,
  busy,
  onDirtyChange
}: Readonly<{
  run: KeywordResearchRunSummary;
  selected: ReadonlySet<string>;
  onSelected: (value: ReadonlySet<string>) => void;
  onConfirm: (input: ConfirmKeywordResearchRunInput) => void;
  onCancel: () => void;
  onOpenWordstat?: (seeds: readonly string[]) => void;
  onRetryImport: () => void;
  groups: readonly SemanticKeywordGroup[];
  canImport: boolean;
  canCancel: boolean;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const ready = run.status === "READY_TO_IMPORT";
  const retryableImport =
    run.status === "FAILED" &&
    run.selectedKeywords > 0 &&
    run.failureCode?.startsWith("SEO_DATA_") === true;
  const [duplicatePolicy, setDuplicatePolicy] = useState<SemanticImportDuplicatePolicy>("SKIP_EXISTING");
  const [selectionMode, setSelectionMode] = useState<"ALL" | "SELECTED">("ALL");
  const [excludedRowIds, setExcludedRowIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [destination, setDestination] = useState<"NEW" | "EXISTING">("NEW");
  const [groupId, setGroupId] = useState("");
  const [parentId, setParentId] = useState("");
  const [distributionMode, setDistributionMode] =
    useState<WordstatImportDistributionMode>("SINGLE_GROUP");
  const initialNewName = `Wordstat · ${new Date(run.createdAt).toLocaleDateString(uiLocale)}`;
  const [newName, setNewName] = useState(initialNewName);
  const [rowGroupIds, setRowGroupIds] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [rowSearch, setRowSearch] = useState("");
  const [loadedRows, setLoadedRows] = useState<readonly KeywordResearchRow[]>(
    run.rows
  );
  const [paginationComplete, setPaginationComplete] = useState(
    run.rows.length >= run.collectedKeywords
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const resultSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const requestedCursorsRef = useRef(new Set<string>());
  useEffect(() => {
    setLoadedRows((current) => mergeKeywordResearchRows(current, run.rows));
    if (run.collectedKeywords > run.rows.length) setPaginationComplete(false);
  }, [run.collectedKeywords, run.rows]);
  const normalizedRowSearch = rowSearch.trim().toLocaleLowerCase("ru-RU");
  const visibleRows = useMemo(
    () => normalizedRowSearch
      ? loadedRows.filter((row) =>
          `${row.keyword}\n${row.sourceQuery ?? ""}`
            .toLocaleLowerCase("ru-RU")
            .includes(normalizedRowSearch)
        )
      : loadedRows,
    [loadedRows, normalizedRowSearch]
  );
  const selectedCount = selectionMode === "ALL"
    ? Math.max(0, run.collectedKeywords - excludedRowIds.size)
    : selected.size;
  const isRowSelected = (rowId: string): boolean => selectionMode === "ALL"
    ? !excludedRowIds.has(rowId)
    : selected.has(rowId);
  const nextCursor = !paginationComplete && loadedRows.length < run.collectedKeywords
    ? loadedRows.at(-1)?.ordinal
    : undefined;

  const loadMore = useCallback(async (): Promise<void> => {
    if (
      nextCursor === undefined ||
      loadingMoreRef.current ||
      requestedCursorsRef.current.has(String(nextCursor))
    ) {
      return;
    }
    const cursor = String(nextCursor);
    requestedCursorsRef.current.add(cursor);
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setPageError(undefined);
    try {
      const result = await browserApiRequest<KeywordResearchRowPage>(
        `${path(run.projectId)}/${encodeURIComponent(run.id)}/rows?cursor=${encodeURIComponent(cursor)}&limit=200`
      );
      setLoadedRows((current) => mergeKeywordResearchRows(current, result.rows));
      setPaginationComplete(!result.page.hasNext);
    } catch (caught) {
      requestedCursorsRef.current.delete(cursor);
      setPageError(message(caught, "Не удалось загрузить следующие запросы."));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextCursor, run.id, run.projectId]);

  useEffect(() => {
    const root = resultScrollRef.current;
    const target = resultSentinelRef.current;
    if (!root || !target || nextCursor === undefined || pageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "320px 0px", threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor, pageError]);
  const targetGroupPath = destination === "EXISTING"
    ? groups.find(({ id }) => id === groupId)?.path
    : joinPath(groups.find(({ id }) => id === parentId)?.path, newName.trim());
  const targetMissing = run.source !== "KEYS_SO" && !targetGroupPath;
  const primaryDestinationOption = useMemo(
    () => [{
      icon: "projects" as const,
      label: distributionMode === "BY_SOURCE_QUERY"
        ? "Автоматически по исходной фразе"
        : "Корневая папка",
      value: PRIMARY_DESTINATION
    }],
    [distributionMode]
  );
  const rowDestinations = [...rowGroupIds].flatMap(([rowId, destinationGroupId]) => {
    if (selectionMode === "SELECTED" && !selected.has(rowId)) return [];
    if (selectionMode === "ALL" && excludedRowIds.has(rowId)) return [];
    const targetGroupPath = groups.find(({ id }) => id === destinationGroupId)?.path;
    return targetGroupPath ? [{ rowId, targetGroupPath }] : [];
  });
  const dirty =
    destination !== "NEW" ||
    groupId !== "" ||
    parentId !== "" ||
    distributionMode !== "SINGLE_GROUP" ||
    newName !== initialNewName ||
    rowGroupIds.size > 0 ||
    selectionMode !== "ALL" ||
    excludedRowIds.size > 0 ||
    duplicatePolicy !== "SKIP_EXISTING";

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  function setRowGroup(rowId: string, destinationGroupId: string): void {
    setRowGroupIds((current) => {
      const next = new Map(current);
      if (destinationGroupId === PRIMARY_DESTINATION) next.delete(rowId);
      else next.set(rowId, destinationGroupId);
      return next;
    });
  }

  const confirmImport = () => onConfirm({
    selectionMode,
    ...(selectionMode === "SELECTED" ? { selectedRowIds: [...selected] } : {}),
    ...(selectionMode === "ALL" && excludedRowIds.size > 0
      ? { excludedRowIds: [...excludedRowIds] }
      : {}),
    duplicatePolicy,
    ...(targetGroupPath ? { targetGroupPath } : {}),
    ...(rowDestinations.length > 0 ? { rowDestinations } : {}),
    distributionMode
  });

  return (
    <div className={`keyword-research-run-preview${ready ? " is-ready" : ""}`}>
      {run.failureCode && <div className="inline-error keyword-research-preview-error"><UiText text="Ошибка:" after=" " />{run.failureCode}</div>}
      {retryableImport && (
        <div className="keyword-research-retry-import">
          <span><strong><UiText text="Сбор завершён, не прошёл только импорт." /></strong><small><UiText text="Запросы и выбранные папки сохранены — повторный парсинг не нужен." /></small></span>
          <button className="primary-button" disabled={!canImport || busy} onClick={onRetryImport} type="button">{busy ? <UiText text="Перезапускаем…" /> : <UiText text="Повторить импорт" />}</button>
        </div>
      )}
      <section className="keyword-research-results-pane">
        <header className="keyword-research-results-toolbar">
          <span className="keyword-research-results-heading">
            <strong><UiText text="Найденные запросы" /></strong>
            <small>
              {visibleRows.length === loadedRows.length
                ? <UiText text="{0} загружено" values={[String(formatInteger(loadedRows.length, uiLocale))]} />
                : <UiText text="{0} из {1}" values={[String(formatInteger(visibleRows.length, uiLocale)), String(formatInteger(loadedRows.length, uiLocale))]} />}
              {run.collectedKeywords > loadedRows.length
                ? <UiText text="· всего {0}" values={[String(formatInteger(run.collectedKeywords, uiLocale))]} before=" " />
                : ""}
            </small>
          </span>
          {loadedRows.length > 0 && (
            <label className="keyword-research-result-search">
              <Icon name="search" />
              <input
                aria-label={uiText("Поиск по результатам Wordstat")}
                onChange={(event) => setRowSearch(event.target.value)}
                placeholder={uiText("Найти запрос или исходную фразу")}
                type="search"
                value={rowSearch}
              />
              {rowSearch && (
                <button aria-label={uiText("Очистить поиск")} onClick={() => setRowSearch("")} type="button">
                  <Icon name="close" />
                </button>
              )}
            </label>
          )}
          <span className="keyword-research-selection-count">
            <UiText text="Выбрано" after=" " /><strong>{formatInteger(selectedCount, uiLocale)}</strong>
          </span>
        </header>
        {loadedRows.length > 0 ? (
          <div className="table-scroll keyword-research-preview-table" ref={resultScrollRef}>
            <table
              className={`data-table keyword-research-result-table ${
                run.source === "KEYS_SO"
                  ? "is-keys-so-result"
                  : `is-wordstat-result${ready ? " has-folder-column" : ""}`
              }`}
            >
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label={uiText("Выбрать все найденные запросы")}
                      checked={run.collectedKeywords > 0 && selectedCount === run.collectedKeywords}
                      onChange={(event) => {
                        setExcludedRowIds(new Set());
                        if (event.target.checked) {
                          setSelectionMode("ALL");
                          onSelected(new Set());
                        } else {
                          setSelectionMode("SELECTED");
                          onSelected(new Set());
                        }
                      }}
                      type="checkbox"
                    />
                  </th>
                  <th><UiText text="Запрос" /></th>
                  {run.source !== "KEYS_SO" ? (
                    <><th><UiText text="Исходная фраза" /></th><th><UiText text="Колонка" /></th></>
                  ) : (
                    <><th><UiText text="Позиция" /></th><th>URL</th></>
                  )}
                  <th><UiText text="Частотность" /></th>
                  {run.source !== "KEYS_SO" && ready && <th><UiText text="Папка" /></th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        aria-label={uiText("Отметить {0}", [String(row.keyword)])}
                        checked={isRowSelected(row.id)}
                        onChange={(event) => {
                          if (selectionMode === "ALL") {
                            setExcludedRowIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            });
                            return;
                          }
                          const next = new Set(selected);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          onSelected(next);
                        }}
                        type="checkbox"
                      />
                    </td>
                    <td><strong>{row.keyword}</strong></td>
                    {run.source !== "KEYS_SO" ? (
                      <><td><span className="table-secondary">{row.sourceQuery ?? "—"}</span></td><td>{row.sourceColumn === "RIGHT" ? <UiText text="Справа" /> : <UiText text="Слева" />}</td></>
                    ) : (
                      <><td>{row.position ?? "—"}</td><td><span className="table-secondary">{row.url ?? "—"}</span></td></>
                    )}
                    <td>{row.frequencyBase === undefined ? "—" : formatInteger(row.frequencyBase, uiLocale)}</td>
                    {run.source !== "KEYS_SO" && ready && (
                      <td className="keyword-research-row-folder">
                        <SemanticGroupPickerField
                          className="keyword-research-row-folder-trigger"
                          dialogTitle={`Папка для «${row.keyword}»`}
                          groups={groups}
                          onChange={(value) => setRowGroup(row.id, value)}
                          rootLabel="Корневая папка"
                          showRootOption={false}
                          specialOptions={primaryDestinationOption}
                          value={rowGroupIds.get(row.id) ?? PRIMARY_DESTINATION}
                        />
                      </td>
                    )}
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td className="keyword-research-filter-empty" colSpan={ready && run.source !== "KEYS_SO" ? 6 : 5}><UiText text="Ничего не найдено. Измените запрос поиска." /></td></tr>
                )}
              </tbody>
            </table>
            {nextCursor !== undefined && (
              <div
                aria-hidden="true"
                className="keyword-research-infinite-sentinel"
                ref={resultSentinelRef}
              >
                {loadingMore && <span className="spinner" />}
              </div>
            )}
          </div>
        ) : (
          <div className="keyword-research-results-empty"><UiText text="В результате пока нет запросов." /></div>
        )}
        {(nextCursor !== undefined || loadingMore || pageError) && (
          <p className="keyword-research-preview-limit">
            {pageError ? (
              <><span>{<UiText text={pageError ?? ""} />}</span> <button className="text-button" onClick={() => void loadMore()} type="button"><UiText text="Повторить" /></button></>
            ) : loadingMore ? <UiText text="Подгружаем следующие запросы · {0} из {1}" values={[String(formatInteger(loadedRows.length, uiLocale)), String(formatInteger(run.collectedKeywords, uiLocale))]} /> : <UiText text="Прокрутите ниже — запросы загрузятся автоматически · {0} из {1}" values={[String(formatInteger(loadedRows.length, uiLocale)), String(formatInteger(run.collectedKeywords, uiLocale))]} />}
          </p>
        )}
        {run.source === "KEYS_SO" && selected.size > 0 && onOpenWordstat && (
          <div className="keyword-research-inline-action">
            <span><UiText text="Выбрано для расширения:" after=" " />{selected.size}</span>
            <button className="secondary-button" onClick={() => onOpenWordstat(loadedRows.filter(({ id }) => selected.has(id)).map(({ keyword }) => keyword))} type="button"><Icon name="search" /> <UiText text="Парсить в Wordstat" before=" " /></button>
          </div>
        )}
      </section>
      {ready && (
        <aside className="keyword-research-import-panel">
          <header className="keyword-research-import-heading">
            <span><strong><UiText text="Добавление в семантику" /></strong><small><UiText text="Настройте один раз, затем при необходимости переопределите папку у отдельных строк." /></small></span>
            <b>{formatInteger(selectedCount, uiLocale)}</b>
          </header>
          <div className="keyword-research-import-scroll">
            <div className="keyword-research-import-settings">
              <label className="form-field"><span><UiText text="Что импортировать" /></span><CustomSelect onChange={(event) => {
                const mode = event.target.value as "ALL" | "SELECTED";
                setSelectionMode(mode);
                setExcludedRowIds(new Set());
                if (mode === "ALL") onSelected(new Set());
              }} value={selectionMode}><option value="ALL"><UiText text="Все найденные ·" after=" " />{run.collectedKeywords}</option><option value="SELECTED"><UiText text="Только отмеченные ·" after=" " />{selected.size}</option></CustomSelect></label>
              <label className="form-field"><span><UiText text="Если запрос уже есть" /></span><CustomSelect onChange={(event) => setDuplicatePolicy(event.target.value as SemanticImportDuplicatePolicy)} value={duplicatePolicy}><option value="SKIP_EXISTING"><UiText text="Не добавлять найденные дубли" /></option><option value="OVERWRITE_MAPPED"><UiText text="Перенести дубли в выбранную папку" /></option></CustomSelect></label>
            </div>
            <p className="keyword-research-duplicate-hint">
              {duplicatePolicy === "SKIP_EXISTING"
                ? <UiText text="Существующие запросы останутся в своих папках, добавятся только новые." />
                : <UiText text="Существующие запросы будут убраны из прежних папок и перенесены в папку, выбранную ниже." />}
            </p>
            {run.source !== "KEYS_SO" && (
              <div className="keyword-research-destination">
                <div className="keyword-research-destination-switch"><button className={destination === "NEW" ? "selected" : undefined} onClick={() => setDestination("NEW")} type="button"><UiText text="Новая папка" /></button><button className={destination === "EXISTING" ? "selected" : undefined} onClick={() => setDestination("EXISTING")} type="button"><UiText text="Существующая" /></button></div>
                {destination === "NEW" ? (
                  <div className="keyword-research-new-folder">
                    <label className="form-field"><span><UiText text="Название новой папки" /></span><input maxLength={255} onChange={(event) => setNewName(event.target.value)} placeholder={uiText("Например, Идеи из Wordstat")} value={newName} /></label>
                    <label className="form-field"><span><UiText text="Создать внутри" /></span><SemanticGroupPickerField groups={groups} onChange={setParentId} rootLabel="Корневая папка" value={parentId} /></label>
                  </div>
                ) : (
                  <label className="form-field"><span><UiText text="Перенести в папку" /></span><SemanticGroupPickerField groups={groups} onChange={setGroupId} rootLabel="Выберите папку" value={groupId} /></label>
                )}
                {targetGroupPath && <p className="keyword-research-path-preview"><Icon name="projects" /> <span>{targetGroupPath}</span></p>}
                <div className="keyword-research-distribution-mode" role="radiogroup" aria-label={uiText("Способ раскладки результатов")}><span><UiText text="Как разложить" /></span><div className="keyword-research-destination-switch"><button className={distributionMode === "SINGLE_GROUP" ? "selected" : undefined} onClick={() => setDistributionMode("SINGLE_GROUP")} role="radio" aria-checked={distributionMode === "SINGLE_GROUP"} type="button"><UiText text="В одну папку" /></button><button className={distributionMode === "BY_SOURCE_QUERY" ? "selected" : undefined} onClick={() => setDistributionMode("BY_SOURCE_QUERY")} role="radio" aria-checked={distributionMode === "BY_SOURCE_QUERY"} type="button"><UiText text="По фразам" /></button></div></div>
                <p className="keyword-research-distribution-hint"><Icon name="semantic" /><span><strong>{distributionMode === "BY_SOURCE_QUERY" ? <UiText text="Для каждой исходной фразы будет создана своя вложенная папка." /> : <UiText text="Корневая папка применяется ко всем запросам." />}</strong> <UiText text="Папку отдельной строки можно изменить прямо в таблице." before=" " /></span></p>
              </div>
            )}
          </div>
          <footer className="keyword-research-import-actions">
            {CANCELLABLE.has(run.status) && <button className="secondary-button keyword-research-cancel-button" disabled={!canCancel || busy} onClick={onCancel} type="button"><UiText text="Отклонить" /></button>}
            <button className="primary-button" disabled={!canImport || busy || targetMissing || selectedCount < 1} onClick={confirmImport} type="button">{busy ? <UiText text="Ставим в очередь…" /> : selectionMode === "ALL" ? <UiText text="Импортировать ({0})" values={[String(selectedCount)]} /> : <UiText text="Импортировать ({0})" values={[String(selected.size)]} />}</button>
          </footer>
        </aside>
      )}
      {!ready && CANCELLABLE.has(run.status) && <button className="danger-button keyword-research-standalone-cancel" disabled={!canCancel || busy} onClick={onCancel} type="button"><UiText text="Отменить операцию" /></button>}
    </div>
  );
}

export function WordstatExpansionDialog({
  activeGroupId,
  groups,
  initialSelections = [],
  initialText,
  projectId,
  projectSearchCity,
  workspaceId,
  onClose,
  onSubmit
}: Readonly<{
  activeGroupId?: string | undefined;
  groups: readonly SemanticGroupTreeItem[];
  initialSelections?: readonly SemanticOperationSelection[];
  initialText: string;
  projectId: string;
  projectSearchCity?: ProjectSearchCity | undefined;
  workspaceId: string;
  onClose: () => void;
  onSubmit: (input: CreateWordstatExpansionRunInput) => Promise<void>;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const formId = useId();
  const [settings, setSettings] = useState<ProjectConnectorSettings>();
  const [workspaceRouting, setWorkspaceRouting] =
    useState<WorkspaceConnectorRoutingSettings>();
  const [credentialId, setCredentialId] = useState("");
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [providerError, setProviderError] = useState<string>();
  const [mode, setMode] = useState<"TEXT" | "PROJECT">(
    initialText.trim() || (!activeGroupId && initialSelections.length === 0)
      ? "TEXT"
      : "PROJECT"
  );
  const [text, setText] = useState(initialText);
  const [selections, setSelections] = useState<readonly SemanticOperationSelection[]>(
    initialSelections
  );
  const [scopeResolving, setScopeResolving] = useState(false);
  const [scopeError, setScopeError] = useState<string>();
  const [regionCode, setRegionCode] = useState("225");
  const [regionLabel, setRegionLabel] = useState("Россия");
  const [device, setDevice] = useState<WordstatExpansionDevice>("ALL");
  const [minusWords, setMinusWords] = useState("");
  const [includeRightColumn, setIncludeRightColumn] = useState(true);
  const [clearMinusPhrases, setClearMinusPhrases] = useState(false);
  const [clearPlus, setClearPlus] = useState(false);
  const [maxKeywords, setMaxKeywords] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const bindingCommand = useRef<IdempotentCreateCommand | undefined>(undefined);
  const sourceOptions = useMemo(
    () => settings && workspaceRouting
      ? wordstatExpansionSourceOptions(settings, workspaceRouting)
      : { requiresProjectBinding: false, sources: [] },
    [settings, workspaceRouting]
  );
  const sources = sourceOptions.sources;
  const selectedSource = sources.find(({ id }) => id === credentialId);
  const provider: "XMLSTOCK" | "ARSENKIN" =
    selectedSource?.provider === "ARSENKIN" ? "ARSENKIN" : "XMLSTOCK";
  const ownQueries = useMemo(() => uniqueLines(text, 500), [text]);
  const queries = mode === "TEXT" ? ownQueries : selections.map(({ label }) => label);
  const maximumResultCount = wordstatResultLimit(provider, maxKeywords);
  const maximumResultCountValid = maximumResultCount !== undefined;
  const projectScopeResolving = wordstatScopeIsResolving(mode, scopeResolving);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingProviders(true);
    setProviderError(undefined);
    const preparedSources = preparedProjectIntegrations(projectId, controller.signal);
    void Promise.all([
      preparedSources,
      preparedSources.then(() => browserApiRequest<WorkspaceConnectorRoutingSettings>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/integrations/routing`,
        { signal: controller.signal }
      ))
    ])
      .then(([result, workspaceResult]) => {
        if (controller.signal.aborted) return;
        const configured = wordstatExpansionSourceOptions(
          result,
          workspaceResult
        ).sources;
        setSettings(result);
        setWorkspaceRouting(workspaceResult);
        setCredentialId((current) =>
          configured.some(({ id }) => id === current)
            ? current
            : configured[0]?.id ?? ""
        );
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setProviderError(message(caught, "Не удалось загрузить подключения Wordstat."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProviders(false);
      });
    return () => controller.abort();
  }, [projectId, workspaceId]);

  async function submit(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (
      queries.length < 1 ||
      queries.length > 500 ||
      !maximumResultCountValid ||
      !selectedSource ||
      busy ||
      projectScopeResolving
    ) return;
    setBusy(true);
    setError(undefined);
    try {
      if (sourceOptions.requiresProjectBinding) {
        await ensureWordstatExpansionBinding(selectedSource.id);
      }
      await onSubmit({
        source: provider === "XMLSTOCK" ? "XMLSTOCK_WORDSTAT" : "ARSENKIN_WORDSTAT",
        queries,
        regionCode,
        device,
        minusWords: uniqueLines(minusWords, 100),
        clearMinusPhrases,
        includeRightColumn,
        clearPlus,
        maxKeywords: maximumResultCount
      });
    } catch (caught) {
      setError(message(caught, "Не удалось запустить парсинг Wordstat."));
      setBusy(false);
    }
  }

  async function ensureWordstatExpansionBinding(
    selectedCredentialId: string
  ): Promise<void> {
    if (!settings) return;
    const capability = "KEYWORD_RESEARCH" as const;
    const current = projectConnectorBinding(settings, capability);
    const draft = { credentialId: selectedCredentialId, enabled: true };
    const updated = current
      ? await browserApiRequest<ProjectConnectorBinding>(
          `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings/${encodeURIComponent(current.id)}`,
          {
            method: "PATCH",
            ifMatch: current.version,
            body: updateProjectConnectorBindingInput(draft)
          }
        )
      : await createWordstatExpansionBinding(capability, draft);
    setSettings(withProjectConnectorBinding(settings, updated));
    bindingCommand.current = undefined;
  }

  async function createWordstatExpansionBinding(
    capability: "KEYWORD_RESEARCH",
    draft: ProjectConnectorDraft
  ): Promise<ProjectConnectorBinding> {
    const signature = projectConnectorCreatePayloadSignature(
      capability,
      draft
    );
    const command = stableProjectConnectorCreateCommand(
      bindingCommand.current,
      signature,
      () => `wordstat-expansion-binding:${globalThis.crypto.randomUUID()}`
    );
    bindingCommand.current = command;
    return browserApiRequest<ProjectConnectorBinding>(
      `/app/api/projects/${encodeURIComponent(projectId)}/integration-settings`,
      {
        method: "POST",
        idempotencyKey: command.key,
        body: createProjectConnectorBindingInput(capability, draft)
      }
    );
  }

  return (
    <SemanticModal
      description={uiText("До 500 исходных фраз. Результат сначала появится в предпросмотре и не изменит ядро без подтверждения.")}
      footer={(
        <div className="semantic-workflow-footer">
          <dl className="semantic-dialog-estimate semantic-workflow-footer-estimate">
            <div><Icon name="semantic" /><div><dt><UiText text="Исходных запросов" /></dt><dd>{queries.length}</dd></div></div>
            <div><ProviderLogo provider={provider} /><div><dt><UiText text="Подключение" /></dt><dd>{selectedSource ? `${selectedSource.label} · ${integrationProviderLabel(selectedSource.provider)}` : loadingProviders ? <UiText text="Загружаем…" /> : <UiText text="Не выбрано" />}</dd></div></div>
            <div><Icon name="operations" /><div><dt><UiText text="Результат" /></dt><dd>{provider === "ARSENKIN" ? <UiText text="Все данные Arsenkin" /> : maximumResultCountValid ? <UiText text="до {0}" values={[String(formatInteger(maximumResultCount, uiLocale))]} /> : <UiText text="Укажите от 1 до 10 000" />}</dd></div></div>
          </dl>
          <div className="semantic-modal-actions">
            <button className="secondary-button" disabled={busy} onClick={onClose} type="button"><UiText text="Отмена" /></button>
            <button
              className="primary-button"
              disabled={busy || loadingProviders || !selectedSource || projectScopeResolving || queries.length < 1 || queries.length > 500 || !maximumResultCountValid}
              form={formId}
              type="submit"
            >
              {busy ? <UiText text="Запускаем…" /> : <UiText text="Запустить ({0})" values={[String(queries.length)]} />}
            </button>
          </div>
        </div>
      )}
      onClose={busy ? () => undefined : onClose}
      presenceKey="semantic-modal:wordstat-expansion"
      size="large"
      title={uiText("Парсинг Wordstat")}
    >
      <form
        className="keyword-research-wordstat-dialog semantic-workflow-dialog"
        id={formId}
        onSubmit={(event) => void submit(event)}
      >
        <div className="semantic-workflow-grid keyword-research-wordstat-workflow-grid">
          <section className="semantic-workflow-panel keyword-research-wordstat-source-panel">
            <header className="semantic-workflow-panel-heading">
              <h3><UiText text="Источник данных" /></h3>
              <a
                className="semantic-dialog-link"
                href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}
              >
                <UiText text="Управлять" /></a>
              <p><UiText text="Выберите подключённый сервис, через который будет выполнен сбор Wordstat." /></p>
            </header>
            {loadingProviders ? (
              <div className="semantic-dialog-loading" role="status"><UiText text="Загружаем подключения…" /></div>
            ) : sources.length ? (
              <div className="semantic-provider-list keyword-research-wordstat-provider-list" role="radiogroup" aria-label={uiText("Подключение Wordstat")}>
                {sources.map((source) => (
                  <button
                    aria-checked={source.id === credentialId}
                    className={`semantic-provider-card ${source.id === credentialId ? "selected" : ""}`}
                    key={source.id}
                    onClick={() => setCredentialId(source.id)}
                    role="radio"
                    type="button"
                  >
                    <ProviderLogo provider={source.provider} />
                    <span className="semantic-provider-card-copy">
                      <strong>{<UiText text={integrationProviderLabel(source.provider) ?? ""} />}</strong>
                      <small>{source.label} · Wordstat API</small>
                      <b><UiText text="Подключено" /></b>
                    </span>
                    <i aria-hidden="true" className="semantic-provider-radio" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="inline-alert warning"><UiText text="Нет доступного маршрута XMLStock или Arsenkin для парсинга Wordstat." /></div>
            )}
            <div className="inline-alert info compact keyword-research-wordstat-preview-note">
              <UiText text="Результат сначала попадёт в предпросмотр. Запросы появятся в ядре только после вашего подтверждения." /></div>
          </section>

          <section className="semantic-workflow-panel keyword-research-wordstat-settings-panel">
            <header>
              <h3><UiText text="Настройки парсинга" /></h3>
              <p><UiText text="Россия выбрана по умолчанию. Уточните устройство и правила очистки." /></p>
            </header>
            <label className="semantic-workflow-field">
              <span><UiText text="Регион Wordstat" /></span>
              <SearchableRegionSelect kind="WORDSTAT" onChange={({ code, label }) => { setRegionCode(code); setRegionLabel(label); }} value={regionCode} valueLabel={regionLabel} />
              {regionCode === "225" ? <small><UiText text="По умолчанию · вся Россия" /></small> : projectSearchCity && regionCode === projectSearchCity.yandexRegionCode ? <small><UiText text="Город проекта ·" after=" " />{projectSearchCity.name}</small> : null}
            </label>
            <fieldset className="semantic-segmented-field">
              <legend><UiText text="Устройство" /></legend>
              <div className="semantic-segmented-control keyword-research-wordstat-device-control" role="radiogroup" aria-label={uiText("Устройство Wordstat")}>
                {([
                  ["ALL", "Все"],
                  ["DESKTOP", "Десктоп"],
                  ["MOBILE", "Мобильные"],
                  ["PHONE_ONLY", "Телефоны"],
                  ["TABLET_ONLY", "Планшеты"]
                ] as const).map(([value, label]) => (
                  <label className={device === value ? "selected" : undefined} key={value}>
                    <input checked={device === value} onChange={() => setDevice(value)} type="radio" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {provider === "XMLSTOCK" && (
              <label className="semantic-workflow-field">
                <span><UiText text="Максимум результатов" /></span>
                <input aria-invalid={!maximumResultCountValid} max={10_000} min={1} onChange={(event) => setMaxKeywords(event.target.value)} type="number" value={maxKeywords} />
                <small><UiText text="От 1 до 10 000 фраз." /></small>
              </label>
            )}
            <div className="keyword-research-wordstat-option-list">
              <label className="semantic-check-row"><input checked={includeRightColumn} onChange={(event) => setIncludeRightColumn(event.target.checked)} type="checkbox" /><span><strong><UiText text="Добавить правую колонку" /></strong><small><UiText text="Связанные формулировки справа в Wordstat." /></small></span></label>
              <label className="semantic-check-row"><input checked={clearMinusPhrases} onChange={(event) => setClearMinusPhrases(event.target.checked)} type="checkbox" /><span><strong><UiText text="Учитывать минус-слова" /></strong><small><UiText text="Исключить фразы с указанными словами." /></small></span></label>
              <label className="semantic-check-row"><input checked={clearPlus} onChange={(event) => setClearPlus(event.target.checked)} type="checkbox" /><span><strong><UiText text="Убирать оператор «+»" /></strong></span></label>
            </div>
            <label className="semantic-workflow-field keyword-research-wordstat-minus-field">
              <span><UiText text="Минус-слова · по одному на строке" /></span>
              <textarea onChange={(event) => setMinusWords(event.target.value)} placeholder={uiText("бесплатно скачать")} rows={3} value={minusWords} />
            </label>
          </section>

          <section className="semantic-workflow-panel semantic-wordstat-scope-panel keyword-research-wordstat-seeds-panel">
            <header>
              <h3><UiText text="Исходные запросы" /></h3>
              <p><UiText text="Вставьте свои фразы или выберите запросы и папки проекта." /></p>
            </header>
            <fieldset className="semantic-segmented-field">
              <legend className="sr-only"><UiText text="Источник исходных запросов" /></legend>
              <div className="semantic-segmented-control keyword-research-wordstat-mode-control" role="radiogroup" aria-label={uiText("Источник исходных запросов")}>
                <label className={mode === "TEXT" ? "selected" : undefined}><input checked={mode === "TEXT"} onChange={() => { setMode("TEXT"); setScopeError(undefined); }} type="radio" /><span><UiText text="Вставить текст" /></span></label>
                <label className={mode === "PROJECT" ? "selected" : undefined}><input checked={mode === "PROJECT"} onChange={() => setMode("PROJECT")} type="radio" /><span><UiText text="Выбрать из проекта" /></span></label>
              </div>
            </fieldset>
            {mode === "TEXT" ? (
              <label className="semantic-workflow-field keyword-research-wordstat-query-field">
                <span><UiText text="По одному запросу на строке" /></span>
                <textarea autoFocus onChange={(event) => setText(event.target.value)} placeholder={uiText("ремонт холодильников купить морозильную камеру")} value={text} />
                <small>{ownQueries.length} <UiText text="из 500 уникальных фраз" before=" " /></small>
              </label>
            ) : (
              <SemanticOperationScope activeGroupId={activeGroupId} groups={groups} initialSelections={initialSelections} maxItems={500} onChange={(next, resolving, nextError) => { setSelections(next); setScopeResolving(resolving); setScopeError(nextError); }} projectId={projectId} />
            )}
          </section>
        </div>
        {(scopeError || providerError || error) && (
          <div className="semantic-workflow-feedback">
            {scopeError && <div className="inline-alert warning" role="alert">{<UiText text={scopeError ?? ""} />}</div>}
            {providerError && <div className="inline-alert warning" role="alert">{<UiText text={providerError ?? ""} />}</div>}
            {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
          </div>
        )}
      </form>
    </SemanticModal>
  );
}

function uniqueLines(value: string, max: number): readonly string[] {
  const output = new Map<string, string>();
  for (const raw of value.split(/\r?\n/gu)) {
    const normalized = raw.trim().replace(/\s+/gu, " ");
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("ru-RU");
    if (!output.has(key)) output.set(key, normalized);
    if (output.size >= max) break;
  }
  return [...output.values()];
}

function joinPath(parent: string | undefined, name: string): string | undefined {
  if (!name) return undefined;
  return parent ? `${parent} / ${name}` : name;
}

function mergeKeywordResearchRows(
  current: readonly KeywordResearchRow[],
  incoming: readonly KeywordResearchRow[]
): readonly KeywordResearchRow[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort(
    (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  );
}

function path(projectId: string): string {
  return `/app/api/v1/projects/${encodeURIComponent(projectId)}/keyword-research-runs`;
}

function runTitle(run: KeywordResearchRunSummary): string {
  if (run.source === "KEYS_SO") return run.domain ?? "Keys.so";
  return `${wordstatProviderLabel(run)} · ${run.seedCount ?? 0} исходных фраз`;
}

function runMeta(run: KeywordResearchRunSummary): string {
  return run.source === "KEYS_SO"
    ? `${databaseLabel(run.database ?? "msk")} · ${run.collectedKeywords} из ${run.totalAvailable ?? "?"}`
    : `${run.regionCode === "225" ? "Россия" : `регион ${run.regionCode ?? "225"}`} · найдено ${run.collectedKeywords} · ${run.includeRightColumn ? "левая + правая колонки" : "левая колонка"}`;
}

function wordstatProviderLabel(run: KeywordResearchRunSummary): string {
  return run.source === "XMLSTOCK_WORDSTAT" ? "XMLStock Wordstat" : "Arsenkin Wordstat";
}

function statusLabel(status: KeywordResearchRunSummary["status"]): string {
  return { QUEUED: "В очереди", RUNNING: "Собирается", RETRY_SCHEDULED: "Ожидает провайдера", READY_TO_IMPORT: "Готов к импорту", IMPORT_QUEUED: "Импорт в очереди", IMPORTING: "Импортируется", COMPLETED: "Готово", FAILED: "Ошибка", CANCELLED: "Отменено" }[status];
}

function databaseLabel(database: KeysSoDatabase): string {
  const known: Partial<Record<KeysSoDatabase, string>> = {
    msk: "Яндекс · Москва",
    gru: "Google · Москва",
    zen: "Дзен",
    spb: "Санкт-Петербург",
    gkv: "Казахстан",
    mns: "Минск",
    gny: "Google · Нью-Йорк"
  };
  return known[database] ?? `Регион ${database.toUpperCase()}`;
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function message(error: unknown, fallback: string): string {
  return error instanceof BrowserApiError ? error.message : fallback;
}
