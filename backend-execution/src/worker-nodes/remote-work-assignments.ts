import type { WorkerCapability } from "@seo-platform/contracts";

export interface RemoteWorkAssignment {
  readonly nodeId:string;
  readonly jobId:string;
  readonly operationId:string;
  readonly capability:WorkerCapability;
  readonly searchEngine:string|null;
  readonly activeTasks:bigint;
}
