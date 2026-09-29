import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { RankOperationProvenanceService } from "./rank-operation-provenance.service.js";

const id = {
  workspace: "01900000-0000-7000-8000-000000000001",
  project: "01900000-0000-7000-8000-000000000002",
  job: "01900000-0000-7000-8000-000000000003",
  first: "01900000-0000-7000-8000-000000000004",
  second: "01900000-0000-7000-8000-000000000005"
};

test("rank provenance counts real Live polls per safe connection label", async () => {
  const service = new RankOperationProvenanceService({
    job: {
      findFirst: async () => ({
        provider: "XMLSTOCK",
        credentialMode: "BYOK_API_KEY",
        scopeSnapshot: { searchSource: "LIVE" },
        rankRun: { estimate: { credentialId: id.first } }
      })
    },
    rankConnectorExecution: {
      groupBy: async () => [
        { credentialId: id.first, provider: "XMLSTOCK",
          _sum: { submitAttemptCount: 1, pollAttemptCount: 4 } },
        { credentialId: id.second, provider: "XMLSTOCK",
          _sum: { submitAttemptCount: 1, pollAttemptCount: 2 } }
      ]
    },
    integrationCredential: {
      findMany: async () => [
        { id: id.first, provider: "XMLSTOCK", label: "Личный", displayHint: "••••b313" },
        { id: id.second, provider: "XMLSTOCK", label: "Резерв", displayHint: "••••349d" }
      ]
    }
  } as unknown as PrismaService);
  assert.deepEqual(await service.sourcesForJob({
    workspaceId: id.workspace, projectId: id.project, jobId: id.job
  }), [
    { provider: "XMLSTOCK", label: "Личный", displayHint: "••••b313",
      requestCount: "4", selected: true },
    { provider: "XMLSTOCK", label: "Резерв", displayHint: "••••349d",
      requestCount: "2", selected: false }
  ]);
});

test("paid rank provenance never exposes the physical system key label", async () => {
  const service = new RankOperationProvenanceService({
    job: {
      findFirst: async () => ({
        provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID",
        scopeSnapshot: { searchSource: "SEARCH_API" }, rankRun: null
      })
    },
    rankConnectorExecution: {
      groupBy: async () => [{
        credentialId: id.first, provider: "XMLSTOCK",
        _sum: { submitAttemptCount: 3, pollAttemptCount: 10 }
      }]
    },
    integrationCredential: {
      findMany: async () => { throw new Error("system key label must stay private"); }
    }
  } as unknown as PrismaService);
  assert.deepEqual(await service.sourcesForJob({
    workspaceId: id.workspace, projectId: id.project, jobId: id.job
  }), [{ provider: "XMLSTOCK", label: "Системный ключ",
    requestCount: "3", selected: true }]);
});

test("admin selected source checks workspace before displaying a label", async () => {
  const service = new RankOperationProvenanceService({
    rankJobRun: {
      findMany: async () => [{
        jobId: id.job, workspaceId: id.workspace,
        estimate: { credentialId: id.first }
      }]
    },
    integrationCredential: {
      findMany: async () => [{
        id: id.first, workspaceId: "01900000-0000-7000-8000-000000000099",
        label: "Чужой", displayHint: null
      }]
    }
  } as unknown as PrismaService);
  const result = await service.selectedForJobs([{
    id: id.job, workspaceId: id.workspace, type: "MANUAL_RANK_CHECK", provider: "XMLSTOCK",
    credentialMode: "BYOK_API_KEY"
  }]);
  assert.equal(result.size, 0);
});

test("admin uses the saved route of a Wordstat operation without reading rank runs", async () => {
  const service = new RankOperationProvenanceService({
    rankJobRun: {
      findMany: async () => { throw new Error("not a rank Job"); }
    },
    integrationCredential: {
      findMany: async () => [{
        id: id.first, workspaceId: id.workspace,
        label: "Wordstat ключ", displayHint: "••••b313"
      }]
    }
  } as unknown as PrismaService);
  const selected = await service.selectedForJobs([{
    id: id.job, workspaceId: id.workspace, type: "FREQUENCY_COLLECTION",
    provider: "XMLSTOCK", credentialMode: "BYOK_API_KEY",
    credentialId: id.first
  }]);
  assert.deepEqual(selected.get(id.job), {
    label: "Wordstat ключ", displayHint: "••••b313"
  });
});
