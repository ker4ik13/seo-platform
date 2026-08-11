import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { FrequencyCollectionClaim } from "./frequency-collection-runtime-broker.service.js";
import { FrequencyCollectionRuntimeService } from "./frequency-collection-runtime.service.js";

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

test("keeps XMLStock as one keyword claim while collecting every requested type", async () => {
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
  assert.equal(releases[0]?.[1], 5);
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
  readonly arsenkin?: { readonly submit?: Submit; readonly fetchResult?: FetchResult };
  readonly xmlStock?: {
    readonly collect?: (input: { readonly keyword: string; readonly type: string }) =>
      Promise<{ readonly ok: true; readonly value: string }>;
  };
  readonly resolve?: (request: ResolveRequest) => Promise<void>;
  readonly persist?: (request: PersistRequest) => Promise<void>;
  readonly defer?: (...args: unknown[]) => Promise<void>;
  readonly fail?: (...args: unknown[]) => Promise<void>;
  readonly complete?: (...args: unknown[]) => Promise<void>;
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
      persistFrequencySnapshotBatch: input.persist ?? (async () => undefined)
    } as never,
    {
      collect: async () => ({ ok: true, value: "1" }),
      ...input.xmlStock
    } as never,
    {
      submit: async () => ({ status: "ACCEPTED", taskId: "task-batch" }),
      fetchResult: async () => ({ status: "PENDING", retryAfterSeconds: 5 }),
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
