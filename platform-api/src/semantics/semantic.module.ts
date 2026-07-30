import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { KeywordController } from "./keyword.controller.js";
import { KeywordGroupController } from "./keyword-group.controller.js";
import { SemanticBulkController } from "./semantic-bulk.controller.js";
import { SemanticSavedViewController } from "./semantic-saved-view.controller.js";
import { SemanticCustomColumnController } from "./semantic-custom-column.controller.js";
import { SemanticExportController } from "./semantic-export.controller.js";
import { SemanticExportService } from "./semantic-export.service.js";

@Module({
  imports: [AuthorizationModule, IdentityModule, SeoDataModule],
  controllers: [
    KeywordController,
    KeywordGroupController,
    SemanticBulkController,
    SemanticCustomColumnController,
    SemanticSavedViewController,
    SemanticExportController
  ],
  providers: [SemanticExportService]
})
export class SemanticModule {}
