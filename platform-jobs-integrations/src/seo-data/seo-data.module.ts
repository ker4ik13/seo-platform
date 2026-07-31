import { Module } from "@nestjs/common";
import { RankManifestClient } from "./rank-manifest.client.js";
import { RankResultClient } from "./rank-result.client.js";
import { SeoDataClient } from "./seo-data.client.js";
import { CrawlSnapshotClient } from "./crawl-snapshot.client.js";

@Module({
  providers: [
    SeoDataClient,
    RankManifestClient,
    RankResultClient,
    CrawlSnapshotClient
  ],
  exports: [
    SeoDataClient,
    RankManifestClient,
    RankResultClient,
    CrawlSnapshotClient
  ]
})
export class SeoDataModule {}
