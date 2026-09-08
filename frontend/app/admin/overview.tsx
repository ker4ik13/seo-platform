"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminOverview } from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { UiText, useUiLocale } from "../../components/ui-locale";


type Destination = "workspaces" | "projects" | "operations" | "receipts" | "refunds" | "providers" | "usage";
const integer = (value: number, uiLocale: string = "ru-RU") => new Intl.NumberFormat(uiLocale).format(value);
const money = (value: number, uiLocale: string = "ru-RU") => new Intl.NumberFormat(uiLocale, { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value / 100);
export function Overview({ onNavigate }: { onNavigate: (screen: Destination) => void }) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [data, setData] = useState<AdminOverview>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState<"amountMinor" | "payments">("amountMinor");
  const load = useCallback(async () => {
    setLoading(true);
    const result = await adminApi<AdminOverview>("/api/overview");
    setLoading(false);
    if (result.ok) { setData(result.data); setError(undefined); } else setError(result.message);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 60_000); return () => clearInterval(timer); }, [load]);
  const series = useMemo(() => {
    if (!data?.finance) return [];
    const byDay = new Map(data.finance.daily.map(row => [row.date, row]));
    const today = new Date(data.generatedAt); today.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: 30 }, (_, index) => { const date = new Date(today.getTime() - (29 - index) * 86_400_000).toISOString().slice(0, 10); return byDay.get(date) ?? { date, amountMinor: 0, payments: 0 }; });
  }, [data]);
  const maximum = Math.max(1, ...series.map(row => row[metric]));
  if (!data) return <div className="content"><section className="panel"><h1><UiText text="Обзор платформы" /></h1><p>{error ?? <UiText text="Собираем показатели…" />}</p><button type="button" className="ghost" onClick={() => void load()}><UiText text="Обновить" /></button></section></div>;
  const finance = data.finance;
  const kpis = [
    { label: "Активны за 7 дней", value: integer(data.users.active7d, uiLocale), hint: `${integer(data.users.total, uiLocale)} пользователей всего`, to: "workspaces" as const },
    { label: "Платные рабочие области", value: integer(data.workspaces.paying, uiLocale), hint: `${integer(data.workspaces.total, uiLocale)} рабочих областей`, to: "workspaces" as const },
    { label: "Проекты", value: integer(data.projects, uiLocale), hint: `${integer(data.workspaces.withProjects, uiLocale)} областей с проектами`, to: "projects" as const },
    { label: "Ключевые запросы", value: data.seo ? integer(data.seo.activeKeywords, uiLocale) : "—", hint: data.seo ? `${integer(data.seo.activatedWorkspaces, uiLocale)} областей начали работу` : "SEO-данные временно недоступны", to: "projects" as const },
    ...(finance ? [{ label: "Поступления за 30 дней", value: money(finance.received30dMinor, uiLocale), hint: `${money(finance.refunded30dMinor, uiLocale)} возвращено`, to: "refunds" as const }, { label: "Месячная стоимость подписок", value: money(finance.monthlyPlanValueMinor, uiLocale), hint: "Активные платные планы, с учётом годовой скидки", to: "workspaces" as const }] : [])
  ];
  return <div className="content admin-overview"><section className="admin-overview-heading"><div><p className="eyebrow"><UiText text="SEOньорита · управление" /></p><h1><UiText text="Обзор платформы" /></h1><p><UiText text="Пользователи, деньги и работа сервиса в одном месте." /></p></div><div><small><UiText text="Обновлено" after=" " />{new Date(data.generatedAt).toLocaleTimeString(uiLocale, { hour: "2-digit", minute: "2-digit" })}</small><button type="button" className="ghost" disabled={loading} onClick={() => void load()}>{loading ? <UiText text="Обновляем…" /> : <UiText text="Обновить" />}</button></div></section>
    {error && <p className="error" role="alert">{<UiText text={error ?? ""} />}</p>}{data.degraded.length > 0 && <p className="notice"><UiText text="Часть данных временно недоступна:" after=" " />{data.degraded.map(source => uiText(source === "SEO" ? "семантика" : "выполнение операций")).join(", ")}<UiText text=". Остальные показатели актуальны." /></p>}
    <div className="admin-kpi-grid">{kpis.map(kpi => <button className="panel admin-kpi" type="button" key={kpi.label} onClick={() => onNavigate(kpi.to)}><span><UiText text={kpi.label} /></span><strong>{kpi.value}</strong><small><UiText text={kpi.hint} /></small></button>)}</div>
    <div className="admin-overview-columns"><section className="panel admin-attention"><header><h2><UiText text="Требует внимания" /></h2><span><UiText text="Операционный контроль" /></span></header>
      {finance && <><Attention label={uiText("Заявки на возврат")} count={finance.pendingRefunds} onClick={() => onNavigate("refunds")} /><Attention label={uiText("Чеки НПД и исправления")} count={finance.pendingReceipts} onClick={() => onNavigate("receipts")} /><Attention label={uiText("Неопределённый расход данных")} count={finance.usageReview} onClick={() => onNavigate("usage")} /></>}
      <Attention label={uiText("Операции требуют решения")} count={data.execution?.attention ?? null} onClick={() => onNavigate("operations")} />
      <Attention label={uiText("Ошибка за последние сутки")} count={data.execution?.failed24h ?? null} onClick={() => onNavigate("operations")} />
      <button type="button" className="ghost" onClick={() => onNavigate("providers")}><UiText text="Аккаунты и остатки провайдеров →" /></button>
    </section><section className="panel admin-activation"><header><h2><UiText text="Активация и удержание" /></h2><span><UiText text="Последние 7 дней" /></span></header><dl><div><dt><UiText text="Новые регистрации" /></dt><dd>{integer(data.users.registered7d, uiLocale)}</dd></div><div><dt><UiText text="Не подтвердили почту" /></dt><dd>{integer(data.users.unverified, uiLocale)}</dd></div><div><dt><UiText text="Рабочие области только для чтения" /></dt><dd>{integer(data.workspaces.readOnly, uiLocale)}</dd></div><div><dt><UiText text="Операций завершено за 30 дней" /></dt><dd>{data.execution ? integer(data.execution.completed30d, uiLocale) : "—"}</dd></div><div><dt><UiText text="В очереди / активны" /></dt><dd>{data.execution ? `${integer(data.execution.queued, uiLocale)} / ${integer(data.execution.active, uiLocale)}` : "—"}</dd></div></dl></section></div>
    {finance && <section className="panel admin-revenue"><header><div><h2><UiText text="Динамика оплат" /></h2><p><UiText text="Подтверждённые платежи за 30 календарных дней, UTC. Тестовые оплаты исключены." /></p></div><div className="admin-chart-tabs"><button className={metric === "amountMinor" ? "active" : undefined} onClick={() => setMetric("amountMinor")} type="button"><UiText text="Поступления" /></button><button className={metric === "payments" ? "active" : undefined} onClick={() => setMetric("payments")} type="button"><UiText text="Количество" /></button></div></header>
      <svg className="admin-revenue-chart" viewBox="0 0 600 180" role="img" aria-label={metric === "amountMinor" ? uiText("Поступления по дням") : uiText("Оплаты по дням")}>{series.map((day, index) => { const height = day[metric] / maximum * 140; return <rect x={index * 20 + 3} y={158 - height} width={14} height={Math.max(day[metric] > 0 ? 3 : 1, height)} rx={3} key={day.date}><title>{day.date}: {metric === "amountMinor" ? money(day.amountMinor, uiLocale) : <UiText text="{0} оплат" values={[String(day.payments)]} />}</title></rect>; })}<text x="3" y="177">{series[0]?.date}</text><text x="598" y="177" textAnchor="end">{series.at(-1)?.date}</text></svg>
      <footer><span><UiText text="С начала года:" after=" " /><strong>{money(finance.receivedYearMinor, uiLocale)}</strong></span><span><UiText text="Ожидают подтверждения:" after=" " /><strong>{finance.pendingPayments}</strong></span></footer>
    </section>}
    <section className="panel"><header><h2><UiText text="Платёжные подключения" /></h2><span><UiText text="Конфигурация магазина" /></span></header><div className="admin-payment-statuses">{data.paymentProviders.map(provider => <div key={provider.provider}><strong>{provider.provider === "YOOKASSA" ? <UiText text="ЮKassa" /> : "Crypto Pay"}</strong><span>{!provider.available ? <UiText text="Не настроен" /> : provider.mode === "TEST" ? <UiText text="Настроен тестовый режим" /> : <UiText text="Настроен боевой режим" />}</span></div>)}</div></section>
  </div>;
}
function Attention({ label, count, onClick }: { label: string; count: number | null; onClick: () => void }) {
  const uiLocale = useUiLocale().locale; return <button type="button" className="admin-attention-row" onClick={onClick}><span>{label}</span><strong className={count && count > 0 ? "is-warning" : undefined}>{count === null ? "—" : integer(count, uiLocale)}</strong></button>; }
