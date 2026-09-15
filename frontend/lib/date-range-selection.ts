export interface DateRangeSelectionState {
  readonly from: string;
  readonly to: string;
  readonly selectingEnd: boolean;
}

export function selectDateRangeDay(
  current: DateRangeSelectionState,
  date: string
): DateRangeSelectionState {
  if (!current.selectingEnd) {
    return { from: date, to: date, selectingEnd: true };
  }
  return {
    from: date < current.from ? date : current.from,
    to: date < current.from ? current.from : date,
    selectingEnd: false
  };
}

export function dateRangePreset(
  available: Readonly<{ from: string; to: string }>,
  days: number
): Readonly<{ from: string; to: string }> {
  const end = dateFromKey(available.to);
  end.setDate(end.getDate() - Math.max(0, days - 1));
  const candidate = dateKey(end);
  return {
    from: candidate < available.from ? available.from : candidate,
    to: available.to
  };
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
