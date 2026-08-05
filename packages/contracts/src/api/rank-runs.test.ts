import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizedRankDataQualityFlags,
  normalizedRankResultTypes,
  rankCheckFinalStatuses,
  rankJobFailureCodes,
  rankJobStages,
  rankJobStatuses,
  rankRunConflictDetails,
  rankRunConflictReasons,
  rankSearchSourceFromProviderMappingVersion,
  rankManifestChunkHashPreimage,
  rankManifestDeduplicationHashPreimage,
  rankManifestHashPreimage,
  redactRankJobSummary,
  type CreateRankRunInput,
  type InternalCreateRankRunInput,
  type InternalCancelRankJobInput,
  type InternalFinalizeRankCheckInput,
  type InternalIngestRankChunkInput,
  type InternalNormalizedRankFoundResult,
  type InternalNormalizedRankNotFoundResult,
  type InternalNormalizedRankResult,
  type InternalRankManifestChunk,
  type InternalRankManifestSeal,
  type InternalSealRankManifestInput,
  type RankRunConflictDetails,
  type RankJobSummary
} from "./rank-runs.js";
import { canonicalJsonSha256 } from "../canonical-json.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  membershipId: "01900000-0000-7000-8000-000000000004",
  estimateId: "01900000-0000-7000-8000-000000000005",
  jobId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  trackingContextId: "01900000-0000-7000-8000-000000000008",
  jobItemId: "01900000-0000-7000-8000-000000000009",
  entryId: "01900000-0000-7000-8000-000000000010",
  assignmentId: "01900000-0000-7000-8000-000000000011",
  keywordId: "01900000-0000-7000-8000-000000000012"
} as const;

const hash = (value: string) =>
  ({
    algorithm: "SHA_256",
    value: value.repeat(64)
  }) as const;

test("rank run public vocabularies are finite and pin the first execution slice", () => {
  assert.deepEqual(rankJobStatuses, [
    "PREPARING",
    "QUEUED",
    "RUNNING",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "PARTIALLY_COMPLETED",
    "COMPLETED",
    "FAILED",
    "ACTION_REQUIRED"
  ]);
  assert.deepEqual(rankJobStages, [
    "PREPARING_SCOPE",
    "WAITING_FOR_QUEUE",
    "WAITING_EXECUTION_GRANT",
    "READY_TO_SUBMIT",
    "SUBMITTING",
    "WAITING_PROVIDER",
    "FETCHING_RESULT",
    "PERSISTING_RESULT",
    "FINALIZING",
    "SUBMIT_OUTCOME_UNKNOWN",
    "FINISHED"
  ]);
  assert.deepEqual(rankJobFailureCodes, [
    "ESTIMATE_EXPIRED",
    "ESTIMATE_STALE",
    "EQUIVALENT_RUN_ACTIVE",
    "EXECUTION_GRANT_DENIED",
    "PROVIDER_AUTHENTICATION_FAILED",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_TEMPORARY_FAILURE",
    "PROVIDER_RESPONSE_INVALID",
    "PERSISTENCE_FAILED",
    "INTERNAL_ERROR",
    "SUBMIT_OUTCOME_UNKNOWN"
  ]);
  assert.deepEqual(rankRunConflictReasons, [
    "EQUIVALENT_RUN_ACTIVE",
    "ESTIMATE_EXPIRED",
    "ESTIMATE_STALE",
    "EXECUTION_GRANT_DENIED"
  ]);
  assert.deepEqual(normalizedRankResultTypes, ["ORGANIC"]);
  assert.deepEqual(normalizedRankDataQualityFlags, [
    "PROVIDER_OBSERVED_AT_UNAVAILABLE",
    "ABSOLUTE_POSITION_UNAVAILABLE",
    "PIXEL_POSITION_UNAVAILABLE",
    "TITLE_UNAVAILABLE",
    "SNIPPET_UNAVAILABLE"
  ]);
  assert.deepEqual(rankCheckFinalStatuses, [
    "COMPLETED",
    "PARTIALLY_COMPLETED",
    "CANCELLED",
    "FAILED",
    "ACTION_REQUIRED"
  ]);
});

test("derives only explicit live and XML search sources from mapping versions", () => {
  assert.equal(
    rankSearchSourceFromProviderMappingVersion(
      "YANDEX",
      "xmlstock-yandex-search-api@2"
    ),
    "SEARCH_API"
  );
  assert.equal(
    rankSearchSourceFromProviderMappingVersion(
      "YANDEX",
      "arsenkin-yandex-live@2"
    ),
    "LIVE"
  );
  assert.equal(
    rankSearchSourceFromProviderMappingVersion(
      "GOOGLE",
      "xmlstock-google-live@2"
    ),
    "LIVE"
  );
  assert.equal(
    rankSearchSourceFromProviderMappingVersion(
      "YANDEX",
      "arsenkin-positions@1"
    ),
    undefined
  );
});

