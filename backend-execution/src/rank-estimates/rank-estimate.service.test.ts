import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import type {
  InternalCreateRankEstimateInput,
  InternalRankEstimateScope
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import { rankEstimateSnapshot } from "./rank-estimate-snapshot.js";
import {
  RANK_ESTIMATE_TTL_MILLISECONDS,
  RankEstimateService
} from "./rank-estimate.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const trackingContextId = "0190abcd-0000-7000-8000-000000000004";
const otherTrackingContextId =
  "0190abcd-0000-7000-8000-000000000010";
const estimateId = "0190abcd-0000-7000-8000-000000000005";
const bindingId = "0190abcd-0000-7000-8000-000000000006";
const routeId = "0190abcd-0000-7000-8000-000000000007";
const credentialId = "0190abcd-0000-7000-8000-000000000008";
const validationId = "0190abcd-0000-7000-8000-000000000009";
const secretSentinel = "must-never-be-selected-or-persisted";

const input: InternalCreateRankEstimateInput = {
  workspaceId,
  projectId,
  actorId,
  trackingContextId,
  project: {
    id: projectId,
    workspaceId,
    domain: "example.com",
    status: "ACTIVE",
    version: 7
  },
  access: {
    workspaceStatus: "ACTIVE",
    canRunRanking: true,
    entitlementStatus: "NOT_AVAILABLE"
  },
  billingCurrency: "RUB",
  quota: { status: "NOT_AVAILABLE" }
};

test("calculates bounded task counts, exact TTL and a redacted immutable estimate", async () => {
  const harness = estimateHarness({ scope: scope({ keywordCount: "251" }) });
  const executableInput: InternalCreateRankEstimateInput = {
    ...input,
    access: {
      ...input.access,
      entitlementStatus: "ALLOWED"
    }
  };
  const estimate = await harness.service.create(
    executableInput,
    "rank-estimate-0001"
  );

  assert.equal(estimate.status, "READY");
  assert.equal(estimate.executionAllowed, true);
  assert.equal(estimate.workload.taskCount, "1");
  assert.equal(estimate.workload.minimumRequestCount, "3");
  assert.equal(estimate.providerLimits.status, "NOT_AVAILABLE");
  assert.equal(estimate.expectedDuration.status, "NOT_AVAILABLE");
  assert.equal(estimate.credentialFreshness.status, "FRESH");
  assert.equal(
    new Date(estimate.expiresAt).getTime() -
      new Date(estimate.calculatedAt).getTime(),
    RANK_ESTIMATE_TTL_MILLISECONDS
  );
  assert.deepEqual(estimate.blockers, []);
  assert.equal(harness.transactionIsolation, "RepeatableRead");
  assert.equal(harness.seoCalls, 1);

  const selectedCredential =
    harness.bindingQuery?.select.routes.select.credential.select;
  assert.ok(selectedCredential);
  assert.equal(selectedCredential.ciphertext, undefined);
  assert.equal(selectedCredential.encryptedDataKey, undefined);
  assert.equal(selectedCredential.providerMeta, undefined);
  assert.equal(selectedCredential.displayHint, undefined);
  assert.equal(
    JSON.stringify(harness.createdData).includes(secretSentinel),
    false
  );
  const publicSnapshot = JSON.stringify(
    harness.createdData?.responseSnapshot
  );
  assert.equal(publicSnapshot.includes(bindingId), false);
  assert.equal(publicSnapshot.includes(routeId), false);
  assert.equal(publicSnapshot.includes(credentialId), false);
  assert.equal(publicSnapshot.includes(validationId), false);
  assert.equal(
    publicSnapshot.includes(executableInput.project.domain),
    false
  );
  assert.equal(
    harness.createdData?.minimumSubmitRequestCount,
    1
  );
  assert.equal(harness.createdData?.minimumCheckRequestCount, 1);
  assert.equal(harness.createdData?.minimumGetRequestCount, 1);
});

test("derives an executable XMLStock Google workload from the bound route", async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  const harness = estimateHarness({
    scope: scope({ keywordCount: "3", pairCount: "3" }),
    binding: binding({ provider: "XMLSTOCK", verifiedAt }),
    validation: validation(verifiedAt, { provider: "XMLSTOCK" })
  });
  const estimate = await harness.service.create(
    {
      ...input,
      access: { ...input.access, entitlementStatus: "ALLOWED" }
    },
    "rank-estimate-xmlstock-google"
  );

  assert.equal(estimate.status, "READY");
  assert.equal(estimate.provider, "XMLSTOCK");
  assert.equal(estimate.workload.taskCount, "3");
  assert.equal(estimate.workload.minimumRequestCount, "9");
  assert.deepEqual(estimate.workload.requestStages, ["GET"]);
  assert.equal(estimate.workload.keywordLimitPerTask, "1");
  assert.equal(harness.createdData?.providerPolicyVersion,
    "manual-xmlstock-serp@1.0.0");
  assert.equal(harness.createdData?.minimumSubmitRequestCount, 0);
  assert.equal(harness.createdData?.minimumCheckRequestCount, 0);
  assert.equal(harness.createdData?.minimumGetRequestCount, 9);
});

