import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import {
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  rankEstimateProjectDomainHashPreimage,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1,
  type RankExecutionGrantDenialReason,
  type RankManifestHash
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type {
  Prisma,
  RankExecutionGrantReceipt
} from "../generated/prisma/client.js";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  RankExecutionGrantPolicy,
  RankExecutionGrantPolicyDecision,
  RankExecutionGrantPolicyInput
} from "./rank-execution-grant.policy.js";
import { RankExecutionGrantService } from "./rank-execution-grant.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const membershipId = "0190abcd-0000-7000-8000-000000000004";
const jobId = "0190abcd-0000-7000-8000-000000000005";
const jobItemId = "0190abcd-0000-7000-8000-000000000006";
const manifestId = "0190abcd-0000-7000-8000-000000000007";
const grantId = "0190abcd-0000-7000-8000-000000000008";
const quotaReservationId = "0190abcd-0000-7000-8000-000000000009";
const projectDomain = "example.com";
const idempotencyKey = "rank-grant-key-0001";
const correlationId = "request-rank-grant-001";
const decidedAt = new Date("2026-07-29T12:00:00.000Z");

test(
  "creates GRANTED with reservation, exact TTL, canonical locks, policy input and Serializable isolation",
  async () => {
    const input = grantInput();
    const fixture = serviceFixture({
      policyDecision: {
        entitlement: "ALLOWED",
        quota: "UNLIMITED",
        quotaReservationId: quotaReservationId.toUpperCase()
      }
    });

    const result = await fixture.service.issue(
      input,
      idempotencyKey,
      correlationId
    );

    assert.equal(result.created, true);
    assert.equal(result.decision.status, "GRANTED");
    if (result.decision.status !== "GRANTED") {
      assert.fail("expected a granted decision");
    }
    assert.equal(result.decision.grant.id, grantId);
    assert.equal(result.decision.grant.issuedAt, decidedAt.toISOString());
    assert.equal(
      new Date(result.decision.grant.expiresAt).getTime() -
        new Date(result.decision.grant.issuedAt).getTime(),
      30_000
    );
    assert.deepEqual(fixture.transactionOptions, [
      { isolationLevel: "Serializable" }
    ]);
    assert.deepEqual(
      fixture.calls.filter((call) => call.startsWith("lock:")),
      [
        "lock:workspaces",
        "lock:projects",
        "lock:users",
        "lock:workspace_members",
        "lock:project_member_access"
      ]
    );
    assert.ok(
      fixture.calls.indexOf("lock:project_member_access") <
        fixture.calls.indexOf("policy")
    );
    assert.ok(fixture.calls.indexOf("policy") < fixture.calls.indexOf("clock"));
    assert.ok(fixture.calls.indexOf("clock") < fixture.calls.indexOf("create"));

    assert.equal(fixture.policyCalls.length, 1);
    assert.equal(
      fixture.policyCalls[0]?.transaction,
      fixture.transaction
    );
    assert.deepEqual(fixture.policyCalls[0]?.input, {
      workspaceId,
      projectId,
      actorId,
      jobId,
      jobItemId,
      executionAttempt: 1,
      provider: "ARSENKIN",
      credentialMode: "BYOK_API_KEY",
      policyVersion: "manual-arsenkin-positions@1.0.0",
      usageIntent: {
        meter: "RANK_PROVIDER_TASK",
        quantity: 1
      }
    });

    const created = requiredCreatedData(fixture);
    assert.equal(created["quotaReservationId"], quotaReservationId);
    assert.equal(created["decision"], "GRANTED");
    assert.equal(created["denialReason"], null);
    assert.equal(created["correlationId"], correlationId);
    assert.equal(created["decidedAt"], decidedAt);
    assert.equal(
      (created["expiresAt"] as Date).getTime() - decidedAt.getTime(),
      30_000
    );
    assert.equal(
      Buffer.from(created["requestHash"] as Uint8Array).length,
      32
    );
    assert.equal(
      Buffer.from(created["scopeHash"] as Uint8Array).length,
      32
    );
    assert.deepEqual(created["responseSnapshot"], result.decision);
  }
);

