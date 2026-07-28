declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type UserId = Brand<string, "UserId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ProjectId = Brand<string, "ProjectId">;
export type JobId = Brand<string, "JobId">;
export type EventId = Brand<string, "EventId">;
export type RequestId = Brand<string, "RequestId">;

export interface TenantContext {
  readonly workspaceId: WorkspaceId;
  readonly projectId?: ProjectId;
  readonly actorUserId?: UserId;
}
