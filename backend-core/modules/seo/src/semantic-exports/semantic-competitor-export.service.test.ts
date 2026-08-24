import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { KeywordService } from "../keywords/keyword.service.js";
import { SemanticCompetitorExportService } from "./semantic-competitor-export.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const keywordId = "01900000-0000-7000-8000-000000000003";

test("exports unique latest SERP and AI competitors without the project domain", async () => {
  const queries: Prisma.Sql[] = [];
  const keywords = {
    list: async () => ({
      data: [{ id: keywordId }],
      page: { hasNext: false, totalApprox: 1 },
      meta: { requestId: "competitor-export-1" }
    })
  } as unknown as KeywordService;
  const prisma = {
    $queryRaw: async (query: Prisma.Sql) => {
      queries.push(query);
      if (query.sql.includes("rank_snapshots")) {
        return [
          candidate(
            "SERP",
            "https://competitor.example/catalog#result",
            "https://competitor.example/catalog",
            "SERP title",
            "SERP description"
          ),
          candidate(
            "SERP",
            "https://www.project.example/own",
            "https://www.project.example/own",
            "Own page",
            null
          )
        ];
      }
      return [
        candidate(
          "AI",
          "https://competitor.example/catalog",
          null,
          "AI duplicate",
          "AI duplicate description"
        ),
        candidate(
          "AI",
          "https://another.example/article",
          null,
          "AI source",
          "AI description"
        )
      ];
    }
  } as unknown as PrismaService;
  const service = new SemanticCompetitorExportService(prisma, keywords);

  const result = await service.list(
    { workspaceId, projectId },
    { limit: 100, sort: "CREATED_DESC" },
    { sources: ["SERP", "AI"] },
    "competitor-export-1"
  );

  assert.equal(queries.length, 2);
  assert.deepEqual(result, {
    data: [{
      keywordId,
      competitors: [
        {
          source: "SERP",
          url: "https://competitor.example/catalog",
          normalizedUrl: "https://competitor.example/catalog",
          title: "SERP title",
          description: "SERP description"
        },
        {
          source: "AI",
          url: "https://competitor.example/catalog",
          normalizedUrl: "https://competitor.example/catalog",
          title: "AI duplicate",
          description: "AI duplicate description"
        },
        {
          source: "AI",
          url: "https://another.example/article",
          normalizedUrl: "https://another.example/article",
          title: "AI source",
          description: "AI description"
        }
      ]
    }],
    page: { hasNext: false, totalApprox: 1 },
    meta: { requestId: "competitor-export-1" }
  });
});

function candidate(
  source: "SERP" | "AI",
  url: string,
  normalizedUrl: string | null,
  title: string | null,
  description: string | null
) {
  return {
    keywordId,
    source,
    url,
    normalizedUrl,
    title,
    description,
    projectDomain: "project.example"
  };
}
