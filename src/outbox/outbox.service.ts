import { Injectable } from "@nestjs/common";
import type {
  Prisma,
  User
} from "../generated/prisma/client.js";

@Injectable()
export class OutboxService {
  public async event(
    transaction: Prisma.TransactionClient,
    input: {
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly aggregateVersion: number;
      readonly workspaceId?: string;
      readonly projectId?: string;
      readonly payload: Prisma.InputJsonValue;
      readonly requestId: string;
    }
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        aggregateVer: input.aggregateVersion,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        payload: input.payload,
        metadata: {
          requestId: input.requestId,
          producer: "platform-api"
        }
      }
    });
  }

  public async userEvent(
    transaction: Prisma.TransactionClient,
    input: {
      readonly eventType: string;
      readonly user: User;
      readonly payload: Prisma.InputJsonValue;
      readonly requestId: string;
    }
  ): Promise<void> {
    await this.event(transaction, {
      eventType: input.eventType,
      aggregateType: "user",
      aggregateId: input.user.id,
      aggregateVersion: input.user.version,
      payload: input.payload,
      requestId: input.requestId
    });
  }
}
