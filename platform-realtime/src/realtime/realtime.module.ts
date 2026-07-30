import { Module } from "@nestjs/common";
import { RealtimeAuthModule } from "../realtime-auth/realtime-auth.module.js";
import { CollaborationGateway } from "./collaboration.gateway.js";

@Module({
  imports: [RealtimeAuthModule],
  providers: [CollaborationGateway]
})
export class RealtimeModule {}
