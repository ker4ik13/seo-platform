import type { ConnectionOptions, QueueBaseOptions } from "bullmq";

export const JOBS_BULLMQ_PREFIX = "seo-platform:jobs:v1";

export function bullMqConnectionOptions(
  connection: ConnectionOptions
): Pick<QueueBaseOptions, "connection" | "prefix"> {
  return {
    connection,
    prefix: JOBS_BULLMQ_PREFIX
  };
}
