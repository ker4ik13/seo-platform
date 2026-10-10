/** Local calendar keys do not shift through UTC or daylight-saving changes. */
export function dateKey(value: Date): string {
  return [String(value.getFullYear()).padStart(4, "0"), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year!, month! - 1, day!);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function calendarDays(month: Date) {
  const first = dateFromKey(`${String(month.getFullYear()).padStart(4, "0")}-${String(month.getMonth() + 1).padStart(2, "0")}-01`);
  const leading = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(1 - leading + index);
    return { date, inMonth: date.getMonth() === first.getMonth(), key: dateKey(date) };
  });
}

export function formatMonth(value: Date, locale: string): string {
  const text = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(value);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function formatAccessibleDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(dateFromKey(value));
}

export type CustomDateInputType = "date" | "datetime-local" | "time";

export function validCalendarValue(value: string, type: CustomDateInputType): boolean {
  if (type !== "time") {
    const day = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || day.startsWith("0000") || dateKey(dateFromKey(day)) !== day) return false;
    if (type === "date") return value.length === 10;
  }
  return (type === "time" || value[10] === "T") && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u.test(type === "time" ? value : value.slice(11));
}
