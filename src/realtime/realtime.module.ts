import { Module } from "@nestjs/common";
import { RealtimeClient } from "./realtime.client.js";

@Module({
  providers: [RealtimeClient],
  exports: [RealtimeClient]
})
export class RealtimeClientModule {}
