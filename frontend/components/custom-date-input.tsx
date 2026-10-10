"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { dateFromKey, dateKey, validCalendarValue, type CustomDateInputType } from "../lib/calendar";
import { dateRangePopoverPosition } from "../lib/date-range-popover-position";
import { announceWorkspaceDropdownOpen, workspaceDropdownOpenEvent } from "../lib/dropdown-events";
import { CalendarMonth } from "./calendar-month";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";
import styles from "./custom-date-input.module.css";

export interface CustomDateInputChangeEvent {
  readonly target: Readonly<{ name: string; value: string }>;
  readonly currentTarget: Readonly<{ name: string; value: string }>;
}

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "children">;
export interface CustomDateInputProps extends NativeProps {
  readonly type?: CustomDateInputType;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (event: CustomDateInputChangeEvent) => void;
}

export function CustomDateInput({ type = "date", value, defaultValue = "", onChange, id, name = "", disabled, readOnly, required, min, max, className, placeholder, title, autoFocus, "aria-label": ariaLabel, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }: CustomDateInputProps) {
  const { locale, t } = useUiLocale();
  const generatedId = useId();
  const fieldId = id ?? `date-input-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const validationRef = useRef<HTMLInputElement>(null);
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const selected = value ?? uncontrolled;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [month, setMonth] = useState(() => dateFromKey(dateKey(new Date())));
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const [validationError, setValidationError] = useState(false);
  const minimum = min === undefined ? "" : String(min), maximum = max === undefined ? "" : String(max);
  const valid = (candidate: string) => validCalendarValue(candidate, type) && (!minimum || candidate >= minimum) && (!maximum || candidate <= maximum);
  const draftDay = type === "time" ? "" : draft.slice(0, 10);
  const draftTime = type === "time" ? draft : draft.slice(11);
  const lowerDay = type === "time" ? "0001-01-01" : minimum.slice(0, 10) || "0001-01-01";
  const upperDay = type === "time" ? "9999-12-31" : maximum.slice(0, 10) || "9999-12-31";

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function show() {
    if (disabled || readOnly) return;
    const now = new Date();
    const day = dateKey(now), time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const current = type === "date" ? day : type === "time" ? time : `${day}T${time}`;
    const initial = (valid(selected) ? selected : "") || (minimum && current < minimum ? minimum : maximum && current > maximum ? maximum : current);
    setDraft(initial);
    const anchorMonth = dateFromKey(type === "time" ? day : initial.slice(0, 10));
    anchorMonth.setDate(1); setMonth(anchorMonth);
    setPortal(rootRef.current?.closest<HTMLElement>("[data-dropdown-portal-root]") ?? rootRef.current?.closest<HTMLDialogElement>("dialog[open]") ?? document.body);
    setOpen(true);
    if (rootRef.current) announceWorkspaceDropdownOpen(rootRef.current);
  }

  function commit(next: string) {
    if (next && !valid(next)) return;
    if (value === undefined) setUncontrolled(next);
    setValidationError(false);
    const target = { name, value: next };
    onChange?.({ target, currentTarget: target });
    close();
  }

  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    validationRef.current?.setCustomValidity(selected && (!validCalendarValue(selected, type) || minimum && selected < minimum || maximum && selected > maximum) ? t("Выберите допустимую дату и время") : "");
  }, [selected, type, minimum, maximum, t]);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form || value !== undefined) return;
    const reset = () => { setUncontrolled(defaultValue); setValidationError(false); close(false); };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, value]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || panelRef.current?.querySelector(".custom-select.is-open")) return;
      event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    const exclusive = (event: Event) => {
      const owner = (event as CustomEvent<EventTarget>).detail;
      if (owner instanceof Node && !rootRef.current?.contains(owner) && !panelRef.current?.contains(owner)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener(workspaceDropdownOpenEvent, exclusive);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener(workspaceDropdownOpenEvent, exclusive); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const anchor = triggerRef.current?.getBoundingClientRect(), panel = panelRef.current;
      if (!anchor || !panel) return;
      const viewport = window.visualViewport;
      const next = dateRangePopoverPosition({ anchor, height: panel.scrollHeight, width: 320, mode: "ANCHORED", viewport: { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight } });
      setPosition((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    }
    reposition();
    const focusFrame = requestAnimationFrame(() => {
      const day = panelRef.current?.querySelector<HTMLButtonElement>('button[data-date-key][aria-pressed="true"]:not(:disabled)');
      (day ?? panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
    });
    const observer = new ResizeObserver(reposition);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => { cancelAnimationFrame(focusFrame); observer.disconnect(); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); window.visualViewport?.removeEventListener("resize", reposition); };
  }, [open, portal]);

  const label = selected && validCalendarValue(selected, type)
    ? type === "time" ? selected : `${dateFromKey(selected.slice(0, 10)).toLocaleDateString(locale)}${type === "datetime-local" ? ` · ${selected.slice(11)}` : ""}`
    : placeholder ?? t(type === "time" ? "Выберите время" : "Выберите дату");
  const changeMonth = (offset: number) => setMonth((current) => { const next = new Date(current); next.setDate(1); next.setMonth(current.getMonth() + offset); return next; });
  const previous = new Date(month); previous.setDate(0);
  const next = new Date(month); next.setMonth(next.getMonth() + 1, 1);
  const years = Array.from({ length: Math.min(9999, month.getFullYear() + 100) - Math.max(1, month.getFullYear() - 100) + 1 }, (_, index) => Math.max(1, month.getFullYear() - 100) + index);

  return <div className={`${styles.field} custom-date-input${className ? ` ${className}` : ""}`} ref={rootRef}>
    <button aria-label={ariaLabel} aria-invalid={ariaInvalid || validationError || undefined} aria-required={required} aria-readonly={readOnly} aria-describedby={ariaDescribedBy} aria-expanded={open} aria-haspopup="dialog" aria-controls={`${fieldId}-panel`} className={styles.trigger} id={fieldId} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); show(); } }} ref={triggerRef} role="combobox" title={title ?? (selected || undefined)} type="button"><Icon name={type === "time" ? "history" : "calendar"} /><span className={!selected ? styles.placeholder : undefined}>{label}</span><Icon name="chevronDown" /></button>
    <input aria-hidden="true" className="visually-hidden" disabled={disabled} name={name || undefined} onChange={() => {}} onInvalid={(event) => { event.preventDefault(); setValidationError(true); show(); triggerRef.current?.focus(); }} readOnly={readOnly} ref={validationRef} required={required} tabIndex={-1} type="text" value={selected} />
    {open && portal && createPortal(<div aria-label={t(type === "time" ? "Выбор времени" : "Выбор даты")} className={`${styles.popover} custom-date-input-popover`} data-custom-date-panel data-exclusive-dropdown-layer data-dropdown-portal-root id={`${fieldId}-panel`} ref={panelRef} role="dialog" style={position}>
      {type !== "time" && <><header className={styles.header}><button aria-label={t("Предыдущий месяц")} disabled={dateKey(previous) < lowerDay} onClick={() => changeMonth(-1)} type="button"><Icon name="chevronRight" /></button><CustomSelect aria-label={t("Месяц")} value={String(month.getMonth())} onChange={(event) => setMonth(dateFromKey(`${String(month.getFullYear()).padStart(4, "0")}-${String(Number(event.target.value) + 1).padStart(2, "0")}-01`))}>{Array.from({ length: 12 }, (_, index) => <option value={String(index)} key={index}>{new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2024, index, 1))}</option>)}</CustomSelect><CustomSelect aria-label={t("Год")} searchable value={String(month.getFullYear())} onChange={(event) => { const updated = new Date(month); updated.setDate(1); updated.setFullYear(Number(event.target.value)); setMonth(updated); }}>{years.map((year) => <option key={year} value={String(year)}>{year}</option>)}</CustomSelect><button aria-label={t("Следующий месяц")} disabled={dateKey(next) > upperDay} onClick={() => changeMonth(1)} type="button"><Icon name="chevronRight" /></button></header>
      <CalendarMonth availableRange={{ from: lowerDay, to: upperDay }} from={draftDay} month={month} onSelect={(day) => type === "date" ? commit(day) : setDraft(`${day}T${draftTime || "00:00"}`)} /></>}
      {type !== "date" && <TimeFields value={draftTime} onChange={(time) => setDraft(type === "time" ? time : `${draftDay}T${time}`)} />}
      <footer className={styles.footer}><button className="text-button" onClick={() => type === "time" ? setDraft(`${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`) : type === "date" ? commit(dateKey(new Date())) : setDraft(`${dateKey(new Date())}T${draftTime || "00:00"}`)} type="button"><UiText text={type === "time" ? "Сейчас" : "Сегодня"} /></button>{!required && <button className="text-button" onClick={() => commit("")} type="button"><UiText text="Очистить" /></button>}{type !== "date" && <button className="primary-button" disabled={!valid(draft)} onClick={() => commit(draft)} type="button"><UiText text="Применить" /></button>}</footer>
      {(validationError || draft && !valid(draft)) && <p className={styles.error} role="alert"><UiText text="Выберите допустимую дату и время" /></p>}
    </div>, portal)}
  </div>;
}

function TimeFields({ value, onChange }: Readonly<{ value: string; onChange: (value: string) => void }>) {
  const [hours = "00", minutes = "00", seconds] = value.split(":");
  const { t } = useUiLocale();
  return <div className={styles.timeFields}>{[["Часы", hours, 24], ["Минуты", minutes, 60], ...(seconds === undefined ? [] : [["Секунды", seconds, 60]])].map(([label, selected, count], index) => <label key={String(label)}><span>{t(String(label))}</span><CustomSelect aria-label={t(String(label))} value={String(selected)} searchable onChange={(event) => { const parts = [hours, minutes, ...(seconds === undefined ? [] : [seconds])]; parts[index] = event.target.value; onChange(parts.join(":")); }}>{Array.from({ length: Number(count) }, (_, number) => <option key={number} value={String(number).padStart(2, "0")}>{String(number).padStart(2, "0")}</option>)}</CustomSelect></label>)}</div>;
}
