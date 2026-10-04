/** Keep liveness visible while a stopping agent confirms already claimed work. */
export async function keepHeartbeatUntilDrained(
  heartbeatController: AbortController,
  heartbeat: Promise<void>,
  drain: () => Promise<void>
): Promise<void> {
  try {
    await drain();
  } finally {
    heartbeatController.abort();
    await heartbeat;
  }
}
