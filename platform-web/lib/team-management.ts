import {
  assignableWorkspaceRoleCodes,
  projectAccessLevels,
  type AssignableWorkspaceRoleCode,
  type CreateWorkspaceInviteInput,
  type ProjectAccessAssignment,
  type ProjectAccessLevel,
  type UpdateWorkspaceMemberInput,
  type WorkspaceInviteSummary,
  type WorkspaceMemberSummary
} from "@seo-platform/contracts";
import type { AppProject } from "./app-types.ts";
import type { BrowserApiCollection } from "./browser-api.ts";

export const TEAM_PAGE_LIMIT = 50;
export const TEAM_MAX_PAGES = 40;
export const TEAM_PROJECT_CATALOG_LIMIT = 1_000;
export const TEAM_PROJECT_RESULTS_LIMIT = 50;

const TEAM_CURSOR_PATTERN = /^[A-Za-z0-9_-]{40,1024}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MEMBER_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
const PENDING_INVITE_STATUSES = ["SENT", "DELIVERED"] as const;
const WORKSPACE_ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  SEO_LEAD: "SEO Lead",
  SEO_SPECIALIST: "SEO-специалист",
  ANALYST: "Аналитик",
  CONTENT_EDITOR: "Контент-редактор",
  CLIENT: "Клиент",
  VIEWER: "Наблюдатель"
};

export interface TeamCollection<Data> {
  readonly items: readonly Data[];
  readonly nextCursor?: string;
  readonly pageCount: number;
  readonly seenCursors: readonly string[];
}

export interface TeamPage<Data> {
  readonly items: readonly Data[];
  readonly nextCursor?: string;
}

export interface TeamInviteDraft {
  readonly email: string;
  readonly roleCode: AssignableWorkspaceRoleCode;
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
  readonly message?: string;
}

export interface TeamInviteFieldErrors {
  readonly email?: string;
  readonly roleCode?: string;
  readonly projectAccesses?: string;
  readonly message?: string;
}

export interface TeamProjectAccessDraft {
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
}

export interface TeamProjectChoice {
  readonly id: string;
  readonly name: string;
  readonly domain?: string;
  readonly status?: AppProject["status"];
  readonly listed: boolean;
}

export interface TeamProjectChoicePage {
  readonly items: readonly TeamProjectChoice[];
  readonly totalMatches: number;
  readonly truncated: boolean;
}

export type WorkspaceInviteFailurePhase =
  | "authentication-required"
  | "verification-required"
  | "account-mismatch"
  | "workspace-unavailable"
  | "invalid"
  | "error";

export class TeamCollectionIntegrityError extends Error {
  public constructor() {
    super("Сервер вернул несогласованную страницу списка команды");
    this.name = "TeamCollectionIntegrityError";
  }
}

export function workspaceMemberPage(
  collection: BrowserApiCollection<unknown>,
  workspaceId: string,
  requestedCursor?: string
): TeamPage<WorkspaceMemberSummary> {
  return parseTeamPage(
    collection,
    (value) => workspaceMember(value, workspaceId),
    requestedCursor
  );
}

export function pendingWorkspaceInvitePage(
  collection: BrowserApiCollection<unknown>,
  workspaceId: string,
  requestedCursor?: string
): TeamPage<WorkspaceInviteSummary> {
  return parseTeamPage(
    collection,
    (value) => pendingWorkspaceInvite(value, workspaceId),
    requestedCursor
  );
}

export function updatedWorkspaceMember(
  value: unknown,
  workspaceId: string
): WorkspaceMemberSummary {
  return workspaceMember(value, workspaceId);
}

export function acceptedWorkspaceInviteMember(
  value: unknown
): WorkspaceMemberSummary {
  const member = record(value);
  return workspaceMember(member, identifierValue(member.workspaceId));
}

export function workspaceInviteFailurePhase(error: {
  readonly status: number;
  readonly code: string;
}): WorkspaceInviteFailurePhase {
  if (error.status === 401) return "authentication-required";
  if (error.code === "EMAIL_VERIFICATION_REQUIRED") {
    return "verification-required";
  }
  if (error.code === "INVITATION_ACCOUNT_MISMATCH") {
    return "account-mismatch";
  }
  if (error.status === 404 || error.status === 410) return "invalid";
  if (error.code === "RESOURCE_STATE_CONFLICT") {
    return "workspace-unavailable";
  }
  return "error";
}

export function createdPendingWorkspaceInvite(
  value: unknown,
  workspaceId: string
): WorkspaceInviteSummary {
  return pendingWorkspaceInvite(record(value).invite, workspaceId);
}

