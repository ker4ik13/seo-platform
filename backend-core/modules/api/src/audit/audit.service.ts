import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

export interface AuditRecord {
  readonly actorId?: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly redactedChanges?: Prisma.InputJsonValue;
  readonly requestId: string;
}
@Injectable()
export class AuditService {
  public constructor(private readonly prisma: PrismaService) {}

  public async record(
    input: AuditRecord,
    transaction?: Prisma.TransactionClient
  ): Promise<void> {
    const client = transaction ?? this.prisma;
    await client.auditEvent.create({
      data: {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        actorType: input.actorId ? "USER" : "ANONYMOUS",
        ...(input.actorId ? { actorId: input.actorId } : {}),
        action: input.action,
        resourceType: input.resourceType,
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        outcome: input.outcome ?? "SUCCESS",
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.redactedChanges
          ? { redactedChanges: input.redactedChanges }
          : {}),
        requestId: input.requestId
      }
    });
  }
}
