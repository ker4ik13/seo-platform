import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { FrequencyCollectionClaim } from "./frequency-collection-runtime-broker.service.js";
import type { XmlStockFrequencyItemOutcome } from "./frequency-collection-runtime-broker.service.js";
import { WordstatQueryError } from "./xmlstock-wordstat.connector.js";
import { FrequencyCollectionRuntimeService } from "./frequency-collection-runtime.service.js";
import type { WordstatCollectionResult, XmlStockSeasonalityResult } from "./xmlstock-wordstat.connector.js";

test("runtime drains a bounded batch and stops when the broker is idle", async () => {
  const runtime = new RuntimeHarness([
    "COMPLETED_ITEM",
    "FAILED_ITEM",
    "COMPLETED_ITEM",
    "IDLE"
  ]);
  assert.deepEqual(await runtime.processBatch("connector-123456", 10), {
    processed: 3,
    result: "IDLE"
  });
});

test("runtime stops a batch after scheduling a provider retry", async () => {
  const runtime = new RuntimeHarness([
    "COMPLETED_ITEM",
    "RETRY_SCHEDULED",
    "COMPLETED_ITEM"
  ]);
  assert.deepEqual(await runtime.processBatch("connector-123456", 10), {
    processed: 2,
    result: "RETRY_SCHEDULED"
  });
});

test("10,000 keywords produce one Arsenkin task and ten bounded resolve calls", async () => {
  const submissions: Array<Readonly<Record<string, unknown>>> = [];
  const resolveSizes: number[] = [];
  const deferrals: unknown[][] = [];
  let marks = 0;
  let renewals = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(10_000)],
    resolve: async (request) => {
      resolveSizes.push(request.items.length);
    },
    renew: async (claim) => {
      renewals += 1;
      return renewed(claim);
    },
    markSubmitting: async (claim, marker) => {
      marks += 1;
      return marked(claim, marker);
    },
    arsenkin: {
      submit: async (request, _secret, _timeoutMs, beforeRequest) => {
        assert.equal(await beforeRequest?.(), true);
        submissions.push(request);
        return { status: "ACCEPTED", taskId: "task-10000" };
      }
    },
    defer: async (...args) => {
      deferrals.push(args);
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.deepEqual(resolveSizes, Array.from({ length: 10 }, () => 1_000));
  assert.equal(renewals, 3);
  assert.equal(marks, 1);
  assert.equal(submissions.length, 1);
  assert.equal(
    (submissions[0]?.keywords as readonly string[] | undefined)?.length,
    10_000
  );
  assert.deepEqual(
    {
      types: submissions[0]?.types,
      regionCode: submissions[0]?.regionCode,
      device: submissions[0]?.device
    },
    { types: ["BASE", "EXACT"], regionCode: "213", device: "ALL" }
  );
  assert.equal(deferrals.length, 1);
  assert.equal(deferrals[0]?.[1], "task-10000");
});

test("pending Arsenkin polling does not resolve 10,000 keywords again", async () => {
  let resolves = 0;
  let resolverWasCalled = false;
  const runtime = runtimeWith({
    claims: [frequencyClaim(10_000, "task-10000")],
    resolve: async () => {
      resolves += 1;
    },
    arsenkin: {
      fetchResult: async (_taskId, resolver) => {
        resolverWasCalled = typeof resolver !== "function";
        return { status: "PENDING", retryAfterSeconds: 5 };
      }
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.equal(resolverWasCalled, false);
  assert.equal(resolves, 0);
});

test("pending Arsenkin polling becomes a terminal timeout at the bounded horizon", async () => {
  const failures: unknown[][] = [];
  let deferrals = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(1, "task-timeout", 720)],
    arsenkin: {
      fetchResult: async () => ({ status: "PENDING", retryAfterSeconds: 5 })
    },
    defer: async () => {
      deferrals += 1;
    },
    fail: async (...args) => {
      failures.push(args);
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "FAILED_ITEM");
  assert.equal(deferrals, 0);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0]?.[1], {
    code: "PROVIDER_TIMEOUT",
    retryable: false
  });
});

