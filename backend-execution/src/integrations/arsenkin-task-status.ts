const PENDING_TASK_STATUSES = new Set([
  "pending",
  "process",
  "queue",
  "queued",
  "wait",
  "waiting"
]);

/**
 * Arsenkin may keep an accepted task in its queue while another tool uses the
 * account's execution slots. A queued task is still live and must keep being
 * polled; only an internally inconsistent lifecycle is rejected.
 */
export function arsenkinTaskLifecycle(
  statusValue: unknown,
  progressValue: unknown
): "PENDING" | "FINISHED" | undefined {
  const status = typeof statusValue === "string"
    ? statusValue.toLocaleLowerCase("en-US")
    : undefined;
  const progress = taskProgress(progressValue);
  if (status === "finish") {
    return progress === 100 ? "FINISHED" : undefined;
  }
  if (!status || !PENDING_TASK_STATUSES.has(status)) return undefined;
  if (status !== "process" && progress === undefined) return "PENDING";
  return progress !== undefined && progress < 100 ? "PENDING" : undefined;
}

function taskProgress(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined;
  }
  if (typeof value !== "string" || !/^\d{1,3}%?$/u.test(value)) {
    return undefined;
  }
  const progress = Number(value.replace(/%$/u, ""));
  return progress >= 0 && progress <= 100 ? progress : undefined;
}
