import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { PageStatusService } from "./page-status.service.js";
import { PageStatusController } from "./page-status.controller.js";
@Module({ imports: [InternalModule], controllers: [PageStatusController], providers: [PageStatusService], exports: [PageStatusService] })
export class PageStatusModule {}
