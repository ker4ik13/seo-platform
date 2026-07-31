import type { Job, Queue } from "bullmq";
import type { AutomationSchedule } from "@seo-platform/contracts";

export const RANK_AUTOMATION_QUEUE = "rank-automation";
export const RANK_AUTOMATION_JOB = "rank.automation.run";

export interface RankAutomationJobData {
  readonly automationId: string;
  readonly automationVersion: number;
}

export function automationSchedulerId(automationId: string): string {
  return `rank-automation-${automationId}`;
}

export async function upsertRankAutomationScheduler(
  queue: Queue<RankAutomationJobData>,
  input: {
    readonly automationId: string;
    readonly automationVersion: number;
    readonly schedule: AutomationSchedule;
    readonly timezone: string;
  }
): Promise<Date> {
  const job = await queue.upsertJobScheduler(
    automationSchedulerId(input.automationId),
    {
      pattern: cronPattern(input.schedule),
      tz: input.timezone
    },
    {
      name: RANK_AUTOMATION_JOB,
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

export function removeRankAutomationScheduler(
  queue: Queue<RankAutomationJobData>,
  automationId: string
): Promise<boolean> {
  return queue.removeJobScheduler(automationSchedulerId(automationId));
}

export function scheduledOccurrence(job: Job<RankAutomationJobData>): Date {
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

export function cronPattern(schedule: AutomationSchedule): string {
  if (schedule.cadence === "DAILY") {
    return `${schedule.minute} ${schedule.hour} * * *`;
  }
  const weekdays = schedule.weekdays
    .map((weekday) => (weekday === 7 ? 0 : weekday))
    .join(",");
  return `${schedule.minute} ${schedule.hour} * * ${weekdays}`;
}

function scheduledJobDate(job: Job<RankAutomationJobData>): Date {
  const timestamp = job.timestamp + Math.max(job.delay, 0);
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    throw new Error("BullMQ returned an invalid automation schedule");
  }
  return value;
}
