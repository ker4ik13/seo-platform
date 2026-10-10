import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { TenantService } from "./tenant.service.js";
import { parseProjectOnboardingSettings } from "@seo-platform/contracts";

const url = process.env.PLATFORM_ONBOARDING_TEST_DATABASE_URL;
test(
  "real Core transaction creates one project across concurrent retries and protects request scope",
  { skip: !url, timeout: 30_000 },
  async () => {
    assert.ok(url);
    assert.equal(new URL(url).hostname, "127.0.0.1");
    assert.notEqual(new URL(url).port, "5432");
    const prisma = new PrismaService(
      loadAppConfig({ NODE_ENV: "test", DATABASE_URL: url }),
    );
    try {
      const email = "onboarding-" + randomUUID() + "@example.invalid";
      const user = await prisma.user.create({
        data: {
          emailNormalized: email,
          emailDisplay: email,
          displayName: "Onboarding integration",
          status: "ACTIVE",
        },
      });
      const workspace = await prisma.workspace.create({
        data: {
          name: "Onboarding integration",
          slug: randomUUID(),
          ownerUserId: user.id,
        },
      });
      await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          roleCode: "OWNER",
          status: "ACTIVE",
        },
      });
      const service = new TenantService(
        prisma,
        new AuditService(prisma),
        new OutboxService(),
        new BillingEntitlementService(prisma),
      );
      const onboarding = parseProjectOnboardingSettings({
        version: 1,
        engines: [],
        columns: ["query", "frequency"],
        columnOrder: ["query", "frequency"],
      });
      const input = {
        name: "Проект",
        domain: "onboarding.example.invalid",
        onboarding,
      };
      const idempotencyKey = "project-onboarding:" + randomUUID(),
        context = { requestId: randomUUID() };
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.createProject(
            user.id,
            workspace.id,
            input,
            context,
            idempotencyKey,
          ),
        ),
      );
      assert.equal(new Set(results.map((row) => row.id)).size, 1);
      assert.deepEqual(results[0]!.onboarding, onboarding);
      assert.equal(
        await prisma.project.count({ where: { workspaceId: workspace.id } }),
        1,
      );
      assert.equal(
        await prisma.projectCreationReceipt.count({
          where: { workspaceId: workspace.id },
        }),
        1,
      );
      assert.equal(
        await prisma.auditEvent.count({
          where: { projectId: results[0]!.id, action: "project.created" },
        }),
        1,
      );
      await assert.rejects(() =>
        service.createProject(
          user.id,
          workspace.id,
          { ...input, name: "Другой" },
          context,
          idempotencyKey,
        ),
      );
      const catalog = await service.listProjects(user.id, workspace.id);
      assert.equal(
        catalog[0]!.onboarding,
        undefined,
        "catalogs must not carry every project's large bootstrap template",
      );
      assert.deepEqual(
        (await service.getProject(results[0]!.id)).onboarding,
        onboarding,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
