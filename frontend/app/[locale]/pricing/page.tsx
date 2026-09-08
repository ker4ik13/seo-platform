import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { BillingPlanSummary } from "@seo-platform/contracts";
import { PublicDocumentShell } from "../../../components/public-document-shell";
import { isLocale } from "../../../lib/locales";
import { platformApiInternalOrigin } from "../../../lib/server-runtime-origin";
import "../documents.css";

type Props = { params: Promise<{ locale: string }> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: locale === "en" ? "Pricing · SEOnorita" : "Тарифы · SEOньорита", description: locale === "en" ? "Choose your workspace capacity. Pay separately for external SEO data." : "Выберите объём рабочей области. Внешние SEO-данные оплачиваются отдельно.", alternates: { canonical: `/${locale}/pricing`, languages: { ru: "/ru/pricing", en: "/en/pricing" } } };
}
async function publishedPlans(): Promise<readonly BillingPlanSummary[] | null> {
  try {
    const response = await fetch(`${platformApiInternalOrigin()}/api/v1/billing/plans`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const payload = await response.json() as { data?: BillingPlanSummary[] };
    if (!Array.isArray(payload.data) || payload.data.length > 20 || payload.data.some(plan => !plan.features || !Array.isArray(plan.prices) || typeof plan.name !== "string" || plan.prices.some(price => price.currency !== "RUB" || !Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0))) return null;
    return payload.data;
  } catch { return null; }
}
export default async function PricingPage({ params }: Props) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  const en = locale === "en", plans = await publishedPlans();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(minor / 100);
  return <PublicDocumentShell locale={locale} slug="pricing"><main className="public-document-main public-pricing-main"><header className="public-document-title"><p>{en ? "Room for your SEO work" : "Место для вашей SEO-работы"}</p><h1>{en ? "A plan for your projects" : "Тариф под ваши проекты"}</h1><p>{en ? "Start free. Add capacity as your projects grow. External data is paid separately, with the price confirmed before each run." : "Начните бесплатно. Увеличивайте объём по мере роста проектов. Внешние данные оплачиваются отдельно, с подтверждением цены перед запуском."}</p></header>
    {!plans ? <section className="public-document-draft" role="status"><h2>{en ? "Could not load current plans" : "Не удалось загрузить актуальные тарифы"}</h2><p>{en ? "Try refreshing, or open billing in your workspace. Unverified prices are not shown." : "Обновите страницу или откройте оплату в рабочей области. Непроверенные цены не показываются."}</p><a href={`/${locale}/pricing`}>{en ? "Refresh" : "Обновить"}</a></section> : <div className="public-pricing-grid">{plans.map(plan => {
      const monthly = plan.prices.find(price => price.period === "MONTHLY"), yearly = plan.prices.find(price => price.period === "ANNUAL"), f = plan.features;
      return <article className={`public-price-card${plan.code === "TEAM" ? " is-recommended" : ""}`} key={`${plan.code}:${plan.version}`}>
        <p className="public-price-kicker">{plan.code === "TEAM" ? en ? "For regular SEO work" : "Для регулярного SEO" : en ? "Workspace plan" : "Тариф рабочей области"}</p><h2>{en ? plan.nameEn ?? plan.name : plan.name}</h2><p>{en ? plan.descriptionEn ?? plan.description : plan.description}</p>
        <div className="public-price-amount">{monthly ? money(monthly.amountMinor) : "—"}<span>{en ? "/ month" : "/ месяц"}</span></div><small className="public-price-year">{yearly ? `${money(yearly.amountMinor)} ${en ? "/ year" : "/ год"}` : en ? "No card required" : "Без банковской карты"}</small>
        <ul><li>{number(f.projects)} {en ? "projects" : "проектов"}</li><li>{number(f.seats)} {en ? "team members" : "участников"}</li><li>{number(f.storedKeywords)} {en ? "keywords per workspace" : "ключей в рабочей области"}</li><li>{f.keywordsPerProject ? `${number(f.keywordsPerProject)} ${en ? "keywords per project" : "ключей в проекте"}` : en ? "Project size within workspace capacity" : "Размер проекта в пределах рабочей области"}</li><li>{number(f.concurrentJobs)} {en ? "concurrent operations" : "операций одновременно"}</li><li>{number(f.scheduledAutomations)} {en ? "enabled schedules" : "активных расписаний"}</li><li>{en ? "Your own API keys supported" : "Можно подключить свои API-ключи"}</li></ul>
        <a className="public-document-button" href={`/app/register?locale=${locale}`}>{monthly?.amountMinor === 0 ? en ? "Start free" : "Начать бесплатно" : en ? "Create workspace" : "Создать рабочую область"}</a>
      </article>;
    })}</div>}
    <div className="public-pricing-details"><section><h2>{en ? "You control data spending" : "Расход данных под вашим контролем"}</h2><p>{en ? "XMLStock and Arsenkin requests use a separate data balance when platform connections are available. You see the source, keyword count and maximum price before starting. Unused reservations return to your balance." : "Запросы XMLStock и Arsenkin оплачиваются с отдельного баланса, если системные подключения доступны. До запуска вы видите источник, число ключей и максимальную стоимость. Неиспользованный резерв возвращается на баланс."}</p><p>{en ? "With your own API key, provider charges go to your own account. We do not promise unlimited external requests or charge your platform balance for these calls." : "При использовании своего API-ключа провайдер списывает средства с вашего аккаунта. Внутренний баланс за такие обращения не расходуется."}</p></section><section><h2>{en ? "Your paid time is preserved" : "Оплаченное время сохраняется"}</h2><p>{en ? "Early renewal keeps remaining days. Changing plans converts unused paid value into extra days. Automatic renewal requires your consent and can be disabled in settings." : "Досрочное продление сохраняет оставшиеся дни. При смене тарифа оплаченный остаток превращается в дополнительные дни. Автоплатёж включается с вашего согласия и отключается в настройках."}</p><p>{en ? "Projects are not automatically deleted after a subscription ends. Refund requests are available for unused paid value, subject to the refund policy and mandatory buyer rights." : "После окончания подписки проекты не удаляются автоматически. Для неиспользованной оплаченной стоимости можно запросить возврат с учётом правил и обязательных прав покупателя."} <a href={`/${locale}/refunds`}>{en ? "Refund policy →" : "Правила возвратов →"}</a></p></section></div>
  </main></PublicDocumentShell>;
}
