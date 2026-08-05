import "reflect-metadata";
import {
  createPlatformApiApplication
} from "@seo-platform/backend-core-api/core-composition";
import {
  createSeoDataApplication
} from "@seo-platform/backend-core-seo/core-composition";
import type { FastifyInstance } from "fastify";
import { coreApiModule } from "./core-api.module.js";
import {
  coreProcessProfile,
  withCoreProcessProfile
} from "./scoped-environment.js";
import { seoDataLocalTransport } from "./seo-data-local-transport.js";

async function startCore(): Promise<void> {
  const seoProfile = coreProcessProfile(process.env, "SEO", 4001);
  const platformProfile = coreProcessProfile(
    process.env,
    "PLATFORM",
    4000
  );
  let seoApp:
    | Awaited<ReturnType<typeof createSeoDataApplication>>
    | undefined;
  let platformApp:
    | Awaited<ReturnType<typeof createPlatformApiApplication>>
    | undefined;
  try {
    const createdSeoApp = await withCoreProcessProfile(
      seoProfile,
      createSeoDataApplication
    );
    seoApp = createdSeoApp;
    await createdSeoApp.listen(
      Number(seoProfile.port),
      process.env.BIND_ADDRESS === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"
    );
    const seoServer = createdSeoApp
      .getHttpAdapter()
      .getInstance() as FastifyInstance;
    const createdPlatformApp = await withCoreProcessProfile(
      platformProfile,
      () =>
        createPlatformApiApplication(
          coreApiModule(seoDataLocalTransport(seoServer))
        )
    );
    platformApp = createdPlatformApp;
    await createdPlatformApp.listen(
      Number(platformProfile.port),
      process.env.BIND_ADDRESS === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1"
    );
  } catch (error) {
    await platformApp?.close().catch(() => undefined);
    await seoApp?.close().catch(() => undefined);
    throw error;
  }
}

await startCore();