test("rank run conflict details expose an attachable Job only for an equivalent run", () => {
  const attachable = rankRunConflictDetails({
    reason: "EQUIVALENT_RUN_ACTIVE",
    existingJobId: ids.jobId
  });
  const expired = rankRunConflictDetails({
    reason: "ESTIMATE_EXPIRED"
  });

  assert.deepEqual(attachable, {
    reason: "EQUIVALENT_RUN_ACTIVE",
    existingJobId: ids.jobId
  } satisfies RankRunConflictDetails);
  assert.deepEqual(expired, {
    reason: "ESTIMATE_EXPIRED"
  } satisfies RankRunConflictDetails);

  for (const invalid of [
    {
      reason: "ESTIMATE_STALE",
      existingJobId: ids.jobId
    },
    {
      reason: "EQUIVALENT_RUN_ACTIVE"
    },
    {
      reason: "EQUIVALENT_RUN_ACTIVE",
      existingJobId:
        "0190000a-0000-7000-8000-000000000006".toUpperCase()
    },
    {
      reason: "EQUIVALENT_RUN_ACTIVE",
      existingJobId: "not-a-uuid"
    },
    {
      reason: "UNKNOWN_CONFLICT"
    },
    {
      reason: "ESTIMATE_EXPIRED",
      credentialId: "private-credential"
    }
  ]) {
    assert.throws(
      () => rankRunConflictDetails(invalid),
      /Invalid rank run conflict details/u
    );
  }
});

test("public create body contains only immutable estimate identity", () => {
  const input = {
    estimateId: ids.estimateId
  } satisfies CreateRankRunInput;

  assert.deepEqual(Object.keys(input), ["estimateId"]);
  assert.equal("projectId" in input, false);
  assert.equal("credentialId" in input, false);
  assert.equal("bindingId" in input, false);
  assert.equal("keywordIds" in input, false);
  assert.equal("idempotencyKey" in input, false);
});