test("terminally closes an over-attempt legacy seasonality claim before provider HTTP", async () => {
  const failures: unknown[][] = [];
  let providerCalls = 0;
  const legacyClaim = seasonalityClaim(1);
  const runtime = runtimeWith({
    claims: [{
      ...legacyClaim,
      provider: "XMLSTOCK",
      maxAttempts: 8,
      types: ["BASE", "EXACT", "FIXED"],
      items: legacyClaim.items.map((item) => ({ ...item, attempt: 123 }))
    }],
    xmlStock: {
      collectSeasonality: async () => {
        providerCalls += 1;
        return { ok: true, points: [] };
      }
    },
    fail: async (...args) => {
      failures.push(args);
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "FAILED_ITEM");
  assert.equal(providerCalls, 0);
  assert.deepEqual(failures[0]?.[1], {
    code: "PROVIDER_TIMEOUT",
    retryable: false
  });
});

test("ready 10,000-keyword result persists in twenty bounded calls with lease renewal", async () => {
  const persistSizes: number[] = [];
  const resolveSizes: number[] = [];
  let renewals = 0;
  let completions = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(10_000, "task-10000")],
    resolve: async (request) => {
      resolveSizes.push(request.items.length);
    },
    persist: async (request) => {
      persistSizes.push(request.items.length);
    },
    renew: async (claim) => {
      renewals += 1;
      return renewed(claim);
    },
    complete: async (_claim, snapshotCount) => {
      assert.equal(snapshotCount, 2);
      completions += 1;
    },
    arsenkin: {
      fetchResult: async (_taskId, keywordResolver) => {
        if (typeof keywordResolver !== "function") {
          throw new TypeError("Expected lazy keyword resolver");
        }
        const keywords = await (keywordResolver as () => Promise<readonly string[]>)();
        return {
          status: "READY",
          results: keywords.map((query) => ({
            query,
            values: { BASE: "100", EXACT: "10", FIXED: "1" }
          }))
        };
      }
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_BATCH");
  assert.deepEqual(resolveSizes, Array.from({ length: 10 }, () => 1_000));
  assert.deepEqual(persistSizes, Array.from({ length: 20 }, () => 500));
  assert.equal(renewals, 8);
  assert.equal(completions, 1);
});

test("polls a legacy per-keyword task without creating a replacement submit", async () => {
  let fetches = 0;
  let submissions = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(1, "legacy-task-1")],
    arsenkin: {
      submit: async () => {
        submissions += 1;
        return { status: "ACCEPTED", taskId: "replacement" };
      },
      fetchResult: async (_taskId, keywordResolver) => {
        fetches += 1;
        if (typeof keywordResolver !== "function") {
          throw new TypeError("Expected lazy keyword resolver");
        }
        const keywords = await (keywordResolver as () => Promise<readonly string[]>)();
        return {
          status: "READY",
          results: keywords.map((query) => ({
            query,
            values: { BASE: "10", EXACT: "1", FIXED: "0" }
          }))
        };
      }
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_ITEM");
  assert.equal(fetches, 1);
  assert.equal(submissions, 0);
});

test("a single XMLStock keyword still collects every requested type", async () => {
  const keywords: string[] = [];
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(1), provider: "XMLSTOCK" }],
    xmlStock: {
      collect: async (input) => {
        keywords.push(`${input.keyword}:${input.type}`);
        return { ok: true, value: input.type === "BASE" ? "10" : "1" };
      }
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_ITEM");
  assert.deepEqual(keywords, ["query 1:BASE", "query 1:EXACT"]);
});

test("three paid frequency types reserve the RPS budget before the first XMLStock request", async () => {
  let permits = 0, calls = 0;
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(1), provider: "XMLSTOCK", types: ["BASE", "EXACT", "FIXED"] }],
    quota: { tryAcquire: async (...args) => {
      permits++;
      assert.equal((args[0] as {requestCost:number;maxWaitMs:number}).requestCost, 3);
      assert.equal((args[0] as {maxWaitMs:number}).maxWaitMs, 4_000);
      assert.equal(calls, 0);
      return { allowed: true };
    } },
    xmlStock: { collect: async () => { calls++; return { ok: true, value: "7" }; } }
  });
  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_ITEM");
  assert.equal(permits, 1); assert.equal(calls, 3);
});

