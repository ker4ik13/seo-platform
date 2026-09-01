import type { Job, Queue } from "bullmq";
import type { RankTrackingAutomationSchedule } from "@seo-platform/contracts";

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
    readonly schedule: RankTrackingAutomationSchedule;
    readonly timezone: string;
  }
): Promise<Date> {
  if (input.schedule.cadence === "ONCE") {
    return upsertOneTimeRankAutomation(queue, {
      ...input,
      schedule: input.schedule
    });
  }
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
  return removeRankAutomationSchedule(queue, automationId);
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
  if (job.id?.startsWith("rank-automation-once-")) {
    return new Date(job.timestamp + Math.max(job.delay, 0));
  }
  return new Date(job.timestamp);
}

export function cronPattern(schedule: Exclude<RankTrackingAutomationSchedule, { readonly cadence: "ONCE" }>): string {
  if (schedule.cadence === "DAILY") {
    return `${schedule.minute} ${schedule.hour} * * *`;
  }
  const weekdays = schedule.weekdays
    .map((weekday) => (weekday === 7 ? 0 : weekday))
    .join(",");
  return `${schedule.minute} ${schedule.hour} * * ${weekdays}`;
}

async function upsertOneTimeRankAutomation(
  queue: Queue<RankAutomationJobData>,
  input: {
    readonly automationId: string;
    readonly automationVersion: number;
    readonly schedule: Extract<RankTrackingAutomationSchedule, { readonly cadence: "ONCE" }>;
    readonly timezone: string;
  }
): Promise<Date> {
  await queue.removeJobScheduler(automationSchedulerId(input.automationId));
  const runAt = new Date(input.schedule.runAt);
  if (Number.isNaN(runAt.getTime())) {
    throw new Error("Invalid one-time automation occurrence");
  }
  const jobId = oneTimeAutomationJobId(input.automationId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (
      existing.data.automationVersion === input.automationVersion &&
      (state === "delayed" || state === "waiting")
    ) {
      return runAt;
    }
    if (state === "active") {
      throw new Error("One-time automation delivery is active");
    }
    await existing.remove();
  }
  await queue.add(
    RANK_AUTOMATION_JOB,
    {
      automationId: input.automationId,
      automationVersion: input.automationVersion
    },
    {
      jobId,
      delay: Math.max(runAt.getTime() - Date.now(), 0),
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 }
    }
  );
  return runAt;
}

async function removeRankAutomationSchedule(
  queue: Queue<RankAutomationJobData>,
  automationId: string
): Promise<boolean> {
  const [schedulerRemoved, oneTimeJob] = await Promise.all([
    queue.removeJobScheduler(automationSchedulerId(automationId)),
    queue.getJob(oneTimeAutomationJobId(automationId))
  ]);
  if (!oneTimeJob) return schedulerRemoved;
  try {
    await oneTimeJob.remove();
    return true;
  } catch {
    return schedulerRemoved;
  }
}

function oneTimeAutomationJobId(automationId: string): string {
  return `rank-automation-once-${automationId}`;
}

function scheduledJobDate(job: Job<RankAutomationJobData>): Date {
  const timestamp = job.timestamp + Math.max(job.delay, 0);
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    throw new Error("BullMQ returned an invalid automation schedule");
  }
  return value;
}
