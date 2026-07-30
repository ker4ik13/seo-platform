import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserApiCollection } from "./browser-api.ts";
import {
  acceptedWorkspaceInviteMember,
  appendTeamCollection,
  canonicalTeamProjectAccesses,
  createdPendingWorkspaceInvite,
  firstTeamCollection,
  pendingWorkspaceInvitePage,
  sameTeamMemberInput,
  setTeamProjectAccess,
  TEAM_MAX_PAGES,
  TEAM_PROJECT_RESULTS_LIMIT,
  TeamCollectionIntegrityError,
  teamInviteInput,
  teamMemberUpdateInput,
  teamProjectChoices,
  updatedWorkspaceMember,
  validateTeamInviteDraft,
  validateTeamProjectAccess,
  workspaceMemberPage,
  workspaceInviteFailurePhase,
  workspaceTeamListPath
} from "./team-management.ts";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const MEMBER_ID = "01900000-0000-7000-8000-000000000010";
const OTHER_MEMBER_ID = "01900000-0000-7000-8000-000000000011";
const INVITE_ID = "01900000-0000-7000-8000-000000000020";
const PROJECT_ID = "01900000-0000-7000-8000-000000000040";
const OTHER_PROJECT_ID = "01900000-0000-7000-8000-000000000041";
const CURSOR = "a".repeat(80);
const NEXT_CURSOR = "b".repeat(80);

test("parses member and pending invite pages within one workspace", () => {
  const members = workspaceMemberPage(
    collection([member(MEMBER_ID)], false),
    WORKSPACE_ID
  );
  const invites = pendingWorkspaceInvitePage(
    collection([invite(INVITE_ID)], true, CURSOR),
    WORKSPACE_ID
  );

  assert.equal(members.items[0]?.email, "member@example.com");
  assert.equal(invites.items[0]?.status, "SENT");
  assert.equal(invites.nextCursor, CURSOR);
  assert.equal(
    updatedWorkspaceMember(member(MEMBER_ID), WORKSPACE_ID).id,
    MEMBER_ID
  );
  assert.equal(
    createdPendingWorkspaceInvite({ invite: invite(INVITE_ID) }, WORKSPACE_ID)
      .id,
    INVITE_ID
  );
  assert.equal(
    acceptedWorkspaceInviteMember(member(MEMBER_ID)).workspaceId,
    WORKSPACE_ID
  );
});

test("maps invitation API failures to exact recoverable UI states", () => {
  assert.equal(
    workspaceInviteFailurePhase({ status: 401, code: "UNAUTHORIZED" }),
    "authentication-required"
  );
  assert.equal(
    workspaceInviteFailurePhase({
      status: 409,
      code: "EMAIL_VERIFICATION_REQUIRED"
    }),
    "verification-required"
  );
  assert.equal(
    workspaceInviteFailurePhase({
      status: 403,
      code: "INVITATION_ACCOUNT_MISMATCH"
    }),
    "account-mismatch"
  );
  assert.equal(
    workspaceInviteFailurePhase({
      status: 409,
      code: "RESOURCE_STATE_CONFLICT"
    }),
    "workspace-unavailable"
  );
  assert.equal(
    workspaceInviteFailurePhase({ status: 404, code: "NOT_FOUND" }),
    "invalid"
  );
  assert.equal(
    workspaceInviteFailurePhase({ status: 503, code: "DEPENDENCY_UNAVAILABLE" }),
    "error"
  );
});

test("rejects cross-workspace data and incoherent cursor pages", () => {
  assert.throws(
    () =>
      workspaceMemberPage(
        collection(
          [
            {
              ...member(MEMBER_ID),
              workspaceId: "01900000-0000-7000-8000-000000000099"
            }
          ],
          false
        ),
        WORKSPACE_ID
      ),
    TeamCollectionIntegrityError
  );
  assert.throws(
    () =>
      workspaceMemberPage(
        collection([member(MEMBER_ID)], true),
        WORKSPACE_ID
      ),
    TeamCollectionIntegrityError
  );
  assert.throws(
    () =>
      workspaceMemberPage(
        collection([member(MEMBER_ID)], true, CURSOR),
        WORKSPACE_ID,
        CURSOR
      ),
    TeamCollectionIntegrityError
  );
});

test("rejects duplicate rows, repeated cursors and the page safety cap", () => {
  const first = firstTeamCollection({
    items: [member(MEMBER_ID)],
    nextCursor: CURSOR
  });
  assert.throws(
    () =>
      appendTeamCollection(
        first,
        { items: [member(MEMBER_ID)], nextCursor: NEXT_CURSOR },
        CURSOR
      ),
    TeamCollectionIntegrityError
  );
  assert.throws(
    () =>
      appendTeamCollection(
        first,
        { items: [member(OTHER_MEMBER_ID)], nextCursor: CURSOR },
        CURSOR
      ),
    TeamCollectionIntegrityError
  );
  assert.throws(
    () =>
      appendTeamCollection(
        { ...first, pageCount: TEAM_MAX_PAGES },
        { items: [member(OTHER_MEMBER_ID)] },
        CURSOR
      ),
    TeamCollectionIntegrityError
  );
});