test("one XMLStock operation starts ten phrases in parallel, resolves and persists one batch", { timeout: 5_000 }, async () => {
  let startCount = 0, running = 0, peak = 0;
  let release!: () => void;
  const wave = new Promise<void>(resolve => { release = resolve; });
  const persisted: number[] = [], resolved: number[] = [];
  let settlements = 0;
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(10), provider: "XMLSTOCK", types: ["BASE"] }],
    resolve: async request => { resolved.push(request.items.length); },
    xmlStock: { collect: async () => {
      running++; startCount++; peak = Math.max(peak, running);
      if (startCount === 10) release();
      await wave; running--;
      return { ok: true, value: "42" };
    } },
    quota: { tryAcquire: async (...args) => {
      assert.equal((args[0] as {requestCost:number}).requestCost, 1);
      return { allowed: true };
    } },
    persist: async request => { persisted.push(request.items.length); },
    settle: async (claim, outcomes) => {
      assert.equal(claim.items.length, 10);
      assert.equal(outcomes.length, 10);
      assert.ok(outcomes.every(item => item.status === "COMPLETED"));
      settlements++;
      return claim.jobVersion + 1;
    },
    complete: async () => { assert.fail("not ten individual completions"); }
  });
  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_BATCH");
  assert.equal(peak, 10); assert.equal(settlements, 1);
  assert.deepEqual(resolved, [10]); assert.deepEqual(persisted, [10]);
});

test("mixed XMLStock outcomes preserve successful neighbours and capacity does not become an error", async () => {
  let acquired = 0;
  const settlements: XmlStockFrequencyItemOutcome[][] = [];
  let persisted = 0;
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(10), provider: "XMLSTOCK", types: ["BASE"] }],
    quota: { tryAcquire: async () => ++acquired === 3 ? { allowed: false, retryAfterSeconds: 1 } : { allowed: true } },
    xmlStock: { collect: async input => {
      if (input.keyword === "query 1") throw new WordstatQueryError();
      if (input.keyword === "query 2") return { ok: false, code: "PROVIDER_UNAVAILABLE", retryable: true };
      return { ok: true, value: "42" };
    } },
    persist: async request => { persisted += request.items.length; },
    settle: async (claim, outcomes) => { settlements.push([...outcomes]); return claim.jobVersion + 1; },
    fail: async () => { assert.fail("one phrase must not fail the parent batch"); }
  });
  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.equal(persisted, 7); assert.equal(settlements.length, 1);
  assert.deepEqual(settlements[0]?.map(item => item.status), ["FAILED", "FAILED", "CAPACITY", ...Array(7).fill("COMPLETED")]);
});

test("XMLStock seasonality uses the same parallel batch and preserves every type", async () => {
  let running = 0, peak = 0, requests = 0, persisted = 0;
  const runtime = runtimeWith({
    claims: [{ ...seasonalityClaim(10), provider: "XMLSTOCK", types: ["BASE", "EXACT"] }],
    xmlStock: { collectSeasonality: async () => {
      running++; requests++; peak = Math.max(peak, running);
      await new Promise<void>(resolve => setImmediate(resolve)); running--;
      return { ok: true, points: [{ periodStart: "2026-01-01", value: "42" }] };
    } },
    persistSeasonality: async request => {
      persisted += request.items.length;
      assert.ok(request.items.every(item => (item as {points:unknown[]}).points.length === 2));
    }
  });
  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_BATCH");
  assert.equal(requests, 20); assert.equal(peak, 10); assert.equal(persisted, 10);
});

