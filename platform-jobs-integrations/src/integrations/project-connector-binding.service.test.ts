import assert from "node:assert/strict";
import test from "node:test";
import {
  ConflictException,
  PreconditionFailedException
} from "@nestjs/common";
import {
  domainEventTypes,
  type InternalCreateProjectConnectorBindingInput
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  IntegrationCredential,
  ProjectConnectorBinding as StoredBinding,
  ProjectConnectorRoute as StoredRoute
} from "../generated/prisma/client.js";
import {
  ProjectConnectorBindingService,
  projectConnectorBindingRequestHash
} from "./project-connector-binding.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const otherWorkspaceId = "0190abcd-0000-7000-8000-000000000002";
const projectId = "0190abcd-0000-7000-8000-000000000003";
const otherProjectId = "0190abcd-0000-7000-8000-000000000004";
const actorId = "0190abcd-0000-7000-8000-000000000005";
const bindingId = "0190abcd-0000-7000-8000-000000000006";
const routeId = "0190abcd-0000-7000-8000-000000000007";
const credentialId = "0190abcd-0000-7000-8000-000000000008";
const otherCredentialId = "0190abcd-0000-7000-8000-000000000009";
const now = new Date("2026-07-29T10:00:00.000Z");

const createInput: InternalCreateProjectConnectorBindingInput = {
  workspaceId,
  projectId,
  actorId,
  idempotencyKey: "binding-create-001",
  capability: "SERP_RANK_TRACKING",
  enabled: true,
  route: {
    position: 0,
    sourceKind: "WORKSPACE_CREDENTIAL",
    credentialId
  },
  fallbackPolicy: { mode: "NONE" },
  budgetPolicy: { mode: "DISABLED" }
};

test("returns project-scoped aggregate and fails malformed capability JSON closed", async () => {
  const credential = credentialRecord({
    capabilities: [
      "SERP_RANK_TRACKING",
      "REMOVED_CAPABILITY",
      "SERP_RANK_TRACKING"
    ]
  });
  const binding = bindingRecord(credential);
  const queries: unknown[] = [];
  let querySequence = 0;
  const prisma = {
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return callback({
        projectConnectorBinding: {
          findMany: async (query: unknown) => {
            assert.equal(querySequence, 0);
            querySequence += 1;
            queries.push(query);
            return [binding];
          }
        },
        integrationCredential: {
          findMany: async (query: unknown) => {
            assert.equal(querySequence, 1);
            querySequence += 1;
            queries.push(query);
            return [credential];
          }
        }
      });
    }
  } as unknown as PrismaService;

  const result = await new ProjectConnectorBindingService(prisma).aggregate(
    workspaceId,
    projectId
  );

  assert.equal(result.bindings[0]?.availability, "READY");
  assert.deepEqual(result.credentialOptions[0]?.capabilities, [
    "SERP_RANK_TRACKING"
  ]);
  assert.equal(result.credentialOptionsTruncated, false);
  assert.deepEqual(
    (
      queries[0] as {
        readonly where: Readonly<Record<string, unknown>>;
      }
    ).where,
    { workspaceId, projectId }
  );
  assert.deepEqual(
    (
      queries[1] as {
        readonly where: Readonly<Record<string, unknown>>;
      }
    ).where,
    { workspaceId, deletedAt: null }
  );
  const credentialSelect = (
    queries[0] as {
      readonly include: {
        readonly routes: {
          readonly include: {
            readonly credential: {
              readonly select: Readonly<Record<string, boolean>>;
            };
          };
        };
      };
    }
  ).include.routes.include.credential.select;
  assert.deepEqual(credentialSelect, {
    id: true,
    workspaceId: true,
    provider: true,
    label: true,
    mode: true,
    status: true,
    capabilities: true,
    providerMeta: true,
    lastSuccessAt: true,
    deletedAt: true
  });
  assert.equal("ciphertext" in credentialSelect, false);
  assert.equal("encryptedDataKey" in credentialSelect, false);
  assert.equal(
    (
      queries[1] as {
        readonly take: number;
      }
    ).take,
    501
  );
  assert.equal(querySequence, 2);

  const malformed = credentialRecord({ capabilities: { granted: true } });
  const malformedPrisma = {
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return callback({
        projectConnectorBinding: {
          findMany: async () => [bindingRecord(malformed)]
        },
        integrationCredential: {
          findMany: async () => [malformed]
        }
      });
    }
  } as unknown as PrismaService;
  const malformedResult = await new ProjectConnectorBindingService(
    malformedPrisma
  ).aggregate(workspaceId, projectId);
  assert.deepEqual(malformedResult.credentialOptions[0]?.capabilities, []);
  assert.equal(
    malformedResult.bindings[0]?.availability,
    "CAPABILITY_MISMATCH"
  );
});