test("public rank summary is rebuilt from an exact redaction allowlist", () => {
  const unsafeSummary = {
    id: ids.jobId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    trackingContextId: ids.trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    searchEngine: "YANDEX",
    searchSource: "LIVE",
    depth: 30,
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    status: "FAILED",
    stage: "FINISHED",
    progress: {
      current: "2",
      total: "2",
      unit: "KEYWORD",
      keywordText: "private-keyword"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    result: {
      pairCount: "2",
      persistedCount: "1",
      foundCount: "1",
      notFoundCount: "0",
      failedCount: "1",
      submitOutcomeUnknownCount: "0",
      rankingUrl: "https://private-result.example"
    },
    failure: {
      code: "PROVIDER_RESPONSE_INVALID",
      rawProviderResponse: "private-provider-payload"
    },
    createdAt: "2026-07-29T12:00:00.000Z",
    queuedAt: "2026-07-29T12:00:01.000Z",
    startedAt: "2026-07-29T12:00:02.000Z",
    finishedAt: "2026-07-29T12:00:03.000Z",
    credentialId: "private-credential",
    credentialMaterialVersion: 7,
    bindingId: "private-binding",
    projectDomain: "private-project.example",
    keywordId: ids.keywordId,
    keywordText: "private-keyword",
    rankingUrl: "https://private-result.example",
    providerRequestId: "private-provider-request",
    rawProviderResponse: "private-provider-payload"
  } as const;

  const summary = redactRankJobSummary(unsafeSummary);

  assert.deepEqual(summary, {
    id: ids.jobId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    trackingContextId: ids.trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    searchEngine: "YANDEX",
    searchSource: "LIVE",
    depth: 30,
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    status: "FAILED",
    stage: "FINISHED",
    progress: {
      current: "2",
      total: "2",
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    result: {
      pairCount: "2",
      persistedCount: "1",
      foundCount: "1",
      notFoundCount: "0",
      failedCount: "1",
      submitOutcomeUnknownCount: "0"
    },
    failure: {
      code: "PROVIDER_RESPONSE_INVALID"
    },
    createdAt: "2026-07-29T12:00:00.000Z",
    queuedAt: "2026-07-29T12:00:01.000Z",
    startedAt: "2026-07-29T12:00:02.000Z",
    finishedAt: "2026-07-29T12:00:03.000Z"
  });

  const publicJson = JSON.stringify(summary);
  for (const privateValue of [
    "private-credential",
    "private-binding",
    "private-project.example",
    "private-keyword",
    "private-result.example",
    "private-provider-request",
    "private-provider-payload"
  ]) {
    assert.equal(publicJson.includes(privateValue), false);
  }

  const forbiddenKeys = [
    "credentialId",
    "credentialMaterialVersion",
    "bindingId",
    "projectDomain",
    "keywordId",
    "keywordText",
    "rankingUrl",
    "normalizedRankingUrl",
    "providerRequestId",
    "rawProviderResponse"
  ];
  for (const key of forbiddenKeys) {
    assert.equal(publicJson.includes(`"${key}"`), false);
  }
});

test("public rank summary rejects contradictory lifecycle projections", () => {
  const base = {
    id: ids.jobId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    trackingContextId: ids.trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    progress: {
      current: "1",
      total: "1",
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    createdAt: "2026-07-29T12:00:00.000Z"
  } as const;
  const result = {
    pairCount: "1",
    persistedCount: "1",
    foundCount: "1",
    notFoundCount: "0",
    failedCount: "0",
    submitOutcomeUnknownCount: "0"
  } as const;

  const invalid = [
    {
      ...base,
      status: "COMPLETED",
      stage: "SUBMITTING",
      result,
      finishedAt: "2026-07-29T12:01:00.000Z"
    },
    {
      ...base,
      status: "RUNNING",
      stage: "WAITING_PROVIDER",
      result,
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...base,
      status: "ACTION_REQUIRED",
      stage: "SUBMIT_OUTCOME_UNKNOWN",
      result,
      failure: { code: "PROVIDER_TEMPORARY_FAILURE" },
      finishedAt: "2026-07-29T12:01:00.000Z"
    },
    {
      ...base,
      status: "FAILED",
      stage: "FINISHED",
      failure: { code: "UNKNOWN_PROVIDER_FAILURE" },
      finishedAt: "2026-07-29T12:01:00.000Z"
    },
    {
      ...base,
      status: "UNKNOWN_STATUS",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:01:00.000Z"
    },
    {
      ...base,
      type: "PRIVATE_RANK_CHECK",
      status: "PREPARING",
      stage: "PREPARING_SCOPE"
    }
  ];

  for (const summary of invalid) {
    assert.throws(
      () => redactRankJobSummary(summary as unknown as RankJobSummary),
      /Invalid rank job lifecycle/u
    );
  }
});

test("internal create carries trusted project and access snapshots without execution secrets", () => {
  const input = {
    estimateId: ids.estimateId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    project: {
      id: ids.projectId,
      workspaceId: ids.workspaceId,
      domain: "project.example",
      status: "ACTIVE",
      version: 7
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId: ids.membershipId,
      membershipVersion: 4,
      canRunRanking: true,
      entitlementStatus: "ALLOWED",
      quota: {
        status: "AVAILABLE",
        limit: "1000",
        used: "10",
        remaining: "990",
        resetsAt: "2026-08-01T00:00:00.000Z"
      }
    },
    billingCurrency: "RUB",
    jobCapacity: {
      planCode: "TEAM",
      planVersion: 3,
      concurrentJobs: 10
    }
  } as const satisfies InternalCreateRankRunInput;

  assert.equal(input.project.workspaceId, input.workspaceId);
  assert.equal(input.project.id, input.projectId);
  assert.equal(input.access.canRunRanking, true);
  assert.equal("idempotencyKey" in input, false);

  const serialized = JSON.stringify(input);
  assert.equal(serialized.includes("credentialId"), false);
  assert.equal(serialized.includes("bindingId"), false);
  assert.equal(serialized.includes("keywordText"), false);
  assert.equal(serialized.includes("providerPayload"), false);
});

test("internal job read and cancel identity is exact and tenant scoped", () => {
  const input = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId
  } satisfies InternalCancelRankJobInput;

  assert.deepEqual(Object.keys(input), [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId"
  ]);
  assert.equal("workspaceStatus" in input, false);
  assert.equal("projectStatus" in input, false);
  assert.equal("credentialId" in input, false);
});

test("manifest boundaries seal exact scope and keep keyword text internal", () => {
  const project = {
    id: ids.projectId,
    workspaceId: ids.workspaceId,
    domain: "project.example",
    status: "ACTIVE",
    version: 7
  } as const;
  const execution = {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: {
      mode: "EXACT_HOST"
    },
    safeSearch: true,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: "arsenkin-positions.v1"
  } as const;

  const sealInput = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    estimateId: ids.estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project,
    estimate: {
      trackingContextId: ids.trackingContextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "1",
      expiresAt: "2026-07-29T12:05:00.000Z"
    },
    execution,
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  } as const satisfies InternalSealRankManifestInput;

  const seal = {
    id: ids.manifestId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    estimateId: ids.estimateId,
    estimateExpiresAt: "2026-07-29T12:05:00.000Z",
    sealedBy: ids.actorId,
    trackingContextId: ids.trackingContextId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project,
    contextVersion: 3,
    configurationVersion: 2,
    configurationHash: hash("a"),
    semanticScopeHash: hash("b"),
    scopeHash: hash("c"),
    hashSchemaVersion: "rank-manifest@1",
    manifestHash: hash("d"),
    deduplicationHash: hash("e"),
    pairCount: "1",
    chunkCount: "1",
    chunkSize: "250",
    execution,
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    status: "SEALED",
    sealedAt: "2026-07-29T12:00:00.000Z"
  } as const satisfies InternalRankManifestSeal;

  const chunk = {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("f"),
    entries: [
      {
        id: ids.entryId,
        sequence: 0,
        assignmentId: ids.assignmentId,
        keywordId: ids.keywordId,
        keywordVersion: 5,
        keywordText: "internal keyword",
        keywordTextHash: hash("1"),
        language: "ru"
      }
    ]
  } as const satisfies InternalRankManifestChunk;

  assert.equal(sealInput.execution.rawSerp, false);
  assert.equal(sealInput.execution.fallbackMode, "NONE");
  assert.equal(seal.chunkSize, "250");
  assert.equal(seal.hashSchemaVersion, "rank-manifest@1");
  assert.notDeepEqual(seal.manifestHash, seal.deduplicationHash);
  assert.equal(chunk.entries.length <= 250, true);
  assert.equal(chunk.entries[0]?.keywordText, "internal keyword");
  assert.equal("credentialId" in sealInput, false);
  assert.equal("bindingId" in sealInput, false);

  const chunkPreimage = rankManifestChunkHashPreimage(chunk);
  assert.deepEqual(Object.keys(chunkPreimage), [
    "hashSchemaVersion",
    "manifestId",
    "chunkIndex",
    "entries"
  ]);
  assert.deepEqual(Object.keys(chunkPreimage.entries[0] ?? {}), [
    "id",
    "sequence",
    "assignmentId",
    "keywordId",
    "keywordVersion",
    "keywordText",
    "keywordTextHash",
    "language"
  ]);
  assert.equal("workspaceId" in chunkPreimage, false);
  assert.equal("projectId" in chunkPreimage, false);
  assert.equal("jobId" in chunkPreimage, false);
  assert.equal("chunkHash" in chunkPreimage, false);

  const deduplicationPreimage =
    rankManifestDeduplicationHashPreimage(sealInput, chunk.entries);
  assert.deepEqual(Object.keys(deduplicationPreimage), [
    "hashSchemaVersion",
    "workspaceId",
    "projectId",
    "project",
    "provider",
    "operation",
    "execution",
    "retention",
    "keywords"
  ]);
  assert.deepEqual(Object.keys(deduplicationPreimage.project), [
    "domain"
  ]);
  assert.deepEqual(
    Object.keys(deduplicationPreimage.keywords[0] ?? {}),
    ["keywordId", "keywordTextHash", "language"]
  );
  const deduplicationJson = JSON.stringify(deduplicationPreimage);
  for (const excludedField of [
    "contextVersion",
    "configurationVersion",
    "configurationHash",
    "semanticScopeHash",
    "keywordVersion",
    "scopeHash",
    "jobId",
    "estimateId",
    "manifestId",
    "entryId",
    "assignmentId",
    "actorId",
    "sealedAt"
  ]) {
    assert.equal(deduplicationJson.includes(excludedField), false);
  }
  const mutatedDeduplicationPreimage =
    rankManifestDeduplicationHashPreimage(
      {
        ...sealInput,
        actorId: "01900000-0000-7000-8000-000000000090",
        jobId: "01900000-0000-7000-8000-000000000091",
        estimateId: "01900000-0000-7000-8000-000000000092",
        project: {
          ...sealInput.project,
          version: 99
        },
        estimate: {
          ...sealInput.estimate,
          trackingContextId:
            "01900000-0000-7000-8000-000000000095",
          contextVersion: 98,
          configurationVersion: 97,
          configurationHash: hash("7"),
          semanticScopeHash: hash("8"),
          scopeHash: hash("9"),
          expiresAt: "2026-07-29T12:06:00.000Z"
        }
      },
      chunk.entries.map((entry) => ({
        ...entry,
        id: "01900000-0000-7000-8000-000000000093",
        assignmentId: "01900000-0000-7000-8000-000000000094",
        keywordVersion: 96
      }))
    );
  assert.deepEqual(
    mutatedDeduplicationPreimage,
    deduplicationPreimage
  );

  const { manifestHash: storedManifestHash, ...sealWithoutHash } = seal;
  assert.deepEqual(storedManifestHash, hash("d"));
  const manifestPreimage = rankManifestHashPreimage(sealWithoutHash, [
    chunk.chunkHash
  ]);
  assert.equal("manifestHash" in manifestPreimage, false);
  assert.equal(manifestPreimage.jobId, ids.jobId);
  assert.equal(manifestPreimage.sealedBy, ids.actorId);
  assert.equal(
    manifestPreimage.estimateExpiresAt,
    "2026-07-29T12:05:00.000Z"
  );
  assert.deepEqual(manifestPreimage.scopeHash, hash("c"));
  assert.deepEqual(manifestPreimage.chunkHashes, [chunk.chunkHash]);

  assert.equal(
    canonicalJsonSha256("rank-manifest-chunk@1", chunkPreimage),
    "6111d8d70f779230f122604bc0e911b1126f5c07e86a4a190c75cc641144360a"
  );
  assert.equal(
    canonicalJsonSha256(
      "rank-manifest@1",
      deduplicationPreimage
    ),
    "4a00eec14217d038a594174867b352fc1d32854dea3a8bea39fe88f200a05005"
  );
  assert.equal(
    canonicalJsonSha256("rank-manifest@1", manifestPreimage),
    "8f8160effac285b26d142e472f7ebc71f41363e47bfd0410a6ef6bceda5e7030"
  );
});

test("normalized result union distinguishes found from valid not found", () => {
  const found = {
    manifestEntryId: ids.entryId,
    keywordId: ids.keywordId,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE"
    ],
    found: true,
    position: 7,
    rankingUrl: "https://project.example/page",
    normalizedRankingUrl: "https://project.example/page",
    resultType: "ORGANIC",
    serpFeatures: []
  } as const satisfies InternalNormalizedRankFoundResult;

  const notFound = {
    manifestEntryId: "01900000-0000-7000-8000-000000000013",
    keywordId: "01900000-0000-7000-8000-000000000014",
    dataQualityFlags: ["PROVIDER_OBSERVED_AT_UNAVAILABLE"],
    found: false,
    position: null
  } as const satisfies InternalNormalizedRankNotFoundResult;

  const results: readonly InternalNormalizedRankResult[] = [found, notFound];
  assert.equal(results[0]?.found, true);
  assert.equal(results[1]?.found, false);
  assert.deepEqual(Object.keys(notFound), [
    "manifestEntryId",
    "keywordId",
    "dataQualityFlags",
    "found",
    "position"
  ]);
  assert.equal("rankingUrl" in notFound, false);
  assert.equal("resultType" in notFound, false);

  const invalidNotFound: InternalNormalizedRankNotFoundResult = {
    ...notFound,
    // @ts-expect-error A not-found observation must never carry a URL.
    rankingUrl: "https://must-not-be-representable.example"
  };
  assert.equal(invalidNotFound.found, false);
});

test("ingest and finalize DTOs are tenant-scoped, normalized and count-free on command", () => {
  const results = [
    {
      manifestEntryId: ids.entryId,
      keywordId: ids.keywordId,
      dataQualityFlags: [],
      found: false,
      position: null
    }
  ] as const satisfies readonly InternalNormalizedRankResult[];

  const ingest = {
    schemaVersion: "rank-ingest@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    manifestChunkHash: hash("3"),
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "arsenkin-task-1",
    connectorVersion: "arsenkin.v1",
    observedAt: "2026-07-29T12:05:00.000Z",
    ingestEnvelopeHash: hash("2"),
    results
  } as const satisfies InternalIngestRankChunkInput;

  const finalize = {
    schemaVersion: "rank-finalize@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    status: "COMPLETED"
  } as const satisfies InternalFinalizeRankCheckInput;

  assert.equal(ingest.results[0].found, false);
  assert.equal("rawProviderResponse" in ingest, false);
  assert.deepEqual(Object.keys(finalize), [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "manifestId",
    "status"
  ]);
  assert.equal("persistedCount" in finalize, false);
  assert.equal("foundCount" in finalize, false);
  assert.equal("notFoundCount" in finalize, false);
});
