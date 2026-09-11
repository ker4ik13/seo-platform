"use client";

import type { FrequencySeasonalityPointSummary } from "@seo-platform/contracts";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { seoRegionDisplayName } from "../lib/seo-regions";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText, useUiLocale } from "./ui-locale";

const WIDTH = 380;
const HEIGHT = 176;
const PADDING = { top: 15, right: 12, bottom: 28, left: 42 } as const;
const SEASONALITY_TYPES = ["BASE", "EXACT", "FIXED"] as const;

export function SemanticSeasonalityCharts({
  points
}: Readonly<{ points: readonly FrequencySeasonalityPointSummary[] }>) {
  const groups = useMemo(() => {
    const result = new Map<string, FrequencySeasonalityPointSummary[]>();
    for (const point of points) {
      const key = JSON.stringify([
        point.granularity,
        point.regionCode,
        point.device
      ]);
      const rows = result.get(key) ?? [];
      rows.push(point);
      result.set(key, rows);
    }
    return [...result.values()]
      .map((rows) => [...rows].sort((left, right) =>
        left.periodStart.localeCompare(right.periodStart)
      ))
      .sort((left, right) =>
        (right.at(-1)?.observedAt ?? "").localeCompare(left.at(-1)?.observedAt ?? "")
      )
      .slice(0, 4);
  }, [points]);

  return (
    <div className="semantic-seasonality-charts">
      {groups.map((rows) => (
        <SeasonalityChart
          key={`${rows[0]?.granularity}:${rows[0]?.regionCode}:${rows[0]?.device}`}
          points={rows}
        />
      ))}
    </div>
  );
}

function SeasonalityChart({
  points
}: Readonly<{ points: readonly FrequencySeasonalityPointSummary[] }>) {
  const { locale, t } = useUiLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const first = points[0]!;
  const series = SEASONALITY_TYPES.flatMap((type) => {
    const values = points
      .filter((point) => point.type === type)
      .sort((left, right) => left.periodStart.localeCompare(right.periodStart));
    return values.length > 0 ? [{ type, points: values }] : [];
  });
  const periods = [...new Set(points.map(({ periodStart }) => periodStart))].sort();
  const firstTime = Date.parse(`${periods[0]}T00:00:00.000Z`);
  const lastTime = Date.parse(`${periods.at(-1)}T00:00:00.000Z`);
  const numericValues = points.map((point) => Number(point.value));
  const maximum = Math.max(0, ...numericValues);
  const plotMaximum = Math.max(1, maximum);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (periodStart: string) => {
    const time = Date.parse(`${periodStart}T00:00:00.000Z`);
    return PADDING.left + (lastTime === firstTime
      ? plotWidth / 2
      : (time - firstTime) / (lastTime - firstTime) * plotWidth);
  };
  const y = (value: string) =>
    PADDING.top + (1 - Number(value) / plotMaximum) * plotHeight;
  const activePeriod = focused ?? hovered ?? periods.at(-1)!;
  const activePoints = series.flatMap((entry) => {
    const point = entry.points.find(({ periodStart }) => periodStart === activePeriod);
    return point ? [{ type: entry.type, point }] : [];
  });
  const guides = [...new Set([0, Math.round(maximum / 2), maximum])]
    .sort((left, right) => right - left);

  function selectNearest(event: ReactPointerEvent<SVGSVGElement>): void {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix || periods.length === 0) return;
    const cursor = svgRef.current!.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const local = cursor.matrixTransform(matrix.inverse());
    const nearest = periods.reduce((current, candidate) =>
      Math.abs(x(candidate) - local.x) < Math.abs(x(current) - local.x)
        ? candidate
        : current
    );
    setHovered(nearest);
  }

  return (
    <article className="semantic-seasonality-chart">
      <header>
        <div>
          <SearchEngineLogo engine="YANDEX" size="compact" />
          <strong><UiText text="Яндекс Wordstat" /></strong>
        </div>
        <span>
          {regionLabel(first.regionCode)} · <UiText text={deviceLabel(first.device)} /> · <UiText text={granularityLabel(first.granularity)} />
        </span>
      </header>
      <div className="semantic-seasonality-chart-canvas">
        <svg
          aria-label={t("Интерактивный график сезонности. Наведите курсор или выберите точку, чтобы увидеть частотность периода.")}
          onPointerLeave={() => setHovered(undefined)}
          onPointerMove={selectNearest}
          ref={svgRef}
          role="group"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {guides.map((value) => {
            const guideY = PADDING.top + (1 - value / plotMaximum) * plotHeight;
            return (
              <g key={value}>
                <line className="semantic-seasonality-guide" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={guideY} y2={guideY} />
                <text className="semantic-seasonality-axis" x={PADDING.left - 7} y={guideY + 3}>{formatValue(String(value), locale)}</text>
              </g>
            );
          })}
          {series.map((entry) => (
            <polyline
              className={`semantic-seasonality-line type-${entry.type.toLowerCase()}`}
              key={entry.type}
              points={entry.points.map((point) => `${x(point.periodStart)},${y(point.value)}`).join(" ")}
            />
          ))}
          {series.flatMap((entry) => entry.points.map((point) => (
            <circle
              className={`semantic-seasonality-point type-${entry.type.toLowerCase()}`}
              cx={x(point.periodStart)}
              cy={y(point.value)}
              key={`${entry.type}:${point.periodStart}`}
              r="3.5"
            />
          )))}
          <line className="semantic-seasonality-active-line" x1={x(activePeriod)} x2={x(activePeriod)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
          {activePoints.map(({ type, point }) => (
            <circle
              className={`semantic-seasonality-active-point type-${type.toLowerCase()}`}
              cx={x(activePeriod)}
              cy={y(point.value)}
              key={`active:${type}`}
              r="5"
            />
          ))}
          {periods.map((period) => (
            <circle
              aria-label={`${periodLabel(period, first.granularity, locale)}: ${activePeriodValues(period, series, locale)}`}
              className="semantic-seasonality-hit"
              cx={x(period)}
              cy={PADDING.top + plotHeight / 2}
              fill="transparent"
              key={`hit:${period}`}
              onBlur={() => setFocused(undefined)}
              onFocus={() => setFocused(period)}
              onPointerDown={() => setFocused(period)}
              r="11"
              tabIndex={0}
            />
          ))}
          <text className="semantic-seasonality-date" x={PADDING.left} y={HEIGHT - 6}>{shortPeriod(periods[0]!, first.granularity, locale)}</text>
          <text className="semantic-seasonality-date end" x={WIDTH - PADDING.right} y={HEIGHT - 6}>{shortPeriod(periods.at(-1)!, first.granularity, locale)}</text>
        </svg>
        {hovered || focused ? (
          <div
            className={`semantic-seasonality-tooltip${x(activePeriod) > WIDTH * .68 ? " align-right" : ""}`}
            style={{ left: `${x(activePeriod) / WIDTH * 100}%`, top: "12%" }}
          >
            <strong>{periodLabel(activePeriod, first.granularity, locale)}</strong>
            {SEASONALITY_TYPES.map((type) => {
              const point = activePoints.find((entry) => entry.type === type)?.point;
              return point ? (
                <span className={`type-${type.toLowerCase()}`} key={type}>
                  <i /> <b><UiText text={frequencyTypeLabel(type)} /></b>
                  <em>{formatValue(point.value, locale)}</em>
                </span>
              ) : null;
            })}
          </div>
        ) : null}
      </div>
      <footer className="semantic-seasonality-selected-point" aria-live="polite">
        <span>{periodLabel(activePeriod, first.granularity, locale)}</span>
        <small>{[...new Set(points.map(({ provider }) => provider === "ARSENKIN" ? "Arsenkin" : "XMLStock"))].join(" + ")} · {periods.length.toLocaleString(locale)} <UiText text="периодов" /></small>
        <div className="semantic-seasonality-series-values">
          {SEASONALITY_TYPES.map((type) => {
            const point = activePoints.find((entry) => entry.type === type)?.point;
            return point ? (
              <span className={`type-${type.toLowerCase()}`} key={type}>
                <i /> <UiText text={frequencyTypeLabel(type)} />
                <strong>{formatValue(point.value, locale)}</strong>
              </span>
            ) : null;
          })}
        </div>
      </footer>
    </article>
  );
}

