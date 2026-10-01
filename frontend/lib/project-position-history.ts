import type {
  ProjectPositionHistoryPoint,
  ProjectPositionTopThreshold
} from "@seo-platform/contracts";

export const projectPositionHistoryPeriods = ["7D", "30D", "90D", "ALL"] as const;
export type ProjectPositionHistoryPeriod =
  (typeof projectPositionHistoryPeriods)[number];

export interface ProjectPositionHistoryDateRange {
  readonly from: string;
  readonly to: string;
}

const PERIOD_DAYS: Readonly<Partial<Record<ProjectPositionHistoryPeriod, number>>> = {
  "7D": 7,
  "30D": 30,
  "90D": 90
};

export function visibleProjectPositionHistory(
  points: readonly ProjectPositionHistoryPoint[],
  period: ProjectPositionHistoryPeriod,
  now: Date,
  maximumSlices: number
): readonly ProjectPositionHistoryPoint[] {
  assertMaximumSlices(maximumSlices);
  const days = PERIOD_DAYS[period];
  const cutoff = days === undefined
    ? undefined
    : projectPositionHistoryDateKey(
        new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString()
      );
  const eligible = [...points]
    .filter(({ date }) => cutoff === undefined || date >= cutoff)
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.observedAt.localeCompare(right.observedAt)
    );
  return samplePositionHistory(eligible, maximumSlices);
}

export function visibleProjectPositionHistoryInRange(
  points: readonly ProjectPositionHistoryPoint[],
  range: ProjectPositionHistoryDateRange,
  maximumSlices: number
): readonly ProjectPositionHistoryPoint[] {
  assertMaximumSlices(maximumSlices);
  assertDateRange(range);
  const eligible = [...points]
    .filter(({ date }) => date >= range.from && date <= range.to)
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.observedAt.localeCompare(right.observedAt)
    );
  return samplePositionHistory(eligible, maximumSlices);
}

export function projectPositionHistoryAvailableRange(
  points: readonly ProjectPositionHistoryPoint[]
): ProjectPositionHistoryDateRange | undefined {
  if (points.length === 0) return undefined;
  const dates = points.map(({ date }) => date);
  return {
    from: dates.reduce((earliest, value) => value < earliest ? value : earliest),
    to: dates.reduce((latest, value) => value > latest ? value : latest)
  };
}

export function projectPositionHistoryDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Position history date must be valid");
  }
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function samplePositionHistory(
  eligible: readonly ProjectPositionHistoryPoint[],
  maximumSlices: number
): readonly ProjectPositionHistoryPoint[] {
  assertMaximumSlices(maximumSlices);
  if (eligible.length <= maximumSlices) return eligible;
  if (maximumSlices === 1) return [eligible.at(-1)!];
  const lastIndex = eligible.length - 1;
  const selected = new Set<number>();
  for (let index = 0; index < maximumSlices; index += 1) {
    selected.add(Math.round(index * lastIndex / (maximumSlices - 1)));
  }
  return [...selected].map((index) => eligible[index]!);
}

function assertMaximumSlices(maximumSlices: number): void {
  if (!Number.isSafeInteger(maximumSlices) || maximumSlices < 1) {
    throw new RangeError("maximumSlices must be a positive safe integer");
  }
}

function assertDateRange(range: ProjectPositionHistoryDateRange): void {
  if (
    !validDateKey(range.from) ||
    !validDateKey(range.to) ||
    range.from > range.to
  ) {
    throw new RangeError("Position history date range must be valid");
  }
}

function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

export function projectPositionTopValue(
  point: ProjectPositionHistoryPoint,
  threshold: ProjectPositionTopThreshold
): number {
  if (threshold === 1) return point.top1KeywordCount;
  if (threshold === 3) return point.top3KeywordCount;
  if (threshold === 5) return point.top5KeywordCount;
  if (threshold === 10) return point.top10KeywordCount;
  if (threshold === 30) return point.top30KeywordCount;
  if (threshold === 100) return point.top100KeywordCount ?? point.top50KeywordCount;
  if (threshold === 200) return point.top200KeywordCount ?? point.top100KeywordCount ?? point.top50KeywordCount;
  return point.top50KeywordCount;
}

export function projectPositionHistoryPeriodLabel(
  period: ProjectPositionHistoryPeriod
): string {
  if (period === "7D") return "7 дней";
  if (period === "30D") return "30 дней";
  if (period === "90D") return "90 дней";
  return "Всё время";
}
