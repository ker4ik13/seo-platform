import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import type { KeywordService } from "../keywords/keyword.service.js";
import { SemanticPositionHistoryExportService } from "./semantic-position-history-export.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const keywordId = "01900000-0000-7000-8000-000000000003";

test("exports newest daily rank independently per geographic and device dimension", async () => {
  const calls: unknown[] = [];
  const keywords = {
    list: async (...input: readonly unknown[]) => {
      calls.push(["keywords", ...input]);
      return {
        data: [
          {
            id: keywordId,
            textOriginal: "купить трубу",
            language: "ru",
            createdAt: "2026-07-01T10:00:00.000Z",
            groupPath: "Каталог / Трубы"
          }
        ],
        page: { hasNext: false, totalApprox: 1 },
        meta: { requestId: "export-1" }
      };
    }
  } as unknown as KeywordService;
  const prisma = {
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    rankSnapshot: {
      findMany: async (input: unknown) => {
        calls.push(["snapshots", input]);
        return [
          snapshot("2026-08-18T18:00:00.000Z", "YANDEX", true, 3),
          snapshot("2026-08-18T09:00:00.000Z", "YANDEX", true, 8),
          snapshot("2026-08-17T18:00:00.000Z", "YANDEX", false, null),
          snapshot("2026-08-18T17:00:00.000Z", "GOOGLE", true, 11)
        ];
      }
    }
  } as unknown as PrismaService;
  const service = new SemanticPositionHistoryExportService(prisma, keywords);

  const result = await service.list(
    { workspaceId, projectId },
    { limit: 25, sort: "CREATED_DESC" },
    {
      observedFrom: "2026-08-01T00:00:00.000Z",
      observedBefore: "2026-08-20T00:00:00.000Z",
      searchEngines: ["YANDEX", "GOOGLE"]
    },
    "export-1"
  );

  assert.deepEqual(result.data, [
    {
      keywordId,
      text: "купить трубу",
      keywordLanguage: "ru",
      createdAt: "2026-07-01T10:00:00.000Z",
      groupPath: "Каталог / Трубы",
      dimension: {
        key: "YANDEX|RU|213|ru|DESKTOP",
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP"
      },
      snapshots: [
        { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 3 },
        { searchEngine: "YANDEX", observedDate: "2026-08-17", found: false }
      ]
    },
    {
      keywordId,
      text: "купить трубу",
      keywordLanguage: "ru",
      createdAt: "2026-07-01T10:00:00.000Z",
      groupPath: "Каталог / Трубы",
      dimension: {
        key: "GOOGLE|RU|1011969|ru|MOBILE",
        searchEngine: "GOOGLE",
        countryCode: "RU",
        regionCode: "1011969",
        regionLabel: "Москва",
        language: "ru",
        device: "MOBILE"
      },
      snapshots: [
        { searchEngine: "GOOGLE", observedDate: "2026-08-18", found: true, position: 11 }
      ]
    }
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "keywords",
    workspaceId,
    projectId,
    { limit: 25, sort: "CREATED_DESC" },
    "export-1"
  ]);
  assert.deepEqual(
    (calls[1] as readonly unknown[])[0],
    "snapshots"
  );
});

function snapshot(
  observedAt: string,
  searchEngine: "YANDEX" | "GOOGLE",
  found: boolean,
  position: number | null
) {
  return {
    id: `${observedAt}:${searchEngine}`,
    keywordId,
    observedAt: new Date(observedAt),
    found,
    position,
    manifest: {
      configuration: searchEngine === "YANDEX"
        ? {
            searchEngine,
            countryCode: "RU",
            regionCode: "213",
            regionLabel: "Москва",
            language: "ru",
            device: "DESKTOP"
          }
        : {
            searchEngine,
            countryCode: "RU",
            regionCode: "1011969",
            regionLabel: "Москва",
            language: "ru",
            device: "MOBILE"
          }
    }
  };
}
