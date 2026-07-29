import { Module } from "@nestjs/common";
import { SeoDataClient } from "./seo-data.client.js";

@Module({
  providers: [SeoDataClient],
  exports: [SeoDataClient]
})
export class SeoDataModule {}