test("persists every fail-closed denial without a reservation", async (t) => {
  const cases: readonly DenialCase[] = [
    {
      name: "missing workspace",
      reason: "WORKSPACE_NOT_ACTIVE",
      mutate: (rows) => {
        rows.workspace = null;
      }
    },
    {
      name: "read-only workspace",
      reason: "WORKSPACE_NOT_ACTIVE",
      mutate: (rows) => {
        assert.ok(rows.workspace);
        rows.workspace.status = "READ_ONLY";
      }
    },
    {
      name: "missing project",
      reason: "PROJECT_NOT_ACTIVE",
      mutate: (rows) => {
        rows.project = null;
      }
    },
    {
      name: "archived project",
      reason: "PROJECT_NOT_ACTIVE",
      mutate: (rows) => {
        assert.ok(rows.project);
        rows.project.status = "ARCHIVED";
      }
    },
    {
      name: "project version drift",
      reason: "PROJECT_VERSION_CHANGED",
      mutate: (rows) => {
        assert.ok(rows.project);
        rows.project.version += 1;
      }
    },
    {
      name: "project domain drift",
      reason: "PROJECT_VERSION_CHANGED",
      mutate: (rows) => {
        assert.ok(rows.project);
        rows.project.domain = "changed.example";
      }
    },
    {
      name: "missing membership",
      reason: "MEMBERSHIP_NOT_ACTIVE",
      mutate: (rows) => {
        rows.membership = null;
      }
    },
    {
      name: "suspended membership",
      reason: "MEMBERSHIP_NOT_ACTIVE",
      mutate: (rows) => {
        assert.ok(rows.membership);
        rows.membership.status = "SUSPENDED";
      }
    },
    {
      name: "suspended actor",
      reason: "MEMBERSHIP_NOT_ACTIVE",
      mutate: (rows) => {
        assert.ok(rows.membership);
        rows.membership.user.status = "SUSPENDED";
      }
    },
    {
      name: "membership version drift",
      reason: "MEMBERSHIP_VERSION_CHANGED",
      mutate: (rows) => {
        assert.ok(rows.membership);
        rows.membership.version += 1;
      }
    },
    {
      name: "ranking.run denied",
      reason: "RUN_PERMISSION_DENIED",
      mutate: (rows) => {
        assert.ok(rows.membership);
        rows.membership.roleCode = "VIEWER";
      }
    },
    {
      name: "entitlement unavailable",
      reason: "ENTITLEMENT_NOT_AVAILABLE",
      policyDecision: {
        entitlement: "NOT_AVAILABLE",
        quota: "NOT_AVAILABLE"
      },
      expectsPolicy: true
    },
    {
      name: "entitlement denied",
      reason: "ENTITLEMENT_DENIED",
      policyDecision: {
        entitlement: "DENIED",
        quota: "NOT_AVAILABLE"
      },
      expectsPolicy: true
    },
    {
      name: "quota unavailable",
      reason: "QUOTA_NOT_AVAILABLE",
      policyDecision: {
        entitlement: "ALLOWED",
        quota: "NOT_AVAILABLE"
      },
      expectsPolicy: true
    },
    {
      name: "quota exhausted",
      reason: "QUOTA_EXHAUSTED",
      policyDecision: {
        entitlement: "ALLOWED",
        quota: "EXHAUSTED"
      },
      expectsPolicy: true
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const rows = activeAuthorizationRows();
      scenario.mutate?.(rows);
      const fixture = serviceFixture({
        authorizationRows: rows,
        ...(scenario.policyDecision
          ? { policyDecision: scenario.policyDecision }
          : {})
      });

      const result = await fixture.service.issue(
        grantInput(),
        idempotencyKey,
        correlationId
      );

      assert.equal(result.created, true);
      assert.equal(result.decision.status, "DENIED");
      if (result.decision.status !== "DENIED") {
        assert.fail("expected a denied decision");
      }
      assert.equal(result.decision.reason, scenario.reason);
      assert.equal(
        fixture.policyCalls.length,
        scenario.expectsPolicy ? 1 : 0
      );
      const created = requiredCreatedData(fixture);
      assert.equal(created["decision"], "DENIED");
      assert.equal(created["denialReason"], scenario.reason);
      assert.equal(created["expiresAt"], null);
      assert.equal(created["quotaReservationId"], null);
    });
  }
});

