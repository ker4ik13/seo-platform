const IDLE_CLAIM_INTERVAL_MS = 5_000;
const ACTIVE_CLAIM_INTERVAL_MS = 100;

/** One agent request at a time; completed work shortens only the next wait. */
export function remoteWorkerClaimDelayMs(
  lastClaimAt: number,
  observedCompletions: number,
  completed: number,
  now: number
): number {
  if (lastClaimAt === 0) return 0;
  const interval = completed > observedCompletions
    ? ACTIVE_CLAIM_INTERVAL_MS
    : IDLE_CLAIM_INTERVAL_MS;
  return Math.max(0, lastClaimAt + interval - now);
}
