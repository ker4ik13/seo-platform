import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RealtimeClient } from "./realtime.client.js";
import { ProjectPresenceController } from "./project-presence.controller.js";
import { ProjectPresenceService } from "./project-presence.service.js";
import { RealtimeTicketController } from "./realtime-ticket.controller.js";

@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [ProjectPresenceController, RealtimeTicketController],
  providers: [ProjectPresenceService, RealtimeClient],
  exports: [RealtimeClient]
})
export class RealtimeClientModule {}
