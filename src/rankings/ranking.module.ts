import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TrackingContextController } from "./tracking-context.controller.js";

@Module({
  imports: [AuthorizationModule, IdentityModule, SeoDataModule],
  controllers: [TrackingContextController]
})
export class RankingModule {}
