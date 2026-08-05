import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { PageController } from "./page.controller.js";
import { PageService } from "./page.service.js";

@Module({
  imports: [InternalModule],
  controllers: [PageController],
  providers: [PageService]
})
export class PageModule {}
