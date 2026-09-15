import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { PrivateExceptionFilter } from "./internal/private-exception.filter.js";
import { installClusteringProposalBodyLimit } from "./clustering-proposals/clustering-proposal-body-limit.js";
import { installPrivateHttpResponsePolicy } from "./internal/http-response-policy.js";
import { installKeywordBulkBodyLimit } from "./keywords/keyword-bulk-body-limit.js";
import { installRankResultBodyLimit } from "./rank-results/rank-result-body-limit.js";
import { installSemanticImportBodyLimit } from "./semantic-imports/semantic-import-body-limit.js";

export async function createSeoDataApplication(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    requestIdHeader: "x-request-id"
  });
  installKeywordBulkBodyLimit(adapter.getInstance());
  installRankResultBodyLimit(adapter.getInstance());
  installClusteringProposalBodyLimit(adapter.getInstance());
  installSemanticImportBodyLimit(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter
  );

  installPrivateHttpResponsePolicy(adapter.getInstance());
  app.useGlobalFilters(new PrivateExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
