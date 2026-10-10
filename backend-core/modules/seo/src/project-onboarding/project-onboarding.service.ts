import { ConflictException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  parseInternalInitializeProjectOnboardingInput,
  parseProjectOnboardingInitialization,
  projectOnboardingViewConfig,
  type InternalInitializeProjectOnboardingInput,
  type ProjectOnboardingInitialization,
  type TrackingContextConfigurationInput,
  type TrackingContextLaunchProfile,
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  configurationCreateData,
  hashConfiguration,
} from "../tracking-contexts/tracking-context.service.js";

@Injectable()
export class ProjectOnboardingService {
  public constructor(private readonly prisma: PrismaService) {}
  public async initialize(
    value: InternalInitializeProjectOnboardingInput,
  ): Promise<ProjectOnboardingInitialization> {
    const input = parseInternalInitializeProjectOnboardingInput(value);
    const hash = createHash("sha256")
      .update(JSON.stringify(input.settings))
      .digest();
    return this.prisma.$transaction(
      async (database) => {
        await database.$executeRaw`SET LOCAL statement_timeout = '3s'`;
        await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"project-onboarding:" + input.projectId},0))`;
        const receipt =
          await database.projectOnboardingInitialization.findUnique({
            where: {
              workspaceId_projectId: {
                workspaceId: input.workspaceId,
                projectId: input.projectId,
              },
            },
          });
        if (receipt) {
          if (
            receipt.actorId !== input.actorId ||
            !Buffer.from(receipt.settingsHash).equals(hash)
          )
            throw new ConflictException(
              "Project onboarding initialization conflict",
            );
          return parseProjectOnboardingInitialization(
            receipt.responseSnapshot,
            input.projectId,
          );
        }
        const scope = {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
        };
        const clock = await database.$queryRaw<
          { at: Date }[]
        >`SELECT CURRENT_TIMESTAMP AS at`;
        const createdAt = clock[0]!.at;
        const profiles = input.settings.engines
          .filter((engine) => engine.positions)
          .flatMap((engine) =>
            engine.targets.map((target) => {
              const id = randomUUID();
              const configuration: TrackingContextConfigurationInput = {
                searchEngine: engine.searchEngine,
                countryCode: "RU",
                language: "ru",
                ...target,
                depth: engine.depth,
                domainMatchRule: { mode: "INCLUDE_WWW" },
                safeSearch: false,
              };
              const launchProfile: TrackingContextLaunchProfile = {
                searchSource: "LIVE",
                includeUntracked: false,
                scope: { mode: "ALL", groupIds: [] },
              };
              return {
                context: {
                  createdAt,
                  updatedAt: createdAt,
                  id,
                  workspaceId: input.workspaceId,
                  projectId: input.projectId,
                  name: (
                    (engine.searchEngine === "YANDEX" ? "Яндекс" : "Google") +
                    " · " +
                    target.regionLabel +
                    " · " +
                    (target.device === "DESKTOP" ? "ПК" : "Телефон") +
                    " · Топ-" +
                    engine.depth
                  ).slice(0, 160),
                  createdBy: input.actorId,
                  updatedBy: input.actorId,
                  isReusable: true,
                  launchProfile:
                    launchProfile as unknown as Prisma.InputJsonObject,
                },
                configuration: {
                  ...configurationCreateData(
                    scope,
                    configuration,
                    hashConfiguration(configuration),
                    1,
                  ),
                  contextId: id,
                  createdAt,
                },
              };
            }),
          );
        if (profiles.length) {
          await database.trackingContext.createMany({
            data: profiles.map((profile) => profile.context),
          });
          await database.trackingContextVersion.createMany({
            data: profiles.map((profile) => profile.configuration),
          });
        }
        const view = await database.semanticSavedView.create({
          data: {
            createdAt,
            updatedAt: createdAt,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            ownerId: input.actorId,
            name: "Основное",
            normalizedName: "основное",
            scope: input.canManageShared ? "PROJECT_SHARED" : "PRIVATE",
            config: projectOnboardingViewConfig(
              input.settings,
            ) as unknown as Prisma.InputJsonObject,
          },
        });
        const result: ProjectOnboardingInitialization = {
          projectId: input.projectId,
          initialized: true,
          trackingContextCount: profiles.length,
          viewId: view.id,
        };
        await database.projectOnboardingInitialization.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            settingsHash: hash,
            responseSnapshot: result as unknown as Prisma.InputJsonObject,
          },
        });
        return result;
      },
      { timeout: 10_000, maxWait: 2000 },
    );
  }
}
