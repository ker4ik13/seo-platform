import assert from "node:assert/strict";
import test from "node:test";
import type { InternalCreateKeywordResearchRunInput } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type { WorkspaceConnectorRoutingService } from "../integrations/workspace-connector-routing.service.js";
import { KeywordResearchService } from "./keyword-research.service.js";

test("provider-backed keyword research starts from each explicitly selected credential", async () => {
  await assertSelectedCredential({
    ...commonInput("wordstat-selected-credential-001"),
    source: "XMLSTOCK_WORDSTAT",
    credentialId: "01900000-0000-7000-8000-000000000001",
    queries: ["пример"],
    regionCode: "225",
    device: "ALL",
    minusWords: [],
    clearMinusPhrases: false,
    includeRightColumn: true,
    clearPlus: false,
    maxKeywords: 100
  });
  await assertSelectedCredential({
    ...commonInput("keys-so-selected-credential-001"),
    source: "KEYS_SO",
    credentialId: "01900000-0000-7000-8000-000000000011",
    domain: "example.com",
    database: "msk",
    maxKeywords: 100
  });
});

async function assertSelectedCredential(
  input: InternalCreateKeywordResearchRunInput
): Promise<void> {
  const expected = new Error("stop after route selection");
  let selectedCredentialId: string | undefined;
  const prisma = {
    job: { findUnique: async () => null }
  } as unknown as PrismaService;
  const routing = {
    resolve: async (
      _workspaceId: string,
      _projectId: string,
      _capability: string,
      _actorId: string,
      _provider: string,
      requestedCredentialId: string | undefined
    ) => {
      selectedCredentialId = requestedCredentialId;
      throw expected;
    }
  } as unknown as WorkspaceConnectorRoutingService;
  const service = new KeywordResearchService(prisma, routing);
  await assert.rejects(service.create(input), expected);
  assert.equal(selectedCredentialId, input.credentialId);
}

function commonInput(idempotencyKey: string) {
  return {
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    actorId: "01900000-0000-7000-8000-000000000004",
    idempotencyKey,
    correlationId: "request-001",
    jobCapacity: {
      planCode: "PRO",
      planVersion: 1,
      concurrentJobs: 10
    }
  };
}