test("bounds credential options and always retains credentials used by existing bindings", async () => {
  const selected = credentialRecord({
    id: otherCredentialId,
    label: "ZZZ selected"
  });
  const candidates = Array.from({ length: 501 }, (_, index) =>
    credentialRecord({
      id: `0190abcd-0000-7000-8000-${(index + 1000)
        .toString(16)
        .padStart(12, "0")}`,
      label: `Credential ${index.toString().padStart(3, "0")}`
    })
  );

  const result = await new ProjectConnectorBindingService(
    aggregatePrisma([bindingRecord(selected)], candidates)
  ).aggregate(workspaceId, projectId);

  assert.equal(result.credentialOptionsTruncated, true);
  assert.equal(result.credentialOptions.length, 500);
  assert.ok(
    result.credentialOptions.some(
      (credential) => credential.id === selected.id
    )
  );
});

test("treats a deleted pending credential as unavailable", async () => {
  const deletedPending = credentialRecord({
    status: "PENDING_VERIFICATION",
    deletedAt: now
  });
  const prisma = aggregatePrisma([bindingRecord(deletedPending)], []);

  const result = await new ProjectConnectorBindingService(prisma).aggregate(
    workspaceId,
    projectId
  );

  assert.equal(
    result.bindings[0]?.availability,
    "CREDENTIAL_UNAVAILABLE"
  );
});

test("replays the immutable create response and rejects another payload", async () => {
  const credential = credentialRecord();
  const original = bindingRecord(credential);
  let transactions = 0;
  const prisma = {
    projectConnectorBindingCreateReceipt: {
      findUnique: async () => receiptRecord(original)
    },
    $transaction: async () => {
      transactions += 1;
      throw new Error("must not run");
    }
  } as unknown as PrismaService;
  const service = new ProjectConnectorBindingService(prisma);

  const replay = await service.create(createInput, "request-replay");
  assert.equal(replay.version, 1);
  assert.equal(replay.enabled, true);
  assert.equal(transactions, 0);

  await assert.rejects(
    service.create(
      { ...createInput, enabled: false },
      "request-conflict"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (
          error.getResponse() as Readonly<Record<string, unknown>>
        ).code,
        "IDEMPOTENCY_CONFLICT"
      );
      return true;
    }
  );
});

test("fails closed for malformed or scope-inconsistent immutable create receipts", async () => {
  const receipt = receiptRecord(bindingRecord(credentialRecord()));
  const candidates = [
    {
      ...receipt,
      responseSnapshot: {
        id: bindingId,
        route: { credentialId }
      }
    },
    {
      ...receipt,
      bindingId: otherCredentialId
    }
  ];

  for (const candidate of candidates) {
    const prisma = {
      projectConnectorBindingCreateReceipt: {
        findUnique: async () => candidate
      }
    } as unknown as PrismaService;

    await assert.rejects(
      new ProjectConnectorBindingService(prisma).create(
        createInput,
        "request-malformed-receipt"
      ),
      /Invalid project connector binding create receipt/
    );
  }
});

test("returns the concurrent idempotent create winner", async () => {
  const winner = receiptRecord(bindingRecord(credentialRecord()));
  let lookups = 0;
  const prisma = {
    projectConnectorBindingCreateReceipt: {
      findUnique: async () => {
        lookups += 1;
        return lookups === 1 ? null : winner;
      }
    },
    $transaction: async () => {
      throw {
        code: "P2002",
        meta: {
          target: [
            "workspace_id",
            "project_id",
            "idempotency_key"
          ]
        }
      };
    }
  } as unknown as PrismaService;

  const result = await new ProjectConnectorBindingService(prisma).create(
    createInput,
    "request-race"
  );

  assert.equal(result.id, bindingId);
  assert.equal(lookups, 2);
});

