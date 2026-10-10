export interface CalendarRange {
  readonly from: string;
  readonly to: string;
}
export interface CalendarRangeSession extends CalendarRange {
  readonly day: string;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function calendarToday(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function readCalendarRangeSession(
  storage: StorageLike,
  key: string,
): CalendarRangeSession | undefined {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const row = value as Record<string, unknown>;
    if (
      !validDate(row.day) ||
      !validDate(row.from) ||
      !validDate(row.to) ||
      row.from > row.to
    )
      return undefined;
    return { day: row.day, from: row.from, to: row.to };
  } catch {
    return undefined;
  }
}

export function sessionCalendarRange({
  value,
  available,
  session,
  today,
  followToday = true,
}: Readonly<{
  value: CalendarRange;
  available: CalendarRange;
  session?: CalendarRangeSession | undefined;
  today: string;
  followToday?: boolean;
}>): CalendarRange {
  const from =
    value.from < available.from
      ? available.from
      : value.from > available.to
        ? available.to
        : value.from;
  const sameChoice =
    session && session.from === value.from && session.to === value.to;
  const manuallyChosen =
    sameChoice && (session.day === today || session.to !== session.day);
  const candidate = followToday && !manuallyChosen ? today : value.to;
  const to =
    candidate > available.to
      ? available.to
      : candidate < from
        ? from
        : candidate;
  return { from, to };
}

export function writeCalendarRangeSession(
  storage: StorageLike,
  key: string,
  range: CalendarRange,
  today = calendarToday(),
): void {
  try {
    storage.setItem(key, JSON.stringify({ ...range, day: today }));
  } catch {
    /* The mounted picker retains the choice if browser storage is unavailable. */
  }
}

export function clearCalendarRangeSession(
  storage: StorageLike,
  key: string,
): void {
  try {
    storage.setItem(key, "null");
  } catch {
    /* Optional browser preference. */
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return false;
  const parsed = new Date(value + "T12:00:00.000Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
