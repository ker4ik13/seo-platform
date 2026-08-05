import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const CONFIRMATION = "CREATE_FIRST_SUPER_ADMIN";

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const email = required("ADMIN_BOOTSTRAP_EMAIL").trim().toLowerCase();
  const reason = required("ADMIN_BOOTSTRAP_REASON").trim();
  if (required("ADMIN_BOOTSTRAP_CONFIRM") !== CONFIRMATION) {
    throw new Error(
      `ADMIN_BOOTSTRAP_CONFIRM must equal ${CONFIRMATION}`
    );
  }
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("ADMIN_BOOTSTRAP_REASON must contain 8-500 characters");
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000
    })
  });
  try {
    const assignment = await client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended('platform-staff-role-admin', 0)
        )::text AS lock_result
      `;
      if (
        (await transaction.platformStaffRoleAssignment.count({
          where: { revokedAt: null }
        })) !== 0
      ) {
        throw new Error(
          "Bootstrap refused: active platform staff assignments already exist"
        );
      }
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
      return created;
    });
    process.stdout.write(
      `First SUPER_ADMIN assignment created: ${assignment.id}\n`
    );
  } finally {
    await client.$disconnect();
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Bootstrap failed"}\n`
  );
  process.exitCode = 1;
});