function activePeriodValues(
  period: string,
  series: readonly {
    readonly type: FrequencySeasonalityPointSummary["type"];
    readonly points: readonly FrequencySeasonalityPointSummary[];
  }[],
  locale: string
): string {
  return series.flatMap(({ type, points }) => {
    const point = points.find(({ periodStart }) => periodStart === period);
    return point
      ? [`${frequencyTypeLabel(type)}: ${formatValue(point.value, locale)}`]
      : [];
  }).join(", ");
}

function frequencyTypeLabel(type: FrequencySeasonalityPointSummary["type"]): string {
  return {
    BASE: "Базовая",
    EXACT: "Фразовая",
    FIXED: "Точная словоформа"
  }[type];
}

function regionLabel(code: string): string {
  return seoRegionDisplayName("WORDSTAT", code);
}

function deviceLabel(device: string): string {
  return {
    ALL: "все устройства",
    DESKTOP: "десктоп",
    MOBILE: "мобильные",
    PHONE_ONLY: "телефоны",
    TABLET_ONLY: "планшеты"
  }[device] ?? device;
}

function granularityLabel(granularity: string): string {
  return { MONTH: "По месяцам", WEEK: "По неделям", DAY: "По дням" }[granularity] ?? granularity;
}

function periodLabel(value: string, granularity: string, locale: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (granularity === "MONTH") {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
  }
  if (granularity === "WEEK") {
    return `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date)} · ${locale.startsWith("ru") ? "начало недели" : "week start"}`;
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function shortPeriod(value: string, granularity: string, locale: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, granularity === "MONTH"
    ? { month: "short", year: "2-digit" }
    : { day: "2-digit", month: "short" }
  ).format(date);
}

function formatValue(value: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(BigInt(value));
  } catch {
    return value;
  }
}
