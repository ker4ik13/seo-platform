import { Module } from "@nestjs/common";
import { RankManifestClient } from "./rank-manifest.client.js";
import { SeoDataClient } from "./seo-data.client.js";

@Module({
  providers: [SeoDataClient, RankManifestClient],
  exports: [SeoDataClient, RankManifestClient]
})
export class SeoDataModule {}
