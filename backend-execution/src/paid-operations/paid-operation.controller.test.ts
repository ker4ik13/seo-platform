import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { PaidOperationController } from "./paid-operation.controller.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const credentialId = "01900000-0000-7000-8000-000000000004";

test("every paid-operation family forwards the exact credential selected at launch", async () => {
  const calls: Array<{
    readonly capability: string;
    readonly provider: string | undefined;
    readonly credentialId: string | undefined;
    readonly requirement: unknown;
  }> = [];
  const routing = {
    resolve: async (
      _workspaceId: string,
      _projectId: string,
      capability: string,
      _actorId: string,
      provider: string | undefined,
      requestedCredentialId: string | undefined,
      requirement: unknown
    ) => {
      calls.push({
        capability,
        provider,
        credentialId: requestedCredentialId,
        requirement
      });
      return {
        bindingId: "01900000-0000-7000-8000-000000000005",
        bindingVersion: 1,
        routeId: "01900000-0000-7000-8000-000000000006",
        credentialId,
        provider,
        credentialMode: "BYOK_API_KEY"
      };
    }
  };
  const controller = new PaidOperationController(
    {} as never,
    routing as never
  );
  const request = {
    id: "request-001",
    headers: {
      "x-workspace-id": workspaceId,
      "x-project-id": projectId,
      "x-actor-id": actorId
    }
  } as unknown as FastifyRequest;
  const commands = [
    {
      body: {
        kind: "FREQUENCY_COLLECTION",
        provider: "XMLSTOCK",
        credentialId,
        xmlStockRequestCount: 900_000
      },
      capability: "WORDSTAT",
      provider: "XMLSTOCK",
      requirement: {
        xmlStock: { product: "WORDSTAT", requestCount: 900_000 }
      }
    },
    {
      body: { kind: "AI_ANSWER_COLLECTION", credentialId },
      capability: "SERP_COLLECTION",
      provider: "ARSENKIN",
      requirement: { allowedProviders: ["ARSENKIN"] }
    },
    {
      body: { kind: "CLUSTERING_RUN", credentialId },
      capability: "CLUSTERING",
      provider: "ARSENKIN",
      requirement: { allowedProviders: ["ARSENKIN"] }
    },
    {
      body: {
        kind: "KEYWORD_RESEARCH",
        source: "XMLSTOCK_WORDSTAT",
        credentialId,
        xmlStockRequestCount: 12
      },
      capability: "KEYWORD_RESEARCH",
      provider: "XMLSTOCK",
      requirement: {
        allowedProviders: ["XMLSTOCK"],
        xmlStock: { product: "WORDSTAT", requestCount: 12 }
      }
    },
    {
      body: {
        kind: "KEYWORD_RESEARCH",
        source: "KEYS_SO",
        credentialId
      },
      capability: "COMPETITOR_RESEARCH",
      provider: "KEYS_SO",
      requirement: { allowedProviders: ["KEYS_SO"] }
    }
  ] as const;

  for (const command of commands) {
    const response = await controller.route(command.body, request);
    assert.equal(response.data.credentialId, credentialId);
  }
  assert.deepEqual(
    calls,
    commands.map(({ capability, provider, requirement }) => ({
      capability,
      provider,
      credentialId,
      requirement
    }))
  );
});
