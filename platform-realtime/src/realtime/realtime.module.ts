import { Module } from "@nestjs/common";
import { CollaborationGateway } from "./collaboration.gateway.js";

@Module({
  providers: [CollaborationGateway]
})
export class RealtimeModule {}