test("estimates XMLStock Yandex Live Turbo with up to fifty results per GET", async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  const harness = estimateHarness({
    scope: scope({
      keywordCount: "3",
      pairCount: "3",
      configuration: {
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        language: "ru",
        device: "DESKTOP",
        depth: 100,
        domainMatchRule: { mode: "EXACT_HOST" },
        safeSearch: false
      }
    }),
    binding: binding({ provider: "XMLSTOCK", verifiedAt }),
    validation: validation(verifiedAt, { provider: "XMLSTOCK" })
  });
  const estimate = await harness.service.create(
    {
      ...input,
      provider: "XMLSTOCK",
      searchSource: "LIVE",
      yandexLiveMode: "TURBO",
      access: { ...input.access, entitlementStatus: "ALLOWED" }
    },
    "rank-estimate-xmlstock-yandex-turbo"
  );

  assert.equal(estimate.status, "READY");
  assert.equal(estimate.workload.minimumRequestCount, "6");
  assert.deepEqual(estimate.workload.requestStages, ["GET"]);
  assert.equal(harness.createdData?.minimumGetRequestCount, 6);
  assert.equal(
    (harness.createdData?.executionSnapshot as { providerMappingVersion?: string })
      ?.providerMappingVersion,
    "xmlstock-yandex-live@3"
  );
});

test("selects the explicitly requested provider from multiple bound routes", async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  const primary = binding({ verifiedAt });
  const xml = binding({ provider: "XMLSTOCK", verifiedAt }).routes[0]!;
  const xmlRouteId = "0190abcd-0000-7000-8000-000000000011";
  const xmlCredentialId = "0190abcd-0000-7000-8000-000000000012";
  const multiRouteBinding = {
    ...primary,
    routes: [
      primary.routes[0]!,
      {
        ...xml,
        id: xmlRouteId,
        position: 1,
        credentialId: xmlCredentialId,
        credential: { ...xml.credential, id: xmlCredentialId }
      }
    ]
  };
  const harness = estimateHarness({
    scope: scope({ keywordCount: "2", pairCount: "2" }),
    binding: multiRouteBinding,
    validation: validation(verifiedAt, {
      provider: "XMLSTOCK",
      credentialId: xmlCredentialId
    })
  });
  const estimate = await harness.service.create(
    {
      ...input,
      provider: "XMLSTOCK",
      access: { ...input.access, entitlementStatus: "ALLOWED" }
    },
    "rank-estimate-explicit-xmlstock"
  );

  assert.deepEqual(estimate.blockers, []);
  assert.equal(estimate.status, "READY");
  assert.equal(estimate.provider, "XMLSTOCK");
  assert.equal(harness.createdData?.routeId, xmlRouteId);
  assert.equal(harness.createdData?.credentialId, xmlCredentialId);
});

