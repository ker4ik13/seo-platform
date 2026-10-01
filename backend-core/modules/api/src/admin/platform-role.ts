import { SetMetadata } from "@nestjs/common";
import type { PlatformRoleCode } from "../generated/prisma/client.js";

export const PLATFORM_ROLES_METADATA = "platform.roles";
export const PLATFORM_RECENT_AUTH_METADATA = "platform.recent_auth";
export const RequireRecentPlatformAuthentication = (): MethodDecorator & ClassDecorator => SetMetadata(PLATFORM_RECENT_AUTH_METADATA, true);

export const RequirePlatformRole = (
  ...roles: readonly PlatformRoleCode[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(PLATFORM_ROLES_METADATA, roles);
