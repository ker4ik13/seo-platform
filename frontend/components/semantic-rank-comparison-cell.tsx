import type {
  SemanticRankColumnMetric,
  SemanticRankComparisonItem
} from "@seo-platform/contracts";
import { externalPageUrlPresentation } from "../lib/app-path";
import { rankChangePresentation } from "../lib/semantic-rank-presentation";
import { useUiLocale } from "./ui-locale";

type RankPositionValue = Readonly<{
  found: boolean;
  position?: number;
  previousPosition?: number;
}>;

export function SemanticRankPositionCell({
  item,
  searchEngine,
  titleSuffix
}: Readonly<{
  item: RankPositionValue;
  searchEngine: "GOOGLE" | "YANDEX";
  titleSuffix?: string;
}>) {
  const { t } = useUiLocale();
  const engine = searchEngine === "YANDEX" ? t("Яндекс") : "Google";
  if (!item.found) {
    const description = item.previousPosition === undefined
      ? `${engine}: ${t("позиция не найдена")}`
      : `${engine}: ${t("позиция не найдена")} · ${t("Была")} ${item.previousPosition}`;
    return (
      <span
        aria-label={description}
        className="semantic-position-value not-found"
        title={titleSuffix ? `${description} · ${titleSuffix}` : description}
      >
        <span aria-hidden="true" className="semantic-rank-not-found">×</span>
        {item.previousPosition !== undefined && (
          <small aria-hidden="true">{t("Была")} {item.previousPosition}</small>
        )}
      </span>
    );
  }
  if (item.position === undefined) {
    return <span className="semantic-metric-empty">—</span>;
  }
  const change = rankChangePresentation(item.position, item.previousPosition);
  return (
    <span
      aria-label={change.ariaLabel}
      className={`semantic-position-value ${change.tone}`}
      title={`${change.title}${titleSuffix ? ` · ${titleSuffix}` : ""}`}
    >
      <strong aria-hidden="true">{item.position}</strong>
      <small aria-hidden="true">{change.label}</small>
    </span>
  );
}

export function SemanticRankUrlCell({ url }: Readonly<{ url: string | undefined }>) {
  const presentation = url
    ? externalPageUrlPresentation(url, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (!presentation) {
    return <span className="semantic-metric-empty">—</span>;
  }
  return (
    <a
      className="semantic-ranking-url-link"
      href={presentation.href}
      onClick={(event) => event.stopPropagation()}
      rel="noreferrer noopener"
      target="_blank"
      title={presentation.href}
    >
      {presentation.label}
    </a>
  );
}

export function SemanticRankCheckedAtCell({
  observedAt
}: Readonly<{ observedAt: string }>) {
  const { locale } = useUiLocale();
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) {
    return <span className="semantic-metric-empty">—</span>;
  }
  const label = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric"
  }).format(date);
  return (
    <time dateTime={observedAt} title={date.toLocaleString(locale)}>
      {label}
    </time>
  );
}

export function SemanticRankComparisonCell({
  item,
  metric,
  loading,
  error
}: Readonly<{
  item: SemanticRankComparisonItem | undefined;
  metric: SemanticRankColumnMetric;
  loading: boolean;
  error?: string | undefined;
}>) {
  const { locale, t } = useUiLocale();
  if (error && !item) {
    return <span className="danger-text" title={t(error)}>!</span>;
  }
  if (!item) {
    return (
      <span
        className="semantic-rank-comparison-empty"
        title={t(loading ? "Загружаем позиции…" : "В этом срезе запрос ещё не проверялся")}
      >
        {loading ? "…" : "—"}
      </span>
    );
  }
  if (metric.startsWith("ai")) {
    const answer = item.aiAnswer;
    if (!answer) return <span className="semantic-rank-comparison-empty">—</span>;
    if (metric === "aiCheckedAt") {
      return <SemanticRankCheckedAtCell observedAt={answer.observedAt} />;
    }
    if (metric === "aiUrl") {
      return <SemanticRankUrlCell url={answer.rankingUrl} />;
    }
    return (
      <SemanticRankPositionCell
        item={{
          found: answer.siteFound,
          ...(answer.position === undefined ? {} : { position: answer.position }),
          ...(answer.previousPosition === undefined ? {} : { previousPosition: answer.previousPosition })
        }}
        searchEngine={item.searchEngine}
        titleSuffix={`${new Date(answer.observedAt).toLocaleString(locale)} · ИИ · ${answer.provider}${answer.rankingUrl ? ` · ${answer.rankingUrl}` : ""}`}
      />
    );
  }
  if (metric === "checkedAt") {
    return <SemanticRankCheckedAtCell observedAt={item.observedAt} />;
  }
  if (metric === "url") {
    return <SemanticRankUrlCell url={item.rankingUrl} />;
  }
  const titleSuffix = `${new Date(item.observedAt).toLocaleString(locale)} · ${item.provider} · ${item.searchSource ?? ""} · ${t("Топ-")}${item.depth}${item.rankingUrl ? ` · ${item.rankingUrl}` : ""}`;
  return (
    <SemanticRankPositionCell
      item={item}
      searchEngine={item.searchEngine}
      titleSuffix={titleSuffix}
    />
  );
}
