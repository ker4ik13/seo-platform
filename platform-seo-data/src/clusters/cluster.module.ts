import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import { ClusterController } from "./cluster.controller.js";
import { ClusterService } from "./cluster.service.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [ClusterController],
  providers: [ClusterService]
})
export class ClusterModule {}
