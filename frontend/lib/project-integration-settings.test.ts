import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectConnectorBinding,
  ProjectConnectorCredentialOption,
  ProjectConnectorSettings,
  WorkspaceConnectorBinding,
  WorkspaceConnectorRoutingSettings
} from "@seo-platform/contracts";
import {
  canApplyProjectConnectorRevalidation,
  canSubmitProjectConnectorDraft,
  createProjectConnectorBindingInput,
  effectiveProjectConnectorOptions,
  isProjectConnectorCredentialEligible,
  isWorkspaceConnectorCredentialConfigurable,
  projectConnectorBinding,
  projectConnectorCreatePayloadSignature,
  projectConnectorDraft,
  projectConnectorDraftDirty,
  projectConnectorIncompatibleOptions,
  projectConnectorOptions,
  RANK_TRACKING_CAPABILITY,
  reorderWorkspaceRouteCredentialIds,
  reconcileProjectConnectorCreate,
  sameProjectConnectorBindingRevision,
  stableProjectConnectorCreateCommand,
  workspaceConnectorOptions,
  workspaceRouteCredentialIdsAfterSelection,
  workspaceRouteMatchesBinding,
  workspaceRouteSelectedOptions,
  workspaceRouteUpdateInput
} from "./project-integration-settings.ts";

const activeCredential: ProjectConnectorCredentialOption = {
  id: "00000000-0000-7000-8000-000000000001",
  workspaceId: "00000000-0000-7000-8000-000000000002",
  provider: "XMLSTOCK",
  label: "Primary XMLStock",
  mode: "BYOK_API_KEY",
  status: "ACTIVE",
  capabilities: ["SERP_RANK_TRACKING", "SERP_COLLECTION"]
};

const binding: ProjectConnectorBinding = {
  id: "00000000-0000-7000-8000-000000000003",
  workspaceId: activeCredential.workspaceId,
  projectId: "00000000-0000-7000-8000-000000000004",
  capability: RANK_TRACKING_CAPABILITY,
  enabled: true,
  route: {
    id: "00000000-0000-7000-8000-000000000005",
    bindingId: "00000000-0000-7000-8000-000000000003",
    workspaceId: activeCredential.workspaceId,
    projectId: "00000000-0000-7000-8000-000000000004",
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId: activeCredential.id,
    provider: "XMLSTOCK",
    credentialMode: "BYOK_API_KEY",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  },
  fallbackPolicy: { mode: "NONE" },
  budgetPolicy: { mode: "DISABLED" },
  availability: "READY",
  version: 1,
  createdBy: "00000000-0000-7000-8000-000000000006",
  updatedBy: "00000000-0000-7000-8000-000000000006",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z"
};

function settings(
  options: readonly ProjectConnectorCredentialOption[] = [activeCredential],
  bindings: readonly ProjectConnectorBinding[] = [binding]
): ProjectConnectorSettings {
  return {
    bindings,
    credentialOptions: options,
    credentialOptionsTruncated: false,
    access: {
      canUpdateBindings: true,
      canUseSystemCredentials: false,
      canManageFallback: false,
      canSetBudgets: false,
      mutationRestriction: "NONE"
    }
  };
}

test("selects one capability binding and rejects duplicate projections", () => {
  assert.equal(
    projectConnectorBinding(settings(), RANK_TRACKING_CAPABILITY)?.id,
    binding.id
  );
  assert.throws(() =>
    projectConnectorBinding(
      settings([activeCredential], [binding, { ...binding, id: "duplicate" }]),
      RANK_TRACKING_CAPABILITY
    )
  );
});

test("only ACTIVE credentials with a mode supporting the capability are eligible", () => {
  assert.equal(
    isProjectConnectorCredentialEligible(
      activeCredential,
      RANK_TRACKING_CAPABILITY
    ),
    true
  );
  for (const status of [
    "PENDING_VERIFICATION",
    "INVALID",
    "REVOKED",
    "DEGRADED",
    "RATE_LIMITED",
    "LOW_BALANCE",
    "EXPIRED",
    "DISABLED"
  ] as const) {
    assert.equal(
      isProjectConnectorCredentialEligible(
        { ...activeCredential, status },
        RANK_TRACKING_CAPABILITY
      ),
      false
    );
  }
  assert.equal(
    isProjectConnectorCredentialEligible(
      { ...activeCredential, capabilities: ["SERP_COLLECTION"] },
      RANK_TRACKING_CAPABILITY
    ),
    false
  );
  assert.equal(
    isProjectConnectorCredentialEligible(
      { ...activeCredential, mode: "PLATFORM_PAID" },
      RANK_TRACKING_CAPABILITY
    ),
    true
  );
  assert.equal(
    isProjectConnectorCredentialEligible(
      {
        ...activeCredential,
        mode: "PLATFORM_PAID",
        capabilities: ["KEYWORD_RESEARCH"]
      },
      "KEYWORD_RESEARCH"
    ),
    true
  );
});

