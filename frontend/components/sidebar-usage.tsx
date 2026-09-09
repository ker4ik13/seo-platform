"use client";

import Link from "next/link";
import type { WorkspaceUsageMetric } from "@seo-platform/contracts";
import { useWorkspaceUsage } from "./workspace-usage-provider";
import { Icon } from "./icon";
import { useUiLocale, UiText } from "./ui-locale";


export function SidebarUsage({ canView }: Readonly<{ canView: boolean; locale?: string }>) {
  const { t: uiText, locale: currentLocale } = useUiLocale();
  const { data, loading, unavailable } = useWorkspaceUsage();
  const english = currentLocale === "en";
  const number = new Intl.NumberFormat(english ? "en" : "ru", { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(english ? "en" : "ru", { maximumFractionDigits: 2 });
  return (
    <div className="sidebar-usage" aria-label={english ? "Plan and usage" : uiText("Тариф и лимиты")}>
      <Link className="sidebar-usage-heading" href="/app/settings/billing">
        <span>{uiText(data?.plan?.name ?? "Тариф и баланс")}</span><Icon name="chevronRight" />
      </Link>
      {!canView ? <small>{english ? "Managed by the workspace owner" : <UiText text="Управляет владелец рабочей области" />}</small> : loading && !data ? (
        <div className="sidebar-usage-loading" role="status">{english ? "Loading limits…" : <UiText text="Загружаем лимиты…" />}</div>
      ) : !data ? <small role="status">{english ? "Usage is temporarily unavailable" : <UiText text="Лимиты временно недоступны" />}</small> : <>
        <div className="sidebar-usage-balance"><span>{english ? "Balance" : <UiText text="Баланс" />}</span><strong>{money.format(data.balance.availableMinor / 100)} ₽</strong></div>
        <UsageBar label={english ? "Projects" : uiText("Проекты")} value={data.resources.projects} number={number} />
        <UsageBar label={english ? "Keywords" : uiText("Запросы")} value={data.resources.keywords} number={number} />
        <UsageBar label={english ? "Active operations" : uiText("Активные операции")} value={data.resources.concurrentJobs} number={number} />
        {(unavailable || data.degraded) && <small className="sidebar-usage-stale">{english ? "Some metrics are temporarily unavailable" : <UiText text="Часть показателей временно недоступна" />}</small>}
      </>}
    </div>
  );
}
function UsageBar({ label, value, number }: { label: string; value: WorkspaceUsageMetric; number: Intl.NumberFormat }) {
  const ratio = value.used !== null && value.limit !== null && value.limit > 0 ? Math.min(100, value.used / value.limit * 100) : 0;
  return <div className={`sidebar-usage-resource${ratio >= 100 ? " is-full" : ratio >= 80 ? " is-warning" : ""}`}>
    <div><span>{label}</span><strong>{value.used === null ? "—" : number.format(value.used)}<small> / {value.limit === null ? "∞" : number.format(value.limit)}</small></strong></div>
    {value.limit !== null && <div className="sidebar-usage-track" aria-hidden="true"><i style={{ width: `${ratio}%` }} /></div>}
  </div>;
}
