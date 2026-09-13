import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreateTrackingContextInput,
  ProjectConnectorCredentialOption,
  TrackingContextSettings,
  TrackingContextSummary
} from "@seo-platform/contracts";
import {
  createRankTargetBatch,
  launchRankTargetBatch,
  prepareRankTargetBatch,
  rankTargetBatchReady,
  type RankTargetBatchInput
} from "./rank-target-batch.ts";
import { defaultTrackingContextSettingsDraft } from "./tracking-contexts.ts";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordIds = [
  "01900000-0000-7000-8000-000000000011",
  "01900000-0000-7000-8000-000000000012"
] as const;

test("prepares every city/device estimate before sending the first paid run", async () => {
  const input: RankTargetBatchInput = {
    workspaceId,
    projectId,
    base: {
      ...defaultTrackingContextSettingsDraft(),
      includeUntracked: true,
      scopeMode: "KEYWORDS"
    },
    targets: [
      { regionCode: "213", regionLabel: "Москва", device: "DESKTOP" },
      { regionCode: "213", regionLabel: "Москва", device: "MOBILE" },
      { regionCode: "2", regionLabel: "Санкт-Петербург", device: "DESKTOP" },
      { regionCode: "2", regionLabel: "Санкт-Петербург", device: "MOBILE" }
    ],
    keywordIds,
    selectedKeywordCount: keywordIds.length,
    source: credential(),
    competitorMode: false,
    saveProjectPosition: false,
    yandexLiveTurbo: false
  };
  const settings: TrackingContextSettings = {
    contexts: [],
    contextsTruncated: false,
    access: { canConfigure: true, mutationRestriction: "NONE" }
  };
  const batch = createRankTargetBatch(input);
  const events: string[] = [];
  const contexts = new Map<string, TrackingContextSummary>();
  const createdInputs: CreateTrackingContextInput[] = [];
  const keywordHash = await sha256([...keywordIds].sort().join("\n"));
  let contextSequence = 20;
  let estimateSequence = 30;
  let jobSequence = 40;

  const request = async <T>(path: string, options: Readonly<{
    method?: string;
    body?: unknown;
  }> = {}): Promise<T> => {
    if (path.endsWith("/tracking-contexts") && options.method === "POST") {
      events.push("context");
      const body = options.body as CreateTrackingContextInput;
      createdInputs.push(body);
      const id = uuid(contextSequence++);
      const now = "2026-09-08T10:00:00.000Z";
      const context: TrackingContextSummary = {
        id,
        workspaceId,
        projectId,
        name: body.name,
        status: "ACTIVE",
        configuration: {
          ...body.configuration,
          configurationVersion: 1,
          createdBy: actorId,
          createdAt: now
        },
        ...(body.launchProfile ? { launchProfile: body.launchProfile } : {}),
        assignedKeywordCount: 0,
        version: 1,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: now,
        updatedAt: now
      };
      contexts.set(id, context);
      return context as T;
    }
    if (options.method === "PUT" && path.endsWith("/keywords")) {
      events.push("assign");
      const contextId = path.split("/").at(-2)!;
      const context = contexts.get(contextId)!;
      contexts.set(contextId, { ...context, assignedKeywordCount: keywordIds.length, version: 2 });
      return {
        contextId,
        assignedKeywordCount: keywordIds.length,
        keywordSetHash: { algorithm: "SHA_256", value: keywordHash },
        version: 2
      } as T;
    }
    if (path.endsWith("/rank-estimates") && options.method === "POST") {
      events.push("estimate");
      const contextId = (options.body as { trackingContextId: string }).trackingContextId;
      return readyEstimate(uuid(estimateSequence++), contextId) as T;
    }
    if (path.endsWith("/rank-runs") && options.method === "POST") {
      events.push("run");
      const estimateId = (options.body as { estimateId: string }).estimateId;
      const entry = batch.entries.find(candidate => candidate.estimate?.id === estimateId)!;
      return queuedJob(uuid(jobSequence++), entry.context!.id) as T;
    }
    const context = contexts.get(path.split("/").at(-1)!);
    if (context) {
      events.push("read-context");
      return context as T;
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${path}`);
  };

  await prepareRankTargetBatch(batch, settings, () => undefined, request);

  assert.equal(rankTargetBatchReady(batch), true, JSON.stringify(batch.entries.map(entry => entry.error)));
  assert.equal(events.filter(event => event === "estimate").length, 4);
  assert.equal(events.includes("run"), false);
  assert.equal(createdInputs.every(({ isReusable }) => isReusable === false), true);

  await launchRankTargetBatch(batch, () => undefined, request);

  assert.equal(batch.entries.every(entry => entry.job?.status === "QUEUED"), true);
  assert.ok(events.indexOf("run") > events.lastIndexOf("estimate"));
});

function credential(): ProjectConnectorCredentialOption {
  return {
    id: "01900000-0000-7000-8000-000000000004",
    workspaceId,
    provider: "XMLSTOCK",
    label: "XMLStock",
    mode: "BYOK_API_KEY",
    status: "ACTIVE",
    capabilities: ["SERP_RANK_TRACKING"]
  };
}

function readyEstimate(id: string, trackingContextId: string) {
  return {
    id,
    workspaceId,
    projectId,
    trackingContextId,
    status: "READY",
    provider: "XMLSTOCK",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope: {
      keywordCount: String(keywordIds.length),
      contextCount: "1",
      pairCount: String(keywordIds.length),
      scopeHash: { availability: "AVAILABLE", algorithm: "SHA_256", value: "a".repeat(64) },
      contextVersion: 2,
      configurationVersion: 1
    },
    workload: {
      taskCount: String(keywordIds.length),
      minimumRequestCount: String(keywordIds.length * 2),
      pollingRequestCount: { status: "NOT_AVAILABLE" },
      requestStages: ["SUBMIT", "POLL"],
      keywordLimitPerTask: "1",
      keywordLimitPerCommand: "300000",
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE"
    },
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    quota: { status: "NOT_AVAILABLE" },
    credentialFreshness: { status: "FRESH", verifiedAt: "2026-09-08T09:00:00.000Z" },
    retention: { normalizedRankHistory: "LONG_TERM", rawSerp: "NOT_COLLECTED" },
    blockers: [],
    executionAllowed: true,
    policyVersion: "manual-xmlstock-serp@2.0.0",
    calculatedAt: "2026-09-08T10:00:00.000Z",
    expiresAt: "2099-09-08T10:05:00.000Z"
  };
}

function queuedJob(id: string, trackingContextId: string) {
  return {
    id,
    workspaceId,
    projectId,
    trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "XMLSTOCK",
    searchEngine: "YANDEX",
    searchSource: "LIVE",
    depth: 50,
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    progress: { current: "0", total: String(keywordIds.length), unit: "KEYWORD" },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    status: "QUEUED",
    stage: "WAITING_FOR_QUEUE",
    createdAt: "2026-09-08T10:00:00.000Z",
    queuedAt: "2026-09-08T10:00:01.000Z"
  };
}

function uuid(sequence: number): string {
  return `01900000-0000-7000-8000-${sequence.toString().padStart(12, "0")}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