test("workspace routing stays configurable independently of runtime balance", () => {
  for (const status of [
    "ACTIVE",
    "DEGRADED",
    "RATE_LIMITED",
    "LOW_BALANCE"
  ] as const) {
    assert.equal(
      isWorkspaceConnectorCredentialConfigurable(
        { ...activeCredential, status },
        RANK_TRACKING_CAPABILITY
      ),
      true
    );
  }
  assert.equal(
    isWorkspaceConnectorCredentialConfigurable(
      { ...activeCredential, capabilities: ["SERP_COLLECTION"] },
      RANK_TRACKING_CAPABILITY
    ),
    false
  );
});

test("capability options retain unavailable matching credentials for explanations", () => {
  const pending = {
    ...activeCredential,
    id: "pending",
    status: "PENDING_VERIFICATION" as const
  };
  const wrongCapability = {
    ...activeCredential,
    id: "wrong",
    capabilities: ["SERP_COLLECTION"] as const
  };
  assert.deepEqual(
    projectConnectorOptions(
      settings([activeCredential, pending, wrongCapability]),
      RANK_TRACKING_CAPABILITY
    ).map(({ id }) => id),
    [activeCredential.id, "pending"]
  );
  assert.deepEqual(
    projectConnectorIncompatibleOptions(
      settings([activeCredential, pending, wrongCapability]),
      RANK_TRACKING_CAPABILITY
    ).map(({ id }) => id),
    ["wrong"]
  );
});

test("inherited execution options follow the current workspace route", () => {
  const arsenkin: ProjectConnectorCredentialOption = {
    ...activeCredential,
    id: "00000000-0000-7000-8000-000000000010",
    provider: "ARSENKIN",
    label: "Arsenkin"
  };
  const workspace: WorkspaceConnectorRoutingSettings = {
    bindings: [
      {
        id: "00000000-0000-7000-8000-000000000011",
        workspaceId: activeCredential.workspaceId,
        capability: RANK_TRACKING_CAPABILITY,
        enabled: true,
        routes: [
          {
            id: "00000000-0000-7000-8000-000000000012",
            bindingId: "00000000-0000-7000-8000-000000000011",
            workspaceId: activeCredential.workspaceId,
            position: 0,
            credentialId: arsenkin.id,
            provider: "ARSENKIN",
            credentialMode: "BYOK_API_KEY",
            availability: "READY",
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:00:00.000Z"
          }
        ],
        fallbackPolicy: { mode: "NONE" },
        version: 2,
        createdBy: binding.createdBy,
        updatedBy: binding.updatedBy,
        createdAt: binding.createdAt,
        updatedAt: "2026-08-05T00:00:00.000Z"
      }
    ],
    credentialOptions: [activeCredential, arsenkin],
    credentialOptionsTruncated: false,
    access: { canUpdateBindings: true, canManageFallback: true }
  };
  const inherited = {
    ...binding,
    configurationScope: "WORKSPACE_INHERITED" as const
  };

  assert.deepEqual(
    effectiveProjectConnectorOptions(
      settings([activeCredential, arsenkin], [inherited]),
      workspace,
      RANK_TRACKING_CAPABILITY
    ).map(({ id }) => id),
    [arsenkin.id]
  );
  assert.deepEqual(
    effectiveProjectConnectorOptions(
      settings(
        [activeCredential, arsenkin],
        [{ ...binding, configurationScope: "PROJECT_OVERRIDE" }]
      ),
      workspace,
      RANK_TRACKING_CAPABILITY
    ).map(({ id }) => id),
    [activeCredential.id]
  );
  assert.deepEqual(
    workspaceConnectorOptions(
      workspace,
      RANK_TRACKING_CAPABILITY
    ).map(({ id }) => id),
    [arsenkin.id]
  );
});

test("dirty and submission rules allow disabling an unavailable current route", () => {
  const draft = projectConnectorDraft(binding);
  assert.equal(projectConnectorDraftDirty(binding, draft), false);
  assert.equal(
    canSubmitProjectConnectorDraft(
      binding,
      draft,
      [activeCredential],
      RANK_TRACKING_CAPABILITY
    ),
    true
  );
  const disabled = { ...draft, enabled: false };
  assert.equal(projectConnectorDraftDirty(binding, disabled), true);
  assert.equal(
    canSubmitProjectConnectorDraft(
      { ...binding, availability: "CREDENTIAL_UNAVAILABLE" },
      disabled,
      [],
      RANK_TRACKING_CAPABILITY
    ),
    true
  );
});

