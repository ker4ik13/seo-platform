"use client";

import { calendarDays, dateKey, formatAccessibleDate, formatMonth, dateFromKey } from "../lib/calendar";
import styles from "./calendar-month.module.css";
import { useUiLocale } from "./ui-locale";

export function CalendarMonth({
  availableRange,
  className = "",
  from,
  month,
  onSelect,
  to,
}: Readonly<{
  availableRange: Readonly<{ from: string; to: string }>;
  className?: string;
  from: string;
  month: Date;
  onSelect: (date: string) => void;
  to?: string;
}>) {
  const uiLocale = useUiLocale().locale;
  const days = calendarDays(month);
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(uiLocale, { weekday: "short" }).format(dateFromKey(`2024-01-0${index + 1}`)));
  const today = dateKey(new Date());
  return (
    <section
      aria-label={formatMonth(month, uiLocale)}
      className={`dashboard-calendar-month ${styles.month} ${className}`}
    >
      <strong>{formatMonth(month, uiLocale)}</strong>
      <div aria-hidden="true" className={`dashboard-calendar-weekdays ${styles.weekdays}`}>
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className={`dashboard-calendar-days ${styles.days}`}>
        {days.map((day) => {
          if (!day.inMonth) {
            return <span aria-hidden="true" key={day.key} />;
          }
          const disabled =
            day.key < availableRange.from || day.key > availableRange.to;
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
                day.key === today ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-date-key={day.key}
              disabled={disabled}
              key={day.key}
              onKeyDown={(event) => {
                const steps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                const step = steps[event.key];
                if (step === undefined) return;
                event.preventDefault();
                const target = new Date(day.date); target.setDate(target.getDate() + step);
                const button = event.currentTarget.closest(".dashboard-calendar-month")?.querySelector<HTMLButtonElement>(`button[data-date-key="${dateKey(target)}"]`);
                if (button && !button.disabled) button.focus();
              }}
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
