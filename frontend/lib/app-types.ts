import type { ProjectAccessLevel } from "@seo-platform/contracts";

export interface AppUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
}

export interface AppWorkspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly locale: string;
  readonly timezone: string;
  readonly status: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly roleCode: string;
  readonly owner: Readonly<{
    userId: string;
    email: string;
    displayName: string;
  }>;
  readonly avatarUpdatedAt?: string;
  readonly version: number;
}

export interface AppProject {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
  readonly locale: string;
  readonly timezone: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly ownerUserId: string;
  readonly projectAccessLevel?: ProjectAccessLevel;
  readonly version: number;
}

export interface ProtectedAppContext {
  readonly user: AppUser;
  readonly workspaces: readonly AppWorkspace[];
  readonly workspace?: AppWorkspace;
  readonly projects: readonly AppProject[];
  readonly project?: AppProject;
}
