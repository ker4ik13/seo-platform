import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";

export type KeywordSystemGroupKind = "UNGROUPED" | "TRASH";

const SYSTEM_GROUPS = [
  {
    kind: "UNGROUPED" as const,
    name: "Без группы",
    color: "#a8a5b8",
    path: "__system__/ungrouped",
    position: 1_998
  },
  {
    kind: "TRASH" as const,
    name: "Корзина",
    color: "#ef6464",
    path: "__system__/trash",
    position: 1_999
  }
] as const;

export async function ensureKeywordSystemGroupIds(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string
): Promise<Readonly<Record<KeywordSystemGroupKind, string>>> {
  const ids = new Map<KeywordSystemGroupKind, string>();
  for (const definition of SYSTEM_GROUPS) {
    const existing = await transaction.keywordGroup.findFirst({
      where: {
        workspaceId,
        projectId,
        systemKind: definition.kind,
        status: "ACTIVE"
      },
      select: { id: true }
    });
    if (existing) {
      ids.set(definition.kind, existing.id);
      continue;
    }
    const created = await transaction.keywordGroup.create({
      data: {
        workspaceId,
        projectId,
        name: definition.name,
        path: definition.path,
        pathHash: createHash("sha256").update(definition.path).digest("hex"),
        color: definition.color,
        position: definition.position,
        systemKind: definition.kind
      },
      select: { id: true }
    });
    ids.set(definition.kind, created.id);
  }
  const ungroupedId = ids.get("UNGROUPED");
  if (!ungroupedId) {
    throw new Error("Semantic ungrouped system group was not resolved");
  }
  await transaction.$executeRaw`
    INSERT INTO "keyword_group_memberships" (
      "project_id",
      "keyword_id",
      "group_id"
    )
    SELECT
      keyword."project_id",
      keyword."id",
      ${ungroupedId}::uuid
    FROM "keywords" AS keyword
    WHERE
      keyword."workspace_id" = ${workspaceId}::uuid
      AND keyword."project_id" = ${projectId}::uuid
      AND keyword."status" = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1
        FROM "keyword_group_memberships" AS membership
        WHERE
          membership."project_id" = keyword."project_id"
          AND membership."keyword_id" = keyword."id"
      )
    ON CONFLICT DO NOTHING
  `;
  return Object.fromEntries(ids) as Readonly<
    Record<KeywordSystemGroupKind, string>
  >;
}
