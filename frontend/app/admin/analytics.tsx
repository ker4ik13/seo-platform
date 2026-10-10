"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  parseProductAnalyticsReport,
  type AnalyticsOperationRow,
  type AnalyticsSection,
  type ProductAnalyticsReport,
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { CustomSelect } from "../../components/custom-select";

const sections: Record<AnalyticsSection, string> = {
  DASHBOARD: "Обзор",
  SEMANTICS: "Семантика",
  RANKINGS: "Позиции",
  SERP: "Выдача и конкуренты",
  WORDSTAT: "Wordstat и частотность",
  AI: "ИИ-ответы",
  CLUSTERING: "Кластеризация",
  CRAWL: "Обход сайта",
  IMPORT: "Импорт",
  EXPORT: "Экспорт",
  SETTINGS: "Настройки",
  BILLING: "Оплата",
  TEAM: "Команда",
  OTHER: "Другие разделы",
};
const operationNames: Record<string, string> = {
  FREQUENCY_COLLECTION: "Частотность",
  SEASONALITY_COLLECTION: "Сезонность",
  MANUAL_RANK_CHECK: "Позиции",
  AI_ANSWER_COLLECTION: "ИИ-ответы",
  CLUSTERING_RUN: "Кластеризация",
  TECHNICAL_CRAWL: "Обход сайта",
  KEYWORD_RESEARCH: "Wordstat и исследования",
  SEMANTIC_EXPORT: "Экспорт",
  SEMANTIC_IMPORT: "Импорт",
  MANUAL: "Ручной запуск",
  AUTOMATION: "По расписанию",
  SYSTEM: "Системные",
  ARSENKIN: "Арсенкин",
  XMLSTOCK: "XMLStock",
  LOCAL: "Локально",
};
const tabs = [
  "audience",
  "features",
  "retention",
  "operations",
  "finance",
  "quality",
] as const;
type Tab = (typeof tabs)[number];
const tabNames: Record<Tab, string> = {
  audience: "Аудитория",
  features: "Функции и время",
  retention: "Активация и удержание",
  operations: "Операции",
  finance: "Финансы",
  quality: "Качество",
};
const number = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
const money = (minor: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(minor / 100);
const duration = (milliseconds: number | null) =>
  milliseconds === null
    ? "—"
    : milliseconds >= 3_600_000
      ? `${number(milliseconds / 3_600_000)} ч`
      : milliseconds >= 60_000
        ? `${number(milliseconds / 60_000)} мин`
        : `${number(milliseconds / 1000)} с`;
const percent = (numerator: number, denominator: number) =>
  denominator ? `${number((numerator / denominator) * 100)}%` : "—";

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  values: readonly (number | null)[];
}
function AnalyticsChart({
  title,
  dates,
  series,
  format = number,
}: Readonly<{
  title: string;
  dates: readonly string[];
  series: readonly ChartSeries[];
  format?: (value: number) => string;
}>) {
  const [hidden, setHidden] = useState<readonly string[]>([]),
    [table, setTable] = useState(false);
  const shown = series.filter((row) => !hidden.includes(row.key)),
    values = shown.flatMap((row) =>
      row.values.filter((value): value is number => value !== null),
    );
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    range = max - min;
  const x = (index: number) =>
      48 + (dates.length < 2 ? 0 : index / (dates.length - 1)) * 650,
    y = (value: number) => 194 - ((value - min) / range) * 164;
  return (
    <section className="panel analytics-chart">
      <header>
        <h2>{title}</h2>
        <button
          className="ghost"
          type="button"
          onClick={() => setTable(!table)}
          aria-pressed={table}
        >
          {table ? "График" : "Таблица"}
        </button>
      </header>
      <div className="analytics-legend">
        {series.map((row) => (
          <button
            key={row.key}
            type="button"
            aria-pressed={!hidden.includes(row.key)}
            onClick={() =>
              setHidden((current) =>
                current.includes(row.key)
                  ? current.filter((key) => key !== row.key)
                  : [...current, row.key],
              )
            }
          >
            <i style={{ background: row.color }} />
            {row.label}
          </button>
        ))}
      </div>
      {values.length === 0 ? (
        <Empty>Данные появятся после начала измерения.</Empty>
      ) : table ? (
        <div className="analytics-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Дата, UTC</th>
                {shown.map((row) => (
                  <th key={row.key}>{row.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, index) => (
                <tr key={date}>
                  <td>{date}</td>
                  {shown.map((row) => (
                    <td key={row.key}>
                      {row.values[index] == null
                        ? "—"
                        : format(row.values[index]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox="0 0 720 235" role="img" aria-label={title}>
          {[0, 0.5, 1].map((fraction) => {
            const value = min + range * fraction;
            return (
              <g key={fraction}>
                <line
                  x1="48"
                  x2="698"
                  y1={y(value)}
                  y2={y(value)}
                  className="analytics-grid-line"
                />
                <text x="42" y={y(value) + 4} textAnchor="end">
                  {format(value)}
                </text>
              </g>
            );
          })}
          {shown.map((row) => (
            <g key={row.key}>
              <path
                d={row.values.reduce(
                  (path, value, index) =>
                    value === null
                      ? path
                      : `${path} ${index === 0 || row.values[index - 1] === null ? "M" : "L"}${x(index)},${y(value)}`,
                  "",
                )}
                fill="none"
                stroke={row.color}
                strokeWidth="2.5"
              />
              {row.values.map((value, index) =>
                value === null ? null : (
                  <circle
                    key={index}
                    cx={x(index)}
                    cy={y(value)}
                    r="3"
                    fill={row.color}
                  >
                    <title>
                      {dates[index]} · {row.label}: {format(value)}
                    </title>
                  </circle>
                ),
              )}
            </g>
          ))}
          <text x="48" y="220">
            {dates[0]}
          </text>
          <text x="698" y="220" textAnchor="end">
            {dates.at(-1)}
          </text>
        </svg>
      )}
    </section>
  );
}
function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="analytics-empty">{children}</p>;
}
function Metric({
  label,
  value,
  hint,
  previous,
  current,
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
  previous?: number | undefined;
  current?: number;
}>) {
  const delta =
    previous === undefined || current === undefined
      ? undefined
      : previous === 0
        ? current > 0
          ? "Новая активность"
          : "Без изменений"
        : `${current >= previous ? "+" : ""}${number(((current - previous) / previous) * 100)}% к предыдущему периоду`;
  return (
    <div className="panel analytics-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
      {delta && (
        <small className={current! >= previous! ? "positive" : "negative"}>
          {delta}
        </small>
      )}
    </div>
  );
}
function Distribution({
  title,
  rows,
}: Readonly<{
  title: string;
  rows: readonly { label: string; value: number; hint?: string }[];
}>) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <Empty>Нет данных за выбранный период.</Empty>
      ) : (
        <div className="analytics-distribution">
          {rows.map((row) => (
            <div key={row.label}>
              <header>
                <span>{row.label}</span>
                <strong>{number(row.value)}</strong>
              </header>
              <div>
                <i style={{ width: `${(row.value / maximum) * 100}%` }} />
              </div>
              {row.hint && <small>{row.hint}</small>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
function OperationsTable({
  rows,
}: Readonly<{ rows: readonly AnalyticsOperationRow[] }>) {
  return rows.length === 0 ? (
    <Empty>Операций за выбранный период нет.</Empty>
  ) : (
    <div className="analytics-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Тип / источник</th>
            <th>Всего</th>
            <th>Готово</th>
            <th>Частично</th>
            <th>Ошибки</th>
            <th>Отмены</th>
            <th>Обработано в завершённых</th>
            <th>p50 / p95 выполнения</th>
            <th>Ожидание запуска</th>
            <th>Первый результат</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{operationNames[row.key] ?? row.key}</th>
              {[
                row.total,
                row.completed,
                row.partial,
                row.failed,
                row.cancelled,
                row.processed,
              ].map((value, index) => (
                <td key={index}>{number(value)}</td>
              ))}
              <td>
                {duration(row.durationP50Ms)} / {duration(row.durationP95Ms)}
              </td>
              <td>{duration(row.queueAverageMs)}</td>
              <td>{duration(row.firstResultAverageMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Analytics({ canFinance }: Readonly<{ canFinance: boolean }>) {
  const params = useSearchParams(),
    initialDays = Number(params.get("analyticsDays") ?? 30);
  const [days, setDays] = useState<7 | 30 | 90>(
      [7, 30, 90].includes(initialDays) ? (initialDays as 7 | 30 | 90) : 30,
    ),
    [internal, setInternal] = useState(
      params.get("analyticsInternal") === "true",
    );
  const [tab, setTab] = useState<Tab>(
    tabs.includes(params.get("analyticsTab") as Tab)
      ? (params.get("analyticsTab") as Tab)
      : "audience",
  );
  const [data, setData] = useState<ProductAnalyticsReport>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("analyticsDays", String(days));
    url.searchParams.set("analyticsInternal", String(internal));
    url.searchParams.set("analyticsTab", tab);
    window.history.replaceState(window.history.state, "", url);
  }, [days, internal, tab]);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    setLoading(true);
    setError(undefined);
    const load = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      const result = await adminApi<unknown>(
        `/api/analytics?days=${days}&includeInternal=${internal}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        if (result.ok) {
          try {
            const report = parseProductAnalyticsReport(result.data);
            if (
              report.period.days !== days ||
              report.period.includeInternal !== internal
            )
              throw new TypeError("Filter mismatch");
            setData(report);
            setError(undefined);
          } catch {
            setError("Получен некорректный отчёт аналитики.");
          }
        } else setError(result.message);
        setLoading(false);
      }
      running = false;
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [days, internal]);
  const validData =
    data?.period.days === days && data.period.includeInternal === internal
      ? data
      : undefined;
  const exportCsv = () => {
    if (!validData) return;
    const rows = [
      [
        "date_utc",
        "users",
        "workspaces",
        "projects",
        "active_seconds",
        "page_views",
        "actions",
        "result_views",
        "sessions",
        "client_errors",
      ],
      ...validData.daily.map((row) => [
        row.date,
        row.users,
        row.workspaces,
        row.projects,
        row.seconds,
        row.views,
        row.actions,
        row.results,
        row.sessions,
        row.errors,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + rows.map((row) => row.join(";")).join("\r\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `analytics-${days}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const visibleTabs = tabs.filter((value) => value !== "finance" || canFinance),
    activeTab = visibleTabs.includes(tab) ? tab : "audience";
  return (
    <div className="content analytics-page">
      <section className="panel analytics-controls">
        <div>
          <label>
            Период
            <CustomSelect
              aria-label="Период аналитики"
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value) as 7 | 30 | 90)
              }
            >
              {[7, 30, 90].map((value) => (
                <option key={value} value={value}>
                  {value} дней
                </option>
              ))}
            </CustomSelect>
          </label>
          <label className="analytics-internal">
            <input
              type="checkbox"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
            />{" "}
            Включить сотрудников и тестовые аккаунты
          </label>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!validData}
          onClick={exportCsv}
        >
          Скачать CSV
        </button>
      </section>
      <nav className="analytics-tabs" aria-label="Разделы аналитики">
        {visibleTabs.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={activeTab === value}
            onClick={() => setTab(value)}
          >
            {tabNames[value]}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && !validData ? (
        <section className="panel" role="status">
          <p>Загружаем аналитику…</p>
        </section>
      ) : !validData ? (
        <section className="panel">
          <Empty>
            Отчёт недоступен. Повторная попытка выполняется автоматически.
          </Empty>
        </section>
      ) : (
        <>
          <p className="analytics-description">
            Даты и дни — UTC. Отчёт рассчитан{" "}
            {new Date(validData.generatedAt).toLocaleString("ru-RU", {
              timeZone: "UTC",
            })}{" "}
            UTC; расчёт кешируется на 5 минут.{" "}
            {validData.since
              ? `Активность измеряется с ${validData.since.slice(0, 10)}.`
              : "История активности начнёт появляться после использования приложения."}
          </p>
          {validData.degraded.length > 0 && (
            <p className="notice">
              Часть источников временно недоступна:{" "}
              {validData.degraded
                .map((value) =>
                  value === "OPERATIONS" ? "операции" : "финансы",
                )
                .join(", ")}
              . Остальные показатели доступны.
            </p>
          )}
          {activeTab === "audience" && <Audience data={validData} />}
          {activeTab === "features" && (
            <>
              <div className="analytics-kpis">
                <Metric
                  label="Активное время"
                  value={duration(validData.audience.current.seconds * 1000)}
                />
                <Metric
                  label="На пользователя"
                  value={duration(
                    validData.audience.current.users
                      ? (validData.audience.current.seconds /
                          validData.audience.current.users) *
                          1000
                      : null,
                  )}
                />
                <Metric
                  label="Посещения"
                  value={number(validData.audience.current.sessions)}
                  hint="Новый период использования после 30 минут простоя"
                />
                <Metric
                  label="Осмысленные действия"
                  value={number(validData.audience.current.actions)}
                />
              </div>
              <Distribution
                title="Активное время по разделам, минуты"
                rows={validData.features
                  .filter((row) => row.seconds > 0)
                  .map((row) => ({
                    label: sections[row.section],
                    value: row.seconds / 60,
                    hint: `${number(row.users)} пользователей · ${percent(row.users, validData.audience.current.users)} аудитории`,
                  }))}
              />
              <section className="panel">
                <h2>Использование функций</h2>
                <div className="analytics-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Раздел</th>
                        <th>Пользователи</th>
                        <th>Области</th>
                        <th>Проекты</th>
                        <th>Просмотры</th>
                        <th>Действия</th>
                        <th>Результаты</th>
                        <th>Время</th>
                        <th>API p95</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validData.features
                        .filter(
                          (row) =>
                            row.seconds > 0 ||
                            row.views > 0 ||
                            row.actions > 0 ||
                            row.results > 0,
                        )
                        .map((row) => (
                          <tr key={row.section}>
                            <th scope="row">{sections[row.section]}</th>
                            {[
                              row.users,
                              row.workspaces,
                              row.projects,
                              row.views,
                              row.actions,
                              row.results,
                            ].map((value, index) => (
                              <td key={index}>{number(value)}</td>
                            ))}
                            <td>{duration(row.seconds * 1000)}</td>
                            <td>{duration(row.latencyP95Ms)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="analytics-description">
                  Общее время пользователя объединяет пересечения вкладок и
                  устройств. Время отдельных разделов — атрибуция по срезам;
                  параллельная работа в разных проектах может пересекаться.
                </p>
              </section>
            </>
          )}
          {activeTab === "retention" && <Retention data={validData} />}
          {activeTab === "operations" && <Operations data={validData} />}
          {activeTab === "finance" && <Finance data={validData} />}
          {activeTab === "quality" && (
            <>
              <div className="analytics-kpis">
                <Metric
                  label="API-запросы в интерфейсе"
                  value={number(validData.quality.apiRequests)}
                />
                <Metric
                  label="API с ошибкой"
                  value={percent(
                    validData.quality.apiErrors,
                    validData.quality.apiRequests,
                  )}
                />
                <Metric
                  label="API p95, приблизительно"
                  value={duration(validData.quality.apiP95Ms)}
                />
                <Metric
                  label="Ошибки JavaScript"
                  value={number(validData.audience.current.errors)}
                />
                <Metric
                  label="Средний LCP"
                  value={duration(validData.quality.lcpAverageMs)}
                />
                <Metric
                  label="Задержка взаимодействий p95"
                  value={duration(validData.quality.interactionP95Ms)}
                />
              </div>
              <AnalyticsChart
                title="Ошибки интерфейса по дням"
                dates={validData.daily.map((row) => row.date)}
                series={[
                  {
                    key: "errors",
                    label: "Ошибки JavaScript",
                    color: "#ec6677",
                    values: validData.daily.map((row) => row.errors),
                  },
                ]}
              />
              <Distribution
                title="API-ошибки по разделам"
                rows={validData.features
                  .filter((row) => row.requestErrors > 0)
                  .map((row) => ({
                    label: sections[row.section],
                    value: row.requestErrors,
                    hint: `${percent(row.requestErrors, row.requests)} запросов · p95 ${duration(row.latencyP95Ms)}`,
                  }))}
              />
              <Distribution
                title="Журнал внутренних ошибок платформы, до 15 дней"
                rows={validData.quality.serverErrors.map((row) => ({
                  label: `${row.service} · ${row.code}`,
                  value: row.count,
                }))}
              />
              <AnalyticsChart
                title="Зарегистрированные внутренние ошибки"
                dates={validData.quality.serverErrorDaily.map(
                  (row) => row.date,
                )}
                series={[
                  {
                    key: "server",
                    label: "Записи журнала",
                    color: "#e9a94a",
                    values: validData.quality.serverErrorDaily.map(
                      (row) => row.count,
                    ),
                  },
                ]}
              />
              <p className="analytics-description">
                Измерения поступают из активного интерфейса, поэтому фоновые
                опросы не считаются работой человека. p95 API и взаимодействий
                рассчитывается по фиксированным диапазонам времени; это
                клиентская диагностика, а не полный серверный SLO. Журнал
                внутренних ошибок относится ко всей платформе, хранится 15 дней
                и может не записать ошибку при недоступности самой БД. Средний
                CLS срезов:{" "}
                {validData.quality.clsAverageMilli === null
                  ? "—"
                  : number(validData.quality.clsAverageMilli / 1000)}
                .
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
function Audience({ data }: Readonly<{ data: ProductAnalyticsReport }>) {
  const comparable =
    data.since !== null &&
    Date.parse(data.since) <=
      Date.parse(data.period.from) - data.period.days * 86_400_000;
  const { audience: a } = data,
    dates = data.daily.map((row) => row.date),
    measured = (date: string) =>
      data.since !== null && date >= data.since.slice(0, 10);
  return (
    <>
      <div className="analytics-kpis">
        <Metric
          label="DAU"
          value={number(a.dau)}
          hint="Уникальные активные сегодня, UTC"
        />
        <Metric
          label="WAU"
          value={number(a.wau)}
          hint="Уникальные за последние 7 дней"
        />
        <Metric
          label="MAU"
          value={number(a.mau)}
          hint="Уникальные за последние 30 дней"
        />
        <Metric
          label="Недавно активны"
          value={number(a.online)}
          hint="Последняя отметка за 2 минуты; срез отчёта"
        />
        <Metric
          label="Активные области"
          value={number(a.current.workspaces)}
          current={a.current.workspaces}
          previous={comparable ? a.previous.workspaces : undefined}
        />
        <Metric
          label="Активные пользователи за период"
          value={number(a.current.users)}
          current={a.current.users}
          previous={comparable ? a.previous.users : undefined}
        />
      </div>
      <AnalyticsChart
        title="Активность по дням"
        dates={dates}
        series={[
          {
            key: "users",
            label: "Пользователи",
            color: "#8877ff",
            values: data.daily.map((row) =>
              measured(row.date) ? row.users : null,
            ),
          },
          {
            key: "workspaces",
            label: "Рабочие области",
            color: "#44cc92",
            values: data.daily.map((row) =>
              measured(row.date) ? row.workspaces : null,
            ),
          },
          {
            key: "projects",
            label: "Проекты",
            color: "#e9a94a",
            values: data.daily.map((row) =>
              measured(row.date) ? row.projects : null,
            ),
          },
        ]}
      />
      <div className="analytics-kpis">
        <Metric
          label="Активное время за период"
          value={duration(a.current.seconds * 1000)}
          current={a.current.seconds}
          previous={comparable ? a.previous.seconds : undefined}
        />
        <Metric
          label="Просмотры результатов"
          value={number(a.current.results)}
          current={a.current.results}
          previous={comparable ? a.previous.results : undefined}
        />
        <Metric
          label="DAU / MAU"
          value={percent(a.dau, a.mau)}
          hint="Частота возвращения; не сумма DAU"
        />
        <Metric
          label="Время на посещение"
          value={duration(
            a.current.sessions
              ? (a.current.seconds / a.current.sessions) * 1000
              : null,
          )}
        />
      </div>
      <AnalyticsChart
        title="Работа в приложении, минуты"
        dates={dates}
        series={[
          {
            key: "time",
            label: "Активные минуты",
            color: "#8877ff",
            values: data.daily.map((row) =>
              measured(row.date) ? row.seconds / 60 : null,
            ),
          },
        ]}
      />
      <p className="analytics-description">
        Активный пользователь: минимум 30 секунд работы в видимой вкладке либо
        действие / просмотр результата. Счётчик времени останавливается после 2
        минут без взаимодействия. Воркеры, автосборы и фоновые запросы не
        создают DAU.
      </p>
    </>
  );
}
function Retention({ data }: Readonly<{ data: ProductAnalyticsReport }>) {
  const a = data.activation;
  return (
    <>
      <Distribution
        title="Активация новых пользователей выбранного периода"
        rows={[
          { label: "Зарегистрировались", value: a.registered },
          { label: "Подтвердили почту", value: a.verified },
          { label: "Начали использовать приложение", value: a.engaged },
          { label: "Открыли результат", value: a.resultViewed },
        ]}
      />
      <div className="analytics-kpis">
        <Metric
          label="Время до первого просмотра результата"
          value={duration(a.timeToValueMedianMs)}
          hint="Медиана среди новой когорты с результатом"
        />
        {([1, 7, 30] as const).map((day) => {
          const retention = data.audience[`d${day}`];
          return (
            <Metric
              key={day}
              label={`Удержание D${day}`}
              value={percent(retention.returned, retention.eligible)}
              hint={`${number(retention.returned)} из ${number(retention.eligible)}; только созревшие когорты`}
            />
          );
        })}
      </div>
      <section className="panel">
        <h2>Недельные когорты удержания</h2>
        <p className="analytics-description">
          Когорта — неделя первого активного использования. D1/D7/D30 — возврат
          именно в этот день. Здесь — возврат в соответствующую неделю после
          первого использования; незавершённые недели показаны прочерком.
        </p>
        {data.cohorts.length === 0 ? (
          <Empty>Для удержания нужна накопленная история активности.</Empty>
        ) : (
          <div className="analytics-table-scroll">
            <table className="analytics-cohorts">
              <thead>
                <tr>
                  <th>Первая неделя, UTC</th>
                  <th>Пользователи</th>
                  {Array.from({ length: 9 }, (_, index) => (
                    <th key={index}>Н{index}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((row) => (
                  <tr key={row.week}>
                    <th scope="row">{row.week}</th>
                    <td>{number(row.users)}</td>
                    {row.weeks.map((cell, index) => (
                      <td
                        key={index}
                        title={`${cell.returned} вернулись из ${cell.eligible} с завершённым периодом`}
                        style={{
                          background: cell.eligible
                            ? `rgba(136,119,255,${0.08 + (cell.returned / cell.eligible) * 0.6})`
                            : undefined,
                        }}
                      >
                        {percent(cell.returned, cell.eligible)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AnalyticsChart
        title="Регистрации и создание проектов"
        dates={data.daily.map((row) => row.date)}
        series={[
          {
            key: "registered",
            label: "Регистрации",
            color: "#8877ff",
            values: data.daily.map(
              (row) =>
                data.lifecycle.find((day) => day.date === row.date)
                  ?.registered ?? 0,
            ),
          },
          {
            key: "projects",
            label: "Проекты",
            color: "#44cc92",
            values: data.daily.map(
              (row) =>
                data.lifecycle.find((day) => day.date === row.date)?.projects ??
                0,
            ),
          },
        ]}
      />
    </>
  );
}
function Operations({ data }: Readonly<{ data: ProductAnalyticsReport }>) {
  const ops = data.operations;
  if (!ops)
    return (
      <section className="panel">
        <Empty>Источник операций временно недоступен.</Empty>
      </section>
    );
  const total = (
    key: "total" | "completed" | "failed" | "cancelled" | "partial",
  ) => ops.types.reduce((sum, row) => sum + row[key], 0);
  return (
    <>
      <div className="analytics-kpis">
        <Metric label="Запуски" value={number(total("total"))} />
        <Metric
          label="Полностью завершены"
          value={percent(total("completed"), total("total"))}
          hint="В знаменателе также незавершённые запуски"
        />
        <Metric label="Частичные результаты" value={number(total("partial"))} />
        <Metric
          label="Ошибки / требуют решения"
          value={number(total("failed"))}
        />
        <Metric label="Отменены" value={number(total("cancelled"))} />
      </div>
      <AnalyticsChart
        title="Исходы запусков по дате создания"
        dates={data.daily.map((row) => row.date)}
        series={(["completed", "partial", "failed", "cancelled"] as const).map(
          (key, index) => ({
            key,
            label: ["Готово", "Частично", "Ошибки", "Отмены"][index]!,
            color: ["#44cc92", "#e9a94a", "#ec6677", "#aaaab5"][index]!,
            values: data.daily.map(
              (day) =>
                ops.daily.find((row) => row.key === day.date)?.[key] ?? 0,
            ),
          }),
        )}
      />
      <section className="panel">
        <h2>Скорость и результат по операциям</h2>
        <OperationsTable rows={ops.types} />
        <p className="analytics-description">
          Время выполнения — от начала до завершения; ожидание запуска и первого
          результата показано отдельно. Исторические записи без первого
          результата сохраняют «—». Число обработанных единиц учитывает только
          закрытые операции: без копирования каждого изменения прогресса.
          Сравнивайте его внутри типа: ключи, строки и URL имеют разный смысл.
        </p>
      </section>
      <div className="analytics-columns">
        <Distribution
          title="Провайдеры"
          rows={ops.providers.map((row) => ({
            label: operationNames[row.key] ?? row.key,
            value: row.total,
            hint: `Ошибки ${number(row.failed)} · выполнение p95 ${duration(row.durationP95Ms)}`,
          }))}
        />
        <Distribution
          title="Ручные и автоматические запуски"
          rows={ops.origins.map((row) => ({
            label: operationNames[row.key] ?? row.key,
            value: row.total,
          }))}
        />
      </div>
      <Distribution
        title="Коды ошибок операций"
        rows={ops.errors.map((row) => ({ label: row.code, value: row.count }))}
      />
    </>
  );
}
function Finance({ data }: Readonly<{ data: ProductAnalyticsReport }>) {
  const finance = data.finance;
  if (!finance)
    return (
      <section className="panel">
        <Empty>Финансовые данные недоступны.</Empty>
      </section>
    );
  const received = finance.daily.reduce(
      (sum, row) => sum + row.receivedMinor,
      0,
    ),
    refunds = finance.daily.reduce((sum, row) => sum + row.refundsMinor, 0);
  return (
    <>
      <div className="analytics-kpis">
        <Metric label="Подтверждённые поступления" value={money(received)} />
        <Metric label="Возвраты" value={money(refunds)} />
        <Metric
          label="Поступления за вычетом возвратов"
          value={money(received - refunds)}
        />
        <Metric
          label="Месячная стоимость подписок"
          value={money(finance.monthlyPlanValueMinor)}
          hint="Годовые планы нормализованы на 12 месяцев"
        />
        <Metric
          label="Платные рабочие области"
          value={number(finance.payingWorkspaces)}
        />
      </div>
      <AnalyticsChart
        title="Оплаты и возвраты, ₽"
        dates={data.daily.map((row) => row.date)}
        format={(value) => number(value)}
        series={[
          {
            key: "received",
            label: "Поступления",
            color: "#44cc92",
            values: data.daily.map(
              (day) =>
                (finance.daily.find((row) => row.date === day.date)
                  ?.receivedMinor ?? 0) / 100,
            ),
          },
          {
            key: "refunds",
            label: "Возвраты",
            color: "#ec6677",
            values: data.daily.map(
              (day) =>
                (finance.daily.find((row) => row.date === day.date)
                  ?.refundsMinor ?? 0) / 100,
            ),
          },
        ]}
      />
      <p className="analytics-description">
        Тестовые платежи исключены. Пополнения баланса входят в денежные
        поступления, но не считаются подписочным MRR. Стоимость обращений по
        личным BYOK-ключам — расход у провайдера, а не выручка платформы.
      </p>
    </>
  );
}
