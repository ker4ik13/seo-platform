import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import {
  ClusteringProposalCommandController,
  ClusteringProposalReadController
} from "./clustering-proposal.controller.js";
import { ClusteringProposalService } from "./clustering-proposal.service.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [
    ClusteringProposalCommandController,
    ClusteringProposalReadController
  ],
  providers: [ClusteringProposalService]
})
export class ClusteringProposalModule {}
