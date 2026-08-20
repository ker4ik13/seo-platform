import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectPresenceParticipant } from "@seo-platform/contracts";
import {
  aggregateProjectParticipants,
  projectPresenceAvatarUrl,
  projectPresenceRouteLabel,
  sameProjectPresenceView,
  stablePresenceColorIndex
} from "./project-presence.ts";

const CURRENT_USER_ID = "0198f258-8cc7-7abc-8def-1234567890ab";
const OTHER_USER_ID = "0198f258-8cc7-7abc-8def-1234567890ac";

test("aggregates multiple tabs into one active participant", () => {
  const participants = aggregateProjectParticipants(
    [
      participant(OTHER_USER_ID, "connection-old", 1),
      participant(CURRENT_USER_ID, "connection-self", 2),
      participant(OTHER_USER_ID, "connection-new", 3)
    ],
    new Map([
      [
        OTHER_USER_ID,
        { userId: OTHER_USER_ID, displayName: "Борис" }
      ],
      [
        CURRENT_USER_ID,
        { userId: CURRENT_USER_ID, displayName: "Анна" }
      ]
    ]),
    CURRENT_USER_ID
  );

  assert.equal(participants.length, 2);
  assert.equal(participants[0]?.userId, CURRENT_USER_ID);
  assert.equal(participants[1]?.connectionCount, 2);
  assert.equal(
    participants[1]?.participant.connectionId,
    "connection-new"
  );
});

test("keeps a user active while at least one of their tabs is active", () => {
  const participants = aggregateProjectParticipants(
    [
      participant(OTHER_USER_ID, "connection-active", 1),
      {
        ...participant(OTHER_USER_ID, "connection-away", 3),
        status: "AWAY"
      }
    ],
    new Map(),
    CURRENT_USER_ID
  );

  assert.equal(participants.length, 1);
  assert.equal(
    participants[0]?.participant.connectionId,
    "connection-active"
  );
  assert.equal(participants[0]?.participant.status, "ACTIVE");
  assert.equal(participants[0]?.connectionCount, 2);
});

test("derives bounded presentation without exposing profile data in URLs", () => {
  assert.equal(projectPresenceRouteLabel("/app/semantics"), "Семантика");
  assert.equal(
    projectPresenceRouteLabel(`/app/projects/${CURRENT_USER_ID}/pages`),
    "Карта страниц"
  );
  assert.equal(
    projectPresenceAvatarUrl("project-id", {
      userId: CURRENT_USER_ID,
      displayName: "Анна Иванова",
      avatarUpdatedAt: "2026-08-20T10:00:00.000Z"
    }),
    "/app/api/projects/project-id/presence-members/0198f258-8cc7-7abc-8def-1234567890ab/avatar?v=2026-08-20T10%3A00%3A00.000Z"
  );
  assert.equal(
    stablePresenceColorIndex(CURRENT_USER_ID),
    stablePresenceColorIndex(CURRENT_USER_ID)
  );
});

test("matches semantic presence only for the same folder context", () => {
  const groupId = "0198f258-8cc7-7abc-8def-1234567890ae";
  const otherGroupId = "0198f258-8cc7-7abc-8def-1234567890af";
  assert.equal(sameProjectPresenceView(null, null), true);
  assert.equal(
    sameProjectPresenceView(
      { kind: "SEMANTIC_CORE", groupIds: [groupId, otherGroupId] },
      { kind: "SEMANTIC_CORE", groupIds: [groupId, otherGroupId] }
    ),
    true
  );
  assert.equal(
    sameProjectPresenceView(
      { kind: "SEMANTIC_CORE", groupIds: [groupId, otherGroupId] },
      { kind: "SEMANTIC_CORE", groupIds: [otherGroupId, groupId] }
    ),
    true
  );
  assert.equal(
    sameProjectPresenceView(
      { kind: "SEMANTIC_CORE", groupIds: [groupId] },
      { kind: "SEMANTIC_CORE", groupIds: [otherGroupId] }
    ),
    false
  );
  assert.equal(
    sameProjectPresenceView(
      { kind: "SEMANTIC_CORE", groupIds: [] },
      null
    ),
    false
  );
});

function participant(
  userId: string,
  connectionId: string,
  second: number
): ProjectPresenceParticipant {
  return {
    connectionId,
    userId,
    clientInstanceId: "0198f258-8cc7-7abc-8def-1234567890ad",
    route: "/app",
    status: "ACTIVE",
    cursor: null,
    selection: null,
    view: null,
    activity: null,
    editing: false,
    sequence: second,
    updatedAt: `2026-08-20T10:00:0${second}.000Z`
  };
}