test("maps only expected create unique constraints to business conflicts", async () => {
  let lookups = 0;
  const duplicatePrisma = {
    projectConnectorBindingCreateReceipt: {
      findUnique: async () => {
        lookups += 1;
        return null;
      }
    },
    $transaction: async () => {
      throw {
        code: "P2002",
        meta: {
          target:
            "project_connector_bindings_tenant_project_capability_key"
        }
      };
    }
  } as unknown as PrismaService;
  await assert.rejects(
    new ProjectConnectorBindingService(duplicatePrisma).create(
      createInput,
      "request-duplicate"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (
          error.getResponse() as Readonly<Record<string, unknown>>
        ).code,
        "DUPLICATE"
      );
      return true;
    }
  );
  assert.equal(lookups, 2);

  const unexpected = {
    code: "P2002",
    meta: { target: "project_connector_routes_pkey" }
  };
  let unexpectedLookups = 0;
  const unexpectedPrisma = {
    projectConnectorBindingCreateReceipt: {
      findUnique: async () => {
        unexpectedLookups += 1;
        return null;
      }
    },
    $transaction: async () => {
      throw unexpected;
    }
  } as unknown as PrismaService;
  await assert.rejects(
    new ProjectConnectorBindingService(unexpectedPrisma).create(
      createInput,
      "request-unexpected-unique"
    ),
    (error: unknown) => error === unexpected
  );
  assert.equal(unexpectedLookups, 1);
});

test("creates binding, route and redacted outbox event in one transaction", async () => {
  const credential = credentialRecord();
  let binding: ReturnType<typeof bindingRecord> | null = null;
  let route: StoredRoute | null = null;
  let event: Readonly<Record<string, unknown>> | null = null;
  let receipt: Readonly<Record<string, unknown>> | null = null;
  let inTransaction = false;
  const prisma = {
    projectConnectorBindingCreateReceipt: {
      findUnique: async () => null
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) => {
      inTransaction = true;
      try {
        return await callback({
          $queryRaw: lockedCredentialQuery(
            credential,
            credentialId,
            () => {
              assert.equal(inTransaction, true);
            }
          ),
          projectConnectorBinding: {
            create: async ({
              data: _data
            }: {
              data: Readonly<Record<string, unknown>>;
            }) => {
              assert.equal(inTransaction, true);
              binding = bindingRecord(credential);
              return binding;
            },
            findFirst: async () => binding
          },
          projectConnectorRoute: {
            createMany: async ({
              data
            }: {
              data: readonly Readonly<Record<string, unknown>>[];
            }) => {
              assert.equal(inTransaction, true);
              const first = data[0];
              if (!first) throw new Error("Missing route create fixture");
              route = {
                id: routeId,
                workspaceId: String(first.workspaceId),
                projectId: String(first.projectId),
                bindingId: bindingId,
                position: Number(first.position),
                sourceKind: "WORKSPACE_CREDENTIAL",
                credentialId: String(first.credentialId),
                routingScope: "PROJECT_OVERRIDE",
                workspaceRouteId: null,
                createdAt: now,
                updatedAt: now
              };
              return { count: data.length };
            }
          },
          outboxEvent: {
            create: async ({
              data
            }: {
              data: Readonly<Record<string, unknown>>;
            }) => {
              assert.equal(inTransaction, true);
              event = data;
              return data;
            }
          },
          projectConnectorBindingCreateReceipt: {
            create: async ({
              data
            }: {
              data: Readonly<Record<string, unknown>>;
            }) => {
              assert.equal(inTransaction, true);
              receipt = data;
              return data;
            }
          }
        });
      } finally {
        inTransaction = false;
      }
    }
  } as unknown as PrismaService;

  const created = await new ProjectConnectorBindingService(prisma).create(
    createInput,
    "request-create"
  );

  assert.equal(created.availability, "READY");
  assert.ok(route);
  assert.ok(event);
  assert.ok(receipt);
  assert.equal(
    bytes(
      (receipt as Readonly<Record<string, unknown>>).requestHash
    ).length,
    32
  );
  assert.equal(
    (event as Readonly<Record<string, unknown>>).eventType,
    domainEventTypes.projectConnectorBindingCreated
  );
  assert.deepEqual(eventChangedFields(event), [
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy"
  ]);
  assertRedactedEvent(event, credential);
});

