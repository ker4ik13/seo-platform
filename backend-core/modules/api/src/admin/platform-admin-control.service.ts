import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AdminStateCommand, AdminStateResult } from "@seo-platform/contracts";
import { domainEventTypes } from "@seo-platform/contracts";
import { OutboxService } from "../outbox/outbox.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../identity/session.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import type { RequestContext } from "../identity/identity.types.js";

@Injectable()
export class PlatformAdminControlService {
  public constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly sessions: SessionService, private readonly outbox: OutboxService, private readonly entitlements: BillingEntitlementService) {}

  public async changeState(kind: "WORKSPACE" | "USER", id: string, input: AdminStateCommand, expectedVersion: number, actorId: string, idempotencyKey: string, context: RequestContext): Promise<AdminStateResult> {
    if (input.confirmId !== id || input.status === "READ_ONLY") throw new BadRequestException("Invalid state command scope");
    if (kind === "USER" && actorId === id) throw new ForbiddenException("Нельзя заблокировать собственный аккаунт");
    const action = `platform_admin.${kind.toLowerCase()}.state_changed`;
    const requestHash = Buffer.from(canonicalJsonSha256("admin-state-change@1", { kind, id, input, expectedVersion }), "hex");
    return this.prisma.$transaction(async (tx) => {
      // The receipt and mutation share one serialized owner transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${action}:${id}`}, 0))`;
      const receipt = await tx.platformAdminCommandReceipt.findUnique({ where: { actorId_action_idempotencyKey: { actorId, action, idempotencyKey } } });
      if (receipt) {
        if (!Buffer.from(receipt.requestHash).equals(requestHash)) throw new ConflictException("Idempotency-Key уже использован для другой команды");
        return receipt.responseSnapshot as unknown as AdminStateResult;
      }
      let result: AdminStateResult;
      let previousStatus: string;
      if (kind === "WORKSPACE") {
        const workspace = await tx.workspace.findUnique({ where: { id }, select: { status: true, version: true } });
        if (!workspace || ["DELETING", "DELETED"].includes(workspace.status)) throw new NotFoundException();
        if (workspace.version !== expectedVersion) throw new ConflictException("Рабочая область изменилась. Обновите данные.");
        previousStatus = workspace.status;
        const nextStatus = input.status === "ACTIVE" && !await this.entitlements.snapshotInTransaction(tx, id) ? "READ_ONLY" : input.status;
        const updated = await tx.workspace.update({ where: { id, version: expectedVersion }, data: { status: nextStatus, version: { increment: 1 } }, select: { id: true, status: true, version: true } });
        result = { ...updated, status: updated.status as AdminStateResult["status"] };
      } else {
        const user = await tx.user.findUnique({ where: { id }, select: { version: true, status: true, emailVerifiedAt: true, platformRoles: { where: { revokedAt: null }, select: { id: true }, take: 1 } } });
        if (!user || user.status === "DELETED") throw new NotFoundException();
        if (user.platformRoles.length > 0) throw new ForbiddenException("Сначала отзовите роли платформы у этого аккаунта");
        if (user.version !== expectedVersion) throw new ConflictException("Аккаунт изменился. Обновите данные.");
        previousStatus = user.status;
        const status = input.status === "SUSPENDED" ? "SUSPENDED" : user.emailVerifiedAt ? "ACTIVE" : "PENDING_VERIFICATION";
        const updated = await tx.user.update({ where: { id, version: expectedVersion }, data: { status, version: { increment: 1 } }, select: { id: true, status: true, version: true } });
        if (status === "SUSPENDED") await this.sessions.revokeFamilies(tx, { userId: id, requestId: context.requestId });
        result = { ...updated, status: updated.status as AdminStateResult["status"] };
      }
      await this.audit.record({ actorId, action, resourceType: kind.toLowerCase(), resourceId: id, ...(kind === "WORKSPACE" ? { workspaceId: id } : {}), reason: input.reason, redactedChanges: { status: { from: previousStatus, to: result.status } }, requestId: context.requestId }, tx);
      if (kind === "WORKSPACE") await this.outbox.event(tx, { eventType: domainEventTypes.workspaceUpdated, aggregateType: "workspace", aggregateId: id, aggregateVersion: result.version, workspaceId: id, payload: { workspaceId: id }, requestId: context.requestId });
      await tx.platformAdminCommandReceipt.create({ data: { actorId, action, idempotencyKey, requestHash, resourceType: kind.toLowerCase(), resourceId: id, ...(kind === "WORKSPACE" ? { workspaceId: id } : {}), responseSnapshot: result as unknown as Prisma.InputJsonValue } });
      return result;
    });
  }
}
