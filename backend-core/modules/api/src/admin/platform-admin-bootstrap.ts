import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const CONFIRMATION = "CREATE_FIRST_SUPER_ADMIN";

interface PlatformAdminBootstrapInput {
  readonly databaseUrl: string;
  readonly email: string;
  readonly reason: string;
}

export function platformAdminBootstrapInput(
  env: NodeJS.ProcessEnv
): PlatformAdminBootstrapInput {
  const databaseUrl =
    optional(env, "DATABASE_URL") ??
    required(env, "PLATFORM_DATABASE_URL");
  const email = required(env, "ADMIN_BOOTSTRAP_EMAIL")
    .trim()
    .toLowerCase();
  const reason = required(env, "ADMIN_BOOTSTRAP_REASON").trim();
  if (required(env, "ADMIN_BOOTSTRAP_CONFIRM") !== CONFIRMATION) {
    throw new Error(
      `ADMIN_BOOTSTRAP_CONFIRM must equal ${CONFIRMATION}`
    );
  }
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("ADMIN_BOOTSTRAP_REASON must contain 8-500 characters");
  }
  return { databaseUrl, email, reason };
}

export async function runPlatformAdminBootstrap(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const { databaseUrl, email, reason } = platformAdminBootstrapInput(env);

  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000
    })
  });
  try {
    const result = await client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended('platform-staff-role-admin', 0)
        )::text AS lock_result
      `;
      const user = await transaction.user.findUnique({
        where: { emailNormalized: email },
        select: {
          id: true,
          status: true,
          emailVerifiedAt: true,
          mfaMethods: {
            where: {
              status: "ACTIVE",
              disabledAt: null,
              confirmedAt: { not: null }
            },
            take: 1
          }
        }
      });
      if (
        !user ||
        user.status !== "ACTIVE" ||
        !user.emailVerifiedAt ||
        user.mfaMethods.length === 0
      ) {
        throw new Error(
          "Bootstrap user must be active, email-verified and have active MFA"
        );
      }

      const existing =
        await transaction.platformStaffRoleAssignment.findFirst({
          where: {
            userId: user.id,
            roleCode: "SUPER_ADMIN",
            revokedAt: null
          },
          orderBy: { assignedAt: "asc" }
        });
      if (existing) {
        return { assignment: existing, created: false } as const;
      }
      if (
        (await transaction.platformStaffRoleAssignment.count({
          where: { revokedAt: null }
        })) !== 0
      ) {
        throw new Error(
          "Bootstrap refused: active platform staff assignments already exist"
        );
      }
      const created =
        await transaction.platformStaffRoleAssignment.create({
          data: {
            userId: user.id,
            roleCode: "SUPER_ADMIN",
            reason
          }
        });
      await transaction.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          action: "platform_admin.staff_role.bootstrapped",
          resourceType: "platform_staff_role_assignment",
          resourceId: created.id,
          outcome: "SUCCESS",
          reason,
          requestId: `admin-bootstrap-${created.id}`
        }
      });
      return { assignment: created, created: true } as const;
    });
    process.stdout.write(
      result.created
        ? `First SUPER_ADMIN assignment created: ${result.assignment.id}\n`
        : `SUPER_ADMIN assignment already active: ${result.assignment.id}\n`
    );
  } finally {
    await client.$disconnect();
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = optional(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint && pathToFileURL(entrypoint).href === import.meta.url
  );
}

if (isDirectExecution()) {
  runPlatformAdminBootstrap().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Bootstrap failed"}\n`
    );
    process.exitCode = 1;
  });
}
