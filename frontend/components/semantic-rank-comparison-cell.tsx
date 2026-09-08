import type { SemanticRankColumnMetric, SemanticRankComparisonItem } from "@seo-platform/contracts";
import { rankChangePresentation, semanticDisplayUrl } from "../lib/semantic-rank-presentation";
import { useUiLocale } from "./ui-locale";

export function SemanticRankComparisonCell({ item, metric, loading, error }: { item: SemanticRankComparisonItem | undefined; metric: SemanticRankColumnMetric; loading: boolean; error?: string | undefined }) {
  const { locale, t } = useUiLocale();
  if (error && !item) return <span className="danger-text" title={t(error)}>!</span>;
  if (!item) return <span className="semantic-rank-comparison-empty" title={t(loading ? "Загружаем позиции…" : "В этом срезе запрос ещё не проверялся")}>{loading ? "…" : "—"}</span>;
  const date = new Date(item.observedAt).toLocaleString(locale);
  if (metric === "checkedAt") return <time dateTime={item.observedAt} title={date}>{date}</time>;
  if (metric === "url") return item.rankingUrl ? <a className="semantic-rank-comparison-url" href={item.rankingUrl} title={item.rankingUrl} rel="noopener noreferrer" target="_blank" onClick={event => event.stopPropagation()}>{semanticDisplayUrl(item.rankingUrl)}</a> : <span>—</span>;
  const change = item.position === undefined ? undefined : rankChangePresentation(item.position, item.previousPosition);
  return <span className="semantic-rank-comparison-position" title={`${date} · ${item.provider} · ${item.searchSource ?? ""} · ${t("Топ-")}${item.depth}${item.rankingUrl ? `\n${item.rankingUrl}` : ""}`}>
    <strong>{item.found ? item.position : "×"}</strong>
    {change ? <small className={change.tone}>{change.label}</small> : item.previousPosition !== undefined ? <small className="declined">←{item.previousPosition}</small> : null}
  </span>;
}
