"use client";

import {
  projectPositionHistoryDefaultSlices,
  projectPositionTopThresholds,
  type ProjectPositionHistory,
  type ProjectPositionHistoryPoint,
  type ProjectPositionTopThreshold,
  type SemanticRankDimension
} from "@seo-platform/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  projectPositionHistoryAvailableRange,
  projectPositionHistoryPeriodLabel,
  projectPositionHistoryPeriods,
  projectPositionTopValue,
  visibleProjectPositionHistory,
  visibleProjectPositionHistoryInRange,
  type ProjectPositionHistoryDateRange,
  type ProjectPositionHistoryPeriod
} from "../lib/project-position-history";
import { ProjectPositionDateRangePicker } from "./project-position-date-range-picker";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { SemanticRankContext } from "./semantic-rank-context";
import { useUiLocale, UiText } from "./ui-locale";


const SERIES: Readonly<Record<
  ProjectPositionTopThreshold,
  Readonly<{ color: string; label: string }>
>> = {
  3: { color: "#6847f5", label: "Топ-3" },
  5: { color: "#2f6fed", label: "Топ-5" },
  10: { color: "#0b94aa", label: "Топ-10" },
  30: { color: "#d58214", label: "Топ-30" },
  50: { color: "#c84d8d", label: "Топ-50" }
};

const DEFAULT_CHART_WIDTH = 1_000;
const MIN_CHART_WIDTH = 240;
const HEIGHT = 300;
const PADDING = { top: 22, right: 24, bottom: 42, left: 54 } as const;
type SelectedPeriod = ProjectPositionHistoryPeriod | "CUSTOM";

