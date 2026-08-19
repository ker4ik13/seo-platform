import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedInternalAiAnswerOperationResult,
  scopedInternalCrawlOperationResultPage,
  scopedInternalFrequencyOperationResult,
  scopedInternalRankOperationResult
} from "./operation-result-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const crawlId = "01900000-0000-7000-8000-000000000005";

test("accepts an AI answer result with optional provider content absent", () => {
  const result = scopedInternalAiAnswerOperationResult(
    {
      workspaceId,
      projectId,
      jobId,
      rows: [{
        keywordId,
        keyword: "подбор подшипника",
        snapshot: {
          answerPresent: true,
          siteFound: false,
          brandFound: false,
          sourceCount: 0,
          observedAt: "2026-08-19T12:00:00.000Z"
        }
      }]
    },
    workspaceId,
    projectId,
    jobId,
    [keywordId]
  );

  assert.equal(result.rows[0]?.snapshot?.answerPresent, true);
  assert.equal(result.rows[0]?.snapshot?.sourceCount, 0);
});

test("accepts exact frequency and crawl result projections", () => {
  const frequency = scopedInternalFrequencyOperationResult(
    {
      workspaceId,
      projectId,
      jobId,
      rows: [
        {
          keywordId,
          keyword: "seo аудит",
          snapshots: [
            {
              type: "BASE",
              regionCode: "213",
              device: "ALL",
              value: "1200",
              provider: "ARSENKIN",
              sourceMode: "BYOK",
              jobId,
              qualityFlags: [],
              observedAt: "2026-08-02T10:00:00.000Z"
            }
          ]
        }
      ]
    },
    workspaceId,
    projectId,
    jobId,
    [keywordId]
  );
  assert.equal(frequency.rows[0]?.snapshots[0]?.value, "1200");

  const crawl = scopedInternalCrawlOperationResultPage(
    {
      workspaceId,
      projectId,
      crawlId,
      rows: [
        {
          sequence: 1_000,
          requestedUrl: "https://example.com/a",
          finalUrl: "https://example.com/a",
          redirectChain: [],
          statusCode: 200,
          responseTimeMs: 100,
          sizeBytes: 1024,
          contentType: "text/html",
          indexability: "BLOCKED_ROBOTS",
          inSitemap: true,
          depth: 1,
          wordCount: 120,
          internalLinkCount: 3,
          externalLinkCount: 1,
          issues: [],
          crawledAt: "2026-08-02T10:00:00.000Z"
        }
      ],
      page: { hasNext: false }
    },
    workspaceId,
    projectId,
    crawlId,
    100
  );
  assert.equal(crawl.rows[0]?.sequence, 1_000);
  assert.equal(crawl.rows[0]?.indexability, "BLOCKED_ROBOTS");
});

test("accepts a rank result page beyond the former 1,000-row boundary", () => {
  const result = scopedInternalRankOperationResult(
    {
      workspaceId,
      projectId,
      jobId,
      trackingContextId: "01900000-0000-7000-8000-000000000006",
      contextName: "Google · Москва",
      execution: execution(),
      rows: [
        {
          sequence: 1_000,
          keywordId,
          keyword: "seo аудит",
          state: "PENDING",
          dataQualityFlags: []
        }
      ],
      page: { hasNext: false }
    },
    workspaceId,
    projectId,
    jobId,
    200,
    "999"
  );

  assert.equal(result.rows[0]?.sequence, 1_000);
  assert.deepEqual(result.page, { hasNext: false });
});

test("rejects forged tenant scope and oversized projections", () => {
  assert.throws(
    () =>
      scopedInternalFrequencyOperationResult(
        {
          workspaceId: "01900000-0000-7000-8000-000000000099",
          projectId,
          jobId,
          rows: []
        },
        workspaceId,
        projectId,
        jobId,
        []
      ),
    DomainError
  );
  assert.throws(
    () =>
      scopedInternalRankOperationResult(
        {
          workspaceId,
          projectId,
          jobId,
          trackingContextId: "01900000-0000-7000-8000-000000000006",
          contextName: "Google · Москва",
          execution: execution(),
          rows: Array.from({ length: 201 }, () => ({})),
          page: { hasNext: false }
        },
        workspaceId,
        projectId,
        jobId,
        200
      ),
    DomainError
  );
});

function execution() {
  return {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "EXACT_HOST" },
    safeSearch: false,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: "arsenkin-positions@1"
  };
}
