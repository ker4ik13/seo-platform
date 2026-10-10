import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import type { AppConfig } from "../config/app-config.js";
import { ProjectOnboardingService } from "./project-onboarding.service.js";
import { TrackingContextService } from "../tracking-contexts/tracking-context.service.js";
import {
  parseProjectOnboardingSettings,
  projectOnboardingColumnCatalog,
  semanticRankColumnKey,
  projectOnboardingDimensions,
} from "@seo-platform/contracts";

const url = process.env.SEO_ONBOARDING_TEST_DATABASE_URL;
test(
  "real SEO bootstrap batches 64 configurations, survives replays, and never materializes keywords",
  { skip: !url, timeout: 30_000 },
  async (t) => {
    assert.ok(url);
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.notEqual(new URL(url).port, "5432");
    const prisma = new PrismaService({
      databaseUrl: url,
      databasePoolMax: 6,
    } as AppConfig);
    try {
      const inputScope = {
        workspaceId: randomUUID(),
        projectId: randomUUID(),
        actorId: randomUUID(),
        canManageShared: true,
      };
      const engine = {
        searchEngine: "YANDEX" as const,
        positions: true,
        ai: true,
        depth: 30 as const,
        targets: Array.from({ length: 64 }, (_, index) => ({
          regionCode: String(1000 + index),
          regionLabel: "Тестовый город " + index,
          device: "DESKTOP" as const,
        })),
      };
      const dimensions = projectOnboardingDimensions({ engines: [engine] });
      const columns = [
        "query",
        ...dimensions.map((dimension) =>
          semanticRankColumnKey(dimension.key, "position"),
        ),
      ];
      const catalog = projectOnboardingColumnCatalog({ engines: [engine] });
      const settings = parseProjectOnboardingSettings({
        version: 1,
        engines: [engine],
        columns,
        columnOrder: [
          ...columns,
          ...catalog.filter((key) => !columns.includes(key)),
        ],
      });
      const service = new ProjectOnboardingService(prisma),
        start = performance.now();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.initialize({ ...inputScope, settings }),
        ),
      );
      assert.equal(new Set(results.map((row) => row.viewId)).size, 1);
      assert.equal(results[0]!.trackingContextCount, 64);
      assert.equal(
        await prisma.trackingContext.count({
          where: { projectId: inputScope.projectId },
        }),
        64,
      );
      assert.equal(
        await prisma.trackingContextVersion.count({
          where: { projectId: inputScope.projectId },
        }),
        64,
      );
      assert.equal(
        await prisma.keyword.count({
          where: { projectId: inputScope.projectId },
        }),
        0,
      );
      assert.equal(
        await prisma.trackingContextKeywordAssignment.count({
          where: { projectId: inputScope.projectId },
        }),
        0,
      );
      assert.equal(
        await prisma.rankSnapshot.count({
          where: { projectId: inputScope.projectId },
        }),
        0,
      );
      const view = await prisma.semanticSavedView.findUniqueOrThrow({
        where: {
          workspaceId_projectId_id: {
            workspaceId: inputScope.workspaceId,
            projectId: inputScope.projectId,
            id: results[0]!.viewId,
          },
        },
      });
      assert.deepEqual((view.config as { columns: string[] }).columns, columns);
      const contexts = await new TrackingContextService(prisma).list(
        inputScope.workspaceId,
        inputScope.projectId,
      );
    assert.equal(contexts.contexts[0]!.configuration.depth, 30);
    for (const context of contexts.contexts) {
      assert.ok(Date.parse(context.configuration.createdAt) >= Date.parse(context.createdAt));
      assert.ok(Date.parse(context.configuration.createdAt) <= Date.parse(context.updatedAt));
    }
      await assert.rejects(() =>
        service.initialize({ ...inputScope, actorId: randomUUID(), settings }),
      );
      await assert.rejects(() =>
        service.initialize({
          ...inputScope,
          settings: { ...settings, columns: ["query"] },
        }),
      );
      t.diagnostic(
        "onboarding bootstrap: 64 contexts and concurrent replays in " +
          Math.round(performance.now() - start) +
          "ms; zero keyword assignments/snapshots",
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