test("rejects cross-workspace, pending and capability-mismatched credentials", async () => {
  const candidates = [
    null,
    credentialRecord({ status: "PENDING_VERIFICATION" }),
    credentialRecord({ capabilities: ["KEYWORD_RESEARCH"] }),
    credentialRecord({ mode: "PLATFORM_PAID" })
  ];
  for (const credential of candidates) {
    let createCalls = 0;
    const prisma = {
      projectConnectorBindingCreateReceipt: {
        findUnique: async () => null
      },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>
      ) =>
        callback({
          $queryRaw: lockedCredentialQuery(credential),
          projectConnectorBinding: {
            create: async () => {
              createCalls += 1;
            }
          }
        })
    } as unknown as PrismaService;

    await assert.rejects(
      new ProjectConnectorBindingService(prisma).create(
        createInput,
        "request-invalid"
      ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(
          (
            error.getResponse() as Readonly<Record<string, unknown>>
          ).code,
          "RESOURCE_STATE_CONFLICT"
        );
        return true;
      }
    );
    assert.equal(createCalls, 0);
  }
});

test("uses CAS, swaps one tenant-scoped route and writes a redacted update event", async () => {
  const firstCredential = credentialRecord();
  const secondCredential = credentialRecord({
    id: otherCredentialId,
    label: "Secondary provider account"
  });
  let state = bindingRecord(firstCredential);
  let event: Readonly<Record<string, unknown>> | null = null;
  let updateWhere: Readonly<Record<string, unknown>> | null = null;
  let routeWhere: Readonly<Record<string, unknown>> | null = null;
  const prisma = {
    projectConnectorBinding: {
      findFirst: async () => state
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) =>
      callback({
        $queryRaw: lockedCredentialQuery(
          secondCredential,
          otherCredentialId
        ),
        projectConnectorBinding: {
          updateMany: async ({
            where,
            data
          }: {
            where: Readonly<Record<string, unknown>>;
            data: Readonly<Record<string, unknown>>;
          }) => {
            updateWhere = where;
            state = {
              ...state,
              enabled: Boolean(data.enabled),
              updatedBy: String(data.updatedBy),
              version: state.version + 1,
              updatedAt: new Date("2026-07-29T11:00:00.000Z")
            };
            return { count: 1 };
          },
          findFirst: async () => state
        },
        projectConnectorRoute: {
          findMany: async () => [
            { id: routeId, position: 0 }
          ],
          update: async ({
            where,
            data
          }: {
            where: Readonly<Record<string, unknown>>;
            data: Readonly<Record<string, unknown>>;
          }) => {
            routeWhere = where;
            const existingRoute = state.routes[0];
            if (!existingRoute) throw new Error("Missing route fixture");
            state = {
              ...state,
              routes: [
                {
                  ...existingRoute,
                  credentialId: String(data.credentialId),
                  credential: secondCredential,
                  updatedAt: new Date("2026-07-29T11:00:00.000Z")
                }
              ]
            };
            return state.routes[0];
          },
          create: async () => {
            throw new Error("Existing route must be updated");
          },
          deleteMany: async () => ({ count: 0 })
        },
        outboxEvent: {
          create: async ({
            data
          }: {
            data: Readonly<Record<string, unknown>>;
          }) => {
            event = data;
            return data;
          }
        }
      })
  } as unknown as PrismaService;

  const updated = await new ProjectConnectorBindingService(prisma).update(
    bindingId,
    {
      workspaceId,
      projectId,
      actorId,
      version: 1,
      enabled: true,
      route: {
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL",
        credentialId: otherCredentialId
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" }
    },
    "request-update"
  );

  assert.equal(updated.route.credentialId, otherCredentialId);
  assert.equal(updated.version, 2);
  assert.deepEqual(updateWhere, {
    id: bindingId,
    workspaceId,
    projectId,
    version: 1
  });
  assert.deepEqual(routeWhere, { id: routeId });
  assert.ok(event);
  assert.equal(
    (event as Readonly<Record<string, unknown>>).eventType,
    domainEventTypes.projectConnectorBindingUpdated
  );
  assert.deepEqual(eventChangedFields(event), ["route"]);
  assertRedactedEvent(event, secondCredential);
});

test("allows disabling a binding whose current credential is no longer active", async () => {
  const unavailableCredential = credentialRecord({ status: "INVALID" });
  let state = bindingRecord(unavailableCredential);
  const prisma = {
    projectConnectorBinding: {
      findFirst: async () => state
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) =>
      callback({
        $queryRaw: async () => {
          throw new Error(
            "disabling the current route must not lock an inactive credential"
          );
        },
        projectConnectorBinding: {
          updateMany: async () => {
            state = {
              ...state,
              enabled: false,
              version: 2,
              updatedAt: new Date("2026-07-29T11:00:00.000Z")
            };
            return { count: 1 };
          },
          findFirst: async () => state
        },
        projectConnectorRoute: {
          findMany: async () => [
            { id: routeId, position: 0 }
          ],
          update: async () => state.routes[0],
          create: async () => {
            throw new Error("Existing route must be updated");
          },
          deleteMany: async () => ({ count: 0 })
        },
        outboxEvent: {
          create: async () => ({})
        }
      })
  } as unknown as PrismaService;

  const disabled = await new ProjectConnectorBindingService(prisma).update(
    bindingId,
    {
      ...updateInput(1),
      enabled: false
    },
    "request-disable"
  );

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.availability, "DISABLED");
});