test("prefers the explicitly selected primary account when a provider has another route", async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  const primary = binding({ provider: "XMLSTOCK", verifiedAt });
  const secondaryCredentialId = "0190abcd-0000-7000-8000-000000000013";
  const secondaryRouteId = "0190abcd-0000-7000-8000-000000000014";
  const multiAccountBinding = {
    ...primary,
    routes: [
      primary.routes[0]!,
      {
        ...primary.routes[0]!,
        id: secondaryRouteId,
        position: 1,
        credentialId: secondaryCredentialId,
        credential: {
          ...primary.routes[0]!.credential,
          id: secondaryCredentialId
        }
      }
    ]
  };
  const harness = estimateHarness({
    binding: multiAccountBinding,
    validation: validation(verifiedAt, { provider: "XMLSTOCK" })
  });
  const estimate = await harness.service.create(
    {
      ...input,
      provider: "XMLSTOCK",
      access: { ...input.access, entitlementStatus: "ALLOWED" }
    },
    "rank-estimate-primary-xmlstock-account"
  );

  assert.equal(estimate.status, "READY");
  assert.equal(harness.createdData?.routeId, routeId);
  assert.equal(harness.createdData?.credentialId, credentialId);
});

test("replays without another SEO read and conflicts on another payload", async () => {
  const harness = estimateHarness();
  const original = await harness.service.create(
    input,
    "rank-estimate-0002"
  );
  const replay = await harness.service.create(
    input,
    "rank-estimate-0002"
  );

  assert.deepEqual(replay, original);
  assert.equal(harness.seoCalls, 1);
  assert.equal(harness.transactionCalls, 1);

  const driftReplay = await harness.service.create(
    {
      ...input,
      project: {
        ...input.project,
        domain: "changed.example.com",
        status: "ARCHIVED",
        version: 8
      },
      access: {
        workspaceStatus: "SUSPENDED",
        canRunRanking: false,
        entitlementStatus: "DENIED"
      },
      billingCurrency: "USD",
      quota: {
        status: "EXHAUSTED",
        limit: "10",
        used: "10",
        remaining: "0"
      }
    },
    "rank-estimate-0002"
  );
  assert.deepEqual(driftReplay, original);
  assert.equal(harness.seoCalls, 1);
  assert.equal(harness.transactionCalls, 1);

  await assert.rejects(
    harness.service.create(
      {
        ...input,
        trackingContextId: otherTrackingContextId
      },
      "rank-estimate-0002"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (
          error.getResponse() as Readonly<Record<string, unknown>>
        ).code,
        "IDEMPOTENCY_CONFLICT"
      );
      return true;
    }
  );
  assert.equal(harness.seoCalls, 1);
});

test("returns the concurrent immutable winner after a unique conflict", async () => {
  const harness = estimateHarness({ uniqueConflictOnCreate: true });
  const estimate = await harness.service.create(
    input,
    "rank-estimate-0003"
  );

  assert.equal(estimate.id, estimateId);
  assert.equal(harness.seoCalls, 1);
  assert.equal(harness.transactionCalls, 1);
});

test("fails closed when a private receipt no longer matches its public snapshot", async () => {
  const harness = estimateHarness();
  await harness.service.create(input, "rank-estimate-corrupt");
  harness.changeStored({ providerTaskCount: 4 });

  await assert.rejects(
    harness.service.create(input, "rank-estimate-corrupt"),
    /Invalid immutable rank estimate snapshot/u
  );
  assert.equal(harness.seoCalls, 1);
});

test("fails closed for private context corruption when the sentinel scope hash is unavailable", async () => {
  const harness = estimateHarness({
    scope: scope({
      keywordCount: "15001",
      semanticScopeHash: { availability: "UNAVAILABLE" }
    })
  });
  await harness.service.create(
    input,
    "rank-estimate-corrupt-sentinel"
  );
  harness.changeStored({ trackingContextId: otherTrackingContextId });

  await assert.rejects(
    harness.service.create(
      input,
      "rank-estimate-corrupt-sentinel"
    ),
    /Invalid immutable rank estimate snapshot/u
  );
  assert.equal(harness.seoCalls, 1);
});