export function ProjectPositionHistoryChart({
  dimensions,
  history,
  includeUntracked,
  onIncludeUntrackedChange,
  onRankDimensionChange,
  rankDimensionKey,
  scopeError,
  scopeLoading
}: Readonly<{
  dimensions: readonly SemanticRankDimension[];
  history: ProjectPositionHistory;
  includeUntracked: boolean;
  onIncludeUntrackedChange: (includeUntracked: boolean) => void;
  onRankDimensionChange: (rankDimensionKey: string) => void;
  rankDimensionKey: string;
  scopeError?: string;
  scopeLoading: boolean;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [period, setPeriod] = useState<SelectedPeriod>("30D");
  const [customRange, setCustomRange] = useState<ProjectPositionHistoryDateRange>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [chartWidth, setChartWidth] = useState(DEFAULT_CHART_WIDTH);
  const plotRef = useRef<HTMLDivElement>(null);
  const [visibleTops, setVisibleTops] = useState<
    ReadonlySet<ProjectPositionTopThreshold>
  >(() => new Set(projectPositionTopThresholds));
  const [activePointId, setActivePointId] = useState<string>();
  const availableRange = useMemo(
    () => projectPositionHistoryAvailableRange(history.points),
    [history.points]
  );
  const points = useMemo(() =>
    period === "CUSTOM" && customRange
      ? visibleProjectPositionHistoryInRange(
          history.points,
          customRange,
          projectPositionHistoryDefaultSlices
        )
      : visibleProjectPositionHistory(
          history.points,
          period === "CUSTOM" ? "30D" : period,
          new Date(),
          projectPositionHistoryDefaultSlices
        ),
  [customRange, history.points, period]);
  const selectedSeries = projectPositionTopThresholds.filter((top) =>
    visibleTops.has(top)
  );
  const activePoint = points.find(({ id }) => id === activePointId) ?? points.at(-1);
  const maximum = Math.max(
    1,
    ...points.flatMap((point) =>
      selectedSeries.map((top) => projectPositionTopValue(point, top))
    )
  );
  const yTicks = chartTicks(maximum);
  const activeIndex = activePoint
    ? points.findIndex(({ id }) => id === activePoint.id)
    : -1;
  const plotVisible = points.length > 0;

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot || !plotVisible) return;
    const updateWidth = () => {
      const width = Math.max(
        MIN_CHART_WIDTH,
        Math.round(plot.getBoundingClientRect().width)
      );
      setChartWidth((current) => current === width ? current : width);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(plot);
    return () => observer.disconnect();
  }, [plotVisible]);

  function toggleTop(top: ProjectPositionTopThreshold): void {
    setVisibleTops((current) => {
      if (current.has(top) && current.size === 1) return current;
      const next = new Set(current);
      if (next.has(top)) next.delete(top);
      else next.add(top);
      return next;
    });
  }

  return (
    <div className="dashboard-position-chart">
      <label className="dashboard-rank-dimension-filter">
        <span><UiText text="Поисковик, город и устройство" /></span>
        <CustomSelect
          disabled={scopeLoading}
          onChange={(event) => onRankDimensionChange(event.target.value)}
          searchable
          searchPlaceholder={uiText("Найти город или устройство")}
          value={rankDimensionKey}
        >
          <option value=""><UiText text="Все города и устройства" /></option>
          {dimensions.map((dimension) => (
            <option key={dimension.key} value={dimension.key}>
              <SemanticRankContext
                device={dimension.device}
                regionCode={dimension.regionCode}
                {...(dimension.regionLabel
                  ? { regionLabel: dimension.regionLabel }
                  : {})}
                searchEngine={dimension.searchEngine}
              />
            </option>
          ))}
        </CustomSelect>
      </label>
      <div className="dashboard-position-controls">
        <div aria-label={uiText("Период графика")} className="dashboard-chart-button-group" role="group">
          {projectPositionHistoryPeriods.map((value) => (
            <button
              aria-pressed={period === value}
              className={period === value ? "is-active" : ""}
              key={value}
              onClick={() => {
                setPeriod(value);
                setDatePickerOpen(false);
              }}
              type="button"
            >
              {<UiText text={projectPositionHistoryPeriodLabel(value) ?? ""} />}
            </button>
          ))}
          {availableRange && (
            <ProjectPositionDateRangePicker
              active={period === "CUSTOM"}
              availableRange={availableRange}
              onApply={(range) => {
                setCustomRange(range);
                setPeriod("CUSTOM");
              }}
              onOpenChange={setDatePickerOpen}
              onReset={() => setPeriod("30D")}
              open={datePickerOpen}
              {...(customRange ? { value: customRange } : {})}
            />
          )}
        </div>
        <div aria-label={uiText("Область запросов и показываемые диапазоны позиций")} className="dashboard-top-filters" role="group">
          <button
            aria-busy={scopeLoading}
            aria-pressed={includeUntracked}
            className={`dashboard-untracked-filter${includeUntracked ? " is-active" : ""}`}
            disabled={scopeLoading}
            onClick={() => onIncludeUntrackedChange(!includeUntracked)}
            title={includeUntracked ? uiText("Неотслеживаемые запросы учитываются в ТОПах") : uiText("Учитывать в ТОПах активные неотслеживаемые запросы")}
            type="button"
          >
            {scopeLoading ? (
              <span aria-hidden="true" className="dashboard-chart-scope-spinner" />
            ) : (
              <Icon name={includeUntracked ? "eye" : "eyeOff"} />
            )}
            <span>{scopeLoading ? <UiText text="Загружаем…" /> : <UiText text="Неотслеживаемые" />}</span>
          </button>
          {projectPositionTopThresholds.map((top) => {
            const selected = visibleTops.has(top);
            return (
              <button
                aria-pressed={selected}
                className={selected ? "is-active" : ""}
                key={top}
                onClick={() => toggleTop(top)}
                style={{ "--series-color": SERIES[top].color } as CSSProperties}
                type="button"
              >
                <i aria-hidden="true" />
                {seriesLabel(top, uiLocale)}
              </button>
            );
          })}
        </div>
      </div>

      {scopeError && (
        <div className="dashboard-chart-scope-error" role="alert">
          <span>{<UiText text={scopeError ?? ""} />}</span>
          <button
            onClick={() => rankDimensionKey
              ? onRankDimensionChange(rankDimensionKey)
              : onIncludeUntrackedChange(true)}
            type="button"
          >
            <UiText text="Повторить" /></button>
        </div>
      )}

      {points.length === 0 ? (
        <div className="dashboard-chart-period-empty" role="status">
          <strong>{history.points.length === 0
            ? includeUntracked
              ? <UiText text="Срезов позиций пока нет" />
              : <UiText text="По отслеживаемым запросам срезов пока нет" />
            : <UiText text="В выбранном периоде съёмов нет" />}</strong>
          <span>{history.points.length === 0
            ? includeUntracked
              ? <UiText text="Запустите новую проверку позиций." />
              : <UiText text="Можно включить неотслеживаемые запросы или запустить новый съём." />
            : <UiText text="Выберите больший период или запустите новую проверку позиций." />}</span>
        </div>
      ) : (
        <div className="dashboard-position-plot" ref={plotRef}>
          {activePoint && (
            <div
              className="dashboard-position-tooltip"
              style={chartTooltipStyle(activeIndex, points.length)}
            >
              <strong>{formatChartDay(activePoint.date, uiLocale)}</strong>
              <span>{formatInteger(activePoint.positionedKeywordCount, uiLocale)} <UiText text="запросов с позицией" before=" " /></span>
              <div>
                {selectedSeries.map((top) => (
                  <span key={top}>
                    <i style={{ background: SERIES[top].color }} />
                    {seriesLabel(top, uiLocale)}: <b>{formatInteger(projectPositionTopValue(activePoint, top), uiLocale)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <svg
            aria-label={chartAriaLabel(points, selectedSeries, uiLocale)}
            onMouseLeave={() => setActivePointId(undefined)}
            role="img"
            viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
          >
            {yTicks.map((tick) => {
              const y = chartY(tick, maximum);
              return (
                <g className="dashboard-chart-grid" key={tick}>
                  <line x1={PADDING.left} x2={chartWidth - PADDING.right} y1={y} y2={y} />
                  <text x={10} y={y + 4}>{formatCompactInteger(tick, uiLocale)}</text>
                </g>
              );
            })}
            {selectedSeries.map((top) => (
              <polyline
                className="dashboard-position-line"
                fill="none"
                key={top}
                points={points.map((point, index) =>
                  `${chartX(index, points.length, chartWidth)},${chartY(projectPositionTopValue(point, top), maximum)}`
                ).join(" ")}
                stroke={SERIES[top].color}
              />
            ))}
            {points.map((point, index) => {
              const x = chartX(index, points.length, chartWidth);
              const hitWidth = (chartWidth - PADDING.left - PADDING.right) /
                Math.max(1, points.length - 1);
              return (
                <g key={point.id}>
                  {showXAxisLabel(index, points.length, chartWidth) && (
                    <text className="dashboard-chart-x-label" x={x} y={HEIGHT - 13}>
                      {formatChartDay(point.date, uiLocale, true)}
                    </text>
                  )}
                  <rect
                    aria-label={pointAriaLabel(point, selectedSeries, uiLocale)}
                    className="dashboard-position-hit"
                    height={HEIGHT - PADDING.top - PADDING.bottom}
                    onFocus={() => setActivePointId(point.id)}
                    onMouseEnter={() => setActivePointId(point.id)}
                    role="img"
                    tabIndex={0}
                    width={Math.max(14, hitWidth)}
                    x={Math.max(PADDING.left, x - hitWidth / 2)}
                    y={PADDING.top}
                  />
                  {activePoint?.id === point.id && selectedSeries.map((top) => (
                    <circle
                      className="dashboard-position-point"
                      cx={x}
                      cy={chartY(projectPositionTopValue(point, top), maximum)}
                      fill={SERIES[top].color}
                      key={top}
                      r={4.5}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <div className="dashboard-chart-note">
        <span>{includeUntracked
          ? <UiText text="Количество всех активных запросов в выбранном ТОПе" />
          : <UiText text="Количество отслеживаемых запросов в выбранном ТОПе" />}</span>
        <span>
          <UiText text="До" after=" " />{projectPositionHistoryDefaultSlices} <UiText text="дней" before=" " />{history.truncated ? <UiText text="· более ранняя история скрыта" before=" " /> : ""}
        </span>
      </div>
    </div>
  );
}

function chartX(index: number, count: number, width: number): number {
  if (count <= 1) return (PADDING.left + width - PADDING.right) / 2;
  return PADDING.left + index * (width - PADDING.left - PADDING.right) / (count - 1);
}

function chartY(value: number, maximum: number): number {
  const ratio = Math.min(1, Math.max(0, value / maximum));
  return HEIGHT - PADDING.bottom - ratio * (HEIGHT - PADDING.top - PADDING.bottom);
}

function chartTicks(maximum: number): readonly number[] {
  return Array.from({ length: 5 }, (_, index) =>
    Math.round(maximum * index / 4)
  ).filter((value, index, values) => index === 0 || value !== values[index - 1]);
}

function showXAxisLabel(index: number, count: number, width: number): boolean {
  const labelCount = width < 480 ? 4 : width < 760 ? 5 : 6;
  if (count <= labelCount) return true;
  return Array.from({ length: labelCount }, (_, labelIndex) =>
    Math.round(labelIndex * (count - 1) / (labelCount - 1))
  ).includes(index);
}

function chartTooltipStyle(index: number, count: number): CSSProperties {
  if (count <= 1 || index < 0) {
    return { left: "50%" };
  }
  const ratio = index / (count - 1);
  if (ratio <= 0.18) {
    return { left: 8, transform: "none" };
  }
  if (ratio >= 0.82) {
    return { right: 8, transform: "none" };
  }
  return { left: `${ratio * 100}%` };
}

function pointAriaLabel(
  point: ProjectPositionHistoryPoint,
  tops: readonly ProjectPositionTopThreshold[], uiLocale: string = "ru-RU"
): string {
  return [
    formatChartDay(point.date, uiLocale),
    ...tops.map((top) =>
      `${seriesLabel(top, uiLocale)}: ${formatInteger(projectPositionTopValue(point, top), uiLocale)}`
    )
  ].join(". ");
}

function chartAriaLabel(
  points: readonly ProjectPositionHistoryPoint[],
  tops: readonly ProjectPositionTopThreshold[], uiLocale: string = "ru-RU"
): string {
  const latest = points.at(-1)!;
  return uiLocale.startsWith("en")
    ? `Ranking history across ${points.length} days. ${pointAriaLabel(latest, tops, uiLocale)}`
    : `Динамика позиций по ${points.length} дням. ${pointAriaLabel(latest, tops, uiLocale)}`;
}

function seriesLabel(
  threshold: ProjectPositionTopThreshold,
  uiLocale: string
): string {
  return `${uiLocale.startsWith("en") ? "Top" : "Топ"}-${threshold}`;
}

function formatChartDay(
  value: string,
  uiLocale: string = "ru-RU",
  compact = false
): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "2-digit",
    month: "short",
    ...(compact ? {} : { year: "numeric" as const }),
    timeZone: "UTC"
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale).format(value);
}

function formatCompactInteger(value: number, uiLocale: string = "ru-RU"): string {
  return new Intl.NumberFormat(uiLocale, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}