test("adding a route retains unavailable credentials in the configured order", () => {
  const readyWorkspaceBinding = {
    id: "00000000-0000-7000-8000-000000000091",
    workspaceId: activeCredential.workspaceId,
    capability: RANK_TRACKING_CAPABILITY,
    enabled: true,
    routes: [{
      id: "00000000-0000-7000-8000-000000000092",
      bindingId: "00000000-0000-7000-8000-000000000091",
      workspaceId: activeCredential.workspaceId,
      position: 0,
      credentialId: "00000000-0000-7000-8000-000000000093",
      provider: "XMLSTOCK",
      credentialMode: "BYOK_API_KEY",
      availability: "READY",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z"
    }],
    fallbackPolicy: { mode: "NONE" },
    version: 1,
    createdBy: binding.createdBy,
    updatedBy: binding.updatedBy,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z"
  } satisfies WorkspaceConnectorBinding;
  const unavailableCredentialId = readyWorkspaceBinding.routes[0]!.credentialId;
  const replacementCredentialId = "00000000-0000-7000-8000-000000000099";
  const unsavedReadyCredentialId = activeCredential.id;

  assert.deepEqual(
    workspaceRouteCredentialIdsAfterSelection(
      [unavailableCredentialId, unsavedReadyCredentialId],
      replacementCredentialId
    ),
    [
      unavailableCredentialId,
      unsavedReadyCredentialId,
      replacementCredentialId
    ]
  );
});

test("confirms the exact workspace order regardless of route version and availability", () => {
  const ids = [
    "00000000-0000-7000-8000-000000000091",
    "00000000-0000-7000-8000-000000000092",
    "00000000-0000-7000-8000-000000000093"
  ];
  const workspaceBinding: WorkspaceConnectorBinding = {
    id: binding.id,
    workspaceId: binding.workspaceId,
    capability: RANK_TRACKING_CAPABILITY,
    enabled: true,
    routes: ids.map((credentialId, position) => ({
      id: credentialId,
      bindingId: binding.id,
      workspaceId: binding.workspaceId,
      position,
      credentialId,
      provider: "XMLSTOCK",
      credentialMode: "BYOK_API_KEY",
      availability: "CREDENTIAL_UNAVAILABLE",
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt
    })),
    fallbackPolicy: { mode: "NEXT_AVAILABLE", reasons: ["LOW_BALANCE"] },
    version: 47,
    createdBy: binding.createdBy,
    updatedBy: binding.updatedBy,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt
  };
  const desired = {
    enabled: true,
    credentialIds: [ids[1]!, ids[0]!, ids[2]!],
    fallbackReasons: ["LOW_BALANCE"] as const
  };
  assert.equal(workspaceRouteMatchesBinding(workspaceBinding, desired), false);
  assert.equal(workspaceRouteMatchesBinding({
    ...workspaceBinding,
    routes: [
      { ...workspaceBinding.routes[1]!, position: 0 },
      { ...workspaceBinding.routes[0]!, position: 1 },
      workspaceBinding.routes[2]!
    ],
    version: 999
  }, desired), true);
  assert.equal(workspaceRouteMatchesBinding(undefined, desired), false);
  assert.deepEqual(
    workspaceRouteSelectedOptions(desired.credentialIds, [], workspaceBinding, RANK_TRACKING_CAPABILITY)
      .map(({ id }) => id),
    desired.credentialIds,
    "configured routes must remain draggable when options are temporarily missing"
  );
  assert.deepEqual(workspaceRouteUpdateInput(desired), {
    enabled: true,
    routes: desired.credentialIds.map((credentialId, position) => ({
      position,
      sourceKind: "WORKSPACE_CREDENTIAL",
      credentialId
    })),
    fallbackPolicy: { mode: "NEXT_AVAILABLE", reasons: ["LOW_BALANCE"] }
  });
  assert.deepEqual(workspaceRouteUpdateInput({
    enabled: false,
    credentialIds: [ids[0]!],
    fallbackReasons: ["LOW_BALANCE"]
  }).fallbackPolicy, { mode: "NONE", reasons: [] });
});

