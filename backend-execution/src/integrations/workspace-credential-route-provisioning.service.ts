import { Injectable } from "@nestjs/common";
import {
  connectorFallbackReasons,
  type IntegrationCapability
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

interface AppendWorkspaceCredentialRoutesInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly credentialId: string;
  readonly capabilities: readonly IntegrationCapability[];
}

/**
 * Adds a newly created credential to the end of every compatible workspace
 * route without changing the existing primary source or route order.
 */
@Injectable()
export class WorkspaceCredentialRouteProvisioningService {
  public constructor(private readonly prisma: PrismaService) {}

  public append(input: AppendWorkspaceCredentialRoutesInput): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      await this.appendInTransaction(transaction, input);
    });
  }

  public async appendInTransaction(
    transaction: Prisma.TransactionClient,
    input: AppendWorkspaceCredentialRoutesInput
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(hashtextextended(${`workspace-credential-routes:${input.workspaceId}`}, 0))`
    );
    for (const capability of [...new Set(input.capabilities)].sort()) {
      let binding = await transaction.workspaceConnectorBinding.findUnique({
        where: {
          workspaceId_capability: {
            workspaceId: input.workspaceId,
            capability
          }
        }
      });
      if (!binding) {
        binding = await transaction.workspaceConnectorBinding.create({
          data: {
            workspaceId: input.workspaceId,
            capability,
            enabled: true,
            fallbackMode: "NONE",
            fallbackReasons: [],
            createdBy: input.actorId,
            updatedBy: input.actorId
          }
        });
      }
      const existing = await transaction.workspaceConnectorRoute.findFirst({
        where: {
          workspaceId: input.workspaceId,
          bindingId: binding.id,
          credentialId: input.credentialId
        },
        select: { id: true }
      });
      if (existing) continue;
      const tail = await transaction.workspaceConnectorRoute.aggregate({
        where: {
          workspaceId: input.workspaceId,
          bindingId: binding.id
        },
        _max: { position: true }
      });
      const position = (tail._max.position ?? -1) + 1;
      await transaction.workspaceConnectorRoute.create({
        data: {
          workspaceId: input.workspaceId,
          bindingId: binding.id,
          credentialId: input.credentialId,
          position
        }
      });
      if (position > 0 && binding.fallbackMode === "NONE") {
        await transaction.workspaceConnectorBinding.update({
          where: { id: binding.id },
          data: {
            fallbackMode: "NEXT_AVAILABLE",
            fallbackReasons: [...connectorFallbackReasons],
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
    }
  }
}