test("50 XMLStock phrases settle in five visible waves without exceeding ten concurrent calls", async () => {
  let running = 0, peak = 0, calls = 0;
  const persisted: number[] = [], settled: Array<{ size: number; version: number; finalize: boolean }> = [];
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(50), provider: "XMLSTOCK", types: ["BASE"] }],
    xmlStock: { collect: async () => {
      running++; peak = Math.max(peak, running); calls++;
      await new Promise<void>(resolve => setImmediate(resolve)); running--;
      return { ok: true, value: "42" };
    } },
    persist: async request => { persisted.push(request.items.length); },
    settle: async (claim, outcomes, finalize) => {
      assert.equal(outcomes.length, 10);
      settled.push({ size: claim.items.length, version: claim.jobVersion, finalize });
      return claim.jobVersion + 1;
    }
  });
  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_BATCH");
  assert.equal(calls, 50); assert.equal(peak, 10);
  assert.deepEqual(persisted, [10, 10, 10, 10, 10]);
  assert.deepEqual(settled.map(wave => wave.version), [2, 3, 4, 5, 6]);
  assert.deepEqual(settled.map(wave => wave.finalize), [false, false, false, false, true]);
});

test("Arsenkin seasonality persists every keyword in bounded batches", async () => {
  const persistSizes: number[] = [];
  const persistedProviders: string[] = [];
  let completionUnits: number | undefined;
  const runtime = runtimeWith({
    claims: [seasonalityClaim(250, "seasonality-task")],
    arsenkin: {
      fetchSeasonalityResult: async (_taskId, resolver) => {
        if (typeof resolver !== "function") {
          throw new TypeError("Expected lazy keyword resolver");
        }
        const keywords = await (resolver as () => Promise<readonly string[]>)();
        return {
          status: "READY",
          results: keywords.map((query) => ({
            query,
            points: [
              { periodStart: "2026-01-01", value: "10" },
              { periodStart: "2026-02-01", value: "20" },
              { periodStart: "2026-03-01", value: "15" }
            ]
          }))
        };
      }
    },
    persistSeasonality: async (request) => {
      persistSizes.push(request.items.length);
      persistedProviders.push(...request.items.flatMap((item) =>
        (item as { points: readonly { provider: string }[] }).points.map(({ provider }) => provider)
      ));
    },
    complete: async (_claim, units) => {
      completionUnits = units as number;
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_BATCH");
  assert.deepEqual(persistSizes, [100, 100, 50]);
  assert.equal(persistedProviders.length, 250 * 3);
  assert.ok(persistedProviders.every((provider) => provider === "ARSENKIN"));
  assert.equal(completionUnits, 1);
});

test("XMLStock persists each requested seasonality frequency type", async () => {
  const persistedTypes: string[] = [];
  let completionUnits: number | undefined;
  const runtime = runtimeWith({
    claims: [{
      ...seasonalityClaim(1),
      provider: "XMLSTOCK",
      maxAttempts: 8,
      types: ["BASE", "EXACT"]
    }],
    xmlStock: {
      collectSeasonality: async (request) => ({
        ok: true,
        points: [{
          periodStart: "2026-01-01",
          value: request.type === "BASE" ? "100" : "25"
        }]
      })
    },
    persistSeasonality: async (request) => {
      persistedTypes.push(...request.items.flatMap((item) =>
        (item as { points: readonly { type: string }[] }).points.map(({ type }) => type)
      ));
    },
    complete: async (_claim, units) => {
      completionUnits = units as number;
    }
  });
  assert.equal(await runtime.processOne("connector-123456"), "COMPLETED_ITEM");
  assert.deepEqual(persistedTypes, ["BASE", "EXACT"]);
  assert.equal(completionUnits, 2);
});

test("caps provider timeout and claims the 120-second, 10,000-item runtime lease", async () => {
  const claimCalls: unknown[][] = [];
  let connectorTimeoutMs: number | undefined;
  const runtime = runtimeWith({
    claims: [frequencyClaim(1, "task-batch")],
    timeoutMs: 120_000,
    claimCalls,
    arsenkin: {
      fetchResult: async (...args) => {
        connectorTimeoutMs = args.at(-1) as number;
        return { status: "PENDING", retryAfterSeconds: 5 };
      }
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.deepEqual(claimCalls, [["connector-123456", 120, 10_000]]);
  assert.equal(connectorTimeoutMs, 10_000);
});

test("a recovered durable submit marker is quarantined without a paid resubmit", async () => {
  let submissions = 0;
  let quarantines = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(2, "submitting:01900000-0000-7000-8000-000000000099")],
    arsenkin: {
      submit: async () => {
        submissions += 1;
        return { status: "ACCEPTED", taskId: "must-not-submit" };
      }
    },
    quarantine: async () => {
      quarantines += 1;
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "ACTION_REQUIRED");
  assert.equal(submissions, 0);
  assert.equal(quarantines, 1);
});

test("an ambiguous submit is marked before HTTP and quarantined without retry", async () => {
  const order: string[] = [];
  let quarantines = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(2)],
    markSubmitting: async (claim, marker) => {
      order.push("marked");
      return marked(claim, marker);
    },
    arsenkin: {
      submit: async (_request, _secret, _timeoutMs, beforeRequest) => {
        assert.equal(await beforeRequest?.(), true);
        order.push("http");
        return {
          status: "OUTCOME_UNKNOWN",
          code: "PROVIDER_TRANSPORT_AMBIGUOUS"
        };
      }
    },
    quarantine: async () => {
      quarantines += 1;
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "ACTION_REQUIRED");
  assert.deepEqual(order, ["marked", "http"]);
  assert.equal(quarantines, 1);
});

test("a full shared provider cap releases the claim without consuming an attempt", async () => {
  let providerHttpCalls = 0;
  const releases: unknown[][] = [];
  const runtime = runtimeWith({
    claims: [frequencyClaim(2)],
    markSubmitting: async () => undefined,
    arsenkin: {
      submit: async (_request, _secret, _timeoutMs, beforeRequest) => {
        if (!(await beforeRequest?.())) {
          return {
            status: "RETRYABLE_FAILURE",
            code: "PROVIDER_CONCURRENCY_LIMITED",
            retryAfterSeconds: 5
          };
        }
        providerHttpCalls += 1;
        return { status: "ACCEPTED", taskId: "unexpected" };
      }
    },
    release: async (...args) => {
      releases.push(args);
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.equal(providerHttpCalls, 0);
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.[1], 5);
});

test("an XMLStock credential quota miss is deferred without calling Wordstat", async () => {
  let providerCalls = 0;
  const releases: unknown[][] = [];
  const runtime = runtimeWith({
    claims: [{ ...frequencyClaim(1), provider: "XMLSTOCK" }],
    xmlStock: {
      collect: async () => {
        providerCalls += 1;
        return { ok: true, value: "1" };
      }
    },
    quota: {
      tryAcquire: async () => ({
        allowed: false,
        retryAfterSeconds: 2
      })
    },
    release: async (...args) => {
      releases.push(args);
    }
  });

  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.equal(providerCalls, 0);
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.[1], 2);
});

test("remote XMLStock capacity waits do not exhaust attempts in either frequency mode", async () => {
  for (const mode of ["FREQUENCY", "SEASONALITY"] as const) {
    let releases = 0;
    const unavailable = { ok: false as const, code: "PROVIDER_CONCURRENCY_LIMITED" as const, retryable: true, retryAfterSeconds: 5 };
    const runtime = runtimeWith({
      claims: [{ ...(mode === "SEASONALITY" ? seasonalityClaim(1) : frequencyClaim(1)), provider: "XMLSTOCK" }],
      xmlStock: { collect: async () => unavailable, collectSeasonality: async () => unavailable },
      fail: async () => { assert.fail("capacity must not spend a provider failure attempt"); },
      release: async () => { releases++; }
    });
    assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
    assert.equal(releases, 1);
  }
});

test("a marked Arsenkin submit that provably did not start waits for capacity, not reconciliation", async () => {
  let releases = 0;
  const runtime = runtimeWith({
    claims: [frequencyClaim(1)],
    arsenkin: { submit: async (_input, _secret, _timeout, beforeRequest) => {
      assert.equal(await beforeRequest?.(), true);
      return { status: "RETRYABLE_FAILURE", code: "PROVIDER_CONCURRENCY_LIMITED", retryAfterSeconds: 5 };
    } },
    quarantine: async () => { assert.fail("no paid request was started"); },
    release: async () => { releases++; }
  });
  assert.equal(await runtime.processOne("connector-123456"), "RETRY_SCHEDULED");
  assert.equal(releases, 1);
});

class RuntimeHarness extends FrequencyCollectionRuntimeService {
  public constructor(private readonly results: string[]) {
    super(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
  }

  public override async processOne(): Promise<string> {
    return this.results.shift() ?? "IDLE";
  }
}

type ResolveRequest = {
  readonly items: readonly { readonly id: string; readonly version: number }[];
};
type PersistRequest = { readonly items: readonly unknown[] };
type Submit = (
  request: Readonly<Record<string, unknown>>,
  secret: unknown,
  timeoutMs: number,
  beforeRequest?: () => Promise<boolean>
) => Promise<Readonly<Record<string, unknown>>>;
type FetchResult = (...args: unknown[]) => Promise<Readonly<Record<string, unknown>>>;

function runtimeWith(input: {
  readonly claims: Array<FrequencyCollectionClaim | undefined>;
  readonly timeoutMs?: number;
  readonly claimCalls?: unknown[][];
  readonly arsenkin?: {
    readonly submit?: Submit;
    readonly submitSeasonality?: Submit;
    readonly fetchResult?: FetchResult;
    readonly fetchSeasonalityResult?: FetchResult;
  };
  readonly xmlStock?: {
    readonly collect?: (input: { readonly keyword: string; readonly type: string }) =>
      Promise<WordstatCollectionResult>;
    readonly collectSeasonality?: (input: { readonly keyword: string; readonly type: string }) =>
      Promise<XmlStockSeasonalityResult>;
  };
  readonly resolve?: (request: ResolveRequest) => Promise<void>;
  readonly persist?: (request: PersistRequest) => Promise<void>;
  readonly persistSeasonality?: (request: PersistRequest) => Promise<void>;
  readonly defer?: (...args: unknown[]) => Promise<void>;
  readonly fail?: (...args: unknown[]) => Promise<void>;
  readonly complete?: (...args: unknown[]) => Promise<void>;
  readonly settle?: (claim: FrequencyCollectionClaim, outcomes: readonly XmlStockFrequencyItemOutcome[], finalize: boolean) => Promise<number>;
  readonly renew?: (
    claim: FrequencyCollectionClaim,
    leaseSeconds: number
  ) => Promise<FrequencyCollectionClaim>;
  readonly markSubmitting?: (
    claim: FrequencyCollectionClaim,
    marker: string,
    leaseSeconds: number
  ) => Promise<FrequencyCollectionClaim | undefined>;
  readonly quarantine?: (...args: unknown[]) => Promise<void>;
  readonly release?: (...args: unknown[]) => Promise<void>;
  readonly quota?: {
    readonly tryAcquire?: (...args: unknown[]) => Promise<Readonly<Record<string, unknown>>>;
    readonly release?: (...args: unknown[]) => Promise<void>;
    readonly penalize?: (...args: unknown[]) => Promise<void>;
    readonly recordSuccess?: (...args: unknown[]) => Promise<void>;
  };
}): FrequencyCollectionRuntimeService {
  return new FrequencyCollectionRuntimeService(
    {
      claim: async (...args: unknown[]) => {
        input.claimCalls?.push(args);
        return input.claims.shift();
      },
      renew: input.renew ?? (async (claim: FrequencyCollectionClaim) => renewed(claim)),
      markSubmitting:
        input.markSubmitting ??
        (async (claim: FrequencyCollectionClaim, marker: string) => marked(claim, marker)),
      defer: input.defer ?? (async () => undefined),
      fail: input.fail ?? (async () => undefined),
      complete: input.complete ?? (async () => undefined),
      settleXmlStockBatch: input.settle ?? (async (claim: FrequencyCollectionClaim) => claim.jobVersion + 1),
      quarantineAmbiguousSubmit: input.quarantine ?? (async () => undefined),
      releaseForProviderCapacity: input.release ?? (async () => undefined)
    } as never,
    { decrypt: () => ({ apiKey: "private-key" }) } as never,
    {
      resolveFrequencyKeywords: async (request: ResolveRequest) => {
        await input.resolve?.(request);
        return {
          items: request.items.map((item) => ({
            id: item.id,
            text: `query ${Number(item.id.slice(-12))}`,
            version: item.version
          }))
        };
      },
      persistFrequencySnapshotBatch: input.persist ?? (async () => undefined),
      persistFrequencySeasonalityBatch:
        input.persistSeasonality ?? (async () => undefined)
    } as never,
    {
      collect: async () => ({ ok: true, value: "1" }),
      collectSeasonality: async () => ({ ok: true, points: [] }),
      ...input.xmlStock
    } as never,
    {
      submit: async () => ({ status: "ACCEPTED", taskId: "task-batch" }),
      submitSeasonality: async () => ({ status: "ACCEPTED", taskId: "seasonality-task" }),
      fetchResult: async () => ({ status: "PENDING", retryAfterSeconds: 5 }),
      fetchSeasonalityResult: async () => ({ status: "PENDING", retryAfterSeconds: 5 }),
      ...input.arsenkin
    } as never,
    {
      tryAcquire: async () => ({
        allowed: true,
        credentialId: "01900000-0000-7000-8000-000000000005",
        product: "WORDSTAT",
        member: "01900000-0000-7000-8000-000000000006"
      }),
      release: async () => undefined,
      penalize: async () => undefined,
      recordSuccess: async () => undefined,
      ...input.quota
    } as never,
    {
      internalCommandTimeoutMs: 1_000,
      integrationCredentialValidation: { timeoutMs: input.timeoutMs ?? 1_000 }
    } as AppConfig
  );
}

function marked(claim: FrequencyCollectionClaim, marker: string): FrequencyCollectionClaim {
  return {
    ...renewed(claim),
    items: claim.items.map((item) => ({ ...item, providerRequestId: marker }))
  };
}

function renewed(claim: FrequencyCollectionClaim): FrequencyCollectionClaim {
  return {
    ...claim,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString()
  };
}

function frequencyClaim(
  count: number,
  providerRequestId?: string,
  attempt = providerRequestId ? 2 : 1
): FrequencyCollectionClaim {
  return {
    jobId: "01900000-0000-7000-8000-000000000001",
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    actorId: "01900000-0000-7000-8000-000000000004",
    credentialId: "01900000-0000-7000-8000-000000000005",
    provider: "ARSENKIN",
    maxAttempts: 720,
    items: Array.from({ length: count }, (_, index) => ({
      jobItemId: `01900000-0000-7000-8000-${String(index + 20_000).padStart(12, "0")}`,
      ...(providerRequestId ? { providerRequestId } : {}),
      keywordId: `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
      keywordVersion: 1,
      attempt
    })),
    mode: "FREQUENCY",
    types: ["BASE", "EXACT"],
    regionCode: "213",
    device: "ALL",
    jobVersion: 2,
    leaseOwner: "connector-123456",
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    encryptedCredential: {
      ciphertext: Buffer.from("a"),
      nonce: Buffer.from("b"),
      authTag: Buffer.from("c"),
      encryptedDataKey: Buffer.from("d"),
      dataKeyNonce: Buffer.from("e"),
      dataKeyAuthTag: Buffer.from("f"),
      keyVersion: 1
    }
  };
}

function seasonalityClaim(
  count: number,
  providerRequestId?: string
): FrequencyCollectionClaim {
  return {
    ...frequencyClaim(count, providerRequestId),
    mode: "SEASONALITY",
    types: ["BASE"],
    seasonality: {
      granularity: "MONTH",
      observedFrom: "2026-01-01",
      observedThrough: "2026-03-31"
    }
  };
}