test(
  "returns an exact expired GRANTED replay without a transaction or policy",
  async () => {
    const input = grantInput();
    const expiredAt = new Date("2000-01-01T00:00:00.000Z");
    const receipt = grantedReceipt(input, expiredAt);
    const storedDecision =
      receipt.responseSnapshot as unknown as InternalRankExecutionGrantDecisionV1;
    const fixture = serviceFixture({
      rootIdempotencyResults: [receipt]
    });

    const result = await fixture.service.issue(
      input,
      idempotencyKey,
      correlationId
    );

    assert.equal(result.created, false);
    assert.deepEqual(result.decision, storedDecision);
    assert.equal(result.decision.status, "GRANTED");
    if (result.decision.status !== "GRANTED") {
      assert.fail("expired exact replay must remain granted");
    }
    assert.ok(
      new Date(result.decision.grant.expiresAt).getTime() < Date.now()
    );
    assert.equal(fixture.transactionCalls, 0);
    assert.equal(fixture.policyCalls.length, 0);
    assert.equal(fixture.creates.length, 0);
  }
);

test(
  "rejects a different request under the same key with a 409 DomainError",
  async () => {
    const storedInput = grantInput();
    const currentInput = grantInput({ executionAttempt: 2 });
    const fixture = serviceFixture({
      rootIdempotencyResults: [grantedReceipt(storedInput)]
    });

    await assert.rejects(
      fixture.service.issue(currentInput, idempotencyKey, correlationId),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 409 &&
        error.code === "IDEMPOTENCY_CONFLICT"
    );
    assert.equal(fixture.transactionCalls, 0);
    assert.equal(fixture.policyCalls.length, 0);
    assert.equal(fixture.creates.length, 0);
  }
);

test("resolves every P2002 outcome fail-closed", async (t) => {
  await t.test("returns the committed idempotency winner", async () => {
    const input = grantInput();
    const winner = grantedReceipt(input);
    const fixture = serviceFixture({
      rootIdempotencyResults: [null, winner],
      createFailures: [{ code: "P2002" }]
    });

    const result = await fixture.service.issue(
      input,
      idempotencyKey,
      correlationId
    );

    assert.equal(result.created, false);
    assert.deepEqual(result.decision, winner.responseSnapshot);
    assert.equal(fixture.transactionCalls, 1);
    assert.equal(fixture.creates.length, 0);
  });

  await t.test("maps an item-attempt collision to 409", async () => {
    const fixture = serviceFixture({
      rootIdempotencyResults: [null, null],
      itemAttemptCollision: grantedReceipt(grantInput()),
      createFailures: [
        {
          meta: {
            driverAdapterError: {
              code: "P2002"
            }
          }
        }
      ]
    });

    await assert.rejects(
      fixture.service.issue(grantInput(), idempotencyKey, correlationId),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 409 &&
        error.code === "IDEMPOTENCY_CONFLICT"
    );
    assert.equal(fixture.transactionCalls, 1);
    assert.equal(fixture.creates.length, 0);
  });

  await t.test("returns 503 when no unique winner is visible", async () => {
    const fixture = serviceFixture({
      rootIdempotencyResults: [null, null],
      createFailures: [
        {
          cause: {
            originalCode: "P2002"
          }
        }
      ]
    });

    await assert.rejects(
      fixture.service.issue(grantInput(), idempotencyKey, correlationId),
      isServiceUnavailable
    );
    assert.equal(fixture.transactionCalls, 1);
    assert.equal(fixture.creates.length, 0);
  });
});

