import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { KeywordController } from "./keyword.controller.js";

@Module({
  imports: [AuthorizationModule, SeoDataModule],
  controllers: [KeywordController]
})
export class SemanticModule {}
