"use client";

import type { SemanticKeywordPositionHistoryPoint } from "@seo-platform/contracts";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import {
  rankEngineLabel,
  rankHistoryProviderLabel,
  rankSearchSystemLabel,
  semanticRankHistoryByEngine
} from "../lib/semantic-rank-presentation";
import { Icon } from "./icon";
import { ProviderLogo } from "./provider-logo";
import { SearchEngineLogo } from "./search-engine-logo";
import { UiText, useUiLocale } from "./ui-locale";


const WIDTH = 380;
const HEIGHT = 170;
const PADDING = { top: 14, right: 12, bottom: 28, left: 30 } as const;
const MISSING_Y = HEIGHT - PADDING.bottom;
const POSITION_PLOT_BOTTOM = MISSING_Y - 18;

interface RankSeries {
  readonly key: string;
  readonly label: string;
  readonly searchEngine: "GOOGLE" | "YANDEX";
  readonly points: readonly SemanticKeywordPositionHistoryPoint[];
}

interface PlottedRankPoint {
  readonly color: string;
  readonly point: SemanticKeywordPositionHistoryPoint;
  readonly series: RankSeries;
  readonly x: number;
  readonly y: number;
}

export function SemanticRankHistoryChart({
  points
}: Readonly<{
  points: readonly SemanticKeywordPositionHistoryPoint[];
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const series = useMemo(() => rankSeries(points), [points]);
  const [hoveredSnapshotId, setHoveredSnapshotId] = useState<string>();
  const [focusedSnapshotId, setFocusedSnapshotId] = useState<string>();
  const svgRef = useRef<SVGSVGElement>(null);
  const timelinePoints = series.flatMap((entry) => entry.points);
  const visiblePoints = series.flatMap(({ points: entryPoints }) =>
    entryPoints.filter(isPositionPoint)
  );
  if (timelinePoints.length === 0) {
    return (
      <div className="semantic-rank-chart-empty">
        <strong><UiText text="История пока не накоплена" /></strong>
        <span><UiText text="График появится после первого сохранённого замера позиции." /></span>
      </div>
    );
  }
  const times = timelinePoints.map(({ observedAt }) =>
    new Date(observedAt).getTime()
  );
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxPosition = Math.max(
    10,
    ...visiblePoints.map(({ position }) => position)
  );
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = POSITION_PLOT_BOTTOM - PADDING.top;
  const x = (value: string): number => {
    const time = new Date(value).getTime();
    return PADDING.left + (maxTime === minTime
      ? plotWidth / 2
      : (time - minTime) / (maxTime - minTime) * plotWidth);
  };
  const y = (position: number): number =>
    PADDING.top + (position - 1) / Math.max(1, maxPosition - 1) * plotHeight;
  const pointY = (point: SemanticKeywordPositionHistoryPoint): number =>
    isPositionPoint(point) ? y(point.position) : MISSING_Y;
  const guides = [1, Math.max(2, Math.round(maxPosition / 2)), maxPosition];
  const plottedPoints: readonly PlottedRankPoint[] = series.flatMap((entry) =>
    entry.points.map((point) => ({
      color: seriesColor(entry.searchEngine),
      point,
      series: entry,
      x: x(point.observedAt),
      y: pointY(point)
    }))
  );
  const activeSnapshotId = focusedSnapshotId ?? hoveredSnapshotId;
  const activePoint = plottedPoints.find(
    ({ point }) => point.snapshotId === activeSnapshotId
  );

  function snapToNearestPoint(event: ReactPointerEvent<SVGSVGElement>): void {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const local = cursor.matrixTransform(matrix.inverse());
    if (
      local.x < PADDING.left - 8 ||
      local.x > WIDTH - PADDING.right + 8 ||
      local.y < PADDING.top - 8 ||
      local.y > MISSING_Y + 8
    ) {
      setHoveredSnapshotId(undefined);
      return;
    }
    const nearest = plottedPoints.reduce<PlottedRankPoint | undefined>(
      (current, candidate) => {
        if (!current) return candidate;
        return pointDistance(candidate, local.x, local.y) <
          pointDistance(current, local.x, local.y)
          ? candidate
          : current;
      },
      undefined
    );
    setHoveredSnapshotId(nearest?.point.snapshotId);
  }

  return (
    <div className="semantic-rank-chart">
      <div className="semantic-rank-chart-canvas">
        <svg
          aria-label={uiText("Интерактивный график истории позиций. Чем выше линия, тем лучше позиция. Наведите курсор или перейдите по точкам клавишей Tab, чтобы узнать детали съёма.")}
          onPointerLeave={() => setHoveredSnapshotId(undefined)}
          onPointerMove={snapToNearestPoint}
          preserveAspectRatio="xMidYMid meet"
          ref={svgRef}
          role="group"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {guides.map((position) => (
            <g key={position}>
              <line
                className="semantic-rank-chart-guide"
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y(position)}
                y2={y(position)}
              />
              <text className="semantic-rank-chart-axis" x={PADDING.left - 7} y={y(position) + 3}>{position}</text>
            </g>
          ))}
          <line
            className="semantic-rank-chart-missing-guide"
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={MISSING_Y}
            y2={MISSING_Y}
          />
          <text className="semantic-rank-chart-axis missing" x={PADDING.left - 7} y={MISSING_Y + 3}><UiText text="нет" /></text>
          {series.map((entry) => {
            const positioned = entry.points.filter(isPositionPoint);
            const color = seriesColor(entry.searchEngine);
            return (
              <g key={entry.key}>
                {positionSegments(entry.points).map((segment, segmentIndex) =>
                  segment.length > 1 && (
                    <polyline
                      fill="none"
                      key={`${entry.key}:segment:${segmentIndex}`}
                      points={segment.map((point) =>
                        `${x(point.observedAt)},${y(point.position)}`
                      ).join(" ")}
                      stroke={color}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                {missingTransitions(entry.points).map(([from, to]) => (
                  <line
                    className="semantic-rank-chart-gap"
                    key={`${entry.key}:gap:${from.snapshotId}:${to.snapshotId}`}
                    stroke={color}
                    x1={x(from.observedAt)}
                    x2={x(to.observedAt)}
                    y1={pointY(from)}
                    y2={pointY(to)}
                  />
                ))}
                {positioned.map((point) => (
                  <circle
                    cx={x(point.observedAt)}
                    cy={y(point.position)}
                    fill={color}
                    key={point.snapshotId}
                    r="3.5"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {entry.points.filter((point) => !isPositionPoint(point)).map((point) => {
                  const markerX = x(point.observedAt);
                  return (
                    <g className="semantic-rank-chart-missing" key={point.snapshotId}>
                      <circle cx={markerX} cy={MISSING_Y} r="5" />
                      <line x1={markerX - 2.5} x2={markerX + 2.5} y1={MISSING_Y - 2.5} y2={MISSING_Y + 2.5} />
                      <line x1={markerX + 2.5} x2={markerX - 2.5} y1={MISSING_Y - 2.5} y2={MISSING_Y + 2.5} />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {activePoint && (
            <g aria-hidden="true" className="semantic-rank-chart-active">
              <line x1={activePoint.x} x2={activePoint.x} y1={PADDING.top} y2={MISSING_Y} />
              <circle cx={activePoint.x} cy={activePoint.y} fill={activePoint.color} r="6" />
            </g>
          )}
          {plottedPoints.map((plotted) => (
            <circle
              aria-label={pointAriaLabel(plotted, uiLocale)}
              className="semantic-rank-chart-hit"
              cx={plotted.x}
              cy={plotted.y}
              fill="transparent"
              key={`hit:${plotted.point.snapshotId}`}
              onBlur={() => setFocusedSnapshotId(undefined)}
              onFocus={() => setFocusedSnapshotId(plotted.point.snapshotId)}
              onPointerDown={() => setHoveredSnapshotId(plotted.point.snapshotId)}
              r="10"
              tabIndex={0}
            />
          ))}
          <text className="semantic-rank-chart-date" x={PADDING.left} y={HEIGHT - 6}>{formatDate(new Date(minTime).toISOString(), uiLocale)}</text>
          <text className="semantic-rank-chart-date end" x={WIDTH - PADDING.right} y={HEIGHT - 6}>{formatDate(new Date(maxTime).toISOString(), uiLocale)}</text>
        </svg>
        {activePoint && <RankPointTooltip plotted={activePoint} svgRef={svgRef} />}
      </div>
      <div className="semantic-rank-chart-legend">
        {series.map((entry) => (
          <span key={entry.key}>
            <SearchEngineLogo engine={entry.searchEngine} size="compact" />
            <i style={{ background: seriesColor(entry.searchEngine) }} />
            <span>{entry.label}</span>
          </span>
        ))}
        <span className="missing"><b>×</b><span><UiText text="Позиция не найдена" /></span></span>
      </div>
    </div>
  );
}

function RankPointTooltip({
  plotted,
  svgRef
}: Readonly<{
  plotted: PlottedRankPoint;
  svgRef: RefObject<SVGSVGElement | null>;
}>) {
  const uiLocale = useUiLocale().locale;
  const { point, series, x, y } = plotted;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [viewportPosition, setViewportPosition] = useState<Readonly<{
    left: number;
    top: number;
  }>>();
  const position = isPositionPoint(point) ? String(point.position) : "Не найдена";
  const region = point.regionLabel?.trim() || point.regionCode || point.countryCode || "—";

  useLayoutEffect(() => {
    const updatePosition = () => {
      const svg = svgRef.current;
      const tooltip = tooltipRef.current;
      const matrix = svg?.getScreenCTM();
      if (!svg || !tooltip || !matrix) return;
      const anchor = svg.createSVGPoint();
      anchor.x = x;
      anchor.y = y;
      const screen = anchor.matrixTransform(matrix);
      const bounds = tooltip.getBoundingClientRect();
      const edge = 8;
      const gap = 10;
      const roomOnRight = window.innerWidth - screen.x;
      const preferredLeft = roomOnRight >= bounds.width + gap + edge
        ? screen.x + gap
        : screen.x - bounds.width - gap;
      const maxLeft = Math.max(edge, window.innerWidth - bounds.width - edge);
      const maxTop = Math.max(edge, window.innerHeight - bounds.height - edge);
      setViewportPosition({
        left: Math.min(maxLeft, Math.max(edge, preferredLeft)),
        top: Math.min(maxTop, Math.max(edge, screen.y - bounds.height / 2))
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (tooltipRef.current) observer.observe(tooltipRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [svgRef, x, y]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`semantic-rank-chart-tooltip${point.found ? "" : " missing"}`}
      ref={tooltipRef}
      role="tooltip"
      style={{
        left: viewportPosition?.left ?? 0,
        top: viewportPosition?.top ?? 0,
        visibility: viewportPosition ? "visible" : "hidden"
      }}
    >
      <header>
        <SearchEngineLogo engine={series.searchEngine} size="compact" />
        <strong>{<UiText text={rankSearchSystemLabel(series.searchEngine, point.searchSource) ?? ""} />}</strong>
        <span>{position}</span>
      </header>
      <dl>
        <div>
          <dt><UiText text="Провайдер" /></dt>
          <dd>
            {point.provider === "KEY_COLLECTOR" || point.provider === "MANUAL_IMPORT" ? (
              <span
                aria-label="Key Collector"
                className="semantic-rank-import-provider-icon"
                role="img"
              >
                <Icon name="import" />
              </span>
            ) : (
              <ProviderLogo provider={point.provider} size="compact" />
            )}
            {<UiText text={rankHistoryProviderLabel(point.provider) ?? ""} />}
          </dd>
        </div>
        <div>
          <dt><UiText text="Дата и время" /></dt>
          <dd><time dateTime={point.observedAt}>{formatDateTime(point.observedAt, uiLocale)}</time></dd>
        </div>
        <div>
          <dt><UiText text="Регион" /></dt>
          <dd>{region}</dd>
        </div>
        <div>
          <dt><UiText text="Устройство" /></dt>
          <dd>{<UiText text={deviceLabel(point.device) ?? ""} />}{point.depth ? <UiText text="· Топ-{0}" values={[String(point.depth)]} before=" " /> : ""}</dd>
        </div>
      </dl>
      <small>{point.contextName}</small>
    </div>,
    document.body
  );
}

function positionSegments(
  points: readonly SemanticKeywordPositionHistoryPoint[]
): readonly (readonly (SemanticKeywordPositionHistoryPoint & { readonly position: number })[])[] {
  const segments: (SemanticKeywordPositionHistoryPoint & { readonly position: number })[][] = [];
  let current: (SemanticKeywordPositionHistoryPoint & { readonly position: number })[] = [];
  for (const point of points) {
    if (isPositionPoint(point)) {
      current.push(point);
      continue;
    }
    if (current.length > 0) segments.push(current);
    current = [];
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function missingTransitions(
  points: readonly SemanticKeywordPositionHistoryPoint[]
): readonly (readonly [
  SemanticKeywordPositionHistoryPoint,
  SemanticKeywordPositionHistoryPoint
])[] {
  const transitions: [
    SemanticKeywordPositionHistoryPoint,
    SemanticKeywordPositionHistoryPoint
  ][] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from && to && (!isPositionPoint(from) || !isPositionPoint(to))) {
      transitions.push([from, to]);
    }
  }
  return transitions;
}

function rankSeries(
  points: readonly SemanticKeywordPositionHistoryPoint[]
): readonly RankSeries[] {
  return semanticRankHistoryByEngine(points).map((series) => ({
    key: series.searchEngine,
    label: rankEngineLabel(series.searchEngine),
    searchEngine: series.searchEngine,
    points: series.points
  }));
}

function isPositionPoint(
  point: SemanticKeywordPositionHistoryPoint
): point is SemanticKeywordPositionHistoryPoint & { readonly position: number } {
  return point.found && typeof point.position === "number";
}

function seriesColor(engine: "GOOGLE" | "YANDEX"): string {
  return engine === "YANDEX" ? "#ef4444" : "#5b43f5";
}

function pointDistance(
  plotted: PlottedRankPoint,
  x: number,
  y: number
): number {
  return (plotted.x - x) ** 2 + (plotted.y - y) ** 2;
}

function pointAriaLabel({ point, series }: PlottedRankPoint, uiLocale: string = "ru-RU"): string {
  const status = isPositionPoint(point)
    ? `позиция ${point.position}`
    : "позиция не найдена";
  return `${rankSearchSystemLabel(series.searchEngine, point.searchSource)}, ${status}, ${rankHistoryProviderLabel(point.provider)}, ${formatDateTime(point.observedAt, uiLocale)}`;
}

function deviceLabel(device: "DESKTOP" | "MOBILE"): string {
  return device === "DESKTOP" ? "Десктоп" : "Мобильное";
}

function formatDate(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        day: "2-digit",
        month: "2-digit"
      }).format(date);
}

function formatDateTime(value: string, uiLocale: string = "ru-RU"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(uiLocale, {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        year: "numeric"
      }).format(date);
}