test(
  "retries P2034 and top-level or nested PostgreSQL serialization/deadlock failures",
  async (t) => {
    const retryableErrors: readonly {
      readonly name: string;
      readonly error: unknown;
    }[] = [
      {
        name: "Prisma P2034",
        error: { code: "P2034" }
      },
      {
        name: "top-level 40001",
        error: { code: "40001" }
      },
      {
        name: "top-level 40P01",
        error: { code: "40P01" }
      },
      {
        name: "nested 40001",
        error: {
          meta: {
            driverAdapterError: {
              cause: {
                originalCode: "40001"
              }
            }
          }
        }
      },
      {
        name: "nested 40P01",
        error: {
          cause: {
            meta: {
              originalCode: "40P01"
            }
          }
        }
      }
    ];

    for (const scenario of retryableErrors) {
      await t.test(scenario.name, async () => {
        const fixture = serviceFixture({
          transactionFailures: [scenario.error]
        });

        const result = await fixture.service.issue(
          grantInput(),
          idempotencyKey,
          correlationId
        );

        assert.equal(result.created, true);
        assert.equal(result.decision.status, "GRANTED");
        assert.equal(fixture.transactionCalls, 2);
        assert.equal(fixture.transactionOptions.length, 2);
        assert.equal(fixture.creates.length, 1);
      });
    }

    await t.test("returns 503 after the three-attempt budget", async () => {
      const fixture = serviceFixture({
        transactionFailures: [
          { code: "P2034" },
          { meta: { code: "40001" } },
          { cause: { driverAdapterError: { originalCode: "40P01" } } }
        ]
      });

      await assert.rejects(
        fixture.service.issue(grantInput(), idempotencyKey, correlationId),
        isServiceUnavailable
      );
      assert.equal(fixture.transactionCalls, 3);
      assert.equal(fixture.policyCalls.length, 0);
      assert.equal(fixture.creates.length, 0);
    });
  }
);

test("rejects inconsistent or malformed policy reservations", async (t) => {
  const invalidDecisions: readonly {
    readonly name: string;
    readonly decision: unknown;
  }[] = [
    {
      name: "AVAILABLE without a reservation",
      decision: {
        entitlement: "ALLOWED",
        quota: "AVAILABLE"
      }
    },
    {
      name: "AVAILABLE with a malformed reservation",
      decision: {
        entitlement: "ALLOWED",
        quota: "AVAILABLE",
        quotaReservationId: "not-a-uuid"
      }
    },
    {
      name: "DENIED with a reservation",
      decision: {
        entitlement: "DENIED",
        quota: "NOT_AVAILABLE",
        quotaReservationId
      }
    },
    {
      name: "EXHAUSTED with a reservation",
      decision: {
        entitlement: "ALLOWED",
        quota: "EXHAUSTED",
        quotaReservationId
      }
    },
    {
      name: "incoherent entitlement and quota",
      decision: {
        entitlement: "NOT_AVAILABLE",
        quota: "EXHAUSTED"
      }
    }
  ];

  for (const scenario of invalidDecisions) {
    await t.test(scenario.name, async () => {
      const fixture = serviceFixture({
        policyDecision: scenario.decision
      });

      await assert.rejects(
        fixture.service.issue(grantInput(), idempotencyKey, correlationId),
        { message: "Invalid rank execution grant policy decision" }
      );
      assert.equal(fixture.transactionCalls, 1);
      assert.equal(fixture.policyCalls.length, 1);
      assert.equal(fixture.creates.length, 0);
    });
  }
});

test("rejects invalid correlation IDs without writing a receipt", async (t) => {
  for (const invalid of [
    "",
    "request id with spaces",
    "-cannot-start-with-punctuation",
    "x".repeat(101)
  ]) {
    await t.test(JSON.stringify(invalid), async () => {
      const fixture = serviceFixture();

      await assert.rejects(
        fixture.service.issue(grantInput(), idempotencyKey, invalid),
        { message: "Invalid rank execution grant correlation ID" }
      );
      assert.equal(fixture.transactionCalls, 1);
      assert.equal(fixture.creates.length, 0);
    });
  }
});

interface MutableWorkspaceRow {
  id: string;
  status: string;
}

interface MutableProjectRow {
  id: string;
  status: string;
  version: number;
  domain: string;
}

interface MutableMembershipRow {
  id: string;
  status: string;
  version: number;
  roleCode: string;
  allProjects: boolean;
  user: {
    status: string;
  };
  projectAccesses: {
    level: string;
  }[];
}

interface AuthorizationRows {
  workspace: MutableWorkspaceRow | null;
  project: MutableProjectRow | null;
  membership: MutableMembershipRow | null;
}