test("blocks stale and missing validation proof without selecting secret material", async () => {
  const staleAt = new Date(Date.now() - 25 * 60 * 60 * 1_000);
  const stale = estimateHarness({
    binding: binding({ verifiedAt: staleAt }),
    validation: validation(staleAt)
  });
  const staleEstimate = await stale.service.create(
    input,
    "rank-estimate-stale"
  );
  assert.equal(staleEstimate.credentialFreshness.status, "STALE");
  assert.ok(
    staleEstimate.blockers.some(
      ({ code }) => code === "CREDENTIAL_NOT_FRESH"
    )
  );
  assert.equal(stale.createdData?.credentialValidationId, validationId);
  assert.equal(
    stale.createdData?.credentialValidationConnectorVersion,
    "arsenkin@1.0.0"
  );

  const missing = estimateHarness({
    binding: binding({ verifiedAt: null }),
    validation: null
  });
  const missingEstimate = await missing.service.create(
    input,
    "rank-estimate-missing"
  );
  assert.equal(
    missingEstimate.credentialFreshness.status,
    "UNVERIFIED"
  );
  assert.equal(missing.createdData?.credentialValidationId, null);
  assert.equal(missing.createdData?.credentialVerifiedAt, null);
});

test("keeps an unsupported provider mapping fail-closed before execution", async () => {
  const baseScope = scope();
  const harness = estimateHarness({
    scope: {
      ...baseScope,
      configuration: {
        ...baseScope.configuration,
        regionCode: "RU-MOW"
      }
    }
  });
  const estimate = await harness.service.create(
    {
      ...input,
      access: {
        ...input.access,
        entitlementStatus: "ALLOWED"
      }
    },
    "rank-estimate-unsupported-mapping"
  );

  assert.equal(estimate.status, "BLOCKED");
  assert.equal(estimate.executionAllowed, false);
  assert.deepEqual(
    estimate.blockers.map(({ code }) => code),
    ["REGION_MAPPING_UNVERIFIED"]
  );
  assert.equal(harness.createdData?.executionSnapshot, Prisma.DbNull);
  assert.equal(harness.createdData?.executionSnapshotHash, null);
});

test("blocks a Yandex depth that the positions request cannot represent", async () => {
  const baseScope = scope();
  const harness = estimateHarness({
    scope: {
      ...baseScope,
      configuration: {
        ...baseScope.configuration,
        searchEngine: "YANDEX",
        depth: 50
      }
    }
  });
  const estimate = await harness.service.create(
    {
      ...input,
      access: {
        ...input.access,
        entitlementStatus: "ALLOWED"
      }
    },
    "rank-estimate-yandex-depth"
  );

  assert.equal(estimate.status, "BLOCKED");
  assert.equal(estimate.executionAllowed, false);
  assert.deepEqual(
    estimate.blockers.map(({ code }) => code),
    ["UNSUPPORTED_DEPTH"]
  );
  assert.equal(harness.createdData?.executionSnapshot, Prisma.DbNull);
  assert.equal(harness.createdData?.executionSnapshotHash, null);
});

test("does not accept a completed proof for another material version", async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  const harness = estimateHarness({
    binding: binding({ verifiedAt }),
    validation: validation(verifiedAt, { materialVersion: 2 })
  });
  const estimate = await harness.service.create(
    input,
    "rank-estimate-old-material"
  );

  assert.equal(estimate.credentialFreshness.status, "STALE");
  assert.equal(harness.createdData?.credentialValidationId, null);
  assert.ok(
    estimate.blockers.some(
      ({ code }) => code === "CREDENTIAL_NOT_FRESH"
    )
  );
});

test("keeps a missing binding as a blocked estimate without a credential read", async () => {
  const harness = estimateHarness({ binding: null, validation: null });
  const estimate = await harness.service.create(
    input,
    "rank-estimate-no-binding"
  );

  assert.equal(
    estimate.credentialFreshness.status,
    "NOT_AVAILABLE"
  );
  assert.ok(
    estimate.blockers.some(
      ({ code }) => code === "BINDING_NOT_CONFIGURED"
    )
  );
  assert.equal(harness.validationQuery, undefined);
  assert.equal(harness.createdData?.credentialId, null);
});

