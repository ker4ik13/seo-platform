import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { TrackingContextController } from "./tracking-context.controller.js";
import { TrackingContextService } from "./tracking-context.service.js";

@Module({
  imports: [InternalModule],
  controllers: [TrackingContextController],
  providers: [TrackingContextService]
})
export class TrackingContextModule {}