test("drag-and-drop reorders mixed providers by credential ID only", () => {
  const ids = ["xmlstock-legend", "xmlstock-personal", "arsenkin-legend"];
  assert.deepEqual(
    reorderWorkspaceRouteCredentialIds(ids, "arsenkin-legend", "xmlstock-legend", "BEFORE"),
    ["arsenkin-legend", "xmlstock-legend", "xmlstock-personal"]
  );
  assert.deepEqual(
    reorderWorkspaceRouteCredentialIds(ids, "xmlstock-legend", "arsenkin-legend", "AFTER"),
    ["xmlstock-personal", "arsenkin-legend", "xmlstock-legend"]
  );
  assert.equal(
    reorderWorkspaceRouteCredentialIds(ids, "xmlstock-legend", "xmlstock-personal", "BEFORE"),
    ids
  );
  assert.equal(
    reorderWorkspaceRouteCredentialIds(ids, "missing", "xmlstock-personal", "AFTER"),
    ids
  );
  assert.deepEqual(
    reorderWorkspaceRouteCredentialIds(
      ["xmlstock-legend", "temporarily-hidden", "xmlstock-personal", "arsenkin-legend"],
      "arsenkin-legend",
      "xmlstock-personal",
      "BEFORE"
    ),
    ["xmlstock-legend", "temporarily-hidden", "arsenkin-legend", "xmlstock-personal"],
    "a missing option must not turn visible row indexes into the wrong stored indexes"
  );
});

test("a transfer-reset binding starts with no selected credential", () => {
  const { route: _retiredRoute, ...resetFields } = binding;
  const reset: ProjectConnectorBinding = {
    ...resetFields,
    enabled: false,
    routes: [],
    availability: "DISABLED",
    version: 2
  };

  assert.deepEqual(projectConnectorDraft(reset), {
    credentialId: "",
    enabled: false
  });
  assert.equal(
    projectConnectorDraftDirty(reset, {
      credentialId: activeCredential.id,
      enabled: true
    }),
    true
  );
  assert.equal(
    canSubmitProjectConnectorDraft(
      reset,
      { credentialId: activeCredential.id, enabled: true },
      [activeCredential],
      RANK_TRACKING_CAPABILITY
    ),
    true
  );
});

test("binding revision compares both identity and optimistic version", () => {
  assert.equal(sameProjectConnectorBindingRevision(binding, binding), true);
  assert.equal(
    sameProjectConnectorBindingRevision(binding, {
      ...binding,
      version: 2
    }),
    false
  );
  assert.equal(sameProjectConnectorBindingRevision(undefined, undefined), true);
  assert.equal(sameProjectConnectorBindingRevision(binding, undefined), false);
});

test("revalidation applies only to the unchanged local generation and revision", () => {
  assert.equal(
    canApplyProjectConnectorRevalidation(3, 3, binding, binding),
    true
  );
  assert.equal(
    canApplyProjectConnectorRevalidation(3, 4, binding, binding),
    false
  );
  assert.equal(
    canApplyProjectConnectorRevalidation(3, 3, binding, {
      ...binding,
      version: 2
    }),
    false
  );
});

test("an immutable create replay is reconciled with the current server binding", () => {
  const current = {
    ...binding,
    enabled: false,
    availability: "DISABLED" as const,
    version: 2
  };
  const result = reconcileProjectConnectorCreate(
    binding,
    settings([activeCredential], [current]),
    RANK_TRACKING_CAPABILITY
  );

  assert.equal(result.current, current);
  assert.equal(result.superseded, true);
});

test("create input cannot contain platform, fallback or budget controls", () => {
  assert.deepEqual(
    createProjectConnectorBindingInput(RANK_TRACKING_CAPABILITY, {
      credentialId: activeCredential.id,
      enabled: true
    }),
    {
      capability: "SERP_RANK_TRACKING",
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId: activeCredential.id
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    }
  );
});

test("create command key is stable only while the payload is unchanged", () => {
  const firstSignature = projectConnectorCreatePayloadSignature(
    RANK_TRACKING_CAPABILITY,
    { credentialId: activeCredential.id, enabled: true }
  );
  let sequence = 0;
  const createKey = () => `key-${++sequence}`;
  const first = stableProjectConnectorCreateCommand(
    undefined,
    firstSignature,
    createKey
  );
  assert.equal(
    stableProjectConnectorCreateCommand(first, firstSignature, createKey),
    first
  );
  const changed = stableProjectConnectorCreateCommand(
    first,
    projectConnectorCreatePayloadSignature(RANK_TRACKING_CAPABILITY, {
      credentialId: "another",
      enabled: true
    }),
    createKey
  );
  assert.equal(changed.key, "key-2");
});
