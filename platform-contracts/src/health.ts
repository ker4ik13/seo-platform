export const serviceNames = [
  "platform-api",
  "seo-data",
  "jobs-integrations",
  "realtime"
] as const;

export type ServiceName = (typeof serviceNames)[number];
export type HealthStatus = "ok" | "degraded" | "unavailable";

export interface DependencyHealth {
  readonly name: string;
  readonly status: HealthStatus;
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface HealthResponse {
  readonly service: ServiceName;
  readonly version: string;
  readonly status: HealthStatus;
  readonly timestamp: string;
  readonly dependencies?: readonly DependencyHealth[];
}

export interface SystemCapability {
  readonly code: string;
  readonly status: "available" | "planned" | "disabled";
}

export interface SystemDescriptor {
  readonly service: ServiceName;
  readonly version: string;
  readonly capabilities: readonly SystemCapability[];
}
