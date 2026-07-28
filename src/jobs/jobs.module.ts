import { Module } from "@nestjs/common";
import { JobsClient } from "./jobs.client.js";

@Module({
  providers: [JobsClient],
  exports: [JobsClient]
})
export class JobsModule {}
