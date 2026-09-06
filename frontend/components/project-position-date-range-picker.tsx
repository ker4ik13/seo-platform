"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectPositionHistoryDateRange } from "../lib/project-position-history";
import { Icon } from "./icon";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const DEFAULT_CUSTOM_RANGE_DAYS = 30;

type DateBoundary = "FROM" | "TO";

export function ProjectPositionDateRangePicker({
  active,
  availableRange,
  onApply,
  onOpenChange,
  onReset,
  open,
  value
}: Readonly<{
  active: boolean;
  availableRange: ProjectPositionHistoryDateRange;
  onApply: (range: ProjectPositionHistoryDateRange) => void;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  open: boolean;
  value?: ProjectPositionHistoryDateRange;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draftFrom, setDraftFrom] = useState(availableRange.from);
  const [draftTo, setDraftTo] = useState<string>();
  const [activeBoundary, setActiveBoundary] = useState<DateBoundary>("FROM");
  const multipleAvailableMonths = monthKey(availableRange.from) !==
    monthKey(availableRange.to);
  const [anchorMonth, setAnchorMonth] = useState(() =>
    initialAnchorMonth(availableRange, multipleAvailableMonths)
  );

  useEffect(() => {
    if (!open) return;
    const next = value ?? defaultCustomRange(availableRange);
    setDraftFrom(next.from);
    setDraftTo(next.to);
    setActiveBoundary("FROM");
    setAnchorMonth(initialAnchorMonth(availableRange, multipleAvailableMonths));
  }, [
    availableRange,
    multipleAvailableMonths,
    open,
    value
  ]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        onOpenChange(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  const months = useMemo(
    () => multipleAvailableMonths
      ? [anchorMonth, addMonths(anchorMonth, 1)]
      : [anchorMonth],
    [anchorMonth, multipleAvailableMonths]
  );
  const firstAvailableMonth = monthStart(availableRange.from);
  const lastAvailableMonth = monthStart(availableRange.to);
  const previousDisabled = multipleAvailableMonths
    ? compareMonths(addMonths(anchorMonth, 1), firstAvailableMonth) <= 0
    : true;
  const nextDisabled = multipleAvailableMonths
    ? compareMonths(addMonths(anchorMonth, 1), lastAvailableMonth) >= 0
    : true;
  const completeDraft = draftTo !== undefined;

  function selectDate(date: string): void {
    if (activeBoundary === "FROM") {
      setDraftFrom(date);
      setDraftTo((current) => current && current >= date ? current : undefined);
      setActiveBoundary("TO");
      return;
    }
    if (date < draftFrom) {
      setDraftFrom(date);
      setDraftTo(draftFrom);
    } else {
      setDraftTo(date);
    }
  }

  function editBoundary(boundary: DateBoundary): void {
    setActiveBoundary(boundary);
    const date = boundary === "FROM" ? draftFrom : draftTo;
    if (!date) return;
    const month = monthStart(date);
    setAnchorMonth(
      multipleAvailableMonths ? addMonths(month, -1) : month
    );
  }

  return (
    <div className="dashboard-date-range-control">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={active && value
          ? `Свой период: ${formatFullRange(value)}`
          : "Выбрать свой период"}
        aria-pressed={active}
        className={`dashboard-date-range-trigger${active ? " is-active" : ""}`}
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        type="button"
      >
        <Icon name="calendar" />
        <span>{active && value ? formatCompactRange(value) : "Свой период"}</span>
        <Icon className="dashboard-date-range-chevron" name="chevronDown" />
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            className="dashboard-date-range-backdrop"
            onPointerDown={() => onOpenChange(false)}
          />
          <div
            aria-label="Выбрать период графика"
            className="dashboard-date-range-popover"
            data-exclusive-dropdown-layer
            ref={panelRef}
            role="dialog"
          >
            <header className="dashboard-date-range-header">
              <div>
                <span>Период графика</span>
                <strong className="dashboard-date-range-month-label is-desktop">
                  {formatMonthRange(months)}
                </strong>
                <strong className="dashboard-date-range-month-label is-mobile">
                  {formatMonth(months.at(-1)!)}
                </strong>
              </div>
              <div className="dashboard-date-range-navigation">
                <button
                  aria-label="Предыдущий месяц"
                  disabled={previousDisabled}
                  onClick={() => setAnchorMonth((current) => addMonths(current, -1))}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
                <button
                  aria-label="Следующий месяц"
                  disabled={nextDisabled}
                  onClick={() => setAnchorMonth((current) => addMonths(current, 1))}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
                <button
                  aria-label="Закрыть выбор периода"
                  className="dashboard-date-range-close"
                  onClick={() => onOpenChange(false)}
                  type="button"
                >
                  <Icon name="close" />
                </button>
              </div>
            </header>

            <div className="dashboard-date-range-values">
              <button
                aria-pressed={activeBoundary === "FROM"}
                className={activeBoundary === "FROM" ? "is-active" : ""}
                onClick={() => editBoundary("FROM")}
                type="button"
              >
                <small>Начало</small>
                <strong>{formatSelectedDate(draftFrom)}</strong>
              </button>
              <span aria-hidden="true">→</span>
              <button
                aria-pressed={activeBoundary === "TO"}
                className={activeBoundary === "TO" ? "is-active" : ""}
                onClick={() => editBoundary("TO")}
                type="button"
              >
                <small>Конец</small>
                <strong>{draftTo ? formatSelectedDate(draftTo) : "Выберите дату"}</strong>
              </button>
            </div>

            <p aria-live="polite" className="dashboard-date-range-guidance">
              {activeBoundary === "FROM"
                ? "Выберите первый день периода"
                : draftTo
                  ? "Диапазон готов — можно применить"
                  : "Теперь выберите последний день периода"}
            </p>

            <div className="dashboard-date-range-calendars">
              {months.map((month, index) => (
                <CalendarMonth
                  availableRange={availableRange}
                  className={months.length === 1
                    ? "is-only"
                    : index === 0
                      ? "is-leading"
                      : "is-trailing"}
                  from={draftFrom}
                  key={monthKey(month)}
                  month={month}
                  onSelect={selectDate}
                  {...(draftTo ? { to: draftTo } : {})}
                />
              ))}
            </div>

            <footer className="dashboard-date-range-footer">
              <span>
                Доступные срезы: {formatSelectedDate(availableRange.from)} — {formatSelectedDate(availableRange.to)}
              </span>
              <div>
                <button
                  className="dashboard-date-range-reset"
                  onClick={() => {
                    onReset();
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  Вернуть 30 дней
                </button>
                <button
                  className="dashboard-date-range-apply"
                  disabled={!completeDraft}
                  onClick={() => {
                    if (!draftTo) return;
                    onApply({ from: draftFrom, to: draftTo });
                    onOpenChange(false);
                  }}
                  type="button"
                >
                  Применить
                </button>
              </div>
            </footer>
          </div>
        </>
      )}
    </div>
  );
}

function CalendarMonth({
  availableRange,
  className,
  from,
  month,
  onSelect,
  to
}: Readonly<{
  availableRange: ProjectPositionHistoryDateRange;
  className: string;
  from: string;
  month: Date;
  onSelect: (date: string) => void;
  to?: string;
}>) {
  const days = calendarDays(month);
  const today = dateKey(new Date());
  return (
    <section
      aria-label={formatMonth(month)}
      className={`dashboard-calendar-month ${className}`}
    >
      <strong>{formatMonth(month)}</strong>
      <div aria-hidden="true" className="dashboard-calendar-weekdays">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="dashboard-calendar-days">
        {days.map((day) => {
          if (!day.inMonth) {
            return <span aria-hidden="true" key={day.key} />;
          }
          const disabled = day.key < availableRange.from ||
            day.key > availableRange.to;
          const rangeEnd = to ?? from;
          const inRange = day.key >= from && day.key <= rangeEnd;
          const rangeStart = day.key === from;
          const rangeFinish = day.key === to;
          return (
            <button
              aria-current={day.key === today ? "date" : undefined}
              aria-label={formatAccessibleDate(day.key)}
              aria-pressed={rangeStart || rangeFinish}
              className={[
                inRange ? "is-in-range" : "",
                rangeStart ? "is-range-start" : "",
                rangeFinish ? "is-range-end" : "",
                day.key === today ? "is-today" : ""
              ].filter(Boolean).join(" ")}
              data-date-key={day.key}
              disabled={disabled}
              key={day.key}
              onClick={() => onSelect(day.key)}
              type="button"
            >
              {day.date.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function calendarDays(month: Date): readonly Readonly<{
  date: Date;
  inMonth: boolean;
  key: string;
}>[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const leading = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      first.getFullYear(),
      first.getMonth(),
      1 - leading + index,
      12
    );
    return {
      date,
      inMonth: date.getMonth() === first.getMonth(),
      key: dateKey(date)
    };
  });
}

function defaultCustomRange(
  availableRange: ProjectPositionHistoryDateRange
): ProjectPositionHistoryDateRange {
  const candidate = dateKey(addDays(dateFromKey(availableRange.to), -(DEFAULT_CUSTOM_RANGE_DAYS - 1)));
  return {
    from: candidate < availableRange.from ? availableRange.from : candidate,
    to: availableRange.to
  };
}

function initialAnchorMonth(
  range: ProjectPositionHistoryDateRange,
  multipleMonths: boolean
): Date {
  const latest = monthStart(range.to);
  return multipleMonths ? addMonths(latest, -1) : latest;
}

function monthStart(value: string): Date;
function monthStart(value: Date): Date;
function monthStart(value: string | Date): Date {
  const date = typeof value === "string" ? dateFromKey(value) : value;
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1, 12);
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount, 12);
}

function compareMonths(left: Date, right: Date): number {
  return left.getFullYear() * 12 + left.getMonth() -
    (right.getFullYear() * 12 + right.getMonth());
}

function monthKey(value: string): string;
function monthKey(value: Date): string;
function monthKey(value: string | Date): string {
  const date = typeof value === "string" ? dateFromKey(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

function dateKey(value: Date): string {
  return [
    String(value.getFullYear()).padStart(4, "0"),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}

function formatMonth(value: Date): string {
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(value);
  return formatted.charAt(0).toLocaleUpperCase("ru-RU") + formatted.slice(1);
}

function formatMonthRange(months: readonly Date[]): string {
  if (months.length === 1) return formatMonth(months[0]!);
  const [first, second] = months;
  if (first!.getFullYear() === second!.getFullYear()) {
    const left = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(first);
    const right = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric"
    }).format(second);
    const result = `${left} — ${right}`;
    return result.charAt(0).toLocaleUpperCase("ru-RU") + result.slice(1);
  }
  return `${formatMonth(first!)} — ${formatMonth(second!)}`;
}

function formatSelectedDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(dateFromKey(value));
}

function formatAccessibleDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long"
  }).format(dateFromKey(value));
}

function formatCompactRange(range: ProjectPositionHistoryDateRange): string {
  const from = dateFromKey(range.from);
  const to = dateFromKey(range.to);
  const format = (value: Date, withYear: boolean) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      ...(withYear ? { year: "2-digit" } : {})
    }).format(value);
  const differentYear = from.getFullYear() !== to.getFullYear();
  return `${format(from, differentYear)} — ${format(to, differentYear)}`;
}

function formatFullRange(range: ProjectPositionHistoryDateRange): string {
  return `${formatSelectedDate(range.from)} — ${formatSelectedDate(range.to)}`;
}
