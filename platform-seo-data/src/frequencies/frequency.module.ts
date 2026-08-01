import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { FrequencyController } from "./frequency.controller.js";
import { FrequencyService } from "./frequency.service.js";

@Module({
  imports: [InternalModule],
  controllers: [FrequencyController],
  providers: [FrequencyService],
  exports: [FrequencyService]
})
export class FrequencyModule {}
