import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { batchedArsenkinRankPolicyVersion, largeXmlStockRankPolicyVersion, type InternalRankChunkIngestCommand, type InternalSealRankManifestInput } from "@seo-platform/contracts";
import { rankChunkIngestHash } from "@seo-platform/contracts/rank-results-canonical";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { TrackingContextService } from "../tracking-contexts/tracking-context.service.js";
import { RankScopeService } from "../rank-scopes/rank-scope.service.js";
import { RankResultService } from "../rank-results/rank-result.service.js";
import { RankManifestService } from "./rank-manifest.service.js";
import { RankFinalizationService } from "./rank-finalization.service.js";

const databaseUrl = process.env.SEO_DATA_LARGE_RANK_TEST_DATABASE_URL;
// This is an end-to-end persistence fixture, not a wall-clock benchmark. It
// competes with other suites on the VPS; per-query/transaction limits remain.
test("PostgreSQL 50k rank selection, Arsenkin batches and XMLStock manifests preserve exact rows and replay", { skip: !databaseUrl, timeout: 360_000 }, async () => {
  assert.ok(databaseUrl); const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432", "Disposable cluster required");
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }));
  const timing: Record<string, number> = {};
  try {
    const [ids] = await prisma.$queryRaw<{ workspaceId: string; projectId: string; actorId: string; jobId: string; estimateId: string; xmlJobId: string; xmlEstimateId: string; itemId: string }[]>`SELECT uuidv7() AS "workspaceId", uuidv7() AS "projectId", uuidv7() AS "actorId", uuidv7() AS "jobId", uuidv7() AS "estimateId", uuidv7() AS "xmlJobId", uuidv7() AS "xmlEstimateId", uuidv7() AS "itemId"`;
    assert.ok(ids);
    let started = performance.now();
    await prisma.$executeRaw`INSERT INTO keywords (workspace_id, project_id, text_original, text_normalized, normalized_hash, language, created_by, updated_at)
      SELECT ${ids.workspaceId}::uuid, ${ids.projectId}::uuid, 'large rank keyword ' || n, 'large rank keyword ' || n,
        encode(sha256(convert_to('large rank keyword ' || n, 'UTF8')), 'hex'), 'en', ${ids.actorId}::uuid, CURRENT_TIMESTAMP
      FROM generate_series(1, 50000) AS n`;
    timing.seedMs = performance.now() - started; process.stdout.write(`large-rank-step seedMs=${Math.round(timing.seedMs)}\n`);
    const keywords = await prisma.keyword.findMany({ where: { workspaceId: ids.workspaceId, projectId: ids.projectId }, select: { id: true }, orderBy: { id: "asc" } });
    assert.equal(keywords.length, 50_000);
    const contexts = new TrackingContextService(prisma);
    const configuration = { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "213", regionLabel: "Москва", language: "ru", device: "DESKTOP" as const, depth: 30 as const, domainMatchRule: { mode: "EXACT_HOST" as const }, safeSearch: false };
    const context = await contexts.create({ workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId, idempotencyKey: randomUUID(), name: "50k scope", configuration });
    const assignment = { workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId, contextId: context.id, version: context.version, idempotencyKey: randomUUID(), keywordIds: keywords.map(row => row.id), entitlement: { planCode: "TEAM", planVersion: 5, storedKeywords: 1_000_000, keywordsPerProject: 300_000, foldersPerProject: 0, trackedContextPairs: 2_000_000 } };
    started = performance.now();
    const assigned = await contexts.replaceKeywords(assignment);
    timing.assignMs = performance.now() - started; process.stdout.write(`large-rank-step assignMs=${Math.round(timing.assignMs)}\n`);
    assert.equal(assigned.addedKeywordCount, 50_000);
    assert.deepEqual(await contexts.replaceKeywords(assignment), assigned, "Exact assignment replay");
    started = performance.now();
    const scope = await new RankScopeService(prisma).calculate({ workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId, trackingContextId: context.id });
    timing.scopeMs = performance.now() - started; process.stdout.write(`large-rank-step scopeMs=${Math.round(timing.scopeMs)}\n`);
    assert.equal(scope.keywordCount, "50000"); assert.equal(scope.semanticScopeHash.availability, "AVAILABLE");
    assert.ok(scope.semanticScopeHash.availability === "AVAILABLE");
    const command: InternalSealRankManifestInput = {
      workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId, jobId: ids.jobId, estimateId: ids.estimateId,
      provider: "ARSENKIN", providerPolicyVersion: batchedArsenkinRankPolicyVersion, operation: "POSITIONS",
      project: { id: ids.projectId, workspaceId: ids.workspaceId, domain: "example.com", status: "ACTIVE", version: 1 },
      estimate: { trackingContextId: context.id, contextVersion: scope.contextVersion, configurationVersion: scope.configurationVersion,
        configurationHash: { algorithm: "SHA_256", value: scope.configurationHash }, semanticScopeHash: { algorithm: "SHA_256", value: scope.semanticScopeHash.value },
        scopeHash: { algorithm: "SHA_256", value: randomBytes(32).toString("hex") }, pairCount: "50000", expiresAt: new Date(Date.now() + 300_000).toISOString() },
      execution: { searchEngine: "GOOGLE", countryCode: "RU", regionCode: "213", language: "ru", device: "DESKTOP", depth: 30,
        domainMatchRule: { mode: "EXACT_HOST" }, safeSearch: false, format: "SIMPLE", rawSerp: false, fallbackMode: "NONE", providerMappingVersion: "arsenkin-positions@1" },
      retention: { normalizedRankHistory: "LONG_TERM", rawSerp: "NOT_COLLECTED" }
    };
    const manifests = new RankManifestService(prisma);
    started = performance.now(); const seal = await manifests.seal(command); timing.arsenkinSealMs = performance.now() - started; process.stdout.write(`large-rank-step arsenkinSealMs=${Math.round(timing.arsenkinSealMs)}\n`);
    assert.equal(seal.chunkCount, "10"); assert.equal(seal.chunkSize, "5000"); assert.equal(seal.pairCount, "50000");
    assert.deepEqual(await manifests.seal(command), seal, "Sealed history must replay without new entries");
    const chunk = await manifests.getChunk({ workspaceId: ids.workspaceId, projectId: ids.projectId, jobId: ids.jobId, manifestId: seal.id, chunkIndex: 9 });
    assert.equal(chunk.entries.length, 5000); assert.equal(chunk.entries[0]?.sequence, 45000); assert.equal(chunk.entries.at(-1)?.sequence, 49999);
    const ingest: InternalRankChunkIngestCommand = { schemaVersion: "rank-ingest@1", workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId,
      jobId: ids.jobId, jobItemId: ids.itemId, manifestId: seal.id, chunkIndex: 9, manifestChunkHash: chunk.chunkHash,
      provider: "ARSENKIN", operation: "POSITIONS", providerRequestId: "controlled-provider-no-live-call", connectorVersion: "arsenkin-positions@2.0.0", observedAt: new Date().toISOString(),
      results: chunk.entries.map(entry => ({ manifestEntryId: entry.id, keywordId: entry.keywordId, found: false, position: null, dataQualityFlags: [] })) };
    const result = { ...ingest, actorId: ids.actorId, ingestEnvelopeHash: rankChunkIngestHash(ingest, chunk) };
    started = performance.now(); const receipt = await new RankResultService(prisma).ingest(result); timing.ingestMs = performance.now() - started; process.stdout.write(`large-rank-step ingestMs=${Math.round(timing.ingestMs)}\n`);
    assert.equal(receipt.persistedCount, "5000"); assert.equal(receipt.notFoundCount, "5000");
    assert.deepEqual(await new RankResultService(prisma).ingest(result), receipt);
    started = performance.now();
    for (let chunkIndex = 0; chunkIndex < 9; chunkIndex++) {
      const next = await manifests.getChunk({ workspaceId: ids.workspaceId, projectId: ids.projectId, jobId: ids.jobId, manifestId: seal.id, chunkIndex });
      const [item] = await prisma.$queryRaw<{ id: string }[]>`SELECT uuidv7() AS id`;
      const nextCommand: InternalRankChunkIngestCommand = { ...ingest, jobItemId: item!.id, chunkIndex, manifestChunkHash: next.chunkHash, providerRequestId: `controlled-batch-${chunkIndex}`,
        results: next.entries.map(entry => ({ manifestEntryId: entry.id, keywordId: entry.keywordId, found: false, position: null, dataQualityFlags: [] })) };
      const nextReceipt = await new RankResultService(prisma).ingest({ ...nextCommand, actorId: ids.actorId, ingestEnvelopeHash: rankChunkIngestHash(nextCommand, next) });
      assert.equal(nextReceipt.persistedCount, "5000");
    }
    timing.remainingIngestMs = performance.now() - started; process.stdout.write(`large-rank-step remainingIngestMs=${Math.round(timing.remainingIngestMs)}\n`);
    const finalization = await new RankFinalizationService(prisma).finalize({ schemaVersion: "rank-finalize@1", workspaceId: ids.workspaceId, projectId: ids.projectId, actorId: ids.actorId, jobId: ids.jobId, manifestId: seal.id, status: "COMPLETED" });
    assert.equal(finalization.persistedCount, "50000"); assert.equal(finalization.missingCount, "0");
    started = performance.now();
    const xml = await manifests.seal({ ...command, provider: "XMLSTOCK", providerPolicyVersion: largeXmlStockRankPolicyVersion, jobId: ids.xmlJobId, estimateId: ids.xmlEstimateId,
      execution: { ...command.execution, providerMappingVersion: "xmlstock-google-live@2" } });
    timing.xmlSealMs = performance.now() - started; process.stdout.write(`large-rank-step xmlSealMs=${Math.round(timing.xmlSealMs)}\n`);
    assert.equal(xml.chunkCount, "50000"); assert.equal(xml.chunkSize, "1");
    const last = await manifests.getChunk({ workspaceId: ids.workspaceId, projectId: ids.projectId, jobId: ids.xmlJobId, manifestId: xml.id, chunkIndex: 49999 });
    assert.equal(last.entries.length, 1); assert.equal(last.entries[0]?.sequence, 49999);
    await assert.rejects(() => manifests.getChunk({ workspaceId: ids.workspaceId, projectId: ids.projectId, jobId: ids.xmlJobId, manifestId: xml.id, chunkIndex: 50000 }));
    assert.equal(await prisma.keyword.count({ where: { workspaceId: ids.workspaceId, projectId: ids.projectId } }), 50_000);
    process.stdout.write(`large-rank-postgres ${JSON.stringify({ keywords: 50000, liveProviderCalls: 0, ...timing })}\n`);
  } finally { await prisma.$disconnect(); }
});
