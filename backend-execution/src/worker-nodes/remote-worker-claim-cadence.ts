const IDLE_CLAIM_INTERVAL_MS = 5_000;
const WARM_POLL_INTERVALS_MS = [1_000, 500, 250, 100] as const;
export const REMOTE_WORKER_WARM_POLLS = WARM_POLL_INTERVALS_MS.length;

/** One agent request at a time; a brief refill window bridges DB settlement. */
export function remoteWorkerClaimDelayMs(
  lastClaimAt: number,
  observedCompletions: number,
  completed: number,
  now: number,
  warmPollsRemaining = 0
): number {
  if (lastClaimAt === 0) return 0;
  const interval = completed > observedCompletions
    ? 0
    : warmPollsRemaining > 0 && warmPollsRemaining <= REMOTE_WORKER_WARM_POLLS
      ? WARM_POLL_INTERVALS_MS[warmPollsRemaining - 1]!
      : IDLE_CLAIM_INTERVAL_MS;
  return Math.max(0, lastClaimAt + interval - now);
}
