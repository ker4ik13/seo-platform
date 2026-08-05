import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RealtimeClient } from "./realtime.client.js";
import { RealtimeTicketController } from "./realtime-ticket.controller.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [RealtimeTicketController],
  providers: [RealtimeClient],
  exports: [RealtimeClient]
})
export class RealtimeClientModule {}
