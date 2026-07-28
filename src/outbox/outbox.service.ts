import { Injectable } from "@nestjs/common";
import type {
  Prisma,
  User
} from "../generated/prisma/client.js";

@Injectable()
export class OutboxService {
  public async userEvent(
    transaction: Prisma.TransactionClient,
    input: {
      readonly eventType: string;
      readonly user: User;
      readonly payload: Prisma.InputJsonValue;
      readonly requestId: string;
    }
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: "user",
        aggregateId: input.user.id,
        aggregateVer: input.user.version,
        payload: input.payload,
        metadata: {
          requestId: input.requestId,
          producer: "platform-api"
        }
      }
    });
  }
}
