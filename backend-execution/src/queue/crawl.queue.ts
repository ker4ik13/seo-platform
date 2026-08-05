import type { Queue } from "bullmq";

export const CRAWL_QUEUE = "crawls";
export const CRAWL_JOB = "technical-crawl";

export interface CrawlJobData {
  readonly crawlId: string;
}

export async function enqueueCrawl(
  queue: Queue<CrawlJobData>,
  crawlId: string
): Promise<void> {
  await queue.add(
    CRAWL_JOB,
    { crawlId },
    {
      jobId: `crawl-${crawlId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: true
    }
  );
}