export function firstTeamCollection<Data>(
  page: TeamPage<Data>
): TeamCollection<Data> {
  return {
    items: page.items,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    pageCount: 1,
    seenCursors: page.nextCursor ? [page.nextCursor] : []
  };
}

export function appendTeamCollection<Data extends { readonly id: string }>(
  current: TeamCollection<Data>,
  page: TeamPage<Data>,
  requestedCursor: string
): TeamCollection<Data> {
  if (
    current.nextCursor !== requestedCursor ||
    current.pageCount >= TEAM_MAX_PAGES ||
    (page.nextCursor !== undefined &&
      current.seenCursors.includes(page.nextCursor))
  ) {
    throw new TeamCollectionIntegrityError();
  }
  const currentIds = new Set(current.items.map(({ id }) => id));
  if (page.items.some(({ id }) => currentIds.has(id))) {
    throw new TeamCollectionIntegrityError();
  }
  return {
    items: [...current.items, ...page.items],
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    pageCount: current.pageCount + 1,
    seenCursors: page.nextCursor
      ? [...current.seenCursors, page.nextCursor]
      : current.seenCursors
  };
}

export function validateTeamInviteDraft(
  draft: TeamInviteDraft
): TeamInviteFieldErrors {
  const email = draft.email.normalize("NFKC").trim();
  const errors: {
    email?: string;
    roleCode?: string;
    projectAccesses?: string;
    message?: string;
  } = {};
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    errors.email = "Укажите корректный email длиной не более 320 символов.";
  }
  if (!assignableWorkspaceRoleCodes.includes(draft.roleCode)) {
    errors.roleCode = "Выберите доступную системную роль.";
  }
  const projectAccessError = validateTeamProjectAccess(draft);
  if (projectAccessError) errors.projectAccesses = projectAccessError;
  if ((draft.message?.normalize("NFKC").trim().length ?? 0) > 2_000) {
    errors.message = "Сообщение должно быть не длиннее 2 000 символов.";
  }
  return errors;
}

export function teamInviteInput(
  draft: TeamInviteDraft
): CreateWorkspaceInviteInput {
  const message = draft.message?.normalize("NFKC").trim();
  return {
    email: draft.email.normalize("NFKC").trim(),
    roleCode: draft.roleCode,
    allProjects: draft.allProjects,
    projectAccesses: canonicalTeamProjectAccesses(draft),
    ...(message ? { message } : {}),
    expiresInDays: 7
  };
}

export function teamMemberUpdateInput(
  roleCode: AssignableWorkspaceRoleCode,
  draft: TeamProjectAccessDraft
): UpdateWorkspaceMemberInput {
  return {
    roleCode,
    allProjects: draft.allProjects,
    projectAccesses: canonicalTeamProjectAccesses(draft)
  };
}

export function validateTeamProjectAccess(
  draft: TeamProjectAccessDraft
): string | undefined {
  let assignments: readonly ProjectAccessAssignment[];
  try {
    assignments = canonicalTeamProjectAccesses(draft);
  } catch {
    return "Настройки доступа к проектам повреждены. Загрузите список заново.";
  }
  if (
    !draft.allProjects &&
    !assignments.some(({ level }) => level !== "NONE")
  ) {
    return "Выберите хотя бы один проект с доступом VIEWER, MEMBER или MANAGER.";
  }
  return undefined;
}

export function canonicalTeamProjectAccesses(
  draft: TeamProjectAccessDraft
): readonly ProjectAccessAssignment[] {
  if (draft.projectAccesses.length > 2_000) {
    throw new TeamCollectionIntegrityError();
  }
  const seen = new Set<string>();
  const assignments = draft.projectAccesses.flatMap(({ projectId, level }) => {
    const normalizedProjectId = identifierValue(projectId);
    if (
      seen.has(normalizedProjectId) ||
      !projectAccessLevels.includes(level)
    ) {
      throw new TeamCollectionIntegrityError();
    }
    seen.add(normalizedProjectId);
    if (!draft.allProjects && level === "NONE") return [];
    return [{ projectId: normalizedProjectId, level }];
  });
  return assignments.sort((left, right) =>
    left.projectId.localeCompare(right.projectId)
  );
}

export function setTeamProjectAccess(
  draft: TeamProjectAccessDraft,
  projectId: string,
  level: ProjectAccessLevel | undefined
): readonly ProjectAccessAssignment[] {
  const normalizedProjectId = identifierValue(projectId);
  const current = canonicalTeamProjectAccesses(draft).filter(
    (assignment) => assignment.projectId !== normalizedProjectId
  );
  if (level === undefined || (!draft.allProjects && level === "NONE")) {
    return current;
  }
  return canonicalTeamProjectAccesses({
    ...draft,
    projectAccesses: [...current, { projectId: normalizedProjectId, level }]
  });
}

