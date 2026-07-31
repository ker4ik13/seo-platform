import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import {
  CrawlIssueController,
  CrawlSnapshotController
} from "./crawl-snapshot.controller.js";
import { CrawlSnapshotService } from "./crawl-snapshot.service.js";

@Module({
  imports: [InternalModule],
  controllers: [CrawlSnapshotController, CrawlIssueController],
  providers: [CrawlSnapshotService]
})
export class CrawlSnapshotModule {}
