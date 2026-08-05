import type { BillingPlanFeatures } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export function billingPlanFeatures(
  value: Prisma.JsonValue
): BillingPlanFeatures {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid billing plan features");
  }
  const feature = value as Readonly<Record<string, Prisma.JsonValue>>;
  const number = (key: string): number => {
    const candidate = feature[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      throw new Error(`Invalid billing plan feature ${key}`);
    }
    return candidate;
  };
  const compatibleNumber = (key: string, fallback: number): number =>
    feature[key] === undefined ? fallback : number(key);
  const boolean = (key: string): boolean => {
    const candidate = feature[key];
    if (typeof candidate !== "boolean") {
      throw new Error(`Invalid billing plan feature ${key}`);
    }
    return candidate;
  };
  const publicApi = feature.publicApi;
  const queuePriority = feature.queuePriority;
  if (publicApi !== "SANDBOX" && publicApi !== "BASIC") {
    throw new Error("Invalid billing plan public API feature");
  }
  if (
    queuePriority !== "TRIAL" &&
    queuePriority !== "NORMAL" &&
    queuePriority !== "NORMAL_PLUS" &&
    queuePriority !== "HIGH" &&
    queuePriority !== "HIGHEST_FAIR_USE"
  ) {
    throw new Error("Invalid billing plan queue priority");
  }
  return {
    seats: number("seats"),
    projects: number("projects"),
    storedKeywords: number("storedKeywords"),
    keywordsPerProject: number("keywordsPerProject"),
    foldersPerProject: compatibleNumber("foldersPerProject", 50),
    concurrentJobs: compatibleNumber("concurrentJobs", 1),
    trackedContextPairs: number("trackedContextPairs"),
    storageBytes: number("storageBytes"),
    rawSerpRetentionDays: number("rawSerpRetentionDays"),
    scheduledAutomations: number("scheduledAutomations"),
    guestReports: number("guestReports"),
    byok: boolean("byok"),
    publicApi,
    clientRole: boolean("clientRole"),
    whiteLabel: boolean("whiteLabel"),
    queuePriority
  };
}
