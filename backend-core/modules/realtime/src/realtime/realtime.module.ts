import { Module } from "@nestjs/common";
import { RealtimeAuthModule } from "../realtime-auth/realtime-auth.module.js";
import { CollaborationGateway } from "./collaboration.gateway.js";
import { PresenceStoreService } from "./presence-store.service.js";

@Module({
  imports: [RealtimeAuthModule],
  providers: [CollaborationGateway, PresenceStoreService]
})
export class RealtimeModule {}
