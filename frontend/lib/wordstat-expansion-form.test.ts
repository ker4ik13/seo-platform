import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  wordstatExpansionSources,
  wordstatResultLimit,
  wordstatScopeIsResolving,
  wordstatStoredResultSafetyLimit
} from "./wordstat-expansion-form.ts";

test("a stale project scope request does not block pasted Wordstat queries", () => {
  assert.equal(wordstatScopeIsResolving("PROJECT", true), true);
  assert.equal(wordstatScopeIsResolving("TEXT", true), false);
});

test("Arsenkin has no user-defined result limit", () => {
  assert.equal(
    wordstatResultLimit("ARSENKIN", "not-a-number"),
    wordstatStoredResultSafetyLimit
  );
});

test("XMLStock keeps its bounded result limit", () => {
  assert.equal(wordstatResultLimit("XMLSTOCK", "5000"), 5000);
  assert.equal(wordstatResultLimit("XMLSTOCK", "0"), undefined);
  assert.equal(wordstatResultLimit("XMLSTOCK", "10001"), undefined);
});

test("Wordstat expansion sees an active workspace route before project materialization", () => {
  const workspaceId = "019fd395-bc13-74eb-80c5-f3e7872bcc20";
  const credential: ProjectConnectorCredentialOption = {
    id: "019fd395-bc13-74eb-80c5-f3e7872bcc21",
    workspaceId,
    provider: "XMLSTOCK",
    label: "XMLStock Wordstat",
    mode: "BYOK_API_KEY",
    status: "ACTIVE",
    capabilities: ["KEYWORD_RESEARCH"]
  };
  const project: ProjectConnectorSettings = {
    bindings: [],
    credentialOptions: [credential],
    credentialOptionsTruncated: false,
    access: {
      canUpdateBindings: true,
      canUseSystemCredentials: true,
      canManageFallback: false,
      canSetBudgets: false,
      mutationRestriction: "NONE"
    }
  };
  const workspace: WorkspaceConnectorRoutingSettings = {
    bindings: [
      {
        id: "019fd395-bc13-74eb-80c5-f3e7872bcc22",
        workspaceId,
        capability: "KEYWORD_RESEARCH",
        enabled: true,
        routes: [
          {
            id: "019fd395-bc13-74eb-80c5-f3e7872bcc23",
            bindingId: "019fd395-bc13-74eb-80c5-f3e7872bcc22",
            workspaceId,
            position: 0,
            credentialId: credential.id,
            provider: "XMLSTOCK",
            credentialMode: "BYOK_API_KEY",
            availability: "READY",
            createdAt: "2026-09-02T00:00:00.000Z",
            updatedAt: "2026-09-02T00:00:00.000Z"
          }
        ],
        fallbackPolicy: { mode: "NONE" },
        version: 1,
        createdBy: "019fd395-bc13-74eb-80c5-f3e7872bcc24",
        updatedBy: "019fd395-bc13-74eb-80c5-f3e7872bcc24",
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z"
      }
    ],
    credentialOptions: [credential],
    credentialOptionsTruncated: false,
    access: { canUpdateBindings: true, canManageFallback: false }
  };

  assert.deepEqual(
    wordstatExpansionSources(project, workspace).map(({ id }) => id),
    [credential.id]
  );
  assert.deepEqual(
    wordstatExpansionSources(project, {
      ...workspace,
      bindings: workspace.bindings.map((binding) => ({
        ...binding,
        enabled: false
      }))
    }),
    []
  );
});
