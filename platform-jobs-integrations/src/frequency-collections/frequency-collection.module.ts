import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { FrequencyCollectionController } from "./frequency-collection.controller.js";
import { FrequencyCollectionService } from "./frequency-collection.service.js";

@Module({
  imports: [InternalModule],
  controllers: [FrequencyCollectionController],
  providers: [FrequencyCollectionService],
  exports: [FrequencyCollectionService]
})
export class FrequencyCollectionModule {}
