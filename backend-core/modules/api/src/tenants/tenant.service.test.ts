import assert from "node:assert/strict";
import test from "node:test";
import type { AuditService } from "../audit/audit.service.js";
import type { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import { TenantService } from "./tenant.service.js";

const currentUserId = "01900000-0000-7000-8000-000000000001";
const otherOwnerId = "01900000-0000-7000-8000-000000000002";

test("lists canonical workspace owners in one bounded query", async () => {
  let observedOwnerQuery: unknown;
  const service = new TenantService(
    {
      workspaceMember: {
        findMany: async () => [
          {
            roleCode: "OWNER",
            workspace: workspace(
              "01900000-0000-7000-8000-000000000010",
              currentUserId,
              "Личная область"
            )
          },
          {
            roleCode: "SEO_SPECIALIST",
            workspace: workspace(
              "01900000-0000-7000-8000-000000000011",
              otherOwnerId,
              "Агентство"
            )
          }
        ]
      },
      user: {
        findMany: async (query: unknown) => {
          observedOwnerQuery = query;
          return [
            {
              id: currentUserId,
              emailDisplay: "me@example.com",
              displayName: "Кирилл"
            },
            {
              id: otherOwnerId,
              emailDisplay: "owner@agency.example",
              displayName: "Анна Владелец"
            }
          ];
        }
      }
    } as unknown as PrismaService,
    {} as AuditService,
    {} as OutboxService,
    {} as BillingEntitlementService
  );

  const result = await service.listWorkspaces(currentUserId);

  assert.deepEqual(observedOwnerQuery, {
    where: { id: { in: [currentUserId, otherOwnerId] } },
    select: {
      id: true,
      emailDisplay: true,
      displayName: true
    }
  });
  assert.deepEqual(
    result.map(({ name, roleCode, owner }) => ({ name, roleCode, owner })),
    [
      {
        name: "Личная область",
        roleCode: "OWNER",
        owner: {
          userId: currentUserId,
          email: "me@example.com",
          displayName: "Кирилл"
        }
      },
      {
        name: "Агентство",
        roleCode: "SEO_SPECIALIST",
        owner: {
          userId: otherOwnerId,
          email: "owner@agency.example",
          displayName: "Анна Владелец"
        }
      }
    ]
  );
});

function workspace(id: string, ownerUserId: string, name: string) {
  const createdAt = new Date("2026-08-01T10:00:00.000Z");
  return {
    id,
    name,
    slug: name === "Агентство" ? "agency" : "personal",
    country: null,
    locale: "ru",
    timezone: "Europe/Moscow",
    billingCurrency: "RUB",
    status: "ACTIVE" as const,
    ownerUserId,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null
  };
}