test("projects lifecycle, permission, entitlement and quota as deterministic blockers", async () => {
  const harness = estimateHarness({
    binding: null,
    validation: null,
    scope: scope({
      contextStatus: "ARCHIVED",
      keywordCount: "0",
      pairCount: "0"
    })
  });
  const estimate = await harness.service.create(
    {
      ...input,
      project: { ...input.project, status: "ARCHIVED" },
      access: {
        workspaceStatus: "READ_ONLY",
        canRunRanking: false,
        entitlementStatus: "DENIED"
      },
      quota: {
        status: "EXHAUSTED",
        limit: "10",
        used: "10",
        remaining: "0"
      }
    },
    "rank-estimate-access"
  );
  const codes = estimate.blockers.map(({ code }) => code);

  for (const code of [
    "CONTEXT_ARCHIVED",
    "NO_ASSIGNED_KEYWORDS",
    "ENTITLEMENT_DENIED",
    "QUOTA_EXCEEDED",
    "MISSING_RUN_PERMISSION",
    "WORKSPACE_READ_ONLY",
    "PROJECT_ARCHIVED"
  ] as const) {
    assert.ok(codes.includes(code));
  }
  assert.equal(new Set(codes).size, codes.length);
});

test("uses a bounded 15001 sentinel without fabricating a partial hash", async () => {
  const harness = estimateHarness({
    scope: scope({
      keywordCount: "15001",
      semanticScopeHash: { availability: "UNAVAILABLE" }
    })
  });
  const estimate = await harness.service.create(
    input,
    "rank-estimate-limit"
  );

  assert.equal(estimate.scope.keywordCount, "15001");
  assert.deepEqual(estimate.scope.scopeHash, {
    availability: "UNAVAILABLE"
  });
  assert.equal(estimate.workload.taskCount, "0");
  assert.equal(harness.createdData?.semanticScopeHash, null);
  assert.equal(harness.createdData?.scopeHash, null);
  assert.ok(
    estimate.blockers.some(
      ({ code }) => code === "KEYWORD_LIMIT_EXCEEDED"
    )
  );
});

test("keeps a provider-incompatible bounded scope blocked and exactly replayable", async () => {
  const harness = estimateHarness({
    scope: scope({
      keywordCount: "1",
      semanticScopeHash: { availability: "UNAVAILABLE" }
    })
  });
  const original = await harness.service.create(
    input,
    "rank-estimate-unavailable-bounded"
  );
  const replay = await harness.service.create(
    input,
    "rank-estimate-unavailable-bounded"
  );

  assert.equal(original.status, "BLOCKED");
  assert.equal(original.scope.keywordCount, "1");
  assert.deepEqual(original.scope.scopeHash, {
    availability: "UNAVAILABLE"
  });
  assert.equal(original.workload.taskCount, "1");
  assert.equal(original.workload.minimumRequestCount, "3");
  assert.ok(
    original.blockers.some(
      ({ code }) => code === "SCOPE_HASH_UNAVAILABLE"
    )
  );
  assert.equal(
    original.blockers.some(
      ({ code }) => code === "KEYWORD_LIMIT_EXCEEDED"
    ),
    false
  );
  assert.equal(harness.createdData?.semanticScopeHash, null);
  assert.equal(harness.createdData?.scopeHash, null);
  assert.deepEqual(replay, original);
  assert.equal(harness.seoCalls, 1);
  assert.equal(harness.transactionCalls, 1);
});

test("rejects unavailable empty and available sentinel snapshots", async () => {
  const unavailableHarness = estimateHarness({
    scope: scope({
      keywordCount: "1",
      semanticScopeHash: { availability: "UNAVAILABLE" }
    })
  });
  const unavailable = await unavailableHarness.service.create(
    input,
    "rank-estimate-snapshot-empty"
  );
  assert.throws(
    () =>
      rankEstimateSnapshot({
        ...unavailable,
        scope: {
          ...unavailable.scope,
          keywordCount: "0",
          pairCount: "0"
        },
        workload: {
          ...unavailable.workload,
          taskCount: "0",
          minimumRequestCount: "0"
        }
      }),
    /Invalid immutable rank estimate snapshot/u
  );

  const availableHarness = estimateHarness();
  const available = await availableHarness.service.create(
    input,
    "rank-estimate-snapshot-sentinel"
  );
  assert.throws(
    () =>
      rankEstimateSnapshot({
        ...available,
        scope: {
          ...available.scope,
          keywordCount: "15001",
          pairCount: "15001"
        },
        workload: {
          ...available.workload,
          taskCount: "0",
          minimumRequestCount: "0"
        }
      }),
    /Invalid immutable rank estimate snapshot/u
  );
});

