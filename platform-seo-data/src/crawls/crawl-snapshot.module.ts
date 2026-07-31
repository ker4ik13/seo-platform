import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import {
  CrawlDuplicateGroupController,
  CrawlIssueController,
  CrawlPageChangeController,
  CrawlSnapshotController
} from "./crawl-snapshot.controller.js";
import { CrawlSnapshotService } from "./crawl-snapshot.service.js";

@Module({
  imports: [InternalModule],
  controllers: [
    CrawlSnapshotController,
    CrawlDuplicateGroupController,
    CrawlIssueController,
    CrawlPageChangeController
  ],
  providers: [CrawlSnapshotService]
})
export class CrawlSnapshotModule {}
