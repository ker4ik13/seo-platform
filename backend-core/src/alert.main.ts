import { startOperationalAlertServer } from "@seo-platform/operational-alerts";

const server = await startOperationalAlertServer(process.env);

const shutdown = (): void => {
  server.close();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