test("rejects unavailable empty and one-null stored hash replays", async () => {
  const harness = estimateHarness({
    scope: scope({
      keywordCount: "1",
      semanticScopeHash: { availability: "UNAVAILABLE" }
    })
  });
  await harness.service.create(
    input,
    "rank-estimate-invalid-stored-hashes"
  );

  harness.changeStored({ keywordCount: 0 });
  await assert.rejects(
    harness.service.create(
      input,
      "rank-estimate-invalid-stored-hashes"
    ),
    /Invalid immutable rank estimate scope hashes/u
  );

  harness.changeStored({
    keywordCount: 1,
    scopeHash: Uint8Array.from(Buffer.alloc(32))
  });
  await assert.rejects(
    harness.service.create(
      input,
      "rank-estimate-invalid-stored-hashes"
    ),
    /Invalid immutable rank estimate scope hashes/u
  );
  assert.equal(harness.seoCalls, 1);
});

test("strictly scopes connector and validation reads to the trusted tenant", async () => {
  const harness = estimateHarness();
  await harness.service.create(input, "rank-estimate-scope");

  assert.deepEqual(harness.bindingQuery?.where, {
    workspaceId,
    projectId,
    capability: "SERP_RANK_TRACKING"
  });
  assert.equal(harness.validationQuery?.where.workspaceId, workspaceId);
  assert.equal(
    harness.validationQuery?.where.deduplicationKey,
    `integration-credential-validation:${credentialId}:3`
  );
  assert.equal(
    "inputSnapshot" in harness.validationQuery.where,
    false
  );
});

function estimateHarness(options: {
  readonly scope?: InternalRankEstimateScope;
  readonly binding?: ReturnType<typeof binding> | null;
  readonly validation?: ReturnType<typeof validation> | null;
  readonly uniqueConflictOnCreate?: boolean;
} = {}) {
  let stored: Record<string, unknown> | null = null;
  let createdData: Record<string, unknown> | undefined;
  let bindingQuery: any;
  let validationQuery: any;
  let transactionIsolation: string | undefined;
  let seoCalls = 0;
  let transactionCalls = 0;
  const selectedBinding =
    options.binding === undefined ? binding() : options.binding;
  const selectedValidation =
    options.validation === undefined
      ? validation(selectedBinding?.routes[0]?.credential.verifiedAt ?? null)
      : options.validation;

  const rankEstimate = {
    findUnique: async () => stored,
    create: async ({ data }: { readonly data: Record<string, unknown> }) => {
      createdData = data;
      stored = { ...data, createdAt: new Date() };
      if (options.uniqueConflictOnCreate) {
        throw { code: "P2002" };
      }
      return stored;
    }
  };
  const transaction = {
    rankEstimate,
    projectConnectorBinding: {
      findFirst: async (query: unknown) => {
        bindingQuery = query;
        return selectedBinding;
      }
    },
    job: {
      findFirst: async (query: unknown) => {
        validationQuery = query;
        return selectedValidation;
      }
    },
    $queryRaw: async () => [{ id: estimateId, calculatedAt: new Date() }]
  };
  const prisma = {
    rankEstimate,
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>,
      config: { readonly isolationLevel: string }
    ) => {
      transactionCalls += 1;
      transactionIsolation = config.isolationLevel;
      return callback(transaction);
    }
  } as unknown as PrismaService;
  const seoData = {
    rankEstimateScope: async () => {
      seoCalls += 1;
      return options.scope ?? scope();
    }
  } as unknown as SeoDataClient;
  const routing = {
    resolve: async (
      _workspaceId: string,
      _projectId: string,
      _capability: string,
      _actorId: string,
      requestedProvider?: "ARSENKIN" | "XMLSTOCK"
    ) => {
      const selectedRoute = requestedProvider === undefined
        ? selectedBinding?.routes[0]
        : selectedBinding?.routes.find(
            ({ credential }) => credential.provider === requestedProvider
          );
      if (!selectedBinding || !selectedRoute) {
        throw new ConflictException({
          code: "CONNECTOR_NOT_READY",
          message: "No active integration route can execute this operation"
        });
      }
      return {
        bindingId: selectedBinding.id,
        bindingVersion: selectedBinding.version,
        routeId: selectedRoute.id,
        credentialId: selectedRoute.credentialId,
        provider: selectedRoute.credential.provider,
        credentialMode: selectedRoute.credential.mode,
        routingScope: "PROJECT_OVERRIDE",
        position: selectedRoute.position,
        attempts: [
          {
            sequence: 1,
            provider: selectedRoute.credential.provider,
            routingScope: "PROJECT_OVERRIDE",
            outcome: "SELECTED",
            occurredAt: "2026-08-04T10:00:00.000Z"
          }
        ]
      };
    }
  };

  return {
    service: new RankEstimateService(prisma, seoData, routing as never),
    get createdData() {
      return createdData;
    },
    get bindingQuery() {
      return bindingQuery;
    },
    get validationQuery() {
      return validationQuery;
    },
    get transactionIsolation() {
      return transactionIsolation;
    },
    get seoCalls() {
      return seoCalls;
    },
    get transactionCalls() {
      return transactionCalls;
    },
    changeStored(change: Readonly<Record<string, unknown>>) {
      if (!stored) throw new Error("No stored estimate");
      stored = { ...stored, ...change };
    }
  };
}

