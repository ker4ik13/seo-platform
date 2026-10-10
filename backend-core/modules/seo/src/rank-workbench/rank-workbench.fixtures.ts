import { createHash } from "node:crypto";
import type { SemanticImportPublishRow } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticImportService } from "../semantic-imports/semantic-import.service.js";

/** Synthetic test data, published by the real SEO import owner; no mocked SQL or API replies. */
export async function createRankWorkbenchFixture(
  prisma: PrismaService,
  scope: Readonly<{
    workspaceId: string;
    projectId: string;
    actorId: string;
  }>,
  domain: string,
  count = 210,
  distinctGroups = false,
) {
  if (
    !domain.endsWith(".example.invalid") ||
    !Number.isSafeInteger(count) ||
    count < 5 ||
    count > 2_000
  )
    throw new TypeError("Isolated test domain and bounded data required");
  const [clock] = await prisma.$queryRaw<
    { importId: string }[]
  >`SELECT uuidv7() AS "importId"`;
  if (!clock) throw new Error("Fixture clock unavailable");
  const input = { ...scope, importId: clock.importId, projectDomain: domain };
  const service = new SemanticImportService(prisma);
  const texts = [
    "Альфа несколько URL",
    "Бета без целевого URL",
    "Гамма устаревший SERP",
    "Дельта разные города",
    "WWW страницы",
    ...Array.from(
      { length: count - 5 },
      (_, index) => `Запрос ${String(index + 1).padStart(4, "0")}`,
    ),
  ];
  const normalized = await service.normalizeKeywords({
    ...input,
    rows: texts.map((text, index) => ({
      rowNumber: String(index + 1),
      text,
      language: "ru",
    })),
  });
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() - 1);
  latest.setUTCHours(12, 0, 0, 0);
  const older = new Date(latest);
  older.setUTCDate(older.getUTCDate() - 3);
  const moscow = {
    source: "KEY_COLLECTOR" as const,
    searchEngine: "YANDEX" as const,
    countryCode: "RU",
    regionCode: "213",
    regionLabel: "Москва",
    language: "ru",
    device: "DESKTOP" as const,
  };
  const rows: SemanticImportPublishRow[] = normalized.rows.map((row, index) => {
    const url = `https://${domain}/page-${index}`;
    const own = (other = false, www = false) => ({
      position: other ? 7 : 3,
      rankingUrl: `https://${www ? "www." : ""}${domain}/page-${index}${other ? "/other" : ""}`,
    });
    const ordinary = [
      own(),
      { position: 1, rankingUrl: "https://competitor.example.invalid/result" },
    ];
    const multiple = [own(), own(true), { position: 8, rankingUrl: url + "/" }];
    const current =
      index === 0
        ? multiple
        : index === 4
          ? [own(false, true), own(true, true)]
          : ordinary;
    return {
      sourceRowNumber: String(index + 1),
      textOriginal: row.textOriginal,
      textNormalized: row.textNormalized,
      normalizedHash: row.normalizedHash,
      language: row.language,
      customValues: {},
      isTracked: true,
      groupPath: distinctGroups ? ["Большое дерево", `Группа ${String(index + 1).padStart(4, "0")}`] : [
        "Основная",
        index < 5 ? "Проверки URL" : "Остальные",
        "Вложенная",
      ],
      ...(index === 1 ? {} : { targetUrl: url }),
      positionHistory: [
        {
          ...moscow,
          observedAt: older.toISOString(),
          found: true,
          position: 8,
          rankingUrl: url,
          serpResults: index === 2 ? multiple : ordinary,
        },
        {
          ...moscow,
          observedAt: latest.toISOString(),
          found: true,
          position: 3,
          rankingUrl: url,
          serpResults: current,
        },
        ...(index === 3
          ? [
              {
                ...moscow,
                regionCode: "2",
                regionLabel: "Санкт-Петербург",
                observedAt: new Date(
                  latest.getTime() - 3_600_000,
                ).toISOString(),
                found: true,
                position: 3,
                rankingUrl: url,
                serpResults: multiple,
              },
            ]
          : []),
        ...(index === 0
          ? [
              {
                ...moscow,
                searchEngine: "GOOGLE" as const,
                regionCode: "1011969",
                observedAt: latest.toISOString(),
                found: true,
                position: 2,
                rankingUrl: url,
                serpResults: ordinary,
              },
            ]
          : []),
      ],
    };
  });
  const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  await service.begin({
    ...input,
    mappingHash: digest("usability-fixture"),
    duplicatePolicy: "MERGE_NON_EMPTY",
    createMissingKeywords: true,
    expectedChunks: Math.ceil(rows.length / 500),
    expectedUniqueRows: String(rows.length),
    expectedNewKeywords: String(rows.length),
    entitlement: {
      planCode: "LOCAL_TEST",
      planVersion: 1,
      storedKeywords: 5_000,
      keywordsPerProject: 5_000,
      foldersPerProject: distinctGroups ? count + 10 : 500,
      trackedContextPairs: 10_000,
    },
  });
  // Match the real publisher's physical batch limit; never relax manifest constraints.
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    await service.applyChunk({
      ...input,
      chunkIndex: offset / 500,
      payloadHash: digest(JSON.stringify({ projectDomain: domain, rows: chunk })),
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true,
      rows: chunk,
    });
  }
  const keywords = await prisma.keyword.findMany({
    where: {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      status: "ACTIVE",
    },
    select: { id: true, textOriginal: true },
  });
  const first = keywords.find((keyword) => keyword.textOriginal === texts[0]);
  if (!first) throw new Error("Published fixture keyword unavailable");
  await prisma.frequencySeasonalityPoint.createMany({
    data: [1, 2, 3, 4].map((month, index) => ({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      keywordId: first.id,
      type: "BASE",
      granularity: "MONTH",
      periodStart: new Date(`2026-0${month}-01T00:00:00.000Z`),
      value: BigInt(800 + index * 100),
      regionCode: "213",
      device: "DESKTOP",
      provider: "XMLSTOCK",
      sourceMode: "BYOK",
      jobId: input.importId,
      observedAt: latest,
    })),
  });
  return {
    keywords,
    texts,
    latest: latest.toISOString(),
    older: older.toISOString(),
    count: rows.length,
    moscow: "YANDEX|RU|213|ru|DESKTOP",
    spb: "YANDEX|RU|2|ru|DESKTOP",
  };
}
