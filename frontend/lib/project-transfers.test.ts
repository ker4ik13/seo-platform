import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectTransferRequestSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import { projectTransferDestinations } from "./project-transfer-destinations.ts";

test("offers only another active workspace with project creation permission", () => {
  const transfer = {
    workspaceId: "source"
  } as ProjectTransferRequestSummary;
  const workspaces = [
    workspace("source", "OWNER", "ACTIVE"),
    workspace("owner", "OWNER", "ACTIVE"),
    workspace("admin", "ADMIN", "ACTIVE"),
    workspace("lead", "SEO_LEAD", "ACTIVE"),
    workspace("specialist", "SEO_SPECIALIST", "ACTIVE"),
    workspace("suspended", "OWNER", "SUSPENDED")
  ];

  assert.deepEqual(
    projectTransferDestinations(workspaces, transfer).map(({ id }) => id),
    ["owner", "admin", "lead"]
  );
});

function workspace(
  id: string,
  roleCode: string,
  status: WorkspaceSummary["status"]
): WorkspaceSummary {
  return {
    id,
    name: id,
    slug: id,
    locale: "ru",
    timezone: "Europe/Moscow",
    billingCurrency: "RUB",
    status,
    roleCode,
    owner: {
      userId: `${id}-owner`,
      email: `owner@${id}.example`,
      displayName: `${id} owner`
    },
    version: 1,
    createdAt: "2026-08-05T00:00:00.000Z"
  };
}