interface DenialCase {
  readonly name: string;
  readonly reason: RankExecutionGrantDenialReason;
  readonly mutate?: (rows: AuthorizationRows) => void;
  readonly policyDecision?: RankExecutionGrantPolicyDecision;
  readonly expectsPolicy?: boolean;
}

interface ServiceFixtureOptions {
  readonly authorizationRows?: AuthorizationRows;
  readonly policyDecision?: unknown;
  readonly rootIdempotencyResults?: readonly (
    | RankExecutionGrantReceipt
    | null
  )[];
  readonly transactionReplay?: RankExecutionGrantReceipt | null;
  readonly itemAttemptCollision?: RankExecutionGrantReceipt | null;
  readonly transactionFailures?: readonly unknown[];
  readonly createFailures?: readonly unknown[];
}

interface PolicyCall {
  readonly transaction: Prisma.TransactionClient;
  readonly input: RankExecutionGrantPolicyInput;
}

interface ServiceFixture {
  readonly service: RankExecutionGrantService;
  readonly transaction: Prisma.TransactionClient;
  readonly calls: string[];
  readonly creates: Readonly<Record<string, unknown>>[];
  readonly policyCalls: PolicyCall[];
  readonly transactionOptions: unknown[];
  readonly transactionCalls: number;
}

function serviceFixture(
  options: ServiceFixtureOptions = {}
): ServiceFixture {
  const rows = options.authorizationRows ?? activeAuthorizationRows();
  const rootResults = [...(options.rootIdempotencyResults ?? [null])];
  const transactionFailures = [...(options.transactionFailures ?? [])];
  const createFailures = [...(options.createFailures ?? [])];
  const calls: string[] = [];
  const creates: Readonly<Record<string, unknown>>[] = [];
  const policyCalls: PolicyCall[] = [];
  const transactionOptions: unknown[] = [];
  let transactionCalls = 0;

  const transaction = {
    rankExecutionGrantReceipt: {
      findUnique: async () => {
        calls.push("transaction:idempotency");
        return options.transactionReplay ?? null;
      },
      create: async (args: {
        readonly data: Readonly<Record<string, unknown>>;
      }) => {
        calls.push("create");
        const failure = createFailures.shift();
        if (failure !== undefined) throw failure;
        creates.push(args.data);
        return args.data;
      }
    },
    $queryRaw: async (...query: readonly unknown[]) => {
      const text = sqlText(query[0]);
      if (text.includes('uuidv7()::text AS "grantId"')) {
        calls.push("clock");
        return [{ grantId, decidedAt }];
      }
      const table = /\bFROM\s+"([^"]+)"/u.exec(text)?.[1];
      if (!table) {
        throw new Error(`Unexpected rank grant SQL: ${text}`);
      }
      calls.push(`lock:${table}`);
      return [];
    },
    workspace: {
      findUnique: async () => {
        calls.push("read:workspace");
        return rows.workspace;
      }
    },
    project: {
      findFirst: async () => {
        calls.push("read:project");
        return rows.project;
      }
    },
    workspaceMember: {
      findFirst: async () => {
        calls.push("read:membership");
        return rows.membership;
      }
    }
  } as unknown as Prisma.TransactionClient;

  const configuredPolicyDecision = Object.hasOwn(
    options,
    "policyDecision"
  )
    ? options.policyDecision
    : ({
        entitlement: "ALLOWED",
        quota: "UNLIMITED",
        quotaReservationId
      } satisfies RankExecutionGrantPolicyDecision);
  const policy: RankExecutionGrantPolicy = {
    evaluate: async (client, input) => {
      calls.push("policy");
      policyCalls.push({ transaction: client, input });
      return configuredPolicyDecision as RankExecutionGrantPolicyDecision;
    }
  };

  const prisma = {
    rankExecutionGrantReceipt: {
      findUnique: async (args: {
        readonly where: Readonly<Record<string, unknown>>;
      }) => {
        if (
          Object.hasOwn(
            args.where,
            "workspaceId_jobItemId_executionAttempt"
          )
        ) {
          calls.push("root:item-attempt");
          return options.itemAttemptCollision ?? null;
        }
        calls.push("root:idempotency");
        return rootResults.shift() ?? null;
      }
    },
    $transaction: async <T>(
      callback: (client: Prisma.TransactionClient) => Promise<T>,
      transactionOption: unknown
    ): Promise<T> => {
      transactionCalls += 1;
      transactionOptions.push(transactionOption);
      const failure = transactionFailures.shift();
      if (failure !== undefined) throw failure;
      return callback(transaction);
    }
  } as unknown as PrismaService;

  return {
    service: new RankExecutionGrantService(prisma, policy),
    transaction,
    calls,
    creates,
    policyCalls,
    transactionOptions,
    get transactionCalls() {
      return transactionCalls;
    }
  };
}