test("validates an invitation and creates the least-surprising default input", () => {
  assert.deepEqual(
    validateTeamInviteDraft({
      email: "invalid",
      roleCode: "VIEWER",
      allProjects: true,
      projectAccesses: []
    }),
    { email: "Укажите корректный email длиной не более 320 символов." }
  );
  assert.match(
    validateTeamInviteDraft({
      email: "member@example.com",
      roleCode: "VIEWER",
      allProjects: false,
      projectAccesses: []
    }).projectAccesses ?? "",
    /хотя бы один проект/u
  );
  assert.deepEqual(
    validateTeamInviteDraft({
      email: "member@example",
      roleCode: "VIEWER",
      allProjects: true,
      projectAccesses: []
    }),
    { email: "Укажите корректный email длиной не более 320 символов." }
  );
  assert.deepEqual(
    teamInviteInput({
      email: "  Member@Example.com ",
      roleCode: "ANALYST",
      allProjects: false,
      projectAccesses: [
        { projectId: PROJECT_ID, level: "NONE" },
        { projectId: OTHER_PROJECT_ID, level: "VIEWER" }
      ]
    }),
    {
      email: "Member@Example.com",
      roleCode: "ANALYST",
      allProjects: false,
      projectAccesses: [{ projectId: OTHER_PROJECT_ID, level: "VIEWER" }],
      expiresInDays: 7
    }
  );
});

test("canonicalizes explicit project access and detects semantic member changes", () => {
  const draft = {
    allProjects: false,
    projectAccesses: [
      { projectId: OTHER_PROJECT_ID, level: "MANAGER" as const },
      { projectId: PROJECT_ID, level: "NONE" as const }
    ]
  };
  assert.deepEqual(canonicalTeamProjectAccesses(draft), [
    { projectId: OTHER_PROJECT_ID, level: "MANAGER" }
  ]);
  assert.equal(validateTeamProjectAccess(draft), undefined);
  assert.match(
    validateTeamProjectAccess({ allProjects: false, projectAccesses: [] }) ?? "",
    /хотя бы один проект/u
  );

  const nextAssignments = setTeamProjectAccess(
    { allProjects: false, projectAccesses: [] },
    PROJECT_ID,
    "VIEWER"
  );
  const input = teamMemberUpdateInput("ADMIN", {
    allProjects: false,
    projectAccesses: nextAssignments
  });
  assert.equal(
    sameTeamMemberInput(
      {
        roleCode: "ADMIN",
        allProjects: false,
        projectAccesses: [{ projectId: PROJECT_ID, level: "VIEWER" }]
      },
      input
    ),
    true
  );
  assert.deepEqual(
    setTeamProjectAccess(
      { allProjects: false, projectAccesses: nextAssignments },
      PROJECT_ID,
      "NONE"
    ),
    []
  );
  assert.deepEqual(
    setTeamProjectAccess(
      {
        allProjects: true,
        projectAccesses: [{ projectId: PROJECT_ID, level: "NONE" }]
      },
      PROJECT_ID,
      undefined
    ),
    []
  );
});

test("bounds searchable project choices and preserves unlisted assignments", () => {
  const projects = Array.from({ length: TEAM_PROJECT_RESULTS_LIMIT + 5 }, (_, index) => ({
    id: projectId(index + 100),
    workspaceId: WORKSPACE_ID,
    name: `Проект ${index + 1}`,
    domain: `project-${index + 1}.example.com`,
    status: "ACTIVE" as const
  }));
  const unknownProjectId = projectId(999);
  const page = teamProjectChoices(
    projects,
    WORKSPACE_ID,
    [{ projectId: unknownProjectId, level: "VIEWER" }],
    ""
  );
  assert.equal(page.items.length, TEAM_PROJECT_RESULTS_LIMIT);
  assert.equal(page.totalMatches, TEAM_PROJECT_RESULTS_LIMIT + 6);
  assert.equal(page.truncated, true);
  assert.equal(page.items[0]?.id, unknownProjectId);

  const unknown = teamProjectChoices(
    projects,
    WORKSPACE_ID,
    [{ projectId: unknownProjectId, level: "VIEWER" }],
    unknownProjectId
  );
  assert.deepEqual(unknown.items, [
    {
      id: unknownProjectId,
      name: "Проект вне текущего списка",
      listed: false
    }
  ]);
  assert.throws(
    () =>
      teamProjectChoices(
        [{ ...projects[0]!, workspaceId: projectId(998) }],
        WORKSPACE_ID,
        [],
        ""
      ),
    TeamCollectionIntegrityError
  );
});

test("wires bounded member pages and pending-only invitation pages", () => {
  assert.equal(
    workspaceTeamListPath(WORKSPACE_ID, "members"),
    `/app/api/workspaces/${WORKSPACE_ID}/members?limit=50`
  );
  assert.equal(
    workspaceTeamListPath(WORKSPACE_ID, "invites", CURSOR),
    `/app/api/workspaces/${WORKSPACE_ID}/invites?limit=50&status=PENDING&cursor=${CURSOR}`
  );
});

function collection(
  data: readonly unknown[],
  hasNext: boolean,
  nextCursor?: string
): BrowserApiCollection<unknown> {
  return {
    data,
    page: {
      hasNext,
      ...(nextCursor ? { nextCursor } : {})
    }
  };
}

function member(id: string) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    userId:
      id === MEMBER_ID
        ? "01900000-0000-7000-8000-000000000030"
        : "01900000-0000-7000-8000-000000000031",
    email: "member@example.com",
    displayName: "Участник",
    roleCode: "ADMIN",
    status: "ACTIVE",
    allProjects: true,
    projectAccesses: [],
    version: 1,
    joinedAt: "2026-07-30T12:00:00.000Z"
  };
}

function invite(id: string) {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    email: "invite@example.com",
    roleCode: "VIEWER",
    status: "SENT",
    allProjects: true,
    projectAccesses: [],
    expiresAt: "2026-08-06T12:00:00.000Z",
    createdAt: "2026-07-30T12:00:00.000Z"
  };
}

function projectId(value: number): string {
  return `01900000-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}
