"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectPositionHistoryDateRange } from "../lib/project-position-history";
import { Icon } from "./icon";
import { useUiLocale, UiText } from "./ui-locale";


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
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
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
        aria-label={active && value ? uiText("Свой период: {0}", [String(formatFullRange(value, uiLocale))]) : uiText("Выбрать свой период")}
        aria-pressed={active}
        className={`dashboard-date-range-trigger${active ? " is-active" : ""}`}
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        type="button"
      >
        <Icon name="calendar" />
        <span>{active && value ? formatCompactRange(value, uiLocale) : <UiText text="Свой период" />}</span>
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
            aria-label={uiText("Выбрать период графика")}
            className="dashboard-date-range-popover"
            data-exclusive-dropdown-layer
            ref={panelRef}
            role="dialog"
          >
            <header className="dashboard-date-range-header">
              <div>
                <span><UiText text="Период графика" /></span>
                <strong className="dashboard-date-range-month-label is-desktop">
                  {formatMonthRange(months, uiLocale)}
                </strong>
                <strong className="dashboard-date-range-month-label is-mobile">
                  {formatMonth(months.at(-1)!, uiLocale)}
                </strong>
              </div>
              <div className="dashboard-date-range-navigation">
                <button
                  aria-label={uiText("Предыдущий месяц")}
                  disabled={previousDisabled}
                  onClick={() => setAnchorMonth((current) => addMonths(current, -1))}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
                <button
                  aria-label={uiText("Следующий месяц")}
                  disabled={nextDisabled}
                  onClick={() => setAnchorMonth((current) => addMonths(current, 1))}
                  type="button"
                >
                  <Icon name="chevronRight" />
                </button>
                <button
                  aria-label={uiText("Закрыть выбор периода")}
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
                <small><UiText text="Начало" /></small>
                <strong>{formatSelectedDate(draftFrom, uiLocale)}</strong>
              </button>
              <span aria-hidden="true">→</span>
              <button
                aria-pressed={activeBoundary === "TO"}
                className={activeBoundary === "TO" ? "is-active" : ""}
                onClick={() => editBoundary("TO")}
                type="button"
              >
                <small><UiText text="Конец" /></small>
                <strong>{draftTo ? formatSelectedDate(draftTo, uiLocale) : <UiText text="Выберите дату" />}</strong>
              </button>
            </div>

            <p aria-live="polite" className="dashboard-date-range-guidance">
              {activeBoundary === "FROM"
                ? <UiText text="Выберите первый день периода" />
                : draftTo
                  ? <UiText text="Диапазон готов — можно применить" />
                  : <UiText text="Теперь выберите последний день периода" />}
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
                <UiText text="Доступные срезы:" after=" " />{formatSelectedDate(availableRange.from, uiLocale)} — {formatSelectedDate(availableRange.to, uiLocale)}
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
                  <UiText text="Вернуть 30 дней" /></button>
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
                  <UiText text="Применить" /></button>
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
  const uiLocale = useUiLocale().locale;
  const days = calendarDays(month);
  const today = dateKey(new Date());
  return (
    <section
      aria-label={formatMonth(month, uiLocale)}
      className={`dashboard-calendar-month ${className}`}
    >
      <strong>{formatMonth(month, uiLocale)}</strong>
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
              aria-label={formatAccessibleDate(day.key, uiLocale)}
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

function formatMonth(value: Date, uiLocale: string = "ru-RU"): string {
  const formatted = new Intl.DateTimeFormat(uiLocale, {
    month: "long",
    year: "numeric"
  }).format(value);
  return formatted.charAt(0).toLocaleUpperCase("ru-RU") + formatted.slice(1);
}

function formatMonthRange(months: readonly Date[], uiLocale: string = "ru-RU"): string {
  if (months.length === 1) return formatMonth(months[0]!, uiLocale);
  const [first, second] = months;
  if (first!.getFullYear() === second!.getFullYear()) {
    const left = new Intl.DateTimeFormat(uiLocale, { month: "long" }).format(first);
    const right = new Intl.DateTimeFormat(uiLocale, {
      month: "long",
      year: "numeric"
    }).format(second);
    const result = `${left} — ${right}`;
    return result.charAt(0).toLocaleUpperCase("ru-RU") + result.slice(1);
  }
  return `${formatMonth(first!, uiLocale)} — ${formatMonth(second!, uiLocale)}`;
}

function formatSelectedDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(dateFromKey(value));
}

function formatAccessibleDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long"
  }).format(dateFromKey(value));
}

function formatCompactRange(range: ProjectPositionHistoryDateRange, uiLocale: string = "ru-RU"): string {
  const from = dateFromKey(range.from);
  const to = dateFromKey(range.to);
  const format = (value: Date, withYear: boolean, uiLocale: string = "ru-RU") =>
    new Intl.DateTimeFormat(uiLocale, {
      day: "2-digit",
      month: "short",
      ...(withYear ? { year: "2-digit" } : {})
    }).format(value);
  const differentYear = from.getFullYear() !== to.getFullYear();
  return `${format(from, differentYear, uiLocale)} — ${format(to, differentYear, uiLocale)}`;
}

function formatFullRange(range: ProjectPositionHistoryDateRange, uiLocale: string = "ru-RU"): string {
  return `${formatSelectedDate(range.from, uiLocale)} — ${formatSelectedDate(range.to, uiLocale)}`;
}