function activeAuthorizationRows(): AuthorizationRows {
  return {
    workspace: {
      id: workspaceId,
      status: "ACTIVE"
    },
    project: {
      id: projectId,
      status: "ACTIVE",
      version: 7,
      domain: projectDomain
    },
    membership: {
      id: membershipId,
      status: "ACTIVE",
      version: 3,
      roleCode: "OWNER",
      allProjects: true,
      user: {
        status: "ACTIVE"
      },
      projectAccesses: []
    }
  };
}

function grantInput(
  overrides: Partial<InternalIssueRankExecutionGrantInputV1> = {}
): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId,
    projectId,
    actorId,
    membership: {
      id: membershipId,
      version: 3
    },
    project: {
      version: 7,
      domainHash: {
        algorithm: "SHA_256",
        value: createHash("sha256")
          .update(
            rankEstimateProjectDomainHashPreimage(projectDomain),
            "utf8"
          )
          .digest("hex")
      }
    },
    jobId,
    jobItemId,
    jobVersion: 5,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: manifestId,
      hash: hashContract("b"),
      chunkIndex: 2
    },
    executionEvidenceHash: hashContract("c"),
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    },
    ...overrides
  };
}

function grantedReceipt(
  input: InternalIssueRankExecutionGrantInputV1,
  issuedAt: Date = decidedAt
): RankExecutionGrantReceipt {
  const requestHash = contractHashBytes(
    rankExecutionGrantRequestHashDomain,
    rankExecutionGrantRequestHashPreimage(input)
  );
  const scopeHash = contractHashBytes(
    rankExecutionGrantScopeHashDomain,
    rankExecutionGrantScopeHashPreimage(input)
  );
  const expiresAt = new Date(issuedAt.getTime() + 30_000);
  const decision: InternalRankExecutionGrantDecisionV1 = {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: bytesHashContract(requestHash),
    decidedAt: issuedAt.toISOString(),
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: grantId,
      requestHash: bytesHashContract(requestHash),
      scopeHash: bytesHashContract(scopeHash),
      issuer: "PLATFORM_API",
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    }
  };
  return {
    id: grantId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    membershipId: input.membership.id,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    executionAttempt: input.executionAttempt,
    projectVersion: input.project.version,
    membershipVersion: input.membership.version,
    policyVersion: input.policyVersion,
    idempotencyScope: `rank-execution-grant:${input.projectId}`,
    idempotencyKey,
    requestHash,
    scopeHash,
    requestSnapshot: input,
    responseSnapshot: decision,
    decision: "GRANTED",
    denialReason: null,
    decidedAt: issuedAt,
    expiresAt,
    quotaReservationId,
    correlationId,
    createdAt: issuedAt
  } as unknown as RankExecutionGrantReceipt;
}

function contractHashBytes(domain: string, value: unknown): Buffer {
  return Buffer.from(canonicalJsonSha256(domain, value), "hex");
}

function bytesHashContract(value: Uint8Array): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: Buffer.from(value).toString("hex")
  };
}

function hashContract(character: string): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: character.repeat(64)
  };
}

function requiredCreatedData(
  fixture: ServiceFixture
): Readonly<Record<string, unknown>> {
  const created = fixture.creates[0];
  assert.ok(created);
  assert.equal(fixture.creates.length, 1);
  return created;
}

function sqlText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join("?");
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "strings" in value &&
    Array.isArray(value.strings)
  ) {
    return value.strings.map(String).join("?");
  }
  return String(value);
}

function isServiceUnavailable(error: unknown): boolean {
  return (
    error instanceof ServiceUnavailableException &&
    error.getStatus() === 503
  );
}