function scope(
  overrides: Partial<InternalRankEstimateScope> = {}
): InternalRankEstimateScope {
  const keywordCount = overrides.keywordCount ?? "250";
  return {
    workspaceId,
    projectId,
    trackingContextId,
    contextStatus: "ACTIVE",
    contextVersion: 3,
    configurationVersion: 3,
    configurationHash: "a".repeat(64),
    configuration: {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "1011969",
      language: "ru",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false
    },
    keywordCount,
    contextCount: "1",
    pairCount: keywordCount,
    semanticScopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: "b".repeat(64)
    },
    calculatedAt: new Date().toISOString(),
    ...overrides
  };
}

function binding(
  overrides: {
    readonly verifiedAt?: Date | null;
    readonly status?: string;
    readonly provider?: "ARSENKIN" | "XMLSTOCK";
  } = {}
) {
  const verifiedAt =
    overrides.verifiedAt === undefined
      ? new Date(Date.now() - 60_000)
      : overrides.verifiedAt;
  return {
    id: bindingId,
    workspaceId,
    projectId,
    capability: "SERP_RANK_TRACKING",
    enabled: true,
    version: 4,
    routes: [
      {
        id: routeId,
        workspaceId,
        projectId,
        bindingId,
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId,
        credential: {
          id: credentialId,
          workspaceId,
          provider: overrides.provider ?? "ARSENKIN",
          mode: "BYOK_API_KEY",
          status: overrides.status ?? "ACTIVE",
          capabilities: ["SERP_RANK_TRACKING"],
          materialVersion: 3,
          version: 6,
          verifiedAt,
          lastSuccessAt: verifiedAt,
          deletedAt: null,
          ciphertext: secretSentinel
        }
      }
    ]
  };
}

function validation(
  finishedAt: Date | null,
  overrides: {
    readonly materialVersion?: number;
    readonly provider?: "ARSENKIN" | "XMLSTOCK";
    readonly credentialId?: string;
  } = {}
) {
  if (!finishedAt) return null;
  const materialVersion = overrides.materialVersion ?? 3;
  const selectedCredentialId = overrides.credentialId ?? credentialId;
  return {
    id: validationId,
    workspaceId,
    provider: overrides.provider ?? "ARSENKIN",
    status: "COMPLETED",
    deduplicationKey:
      `integration-credential-validation:${selectedCredentialId}:${materialVersion}`,
    inputSnapshot: {
      kind: "integration.credential.validation.v1",
      credentialId: selectedCredentialId,
      credentialMaterialVersion: materialVersion,
      connectorVersion:
        overrides.provider === "XMLSTOCK"
          ? "xmlstock@1.2.0"
          : "arsenkin@1.0.0"
    },
    version: 5,
    finishedAt
  };
}