test("returns HTTP 412 with the current version for stale and concurrent CAS", async () => {
  const credential = credentialRecord();
  const stalePrisma = {
    projectConnectorBinding: {
      findFirst: async () =>
        bindingRecord(credential, { version: 4 })
    }
  } as unknown as PrismaService;
  await assertVersionConflict(
    new ProjectConnectorBindingService(stalePrisma).update(
      bindingId,
      updateInput(3),
      "request-stale"
    ),
    4
  );

  const concurrentPrisma = {
    projectConnectorBinding: {
      findFirst: async () => bindingRecord(credential)
    },
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>
    ) =>
      callback({
        $queryRaw: lockedCredentialQuery(credential),
        projectConnectorBinding: {
          updateMany: async () => ({ count: 0 }),
          findFirst: async () => ({ version: 2 })
        }
      })
  } as unknown as PrismaService;
  await assertVersionConflict(
    new ProjectConnectorBindingService(concurrentPrisma).update(
      bindingId,
      updateInput(1),
      "request-concurrent"
    ),
    2
  );
});

test("does not load a binding from another workspace or project", async () => {
  let where: Readonly<Record<string, unknown>> | null = null;
  const prisma = {
    projectConnectorBinding: {
      findFirst: async (query: {
        readonly where: Readonly<Record<string, unknown>>;
      }) => {
        where = query.where;
        return null;
      }
    }
  } as unknown as PrismaService;

  await assert.rejects(
    new ProjectConnectorBindingService(prisma).update(
      bindingId,
      updateInput(1),
      "request-scope"
    )
  );
  assert.deepEqual(where, { id: bindingId, workspaceId, projectId });
  assert.notDeepEqual(where, {
    id: bindingId,
    workspaceId: otherWorkspaceId,
    projectId: otherProjectId
  });
});

function updateInput(version: number) {
  return {
    workspaceId,
    projectId,
    actorId,
    version,
    enabled: true,
    route: createInput.route,
    fallbackPolicy: { mode: "NONE" as const },
    budgetPolicy: { mode: "DISABLED" as const }
  };
}

function aggregatePrisma(
  bindings: readonly ReturnType<typeof bindingRecord>[],
  credentials: readonly IntegrationCredential[]
): PrismaService {
  return {
    $transaction: async (
      callback: (transaction: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return callback({
        projectConnectorBinding: {
          findMany: async () => bindings
        },
        integrationCredential: {
          findMany: async () => credentials
        }
      });
    }
  } as unknown as PrismaService;
}

function lockedCredentialQuery(
  credential: IntegrationCredential | null,
  expectedCredentialId = credentialId,
  onLock?: () => void
) {
  return async (
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ) => {
    onLock?.();
    const sql = strings.join("?");
    assert.match(sql, /FROM "integration_credentials"/u);
    assert.match(sql, /FOR SHARE/u);
    assert.equal(sql.includes("ciphertext"), false);
    assert.equal(sql.includes("encrypted_data_key"), false);
    assert.deepEqual(values, [workspaceId, expectedCredentialId]);
    return credential
      ? [
          {
            id: credential.id,
            workspaceId: credential.workspaceId,
            provider: credential.provider,
            mode: credential.mode,
            status: credential.status,
            capabilities: credential.capabilities,
            deletedAt: credential.deletedAt
          }
        ]
      : [];
  };
}

async function assertVersionConflict(
  promise: Promise<unknown>,
  currentVersion: number
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PreconditionFailedException);
    assert.deepEqual(error.getResponse(), {
      code: "VERSION_CONFLICT",
      message: "Project connector binding version conflict",
      currentVersion
    });
    return true;
  });
}

