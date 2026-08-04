import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedInternalCrawlOperationResultPage,
  scopedInternalFrequencyOperationResult,
  scopedInternalRankOperationResult
} from "./operation-result-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const crawlId = "01900000-0000-7000-8000-000000000005";

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
          sequence: 0,
          requestedUrl: "https://example.com/a",
          finalUrl: "https://example.com/a",
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
  assert.equal(crawl.rows[0]?.indexability, "BLOCKED_ROBOTS");
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
          rows: Array.from({ length: 1_001 }, () => ({}))
        },
        workspaceId,
        projectId,
        jobId
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
