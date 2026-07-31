import { Module } from "@nestjs/common";
import { RankManifestClient } from "./rank-manifest.client.js";
import { RankResultClient } from "./rank-result.client.js";
import { SeoDataClient } from "./seo-data.client.js";

@Module({
  providers: [SeoDataClient, RankManifestClient, RankResultClient],
  exports: [SeoDataClient, RankManifestClient, RankResultClient]
})
export class SeoDataModule {}