export function sameTeamMemberInput(
  member: Pick<
    WorkspaceMemberSummary,
    "roleCode" | "allProjects" | "projectAccesses"
  >,
  input: UpdateWorkspaceMemberInput
): boolean {
  if (
    member.roleCode !== input.roleCode ||
    member.allProjects !== input.allProjects
  ) {
    return false;
  }
  const current = canonicalTeamProjectAccesses(member);
  const next = canonicalTeamProjectAccesses(input);
  return (
    current.length === next.length &&
    current.every(
      (assignment, index) =>
        assignment.projectId === next[index]?.projectId &&
        assignment.level === next[index]?.level
    )
  );
}

export function teamProjectChoices(
  projects: readonly Pick<
    AppProject,
    "id" | "workspaceId" | "name" | "domain" | "status"
  >[],
  workspaceId: string,
  assignments: readonly ProjectAccessAssignment[],
  search: string
): TeamProjectChoicePage {
  if (projects.length > TEAM_PROJECT_CATALOG_LIMIT) {
    throw new TeamCollectionIntegrityError();
  }
  const normalizedWorkspaceId = identifierValue(workspaceId);
  const choices = new Map<string, TeamProjectChoice>();
  for (const project of projects) {
    const projectId = identifierValue(project.id);
    if (
      identifierValue(project.workspaceId) !== normalizedWorkspaceId ||
      choices.has(projectId)
    ) {
      throw new TeamCollectionIntegrityError();
    }
    choices.set(projectId, {
      id: projectId,
      name: project.name,
      domain: project.domain,
      status: project.status,
      listed: true
    });
  }
  const canonicalAssignments = canonicalTeamProjectAccesses({
    allProjects: true,
    projectAccesses: assignments
  });
  const assignedProjectIds = new Set(
    canonicalAssignments.map(({ projectId }) => projectId)
  );
  for (const { projectId } of canonicalAssignments) {
    if (!choices.has(projectId)) {
      choices.set(projectId, {
        id: projectId,
        name: "Проект вне текущего списка",
        listed: false
      });
    }
  }
  const query = search.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
  const matches = [...choices.values()]
    .filter((choice) => {
      if (!query) return true;
      return [choice.name, choice.domain, choice.id].some((value) =>
        value?.toLocaleLowerCase("ru-RU").includes(query)
      );
    })
    .sort((left, right) => {
      const assignmentOrder =
        Number(assignedProjectIds.has(right.id)) -
        Number(assignedProjectIds.has(left.id));
      return (
        assignmentOrder ||
        left.name.localeCompare(right.name, "ru-RU") ||
        left.id.localeCompare(right.id)
      );
    });
  return {
    items: matches.slice(0, TEAM_PROJECT_RESULTS_LIMIT),
    totalMatches: matches.length,
    truncated: matches.length > TEAM_PROJECT_RESULTS_LIMIT
  };
}

export function workspaceRoleLabel(roleCode: string): string {
  return WORKSPACE_ROLE_LABELS[roleCode] ?? roleCode;
}

export function workspaceTeamListPath(
  workspaceId: string,
  resource: "members" | "invites",
  cursor?: string
): string {
  const parameters = new URLSearchParams({
    limit: String(TEAM_PAGE_LIMIT)
  });
  if (resource === "invites") parameters.set("status", "PENDING");
  if (cursor) parameters.set("cursor", cursor);
  return `/app/api/workspaces/${encodeURIComponent(workspaceId)}/${resource}?${parameters.toString()}`;
}

export function memberProjectAccessLabel(
  member: Pick<WorkspaceMemberSummary, "allProjects" | "projectAccesses">
): string {
  if (member.allProjects) {
    return member.projectAccesses.length === 0
      ? "Все текущие и будущие проекты"
      : `Все проекты, ${member.projectAccesses.length} явных override`;
  }
  const accessible = member.projectAccesses.filter(
    ({ level }) => level !== "NONE"
  ).length;
  return accessible === 1
    ? "1 выбранный проект"
    : `${accessible} выбранных проектов`;
}

