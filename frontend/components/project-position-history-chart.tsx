"use client";

import {
  projectPositionHistoryDefaultSlices,
  projectPositionTopThresholds,
  type ProjectPositionHistory,
  type ProjectPositionHistoryPoint,
  type ProjectPositionTopThreshold
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
import { Icon } from "./icon";

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
  history,
  includeUntracked,
  onIncludeUntrackedChange,
  scopeError,
  scopeLoading
}: Readonly<{
  history: ProjectPositionHistory;
  includeUntracked: boolean;
  onIncludeUntrackedChange: (includeUntracked: boolean) => void;
  scopeError?: string;
  scopeLoading: boolean;
}>) {
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
      <div className="dashboard-position-controls">
        <div aria-label="Период графика" className="dashboard-chart-button-group" role="group">
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
              {projectPositionHistoryPeriodLabel(value)}
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
        <div aria-label="Область запросов и показываемые диапазоны позиций" className="dashboard-top-filters" role="group">
          <button
            aria-busy={scopeLoading}
            aria-pressed={includeUntracked}
            className={`dashboard-untracked-filter${includeUntracked ? " is-active" : ""}`}
            disabled={scopeLoading}
            onClick={() => onIncludeUntrackedChange(!includeUntracked)}
            title={includeUntracked
              ? "Неотслеживаемые запросы учитываются в ТОПах"
              : "Учитывать в ТОПах активные неотслеживаемые запросы"}
            type="button"
          >
            {scopeLoading ? (
              <span aria-hidden="true" className="dashboard-chart-scope-spinner" />
            ) : (
              <Icon name={includeUntracked ? "eye" : "eyeOff"} />
            )}
            <span>{scopeLoading ? "Загружаем…" : "Неотслеживаемые"}</span>
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
                {SERIES[top].label}
              </button>
            );
          })}
        </div>
      </div>

      {scopeError && (
        <div className="dashboard-chart-scope-error" role="alert">
          <span>{scopeError}</span>
          <button
            onClick={() => onIncludeUntrackedChange(true)}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      {points.length === 0 ? (
        <div className="dashboard-chart-period-empty" role="status">
          <strong>{history.points.length === 0
            ? includeUntracked
              ? "Срезов позиций пока нет"
              : "По отслеживаемым запросам срезов пока нет"
            : "В выбранном периоде съёмов нет"}</strong>
          <span>{history.points.length === 0
            ? includeUntracked
              ? "Запустите новую проверку позиций."
              : "Можно включить неотслеживаемые запросы или запустить новый съём."
            : "Выберите больший период или запустите новую проверку позиций."}</span>
        </div>
      ) : (
        <div className="dashboard-position-plot" ref={plotRef}>
          {activePoint && (
            <div
              className="dashboard-position-tooltip"
              style={chartTooltipStyle(activeIndex, points.length)}
            >
              <strong>{formatChartDateTime(activePoint.observedAt)}</strong>
              <span>{formatInteger(activePoint.positionedKeywordCount)} запросов с позицией</span>
              <div>
                {selectedSeries.map((top) => (
                  <span key={top}>
                    <i style={{ background: SERIES[top].color }} />
                    {SERIES[top].label}: <b>{formatInteger(projectPositionTopValue(activePoint, top))}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <svg
            aria-label={chartAriaLabel(points, selectedSeries)}
            onMouseLeave={() => setActivePointId(undefined)}
            role="img"
            viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
          >
            {yTicks.map((tick) => {
              const y = chartY(tick, maximum);
              return (
                <g className="dashboard-chart-grid" key={tick}>
                  <line x1={PADDING.left} x2={chartWidth - PADDING.right} y1={y} y2={y} />
                  <text x={10} y={y + 4}>{formatCompactInteger(tick)}</text>
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
                      {formatChartDate(point.observedAt)}
                    </text>
                  )}
                  <rect
                    aria-label={pointAriaLabel(point, selectedSeries)}
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
          ? "Количество всех активных запросов в выбранном ТОПе"
          : "Количество отслеживаемых запросов в выбранном ТОПе"}</span>
        <span>
          До {projectPositionHistoryDefaultSlices} срезов
          {history.truncated ? " · более ранняя история скрыта" : ""}
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
  tops: readonly ProjectPositionTopThreshold[]
): string {
  return [
    formatChartDateTime(point.observedAt),
    ...tops.map((top) =>
      `${SERIES[top].label}: ${formatInteger(projectPositionTopValue(point, top))}`
    )
  ].join(". ");
}

function chartAriaLabel(
  points: readonly ProjectPositionHistoryPoint[],
  tops: readonly ProjectPositionTopThreshold[]
): string {
  const latest = points.at(-1)!;
  return `Динамика позиций по ${points.length} срезам. ${pointAriaLabel(latest, tops)}`;
}

function formatChartDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short"
  }).format(new Date(value));
}

function formatChartDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatCompactInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}
