"use client";

import { rankSearchSourceFromProviderMappingVersion } from "@seo-platform/contracts";
import type {
  CrawlOperationResultPage,
  CrawlOperationResultRow,
  FrequencyOperationResult,
  FrequencyOperationResultRow,
  KeywordResearchRunSummary,
  RankJobSummary,
  RankOperationResult,
  RankOperationResultRow,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  connectorRouteTrail,
  connectorRoutingScopeLabel
} from "../lib/connector-routing-presentation";
import {
  operationResultApiPath,
  type OperationResultKind
} from "../lib/operation-result-routes";
import { operationStatusLabel } from "../lib/operation-status-presentation";
import {
  rankJobFailureMessage,
  rankSearchSystemLabel
} from "../lib/rank-jobs";
import { ProviderLogo } from "./provider-logo";
import { CustomSelect } from "./custom-select";
import styles from "./operation-result-workspace.module.css";

type OperationResultData =
  | Readonly<{ kind: "frequency"; value: FrequencyOperationResult }>
  | Readonly<{ kind: "rank"; value: RankOperationResult }>
  | Readonly<{ kind: "crawl"; value: CrawlOperationResultPage }>
  | Readonly<{ kind: "research"; value: KeywordResearchRunSummary }>;

export function OperationResultWorkspace({
  embedded = false,
  kind,
  operationId,
  projectId
}: Readonly<{
  embedded?: boolean;
  kind: OperationResultKind;
  operationId: string;
  projectId: string;
}>) {
  const [data, setData] = useState<OperationResultData>();
  const [rankJobWithoutResult, setRankJobWithoutResult] = useState<RankJobSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(undefined);
    try {
      const result = await loadOperationResult(
        projectId,
        kind,
        operationId,
        signal
      );
      if (!signal?.aborted) {
        setData(result);
        setRankJobWithoutResult(undefined);
      }
    } catch (requestError) {
      if (!signal?.aborted) {
        const rankJob = await loadRankJobWithoutResult(
          projectId,
          kind,
          operationId,
          requestError,
          signal
        );
        if (!signal?.aborted && rankJob) {
          setRankJobWithoutResult(rankJob);
          setError(undefined);
        } else if (!signal?.aborted) {
          setRankJobWithoutResult(undefined);
          setError(operationResultError(requestError));
        }
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [kind, operationId, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshVersion]);

  useEffect(() => {
    if (
      (!data || !isActiveOperation(data)) &&
      (!rankJobWithoutResult || !isActiveStatus(rankJobWithoutResult.status))
    ) return;
    const timer = window.setTimeout(
      () => setRefreshVersion((value) => value + 1),
      2_000
    );
    return () => window.clearTimeout(timer);
  }, [data, rankJobWithoutResult]);

  async function loadMore(): Promise<void> {
    if (
      data?.kind !== "crawl" ||
      !data.value.page.hasNext ||
      !data.value.page.nextCursor ||
      loadingMore
    ) {
      return;
    }
    setLoadingMore(true);
    setError(undefined);
    try {
      const next = await browserApiRequest<CrawlOperationResultPage>(
        operationResultApiPath(
          projectId,
          "crawl",
          operationId,
          data.value.page.nextCursor
        )
      );
      setData((current) => {
        if (current?.kind !== "crawl") return current;
        return {
          kind: "crawl",
          value: {
            ...next,
            rows: mergeCrawlRows(current.value.rows, next.rows)
          }
        };
      });
    } catch (requestError) {
      setError(operationResultError(requestError));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !data) {
    return (
      <section className={workspaceClass(embedded)}>
        <div className={styles.state} role="status">
          <span className={styles.spinner} />
          <strong>Загружаем результат операции…</strong>
          <p>Получаем только данные этого запуска в текущем проекте.</p>
        </div>
      </section>
    );
  }

  if (!data) {
    if (rankJobWithoutResult) {
      const active = isActiveStatus(rankJobWithoutResult.status);
      return (
        <section className={workspaceClass(embedded)}>
          <div
            className={`${styles.state} ${active ? "" : styles.error}`}
            role={active ? "status" : "alert"}
          >
            {active && <span className={styles.spinner} />}
            <strong>{active ? "Результат ещё формируется" : "Результат не сформирован"}</strong>
            <p>
              {active
                ? `${operationStatusLabel(rankJobWithoutResult.status)} · ${rankJobWithoutResult.progress.current} из ${rankJobWithoutResult.progress.total}`
                : rankJobWithoutResult.failure
                  ? rankJobFailureMessage(rankJobWithoutResult.failure.code)
                  : `Операция завершена со статусом «${operationStatusLabel(rankJobWithoutResult.status)}».`}
            </p>
            {!active && (
              <button onClick={() => setRefreshVersion((value) => value + 1)} type="button">
                Повторить загрузку
              </button>
            )}
          </div>
        </section>
      );
    }
    return (
      <section className={workspaceClass(embedded)}>
        <div className={`${styles.state} ${styles.error}`} role="alert">
          <strong>Не удалось открыть результат</strong>
          <p>{error ?? "Результат операции временно недоступен."}</p>
          <button onClick={() => setRefreshVersion((value) => value + 1)} type="button">
            Повторить
          </button>
        </div>
      </section>
    );
  }

  const summary = operationSummary(data);

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
            <button
              disabled={refreshing}
              onClick={() => void load(undefined, true)}
              type="button"
            >
              {refreshing ? "Обновляем…" : "Обновить"}
            </button>
            <a href="/app/tasks">История операций</a>
          </div>
        </header>
      )}

      <div className={styles.summary}>
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

      {error && (
        <div className={styles.inlineError} role="alert">
          <span>{error}</span>
          <button onClick={() => void load(undefined, true)} type="button">Повторить</button>
        </div>
      )}

      <div className={styles.tablePanel}>
        <OperationTable data={data} />
        {data.kind === "crawl" && data.value.page.hasNext && (
          <div className={styles.loadMore}>
            <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
              {loadingMore ? "Загружаем…" : "Показать ещё страницы"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function OperationTable({ data }: Readonly<{ data: OperationResultData }>) {
  if (data.kind === "frequency") return <FrequencyTable result={data.value} />;
  if (data.kind === "rank") return <RankTable result={data.value} />;
  if (data.kind === "crawl") return <CrawlTable result={data.value} />;
  return <ResearchTable result={data.value} />;
}

function FrequencyTable({ result }: Readonly<{ result: FrequencyOperationResult }>) {
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.collection.status)} />;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption>Частотность запросов этого запуска</caption>
        <thead><tr><th>#</th><th>Запрос</th><th>Статус</th><th>Я База</th><th>Я &quot;&quot;</th><th>Я &quot;!&quot;</th><th>Источник</th><th>Обновлено</th></tr></thead>
        <tbody>{result.rows.map((row) => (
          <tr key={row.keywordId}>
            <td>{row.sequence + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keyword}</strong><small>{shortId(row.keywordId)}</small></td>
            <td><ItemStatus status={row.status} {...(row.errorCode ? { errorCode: row.errorCode } : {})} /></td>
            <FrequencyCell row={row} type="BASE" />
            <FrequencyCell row={row} type="EXACT" />
            <FrequencyCell row={row} type="FIXED" />
            <td>{frequencyProvider(row)}</td>
            <td>{frequencyObservedAt(row)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FrequencyCell({ row, type }: Readonly<{ row: FrequencyOperationResultRow; type: SemanticFrequencyType }>) {
  const snapshot = row.snapshots.find((item) => item.type === type);
  return <td className={styles.numberCell}>{snapshot?.value === undefined ? "—" : formatDecimal(snapshot.value)}</td>;
}

function RankTable({ result }: Readonly<{ result: RankOperationResult }>) {
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.job.status)} />;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption>Позиции запросов этого запуска</caption>
        <thead><tr><th>#</th><th>Запрос</th><th>Результат</th><th>Позиция</th><th>Релевантный URL</th><th>Заголовок</th><th>Качество</th><th>Проверено</th></tr></thead>
        <tbody>{result.rows.map((row) => (
          <tr key={`${row.sequence}:${row.keywordId}`}>
            <td>{row.sequence + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keyword}</strong><small>{shortId(row.keywordId)}</small></td>
            <td><RankState state={row.state} /></td>
            <td className={styles.numberCell}>{rankPosition(row)}</td>
            <td className={styles.urlCell}><ExternalUrl value={row.rankingUrl} /></td>
            <td className={styles.longCell} title={row.title ?? row.snippet}>{row.title ?? row.snippet ?? "—"}</td>
            <td>{row.dataQualityFlags.length === 0 ? "Без замечаний" : row.dataQualityFlags.join(" · ")}</td>
            <td>{formatDateTime(row.observedAt)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CrawlTable({ result }: Readonly<{ result: CrawlOperationResultPage }>) {
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
          <span className={styles.visuallyHidden}>Поиск URL</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти URL"
            type="search"
            value={query}
          />
        </label>
        <CustomSelect
          aria-label="Фильтр HTTP-ответов"
          onChange={(event) => setStatusFilter(event.target.value as CrawlStatusFilter)}
          value={statusFilter}
        >
          <option value="ALL">Все ответы</option>
          <option value="2XX">Успешные · 2xx</option>
          <option value="3XX">Ответы · 3xx</option>
          <option value="4XX">Ошибки клиента · 4xx</option>
          <option value="5XX">Ошибки сервера · 5xx</option>
          <option value="REDIRECTS">Только редиректы</option>
          <option value="ISSUES">Только с проблемами</option>
        </CustomSelect>
        <CustomSelect
          aria-label="Сортировка результатов"
          onChange={(event) => setSort(event.target.value as CrawlSort)}
          value={sort}
        >
          <option value="SEQUENCE_ASC">В порядке обхода</option>
          <option value="STATUS_ASC">HTTP-код · по возрастанию</option>
          <option value="STATUS_DESC">HTTP-код · по убыванию</option>
          <option value="TIME_DESC">Самые медленные</option>
          <option value="TIME_ASC">Самые быстрые</option>
          <option value="URL_ASC">URL · А—Я</option>
        </CustomSelect>
        <span>{formatInteger(rows.length)} из {formatInteger(result.rows.length)}</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.filteredEmpty}>
          <strong>По выбранным условиям страниц нет</strong>
          <button onClick={() => { setQuery(""); setStatusFilter("ALL"); }} type="button">Сбросить фильтры</button>
        </div>
      ) : httpStatusCheck ? (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.httpTable}`}>
            <caption>HTTP-ответы этого запуска</caption>
            <thead><tr><th>#</th><th>URL</th><th>HTTP</th><th className={styles.centerCell}>Цепочка редиректов</th><th className={styles.centerCell}>Время</th><th className={styles.centerCell}>Размер</th><th className={styles.centerCell}>Тип ответа</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sequence}:${row.requestedUrl}`}>
                <td>{row.sequence + 1}</td>
                <td className={`${styles.primaryCell} ${styles.urlCell}`}><ExternalUrl value={row.finalUrl} />{row.requestedUrl !== row.finalUrl && <small>Запрошено: {row.requestedUrl}</small>}</td>
                <td><HttpStatus status={row.statusCode} /></td>
                <td className={styles.centerCell}><RedirectChain row={row} /></td>
                <td className={`${styles.numberCell} ${styles.centerCell}`}>{formatInteger(row.responseTimeMs)} мс</td>
                <td className={`${styles.numberCell} ${styles.centerCell}`}>{formatBytes(row.sizeBytes)}</td>
                <td className={styles.centerCell}>{row.contentType || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={`${styles.table} ${styles.wideTable}`}>
            <caption>Страницы технического аудита</caption>
            <thead><tr><th>#</th><th>URL</th><th>HTTP</th><th>Индексируемость</th><th>Title / H1</th><th>Проблемы</th><th>Время</th><th>Размер</th><th>Слова</th><th>Ссылки</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sequence}:${row.requestedUrl}`}>
                <td>{row.sequence + 1}</td>
                <td className={`${styles.primaryCell} ${styles.urlCell}`}><ExternalUrl value={row.finalUrl} />{row.requestedUrl !== row.finalUrl && <small>Запрошено: {row.requestedUrl}</small>}</td>
                <td><HttpStatus status={row.statusCode} /></td>
                <td>{indexabilityLabel(row.indexability)}</td>
                <td className={styles.longCell}><strong>{row.title ?? "Без title"}</strong><small>{row.h1 ?? "Без H1"}</small></td>
                <td><IssueSummary row={row} /></td>
                <td className={styles.numberCell}>{formatInteger(row.responseTimeMs)} мс</td>
                <td className={styles.numberCell}>{formatBytes(row.sizeBytes)}</td>
                <td className={styles.numberCell}>{formatInteger(row.wordCount)}</td>
                <td className={styles.numberCell}>{formatInteger(row.internalLinkCount)} / {formatInteger(row.externalLinkCount)}</td>
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
  if (row.redirectChain.length === 0) return <span className={styles.noIssues}>Нет</span>;
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
  if (result.rows.length === 0) return <EmptyRows active={isActiveStatus(result.status)} />;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption>Ключевые слова, найденные в Keys.so</caption>
        <thead><tr><th>#</th><th>Запрос</th><th>URL</th><th>База</th><th>&quot;&quot;</th><th>&quot;!&quot;</th><th>Позиция</th><th>KEI</th><th>Импорт</th></tr></thead>
        <tbody>{result.rows.map((row, index) => (
          <tr key={row.id}>
            <td>{index + 1}</td>
            <td className={styles.primaryCell}><strong>{row.keyword}</strong><small>{shortId(row.id)}</small></td>
            <td className={styles.urlCell}><ExternalUrl value={row.url} /></td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyBase)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyExact)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.frequencyFixed)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.position)}</td>
            <td className={styles.numberCell}>{formatOptionalNumber(row.kei)}</td>
            <td>{row.selected ? "Выбрано" : "Не выбрано"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function EmptyRows({ active }: Readonly<{ active: boolean }>) {
  return (
    <div className={styles.emptyRows}>
      <strong>{active ? "Результаты ещё формируются" : "В этой операции нет строк результата"}</strong>
      <p>{active ? "Таблица обновится автоматически по мере обработки." : "Проверьте статус и входные параметры операции в истории."}</p>
    </div>
  );
}

function ItemStatus({ status, errorCode }: Readonly<{ status: string; errorCode?: string }>) {
  return <span className={styles.itemStatus} title={errorCode}>{itemStatusLabel(status)}{errorCode ? ` · ${errorCode}` : ""}</span>;
}

function RankState({ state }: Readonly<{ state: RankOperationResultRow["state"] }>) {
  return <span className={`${styles.itemStatus} ${state === "FOUND" ? styles.found : state === "NOT_FOUND" ? styles.notFound : ""}`}>{state === "FOUND" ? "Найден" : state === "NOT_FOUND" ? "Не найден" : "Ожидает"}</span>;
}

function HttpStatus({ status }: Readonly<{ status: number }>) {
  const tone = status >= 500 ? styles.httpError : status >= 400 ? styles.httpWarning : status >= 300 ? styles.httpRedirect : styles.httpSuccess;
  return <span className={`${styles.httpStatus} ${tone}`}>{status}</span>;
}

function IssueSummary({ row }: Readonly<{ row: CrawlOperationResultRow }>) {
  if (row.issues.length === 0) return <span className={styles.noIssues}>Нет</span>;
  return <span className={styles.issueSummary} title={row.issues.map(({ title }) => title).join("\n")}>{row.issues.length} · {row.issues.slice(0, 2).map(({ title }) => title).join(", ")}</span>;
}

function ExternalUrl({ value }: Readonly<{ value: string | undefined }>) {
  if (!value) return <>—</>;
  const href = safeExternalUrl(value);
  return href ? <a href={href} rel="noreferrer" target="_blank">{value}</a> : <span title="Некорректный внешний URL">{value}</span>;
}

interface SummaryView {
  readonly title: string;
  readonly description: string;
  readonly provider?: "XMLSTOCK" | "ARSENKIN" | "KEYS_SO";
  readonly status: string;
  readonly tone: "Active" | "Success" | "Warning" | "Error" | "Neutral";
  readonly progress: string;
  readonly progressPercent: number;
  readonly facts: readonly Readonly<{ label: string; value: string }>[];
}

function operationSummary(data: OperationResultData): SummaryView {
  if (data.kind === "frequency") {
    const value = data.value.collection;
    const current = value.completedKeywords + value.failedKeywords;
    const routeTrail = connectorRouteTrail(value.connectorAttempts);
    return {
      title: "Сбор частотности",
      description: `${providerLabel(value.provider)} · ${value.types.map(frequencyTypeLabel).join(" + ")}`,
      provider: value.provider,
      ...summaryStatus(
        value.status,
        current,
        value.selectedKeywords,
        value.stage
      ),
      facts: [
        { label: "Обработано", value: formatInteger(current) },
        { label: "Ошибок", value: formatInteger(value.failedKeywords) },
        { label: "Регион", value: value.regionCode },
        { label: "Устройство", value: deviceLabel(value.device) },
        ...(value.routingScope
          ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.routingScope) }]
          : []),
        ...(routeTrail
          ? [{ label: "Провайдеры", value: routeTrail }]
          : []),
        ...(value.failureCode
          ? [{ label: "Код ошибки", value: value.failureCode }]
          : [])
      ]
    };
  }
  if (data.kind === "rank") {
    const value = data.value;
    const current = Number(value.job.progress.current);
    const total = Number(value.job.progress.total);
    const found = Number(value.job.result?.foundCount ?? value.rows.filter(({ state }) => state === "FOUND").length);
    const notFound = Number(value.job.result?.notFoundCount ?? value.rows.filter(({ state }) => state === "NOT_FOUND").length);
    const failed = Number(value.job.result?.failedCount ?? 0);
    const routeTrail = connectorRouteTrail(value.job.connectorAttempts);
    const searchSource = rankSearchSourceFromProviderMappingVersion(
      value.execution.searchEngine,
      value.execution.providerMappingVersion
    );
    const searchSystem = rankSearchSystemLabel(
      value.execution.searchEngine,
      searchSource
    );
    return {
      title: "Проверка позиций",
      description: `${value.contextName} · ${searchSystem} · ${deviceLabel(value.execution.device)}`,
      provider: value.job.provider,
      ...summaryStatus(value.job.status, current, total),
      facts: [
        { label: "Провайдер", value: providerLabel(value.job.provider) },
        { label: "Поисковая система", value: searchSystem },
        { label: "Найдено", value: formatInteger(found) },
        { label: "Не найдено", value: formatInteger(notFound) },
        { label: "Ошибок", value: formatInteger(failed) },
        { label: "Регион", value: value.execution.regionCode ?? value.execution.countryCode },
        { label: "Глубина", value: `Топ-${value.execution.depth}` },
        ...(value.job.routingScope
          ? [{ label: "Маршрут", value: connectorRoutingScopeLabel(value.job.routingScope) }]
          : []),
        ...(routeTrail
          ? [{ label: "Провайдеры", value: routeTrail }]
          : []),
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
      description: `${value.config.startUrls.length} стартовых URL · до ${formatInteger(value.config.maxUrls)} страниц`,
      ...summaryStatus(value.status, value.processedUrls, total),
      facts: [
        { label: "Обработано", value: formatInteger(value.processedUrls) },
        { label: "Ошибок", value: formatInteger(value.failedUrls) },
        ...(value.config.purpose === "HTTP_STATUS_CHECK"
          ? []
          : [{ label: "SEO-проблем", value: formatInteger(value.issueCount) }]),
        { label: "Успешно", value: formatInteger(value.successfulUrls) },
        ...(value.failureCode
          ? [{ label: "Код ошибки", value: value.failureCode }]
          : [])
      ]
    };
  }
  const value = data.value;
  const current = value.importedKeywords > 0 ? value.importedKeywords : value.collectedKeywords;
  const total = value.totalAvailable ?? value.maxKeywords;
  return {
    title: "Сбор конкурентов",
    description: `Keys.so · ${value.domain} · ${value.database.toUpperCase()}`,
    provider: "KEYS_SO",
    ...summaryStatus(value.status, current, total),
    facts: [
      { label: "Найдено", value: formatInteger(value.collectedKeywords) },
      { label: "Выбрано", value: formatInteger(value.selectedKeywords) },
      { label: "Импортировано", value: formatInteger(value.importedKeywords) },
      { label: "Доступно", value: value.totalAvailable === undefined ? "—" : formatInteger(value.totalAvailable) },
      ...(value.failureCode
        ? [{ label: "Код ошибки", value: value.failureCode }]
        : [])
    ]
  };
}

function summaryStatus(status: string, current: number, total: number, stage?: string): Pick<SummaryView, "status" | "tone" | "progress" | "progressPercent"> {
  return {
    status: operationStatusLabel(status, stage),
    tone: statusTone(status),
    progress: total > 0 ? `${formatInteger(current)} из ${formatInteger(total)}` : "Ожидает данных",
    progressPercent: total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0
  };
}

async function loadOperationResult(projectId: string, kind: OperationResultKind, operationId: string, signal?: AbortSignal): Promise<OperationResultData> {
  const path = operationResultApiPath(projectId, kind, operationId);
  if (kind === "frequency") return { kind, value: await browserApiRequest<FrequencyOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "rank") return { kind, value: await browserApiRequest<RankOperationResult>(path, signal ? { signal } : {}) };
  if (kind === "crawl") return { kind, value: await browserApiRequest<CrawlOperationResultPage>(path, signal ? { signal } : {}) };
  return { kind, value: await browserApiRequest<KeywordResearchRunSummary>(path, signal ? { signal } : {}) };
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
  if (data.kind === "rank") return isActiveStatus(data.value.job.status);
  if (data.kind === "crawl") return isActiveStatus(data.value.crawl.status);
  return isActiveStatus(data.value.status);
}

function isActiveStatus(status: string): boolean {
  return ["PREPARING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "FAILED_RETRYABLE", "CANCEL_REQUESTED", "IMPORT_QUEUED", "IMPORTING"].includes(status);
}

function mergeCrawlRows(current: readonly CrawlOperationResultRow[], next: readonly CrawlOperationResultRow[]): readonly CrawlOperationResultRow[] {
  const seen = new Set(current.map(({ sequence }) => sequence));
  return [...current, ...next.filter(({ sequence }) => !seen.has(sequence))];
}

function frequencyProvider(row: FrequencyOperationResultRow): string { return row.snapshots[0]?.provider ?? "—"; }
function frequencyObservedAt(row: FrequencyOperationResultRow): string { return formatDateTime(row.snapshots[0]?.observedAt); }
function rankPosition(row: RankOperationResultRow): string { return row.state === "FOUND" ? formatOptionalNumber(row.position ?? row.absolutePosition) : row.state === "NOT_FOUND" ? "Не найден" : "—"; }
function formatOptionalNumber(value: number | undefined): string { return value === undefined ? "—" : formatInteger(value); }
function formatDecimal(value: string): string { const number = Number(value); return Number.isSafeInteger(number) ? formatInteger(number) : value; }
function formatInteger(value: number): string { return new Intl.NumberFormat("ru-RU").format(value); }
function formatBytes(value: number): string { if (value < 1024) return `${value} Б`; if (value < 1_048_576) return `${(value / 1024).toFixed(1)} КБ`; return `${(value / 1_048_576).toFixed(1)} МБ`; }
function formatDateTime(value: string | undefined): string { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date); }
function shortId(value: string): string { return value.slice(0, 8); }
function safeExternalUrl(value: string): string | undefined { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }
function providerLabel(provider: "XMLSTOCK" | "ARSENKIN"): string { return provider === "XMLSTOCK" ? "XMLStock" : "Arsenkin Tools"; }
function frequencyTypeLabel(type: string): string { return ({ BASE: "База", EXACT: '""', FIXED: '"!"' } as Readonly<Record<string, string>>)[type] ?? type; }
function deviceLabel(device: string): string { return ({ ALL: "Все устройства", DESKTOP: "Десктоп", MOBILE: "Мобильные", PHONE_ONLY: "Телефоны", TABLET_ONLY: "Планшеты" } as Readonly<Record<string, string>>)[device] ?? device; }
function indexabilityLabel(value: string): string { return ({ INDEXABLE: "Индексируется", NOINDEX: "Noindex", CANONICALIZED: "Canonical на другой URL", REDIRECTED: "Редирект", ERROR: "Ошибка", UNKNOWN: "Не определено" } as Readonly<Record<string, string>>)[value] ?? value; }
function itemStatusLabel(value: string): string { return ({ PENDING: "Ожидает", QUEUED: "В очереди", RUNNING: "Выполняется", COMPLETED: "Готово", FAILED_RETRYABLE: "Повтор", FAILED_FINAL: "Ошибка", CANCELLED: "Отменено" } as Readonly<Record<string, string>>)[value] ?? value; }
function statusTone(value: string): SummaryView["tone"] { if (["COMPLETED"].includes(value)) return "Success"; if (["FAILED", "FAILED_FINAL"].includes(value)) return "Error"; if (["ACTION_REQUIRED", "PARTIALLY_COMPLETED", "READY_TO_IMPORT"].includes(value)) return "Warning"; if (isActiveStatus(value)) return "Active"; return "Neutral"; }
function operationResultError(error: unknown): string { if (!(error instanceof BrowserApiError)) return "Не удалось получить результат операции."; if (error.status === 403) return "У вас нет доступа к результату этой операции."; if (error.status === 404) return "Операция не найдена в текущем проекте."; return error.message; }
function workspaceClass(embedded: boolean): string {
  const workspace = styles.workspace ?? "";
  return embedded ? `${workspace} ${styles.embedded ?? ""}` : workspace;
}