function parseTeamPage<Data extends { readonly id: string }>(
  collection: BrowserApiCollection<unknown>,
  parseItem: (value: unknown) => Data,
  requestedCursor: string | undefined
): TeamPage<Data> {
  if (collection.data.length > TEAM_PAGE_LIMIT) {
    throw new TeamCollectionIntegrityError();
  }
  const items = collection.data.map(parseItem);
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    throw new TeamCollectionIntegrityError();
  }
  const { hasNext, nextCursor } = collection.page;
  if (
    (hasNext &&
      (items.length === 0 ||
        !nextCursor ||
        !TEAM_CURSOR_PATTERN.test(nextCursor))) ||
    (!hasNext && nextCursor !== undefined) ||
    (requestedCursor !== undefined && nextCursor === requestedCursor)
  ) {
    throw new TeamCollectionIntegrityError();
  }
  return {
    items,
    ...(nextCursor ? { nextCursor } : {})
  };
}

function workspaceMember(
  value: unknown,
  expectedWorkspaceId: string
): WorkspaceMemberSummary {
  const member = record(value);
  const workspaceId = identifierValue(member.workspaceId);
  const status = stringValue(member.status);
  const roleCode = stringValue(member.roleCode);
  if (
    workspaceId !== expectedWorkspaceId ||
    !MEMBER_STATUSES.includes(status as (typeof MEMBER_STATUSES)[number]) ||
    (roleCode !== "OWNER" &&
      !assignableWorkspaceRoleCodes.includes(
        roleCode as AssignableWorkspaceRoleCode
      ))
  ) {
    throw new TeamCollectionIntegrityError();
  }
  const joinedAt = optionalDateValue(member.joinedAt);
  return {
    id: identifierValue(member.id),
    workspaceId,
    userId: identifierValue(member.userId),
    email: stringValue(member.email),
    displayName: stringValue(member.displayName),
    roleCode,
    status: status as WorkspaceMemberSummary["status"],
    allProjects: booleanValue(member.allProjects),
    projectAccesses: projectAccessAssignments(member.projectAccesses),
    version: positiveInteger(member.version),
    ...(joinedAt ? { joinedAt } : {})
  };
}

function pendingWorkspaceInvite(
  value: unknown,
  expectedWorkspaceId: string
): WorkspaceInviteSummary {
  const invite = record(value);
  const workspaceId = identifierValue(invite.workspaceId);
  const roleCode = stringValue(invite.roleCode);
  const status = stringValue(invite.status);
  if (
    workspaceId !== expectedWorkspaceId ||
    !assignableWorkspaceRoleCodes.includes(
      roleCode as AssignableWorkspaceRoleCode
    ) ||
    !PENDING_INVITE_STATUSES.includes(
      status as (typeof PENDING_INVITE_STATUSES)[number]
    )
  ) {
    throw new TeamCollectionIntegrityError();
  }
  const message = optionalStringValue(invite.message);
  return {
    id: identifierValue(invite.id),
    workspaceId,
    email: stringValue(invite.email),
    roleCode: roleCode as AssignableWorkspaceRoleCode,
    status: status as WorkspaceInviteSummary["status"],
    allProjects: booleanValue(invite.allProjects),
    projectAccesses: projectAccessAssignments(invite.projectAccesses),
    ...(message ? { message } : {}),
    expiresAt: dateValue(invite.expiresAt),
    createdAt: dateValue(invite.createdAt)
  };
}

function projectAccessAssignments(
  value: unknown
): readonly ProjectAccessAssignment[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw new TeamCollectionIntegrityError();
  }
  const assignments = value.map((item) => {
    const assignment = record(item);
    const projectId = identifierValue(assignment.projectId);
    const level = stringValue(assignment.level);
    if (!projectAccessLevels.includes(level as ProjectAccessLevel)) {
      throw new TeamCollectionIntegrityError();
    }
    return { projectId, level: level as ProjectAccessLevel };
  });
  if (
    new Set(assignments.map(({ projectId }) => projectId)).size !==
    assignments.length
  ) {
    throw new TeamCollectionIntegrityError();
  }
  return assignments;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeamCollectionIntegrityError();
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TeamCollectionIntegrityError();
  }
  return value;
}

function optionalStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return stringValue(value);
}

function identifierValue(value: unknown): string {
  const identifier = stringValue(value);
  if (!UUID_PATTERN.test(identifier)) {
    throw new TeamCollectionIntegrityError();
  }
  return identifier.toLowerCase();
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TeamCollectionIntegrityError();
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TeamCollectionIntegrityError();
  }
  return Number(value);
}

function optionalDateValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return dateValue(value);
}

function dateValue(value: unknown): string {
  const date = stringValue(value);
  const timestamp = Date.parse(date);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== date) {
    throw new TeamCollectionIntegrityError();
  }
  return date;
}
