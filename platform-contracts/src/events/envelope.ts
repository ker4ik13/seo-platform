import type {
  EventId,
  ProjectId,
  WorkspaceId
} from "../identifiers.js";

export interface AggregateReference {
  readonly type: string;
  readonly id: string;
  readonly version: number;
}

export interface EventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface DomainEventEnvelope<Data = Readonly<Record<string, unknown>>> {
  readonly eventId: EventId;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly producer: string;
  readonly traceId: string;
  readonly workspaceId?: WorkspaceId;
  readonly projectId?: ProjectId;
  readonly aggregate: AggregateReference;
  readonly data: Data;
  readonly metadata: EventMetadata;
}
