"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

export function RankingsDateColumns({ dates, hiddenDates, onToggleDate }: Readonly<{
  dates: readonly string[];
  hiddenDates: ReadonlySet<string>;
  onToggleDate: (date: string) => void;
}>) {
  const { locale, t } = useUiLocale();
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !root.current?.open) return;
      event.preventDefault();
      root.current.open = false;
      root.current.querySelector("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return <details className="rankings-date-columns rankings-columns-toggle" ref={root}>
    <summary><Icon name="list" /><UiText text="Колонки дат" />
      {hiddenDates.size > 0 && <b>{hiddenDates.size}</b>}
    </summary>
    <div>{dates.map(date => <label key={date}>
      <input type="checkbox" checked={!hiddenDates.has(date)} onChange={() => onToggleDate(date)} aria-label={t("Колонка {0}", [date])} />
      <time dateTime={date}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</time>
    </label>)}</div>
  </details>;
}
