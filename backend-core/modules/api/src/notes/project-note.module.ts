import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import {
  ProjectNoteController,
  PublicProjectNoteController
} from "./project-note.controller.js";

@Module({
  imports: [AuthorizationModule, IdentityModule, SeoDataModule],
  controllers: [ProjectNoteController, PublicProjectNoteController]
})
export class ProjectNoteModule {}
