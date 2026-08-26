export interface OperationTiming {
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

/**
 * Formats the elapsed wall-clock time for a completed background operation.
 * Legacy operations may not have startedAt, so their creation time is used as
 * the best available lower bound.
 */
export function operationDurationLabel(
  timing: OperationTiming
): string | undefined {
  if (!timing.finishedAt) return undefined;

  const startedAt = new Date(timing.startedAt ?? timing.createdAt).getTime();
  const finishedAt = new Date(timing.finishedAt).getTime();
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt
  ) {
    return undefined;
  }

  const seconds = Math.floor((finishedAt - startedAt) / 1_000);
  if (seconds < 1) return "меньше секунды";
  if (seconds < 60) return `${seconds} ${plural(seconds, "секунду", "секунды", "секунд")}`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} ${remainingSeconds} сек`
      : `${minutes} ${plural(minutes, "минуту", "минуты", "минут")}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `${hours} ${plural(hours, "час", "часа", "часов")} ${remainingMinutes} мин`
      : `${hours} ${plural(hours, "час", "часа", "часов")}`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? `${days} ${plural(days, "день", "дня", "дней")} ${remainingHours} ч`
    : `${days} ${plural(days, "день", "дня", "дней")}`;
}

function plural(
  value: number,
  one: string,
  few: string,
  many: string
): string {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
