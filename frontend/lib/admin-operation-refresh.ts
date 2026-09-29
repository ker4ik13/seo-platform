export const adminOperationRefreshIntervals = [3, 5, 10, 15] as const;

export type AdminOperationRefreshSeconds =
  (typeof adminOperationRefreshIntervals)[number];

export function adminOperationRefreshSeconds(
  value: string | null
): AdminOperationRefreshSeconds {
  const parsed = value === null ? NaN : Number(value);
  return adminOperationRefreshIntervals.find((seconds) => seconds === parsed) ?? 15;
}