function assertRedactedEvent(
  event: Readonly<Record<string, unknown>>,
  credential: IntegrationCredential
): void {
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes(credential.id), false);
  assert.equal(serialized.includes(credential.label), false);
  assert.equal(serialized.includes("providerMeta"), false);
  assert.equal(serialized.includes("displayHint"), false);
  assert.equal(serialized.includes("ciphertext"), false);
  assert.equal(serialized.includes("apiKey"), false);
}

function eventChangedFields(
  event: Readonly<Record<string, unknown>>
): unknown {
  const payload = event.payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Missing event payload");
  }
  return (payload as Readonly<Record<string, unknown>>).changedFields;
}

function bindingRecord(
  credential: IntegrationCredential,
  overrides: Partial<StoredBinding> = {}
) {
  const binding: StoredBinding = {
    id: bindingId,
    workspaceId,
    projectId,
    capability: "SERP_RANK_TRACKING",
    enabled: true,
    fallbackMode: "NONE",
    fallbackReasons: [],
    configurationScope: "PROJECT_OVERRIDE",
    workspaceBindingId: null,
    workspaceBindingVersion: null,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
  return {
    ...binding,
    routes: [
      {
        id: routeId,
        workspaceId: binding.workspaceId,
        projectId: binding.projectId,
        bindingId: binding.id,
        position: 0,
        sourceKind: "WORKSPACE_CREDENTIAL" as const,
        credentialId: credential.id,
        routingScope: "PROJECT_OVERRIDE",
        workspaceRouteId: null,
        createdAt: now,
        updatedAt: now,
        credential
      }
    ]
  };
}

function receiptRecord(binding: ReturnType<typeof bindingRecord>) {
  const route = binding.routes[0];
  if (!route) throw new Error("Missing route fixture");
  return {
    workspaceId,
    projectId,
    idempotencyKey: createInput.idempotencyKey,
    requestHash: Uint8Array.from(
      projectConnectorBindingRequestHash(createInput)
    ),
    bindingId: binding.id,
    responseSnapshot: {
      id: binding.id,
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      capability: binding.capability,
      enabled: binding.enabled,
      route: {
        id: route.id,
        bindingId: route.bindingId,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        position: route.position,
        sourceKind: route.sourceKind,
        credentialId: route.credentialId,
        provider: route.credential.provider,
        credentialMode: route.credential.mode,
        createdAt: route.createdAt.toISOString(),
        updatedAt: route.updatedAt.toISOString()
      },
      fallbackPolicy: { mode: "NONE" },
      budgetPolicy: { mode: "DISABLED" },
      availability: binding.enabled ? "READY" : "DISABLED",
      version: binding.version,
      createdBy: binding.createdBy,
      updatedBy: binding.updatedBy,
      createdAt: binding.createdAt.toISOString(),
      updatedAt: binding.updatedAt.toISOString()
    },
    createdAt: now
  };
}

function credentialRecord(
  overrides: Partial<IntegrationCredential> = {}
): IntegrationCredential {
  return {
    id: credentialId,
    workspaceId,
    provider: "ARSENKIN",
    label: "Primary provider account",
    mode: "BYOK_API_KEY",
    status: "ACTIVE",
    ciphertext: Uint8Array.from([1]),
    nonce: Uint8Array.from({ length: 12 }, () => 1),
    authTag: Uint8Array.from({ length: 16 }, () => 1),
    encryptedDataKey: Uint8Array.from([1]),
    dataKeyNonce: Uint8Array.from({ length: 12 }, () => 1),
    dataKeyAuthTag: Uint8Array.from({ length: 16 }, () => 1),
    keyVersion: 1,
    displayHint: "••••test",
    capabilities: ["SERP_RANK_TRACKING"],
    providerMeta: { accountIdentifierConfigured: true },
    idempotencyKey: "credential-create-001",
    requestFingerprint: Uint8Array.from({ length: 32 }, () => 1),
    fingerprintKeyVersion: 1,
    materialVersion: 1,
    createdBy: actorId,
    updatedBy: actorId,
    verifiedAt: now,
    lastSuccessAt: now,
    lastErrorAt: null,
    lastErrorCode: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides
  };
}

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new Error("Expected database bytes");
  }
  return Uint8Array.from(value);
}
