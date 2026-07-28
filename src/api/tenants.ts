export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly country?: string;
  readonly locale: string;
  readonly timezone: string;
  readonly billingCurrency: string;
  readonly status: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly roleCode: string;
  readonly version: number;
  readonly createdAt: string;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly slug?: string;
  readonly country?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly billingCurrency: string;
}

export interface UpdateWorkspaceInput {
  readonly name?: string;
  readonly country?: string | null;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
  readonly locale: string;
  readonly timezone: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly version: number;
  readonly createdAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly slug?: string;
  readonly domain: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly confirmDuplicateDomain?: boolean;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly domain?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly confirmDuplicateDomain?: boolean;
}
