import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticSavedViewController } from "./semantic-saved-view.controller.js";
import { SemanticSavedViewService } from "./semantic-saved-view.service.js";

@Module({
  imports: [InternalModule],
  controllers: [SemanticSavedViewController],
  providers: [SemanticSavedViewService]
})
export class SemanticSavedViewModule {}
