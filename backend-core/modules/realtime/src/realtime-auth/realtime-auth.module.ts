import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RealtimeTicketController } from "./realtime-ticket.controller.js";
import { RealtimeTicketService } from "./realtime-ticket.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RealtimeTicketController],
  providers: [RealtimeTicketService],
  exports: [RealtimeTicketService]
})
export class RealtimeAuthModule {}
