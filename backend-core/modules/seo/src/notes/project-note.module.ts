import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import {
  ProjectNoteController,
  PublicProjectNoteController
} from "./project-note.controller.js";
import { ProjectNoteService } from "./project-note.service.js";

@Module({
  imports: [InternalModule],
  controllers: [ProjectNoteController, PublicProjectNoteController],
  providers: [ProjectNoteService]
})
export class ProjectNoteModule {}
