import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { KeywordController } from "./keyword.controller.js";
import { KeywordGroupController } from "./keyword-group.controller.js";
import { SemanticBulkController } from "./semantic-bulk.controller.js";
import { SemanticSavedViewController } from "./semantic-saved-view.controller.js";
import { SemanticCustomColumnController } from "./semantic-custom-column.controller.js";
import { SemanticExportController } from "./semantic-export.controller.js";
import { SemanticVersionController } from "./semantic-version.controller.js";
import { SemanticClusterController } from "./semantic-cluster.controller.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { FrequencyCollectionController } from "./frequency-collection.controller.js";
import { NegativeKeywordController } from "./negative-keyword.controller.js";
import { SemanticDuplicateController } from "./semantic-duplicate.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    BillingModule,
    IdentityModule,
    SeoDataModule,
    JobsModule
  ],
  controllers: [
    KeywordController,
    KeywordGroupController,
    SemanticClusterController,
    SemanticBulkController,
    SemanticCustomColumnController,
    SemanticSavedViewController,
    SemanticExportController,
    SemanticVersionController,
    FrequencyCollectionController,
    NegativeKeywordController,
    SemanticDuplicateController
  ]
})
export class SemanticModule {}
