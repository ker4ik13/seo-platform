"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dateRangePopoverPosition } from "../lib/date-range-popover-position";
import {
  dateRangePreset,
  selectDateRangeDay,
} from "../lib/date-range-selection";
import { CalendarMonth } from "./calendar-month";
import { dateKey, dateFromKey, formatMonth } from "../lib/calendar";
import { Icon } from "./icon";
import {
  calendarToday,
  clearCalendarRangeSession,
  readCalendarRangeSession,
  sessionCalendarRange,
  writeCalendarRangeSession,
  type CalendarRangeSession,
} from "../lib/date-range-session";
import { useUiLocale, UiText } from "./ui-locale";


const DEFAULT_CUSTOM_RANGE_DAYS = 30;

export interface CustomDateRangeValue {
  readonly from: string;
  readonly to: string;
}

export function CustomDateRangePicker({
  active,
  alwaysShowYear = false,
  availableRange,
  className,
  dialogLabel = "Выбрать период графика",
  disabled = false,
  followToday = true,
  modal = false,
  onApply,
  onOpenChange,
  onReset,
  open,
  periodLabel = "",
  rangeLabel = "Доступные срезы:",
  resetLabel = "Вернуть 30 дней",
  sessionKey,
  triggerLabel = "Свой период",
  value,
}: Readonly<{
  active: boolean;
  alwaysShowYear?: boolean;
  availableRange: CustomDateRangeValue;
  className?: string;
  dialogLabel?: string;
  disabled?: boolean;
  followToday?: boolean;
  modal?: boolean;
  onApply: (range: CustomDateRangeValue) => void;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  open: boolean;
  periodLabel?: string;
  rangeLabel?: string;
  resetLabel?: string;
  sessionKey?: string;
  triggerLabel?: string;
  value?: CustomDateRangeValue;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPosition, setPanelPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const wasOpen = useRef(false);
  const acceptedSession = useRef<CalendarRangeSession | undefined>(undefined);
  const effectiveRange = followToday
    ? { from: availableRange.from, to: calendarToday() }
    : availableRange;
  const availableFrom = availableRange.from;
  const availableTo = effectiveRange.to;
  const valueFrom = value?.from;
  const valueTo = value?.to;
  const [draftFrom, setDraftFrom] = useState(availableRange.from);
  const [draftTo, setDraftTo] = useState(availableRange.to);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const multipleAvailableMonths =
    monthKey(availableRange.from) !== monthKey(availableTo);
  const [anchorMonth, setAnchorMonth] = useState(() =>
    initialAnchorMonth(availableRange, multipleAvailableMonths),
  );

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    let stored: CalendarRangeSession | undefined;
    try {
      stored = sessionKey
        ? readCalendarRangeSession(window.sessionStorage, sessionKey)
        : undefined;
    } catch {
      stored = acceptedSession.current;
    }
    const selected =
      valueFrom && valueTo
        ? { from: valueFrom, to: valueTo }
        : (stored ??
          defaultCustomRange({ from: availableFrom, to: availableTo }));
    const next = sessionCalendarRange({
      value: selected,
      available: { from: availableFrom, to: availableTo },
      session: stored ?? acceptedSession.current,
      today: calendarToday(),
      followToday,
    });
    setDraftFrom(next.from);
    setDraftTo(next.to);
    setSelectingEnd(false);
    setAnchorMonth(initialAnchorMonth(next, multipleAvailableMonths));
  }, [
    availableFrom,
    availableTo,
    multipleAvailableMonths,
    open,
    valueFrom,
    valueTo,
    sessionKey,
    followToday,
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

  useEffect(() => {
    if (disabled && open) onOpenChange(false);
  }, [disabled, onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const reposition = () => {
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      const position = dateRangePopoverPosition({
        anchor: anchor.getBoundingClientRect(),
        height: panel.scrollHeight + 2,
        viewport,
        mode: window.innerWidth <= 680 ? "SHEET" : modal ? "CENTERED" : "ANCHORED",
      });
      setPanelPosition({ ...position, bottom: "auto", right: "auto", transform: "none" });
    };
    reposition();
    const followScroll = (event: Event) => {
      // Scrolling the calendar itself does not move its anchor.
      if (event.target instanceof Node && panel.contains(event.target)) return;
      reposition();
    };
    const observer = new ResizeObserver(reposition);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", followScroll, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", followScroll, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [modal, open]);

  const months = useMemo(
    () =>
      multipleAvailableMonths
        ? [anchorMonth, addMonths(anchorMonth, 1)]
        : [anchorMonth],
    [anchorMonth, multipleAvailableMonths],
  );
  const firstAvailableMonth = monthStart(availableRange.from);
  const lastAvailableMonth = monthStart(availableTo);
  const previousDisabled = multipleAvailableMonths
    ? compareMonths(addMonths(anchorMonth, 1), firstAvailableMonth) <= 0
    : true;
  const nextDisabled = multipleAvailableMonths
    ? compareMonths(addMonths(anchorMonth, 1), lastAvailableMonth) >= 0
    : true;
  const completeDraft = Boolean(draftFrom && draftTo);

  function selectDate(date: string): void {
    const next = selectDateRangeDay(
      {
        from: draftFrom,
        to: draftTo,
        selectingEnd,
      },
      date,
    );
    setDraftFrom(next.from);
    setDraftTo(next.to);
    setSelectingEnd(next.selectingEnd);
  }

  function selectPreset(days: number): void {
    const range = dateRangePreset(effectiveRange, days);
    setDraftFrom(range.from);
    setDraftTo(range.to);
    setSelectingEnd(false);
    const month = monthStart(range.to);
    setAnchorMonth(multipleAvailableMonths ? addMonths(month, -1) : month);
  }

  return (
    <div
      className={`dashboard-date-range-control custom-date-range${className ? ` ${className}` : ""}`}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          active && value
            ? `${uiText(triggerLabel)}: ${formatFullRange(value, uiLocale)}`
            : uiText(dialogLabel)
        }
        aria-pressed={active}
        className={`dashboard-date-range-trigger${active ? " is-active" : ""}`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        ref={triggerRef}
        type="button"
      >
        <Icon name="calendar" />
        <span>
          {active && value ? (
            formatCompactRange(value, uiLocale, alwaysShowYear)
          ) : (
            <UiText text={triggerLabel} />
          )}
        </span>
        <Icon className="dashboard-date-range-chevron" name="chevronDown" />
      </button>

      {open && (
        <DateRangeLayerPortal anchor={triggerRef.current}>
          <div className={`custom-date-range-layer${modal ? " is-modal" : ""}`}>
            <div
              aria-hidden="true"
              className="dashboard-date-range-backdrop"
              onPointerDown={() => onOpenChange(false)}
            />
            <div
              aria-label={uiText(dialogLabel)}
              className="dashboard-date-range-popover"
              data-exclusive-dropdown-layer
              ref={panelRef}
              role="dialog"
              style={panelPosition}
            >
              <header className="dashboard-date-range-header">
                <div>
                  {periodLabel && (
                    <span>
                      <UiText text={periodLabel} />
                    </span>
                  )}
                  <strong className="dashboard-date-range-month-label is-desktop">
                    {formatMonthRange(months, uiLocale)}
                  </strong>
                  <strong className="dashboard-date-range-month-label is-mobile">
                    {formatMonth(months.at(-1)!, uiLocale)}
                  </strong>
                  <small className="dashboard-date-range-available">
                    <UiText text={rangeLabel} after=" " />
                    {formatSelectedDate(availableRange.from, uiLocale)} —{" "}
                    {formatSelectedDate(availableTo, uiLocale)}
                  </small>
                </div>
                <div className="dashboard-date-range-navigation">
                  <button
                    aria-label={uiText("Предыдущий месяц")}
                    disabled={previousDisabled}
                    onClick={() =>
                      setAnchorMonth((current) => addMonths(current, -1))
                    }
                    type="button"
                  >
                    <Icon name="chevronRight" />
                  </button>
                  <button
                    aria-label={uiText("Следующий месяц")}
                    disabled={nextDisabled}
                    onClick={() =>
                      setAnchorMonth((current) => addMonths(current, 1))
                    }
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
                <div
                  className="dashboard-date-range-value"
                  data-date-bound="from"
                >
                  <small>
                    <UiText text="От" />
                  </small>
                  <strong>
                    <time dateTime={draftFrom}>
                      {formatSelectedDate(draftFrom, uiLocale)}
                    </time>
                  </strong>
                </div>
                <span aria-hidden="true">→</span>
                <div
                  className="dashboard-date-range-value"
                  data-date-bound="to"
                >
                  <small>
                    <UiText text="До" />
                  </small>
                  <strong>
                    <time dateTime={draftTo}>
                      {formatSelectedDate(draftTo, uiLocale)}
                    </time>
                  </strong>
                  {followToday && (
                    <button
                      className="date-range-today"
                      onClick={() => {
                        setDraftTo(availableTo);
                        setSelectingEnd(false);
                      }}
                      type="button"
                    >
                      <UiText text="Сегодня" />
                    </button>
                  )}
                </div>
              </div>

              <p aria-live="polite" className="dashboard-date-range-guidance">
                {selectingEnd ? (
                  <UiText text="Выберите второй день — будет отмечен весь промежуток" />
                ) : (
                  <UiText text="Один клик выбирает день, второй — диапазон" />
                )}
              </p>

              <div className="dashboard-date-range-calendars">
                {months.map((month, index) => (
                  <CalendarMonth
                    availableRange={effectiveRange}
                    className={
                      months.length === 1
                        ? "is-only"
                        : index === 0
                          ? "is-leading"
                          : "is-trailing"
                    }
                    from={draftFrom}
                    key={monthKey(month)}
                    month={month}
                    onSelect={selectDate}
                    to={draftTo}
                  />
                ))}
              </div>

              <div
                aria-label={uiText("Быстрый выбор периода")}
                className="dashboard-date-range-presets"
                role="group"
              >
                {(
                  [
                    ["Сегодня", 1],
                    ["Неделя", 7],
                    ["Месяц", 30],
                    ["3 месяца", 90],
                    ["6 месяцев", 183],
                    ["1 год", 365],
                    ["2 года", 730],
                  ] as const
                ).map(([label, days]) => (
                  <button
                    key={label}
                    onClick={() => selectPreset(days)}
                    type="button"
                  >
                    <UiText text={label} />
                  </button>
                ))}
              </div>

              <footer className="dashboard-date-range-footer">
                <div>
                  <button
                    className="dashboard-date-range-reset"
                    onClick={() => {
                      acceptedSession.current = undefined;
                      try {
                        if (sessionKey)
                          clearCalendarRangeSession(
                            window.sessionStorage,
                            sessionKey,
                          );
                      } catch {
                        /* Optional browser storage. */
                      }
                      onReset();
                      onOpenChange(false);
                    }}
                    type="button"
                  >
                    <UiText text={resetLabel} />
                  </button>
                  <button
                    className="dashboard-date-range-apply"
                    disabled={!completeDraft}
                    onClick={() => {
                      acceptedSession.current = {
                        from: draftFrom,
                        to: draftTo,
                        day: calendarToday(),
                      };
                      try {
                        if (sessionKey)
                          writeCalendarRangeSession(
                            window.sessionStorage,
                            sessionKey,
                            { from: draftFrom, to: draftTo },
                          );
                      } catch {
                        /* The in-memory accepted range stays available. */
                      }
                      onApply({ from: draftFrom, to: draftTo });
                      onOpenChange(false);
                    }}
                    type="button"
                  >
                    <UiText text="Применить" />
                  </button>
                </div>
              </footer>
            </div>
          </div>
        </DateRangeLayerPortal>
      )}
    </div>
  );
}

function DateRangeLayerPortal({
  anchor,
  children,
}: Readonly<{
  anchor: HTMLElement | null;
  children: ReactNode;
}>) {
  if (typeof document === "undefined") return children;
  const target =
    anchor?.closest<HTMLElement>("[data-dropdown-portal-root]") ??
    anchor?.closest<HTMLDialogElement>("dialog[open]") ??
    document.body;
  return target ? createPortal(children, target) : children;
}

function defaultCustomRange(
  availableRange: CustomDateRangeValue,
): CustomDateRangeValue {
  const candidate = dateKey(
    addDays(dateFromKey(availableRange.to), -(DEFAULT_CUSTOM_RANGE_DAYS - 1)),
  );
  return {
    from: candidate < availableRange.from ? availableRange.from : candidate,
    to: availableRange.to,
  };
}

function initialAnchorMonth(
  range: CustomDateRangeValue,
  multipleMonths: boolean,
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
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + amount,
    12,
  );
}

function compareMonths(left: Date, right: Date): number {
  return (
    left.getFullYear() * 12 +
    left.getMonth() -
    (right.getFullYear() * 12 + right.getMonth())
  );
}

function monthKey(value: string): string;
function monthKey(value: Date): string;
function monthKey(value: string | Date): string {
  const date = typeof value === "string" ? dateFromKey(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}







function formatMonthRange(
  months: readonly Date[],
  uiLocale: string = "ru-RU",
): string {
  if (months.length === 1) return formatMonth(months[0]!, uiLocale);
  const [first, second] = months;
  if (first!.getFullYear() === second!.getFullYear()) {
    const left = new Intl.DateTimeFormat(uiLocale, { month: "long" }).format(
      first,
    );
    const right = new Intl.DateTimeFormat(uiLocale, {
      month: "long",
      year: "numeric",
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
    year: "numeric",
  }).format(dateFromKey(value));
}



function formatCompactRange(
  range: CustomDateRangeValue,
  uiLocale: string = "ru-RU",
  alwaysShowYear = false,
): string {
  const from = dateFromKey(range.from);
  const to = dateFromKey(range.to);
  if (alwaysShowYear) {
    const formatWithYear = (value: Date) =>
      new Intl.DateTimeFormat(uiLocale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(value);
    return `${formatWithYear(from)} — ${formatWithYear(to)}`;
  }
  const format = (value: Date, withYear: boolean, uiLocale: string = "ru-RU") =>
    new Intl.DateTimeFormat(uiLocale, {
      day: "2-digit",
      month: "short",
      ...(withYear ? { year: "2-digit" } : {}),
    }).format(value);
  const differentYear = from.getFullYear() !== to.getFullYear();
  return `${format(from, differentYear, uiLocale)} — ${format(to, differentYear, uiLocale)}`;
}

function formatFullRange(
  range: CustomDateRangeValue,
  uiLocale: string = "ru-RU",
): string {
  return `${formatSelectedDate(range.from, uiLocale)} — ${formatSelectedDate(range.to, uiLocale)}`;
}
