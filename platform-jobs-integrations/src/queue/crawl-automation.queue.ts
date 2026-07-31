import type { Job, Queue } from "bullmq";
import type { AutomationSchedule } from "@seo-platform/contracts";
import { cronPattern } from "./rank-automation.queue.js";

export const CRAWL_AUTOMATION_QUEUE = "crawl-automation";
export const CRAWL_AUTOMATION_JOB = "crawl.automation.run";

export interface CrawlAutomationJobData {
  readonly automationId: string;
  readonly automationVersion: number;
}

export function crawlAutomationSchedulerId(automationId: string): string {
  return `crawl-automation-${automationId}`;
}

export async function upsertCrawlAutomationScheduler(
  queue: Queue<CrawlAutomationJobData>,
  input: {
    readonly automationId: string;
    readonly automationVersion: number;
    readonly schedule: AutomationSchedule;
    readonly timezone: string;
  }
): Promise<Date> {
  const job = await queue.upsertJobScheduler(
    crawlAutomationSchedulerId(input.automationId),
    {
      pattern: cronPattern(input.schedule),
      tz: input.timezone
    },
    {
      name: CRAWL_AUTOMATION_JOB,
      data: {
        automationId: input.automationId,
        automationVersion: input.automationVersion
      },
      opts: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 5_000,
          jitter: 0.5
        },
        removeOnComplete: {
          age: 7 * 24 * 60 * 60,
          count: 10_000
        },
        removeOnFail: {
          age: 30 * 24 * 60 * 60,
          count: 10_000
        }
      }
    }
  );
  return scheduledJobDate(job);
}

export function removeCrawlAutomationScheduler(
  queue: Queue<CrawlAutomationJobData>,
  automationId: string
): Promise<boolean> {
  return queue.removeJobScheduler(
    crawlAutomationSchedulerId(automationId)
  );
}

export function crawlScheduledOccurrence(
  job: Job<CrawlAutomationJobData>
): Date {
  const suffix = job.id?.split(":").at(-1);
  if (suffix && /^(?:0|[1-9]\d{0,15})$/u.test(suffix)) {
    const value = Number(suffix);
    if (Number.isSafeInteger(value)) {
      const occurrence = new Date(value);
      if (!Number.isNaN(occurrence.getTime())) return occurrence;
    }
  }
  return new Date(job.timestamp);
}

function scheduledJobDate(job: Job<CrawlAutomationJobData>): Date {
  const value = new Date(job.timestamp + Math.max(job.delay, 0));
  if (Number.isNaN(value.getTime())) {
    throw new Error("BullMQ returned an invalid crawl automation schedule");
  }
  return value;
}
