import type {
  TrackingContextStatus,
  TrackingDevice,
  TrackingSearchEngine
} from "../api/tracking-contexts.js";

export const trackingContextChangedFields = [
  "name",
  "configuration",
  "launchProfile",
  "status"
] as const;

export type TrackingContextChangedField =
  (typeof trackingContextChangedFields)[number];

export interface TrackingContextEventDataV1 {
  readonly contextId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status: TrackingContextStatus;
  readonly entityVersion: number;
  readonly configurationVersion: number;
  readonly searchEngine: TrackingSearchEngine;
  readonly device: TrackingDevice;
  readonly changedBy: string;
  readonly changedFields: readonly TrackingContextChangedField[];
}

export interface TrackingContextKeywordAssignmentEventDataV1 {
  readonly contextId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly keywordId: string;
  readonly operation: "ASSIGNED" | "REMOVED";
  readonly changedBy: string;
}

export interface TrackingContextKeywordAssignmentsReplacedEventDataV1 {
  readonly contextId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityVersion: number;
  readonly assignedKeywordCount: number;
  readonly addedKeywordCount: number;
  readonly removedKeywordCount: number;
  readonly unchangedKeywordCount: number;
  readonly keywordSetHash: string;
  readonly changedBy: string;
}
