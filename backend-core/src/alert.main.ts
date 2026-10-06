import { startOperationalAlertServer } from "@seo-platform/operational-alerts";
import { OperationalErrorJournal } from "@seo-platform/backend-core-api/operational-error-journal";

const journal = new OperationalErrorJournal(
  process.env.PLATFORM_DATABASE_URL ?? "",
  process.env.TELEGRAM_ALERT_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  process.env.SERVICE_VERSION ?? "unknown"
);
const server = await startOperationalAlertServer(process.env, {
  recordAlert: (envelope) => journal.record(envelope)
});
const sweep = (): void => {
  void journal.purgeExpired().catch(() => {
    process.stderr.write("[operational-alerts] error journal cleanup unavailable\n");
  });
};
sweep();
const sweepTimer = setInterval(sweep, 24 * 60 * 60 * 1_000);
sweepTimer.unref();
server.once("close", () => {
  clearInterval(sweepTimer);
  void journal.close().catch(() => {
    process.stderr.write("[operational-alerts] error journal close unavailable\n");
  });
});

const shutdown = (): void => {
  server.close();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
