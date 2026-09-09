"use client";

import { CustomSelect } from "./custom-select";

import {
  assignableWorkspaceRoleCodes,
  projectAccessLevels,
  type AssignableWorkspaceRoleCode,
  type ProjectAccessAssignment,
  type ProjectAccessLevel,
  type UpdateWorkspaceMemberInput,
  type WorkspaceInviteSummary,
  type WorkspaceMemberSummary
} from "@seo-platform/contracts";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  canManageWorkspaceTeam,
  canViewWorkspaceTeam
} from "../lib/app-permissions";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import {
  appendTeamCollection,
  createdPendingWorkspaceInvite,
  firstTeamCollection,
  memberProjectAccessLabel,
  pendingWorkspaceInvitePage,
  sameTeamMemberInput,
  setTeamProjectAccess,
  TEAM_MAX_PAGES,
  TeamCollectionIntegrityError,
  teamInviteInput,
  teamMemberUpdateInput,
  teamProjectChoices,
  updatedWorkspaceMember,
  validateTeamInviteDraft,
  validateTeamProjectAccess,
  workspaceMemberPage,
  workspaceTeamListPath,
  workspaceRoleLabel,
  type TeamCollection,
  type TeamInviteFieldErrors
} from "../lib/team-management";
import { UiText, useUiLocale } from "./ui-locale";


interface TeamFailure {
  readonly message: string;
  readonly requestId?: string;
}

type TeamCollectionState<Data> =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly failure: TeamFailure }
  | { readonly phase: "integrity" }
  | {
      readonly phase: "ready";
      readonly value: TeamCollection<Data>;
      readonly loadingMore: boolean;
      readonly continuationFailure?: TeamFailure;
    };

type TeamConfirmation =
  | {
      readonly kind: "update-member";
      readonly member: WorkspaceMemberSummary;
      readonly input: UpdateWorkspaceMemberInput;
      readonly self: boolean;
    }
  | {
      readonly kind: "remove-member";
      readonly member: WorkspaceMemberSummary;
      readonly self: boolean;
    }
  | {
      readonly kind: "revoke-invite";
      readonly invite: WorkspaceInviteSummary;
    };

interface TeamFeedback extends TeamFailure {
  readonly tone: "danger" | "success";
}

const INITIAL_COLLECTION = { phase: "loading" } as const;

export function TeamManagement({
  currentUserId,
  projects,
  workspace
}: Readonly<{
  currentUserId: string;
  projects: readonly AppProject[];
  workspace: AppWorkspace;
}>) {
  const { t: uiText } = useUiLocale();
  const router = useRouter();
  const [members, setMembers] =
    useState<TeamCollectionState<WorkspaceMemberSummary>>(INITIAL_COLLECTION);
  const [invites, setInvites] =
    useState<TeamCollectionState<WorkspaceInviteSummary>>(INITIAL_COLLECTION);
  const [online, setOnline] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [runtimeRestriction, setRuntimeRestriction] = useState<
    "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY"
  >();
  const [operation, setOperation] = useState<string>();
  const [feedback, setFeedback] = useState<TeamFeedback>();
  const [confirmation, setConfirmation] = useState<TeamConfirmation>();
  const [confirmationError, setConfirmationError] = useState<TeamFailure>();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteRole, setInviteRole] =
    useState<AssignableWorkspaceRoleCode>("SEO_SPECIALIST");
  const [inviteAllProjects, setInviteAllProjects] = useState(true);
  const [inviteProjectAccesses, setInviteProjectAccesses] = useState<
    readonly ProjectAccessAssignment[]
  >([]);
  const [inviteErrors, setInviteErrors] =
    useState<TeamInviteFieldErrors>({});
  const feedbackRef = useRef<HTMLDivElement>(null);

  const roleAllowsManage = canManageWorkspaceTeam(workspace.roleCode);
  const statusAllowsManage = workspace.status === "ACTIVE";
  const projectCatalogValid = useMemo(() => {
    try {
      teamProjectChoices(projects, workspace.id, [], "");
      return true;
    } catch {
      return false;
    }
  }, [projects, workspace.id]);
  const safeProjects = projectCatalogValid ? projects : [];
  const collectionBusy =
    (members.phase === "ready" && members.loadingMore) ||
    (invites.phase === "ready" && invites.loadingMore);
  const mutationBoundaryAllows =
    roleAllowsManage &&
    statusAllowsManage &&
    projectCatalogValid &&
    !runtimeRestriction;
  const canMutate =
    mutationBoundaryAllows &&
    online &&
    !operation &&
    !collectionBusy;
  const restriction = teamRestrictionMessage(
    workspace,
    roleAllowsManage,
    runtimeRestriction
  );
  const degraded =
    [members.phase, invites.phase].some((phase) =>
      ["error", "integrity"].includes(phase)
    ) &&
    [members.phase, invites.phase].some((phase) => phase === "ready");

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setMembers(INITIAL_COLLECTION);
    setInvites(INITIAL_COLLECTION);
    setForbidden(false);
    setRuntimeRestriction(undefined);
    setFeedback(undefined);

    void loadMemberPage(workspace.id, undefined, controller.signal)
      .then((page) => {
        if (active) setMembers(readyCollection(page));
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        if (redirectExpiredTeamSession(error)) return;
        if (isForbidden(error)) {
          setForbidden(true);
          return;
        }
        if (isTeamListIntegrityError(error)) {
          setMembers({ phase: "integrity" });
          return;
        }
        setMembers({
          phase: "error",
          failure: teamFailure(error, navigator.onLine, "участников")
        });
      });

    void loadInvitePage(workspace.id, undefined, controller.signal)
      .then((page) => {
        if (active) setInvites(readyCollection(page));
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        if (redirectExpiredTeamSession(error)) return;
        if (isForbidden(error)) {
          setForbidden(true);
          return;
        }
        if (isTeamListIntegrityError(error)) {
          setInvites({ phase: "integrity" });
          return;
        }
        setInvites({
          phase: "error",
          failure: teamFailure(error, navigator.onLine, "приглашения")
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [workspace.id]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  async function reloadMembers(): Promise<void> {
    if (!online) return;
    setMembers(INITIAL_COLLECTION);
    try {
      const page = await loadMemberPage(workspace.id);
      setMembers(readyCollection(page));
      setForbidden(false);
    } catch (error) {
      if (redirectExpiredTeamSession(error)) return;
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      if (isTeamListIntegrityError(error)) {
        setMembers({ phase: "integrity" });
        return;
      }
      setMembers({
        phase: "error",
        failure: teamFailure(error, navigator.onLine, "участников")
      });
    }
  }

  async function reloadInvites(): Promise<void> {
    if (!online) return;
    setInvites(INITIAL_COLLECTION);
    try {
      const page = await loadInvitePage(workspace.id);
      setInvites(readyCollection(page));
      setForbidden(false);
    } catch (error) {
      if (redirectExpiredTeamSession(error)) return;
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      if (isTeamListIntegrityError(error)) {
        setInvites({ phase: "integrity" });
        return;
      }
      setInvites({
        phase: "error",
        failure: teamFailure(error, navigator.onLine, "приглашения")
      });
    }
  }

  async function loadMoreMembers(): Promise<void> {
    if (
      members.phase !== "ready" ||
      members.loadingMore ||
      !online ||
      operation
    ) {
      return;
    }
    const cursor = members.value.nextCursor;
    if (!cursor) return;
    if (members.value.pageCount >= TEAM_MAX_PAGES) {
      setMembers({ phase: "integrity" });
      return;
    }
    const current = members.value;
    setMembers({ phase: "ready", value: current, loadingMore: true });
    try {
      const page = await loadMemberPage(workspace.id, cursor);
      setMembers({
        phase: "ready",
        value: appendTeamCollection(current, page, cursor),
        loadingMore: false
      });
    } catch (error) {
      if (redirectExpiredTeamSession(error)) return;
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      if (isTeamListIntegrityError(error)) {
        setMembers({ phase: "integrity" });
        return;
      }
      setMembers({
        phase: "ready",
        value: current,
        loadingMore: false,
        continuationFailure: teamFailure(
          error,
          navigator.onLine,
          "следующую страницу участников"
        )
      });
    }
  }

  async function loadMoreInvites(): Promise<void> {
    if (
      invites.phase !== "ready" ||
      invites.loadingMore ||
      !online ||
      operation
    ) {
      return;
    }
    const cursor = invites.value.nextCursor;
    if (!cursor) return;
    if (invites.value.pageCount >= TEAM_MAX_PAGES) {
      setInvites({ phase: "integrity" });
      return;
    }
    const current = invites.value;
    setInvites({ phase: "ready", value: current, loadingMore: true });
    try {
      const page = await loadInvitePage(workspace.id, cursor);
      setInvites({
        phase: "ready",
        value: appendTeamCollection(current, page, cursor),
        loadingMore: false
      });
    } catch (error) {
      if (redirectExpiredTeamSession(error)) return;
      if (isForbidden(error)) {
        setForbidden(true);
        return;
      }
      if (isTeamListIntegrityError(error)) {
        setInvites({ phase: "integrity" });
        return;
      }
      setInvites({
        phase: "ready",
        value: current,
        loadingMore: false,
        continuationFailure: teamFailure(
          error,
          navigator.onLine,
          "следующую страницу приглашений"
        )
      });
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canMutate) return;
    const draft = {
      email: inviteEmail,
      roleCode: inviteRole,
      allProjects: inviteAllProjects,
      projectAccesses: inviteProjectAccesses,
      message: inviteMessage
    };
    const errors = validateTeamInviteDraft(draft);
    if (Object.keys(errors).length > 0) {
      setInviteErrors(errors);
      setFeedback({
        tone: "danger",
        message: "Проверьте данные приглашения."
      });
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('#team-invite-form [aria-invalid="true"]')
          ?.focus();
      });
      return;
    }

    setOperation("invite:create");
    setFeedback(undefined);
    setInviteErrors({});
    try {
      const result = await browserApiRequest<unknown>(invitePath(workspace.id), {
        method: "POST",
        body: teamInviteInput(draft)
      });
      const invite = createdPendingWorkspaceInvite(result, workspace.id);
      setInvites((current) =>
        current.phase === "ready"
          ? {
              ...current,
              value: {
                ...current.value,
                items: [
                  invite,
                  ...current.value.items.filter(({ id }) => id !== invite.id)
                ]
              }
            }
          : current
      );
      setInviteEmail("");
      setInviteMessage("");
      setInviteAllProjects(true);
      setInviteProjectAccesses([]);
      setFeedback({
        tone: "success",
        message: `Приглашение для ${invite.email} создано и передано на отправку.`
      });
      if (invites.phase !== "ready") void reloadInvites();
      router.refresh();
    } catch (error) {
      applyMutationRestriction(error);
      setInviteErrors(inviteApiFieldErrors(error));
      setFeedback({
        tone: "danger",
        ...teamFailure(error, navigator.onLine, "приглашение")
      });
    } finally {
      setOperation(undefined);
    }
  }

  function requestMemberUpdate(
    member: WorkspaceMemberSummary,
    input: UpdateWorkspaceMemberInput
  ): void {
    setConfirmation({
      kind: "update-member",
      member,
      input,
      self: member.userId === currentUserId
    });
    setConfirmationError(undefined);
  }

  async function updateMember(
    member: WorkspaceMemberSummary,
    input: UpdateWorkspaceMemberInput
  ): Promise<boolean> {
    if (!canMutate || member.roleCode === "OWNER") return false;
    setOperation(`member:update:${member.id}`);
    setFeedback(undefined);
    setConfirmationError(undefined);
    try {
      const result = await browserApiRequest<unknown>(
        memberPath(workspace.id, member.id),
        {
          method: "PATCH",
          ifMatch: member.version,
          body: input
        }
      );
      const updated = updatedWorkspaceMember(result, workspace.id);
      setMembers((current) =>
        current.phase === "ready"
          ? {
              ...current,
              value: {
                ...current.value,
                items: current.value.items.map((item) =>
                  item.id === updated.id ? updated : item
                )
              }
            }
          : current
      );
      setFeedback({
        tone: "success",
        message: `Роль и доступ ${updated.email} обновлены.`
      });
      if (
        updated.userId === currentUserId &&
        !canManageWorkspaceTeam(updated.roleCode)
      ) {
        setRuntimeRestriction("MISSING_PERMISSION");
      }
      if (
        updated.userId === currentUserId &&
        !canViewWorkspaceTeam(updated.roleCode)
      ) {
        window.location.assign("/app");
      } else {
        router.refresh();
      }
      return true;
    } catch (error) {
      applyMutationRestriction(error);
      const failure = teamFailure(error, navigator.onLine, "роль и доступ участника");
      setConfirmationError(failure);
      setFeedback({ tone: "danger", ...failure });
      if (isVersionConflict(error)) {
        setConfirmation(undefined);
        setConfirmationError(undefined);
        void reloadMembers();
      }
      return false;
    } finally {
      setOperation(undefined);
    }
  }

  async function removeMember(
    member: WorkspaceMemberSummary
  ): Promise<boolean> {
    if (!canMutate || member.roleCode === "OWNER") return false;
    setOperation(`member:remove:${member.id}`);
    setFeedback(undefined);
    setConfirmationError(undefined);
    try {
      await browserApiRequest<unknown>(memberPath(workspace.id, member.id), {
        method: "DELETE",
        ifMatch: member.version
      });
      setMembers((current) =>
        current.phase === "ready"
          ? {
              ...current,
              value: {
                ...current.value,
                items: current.value.items.filter(({ id }) => id !== member.id)
              }
            }
          : current
      );
      setFeedback({
        tone: "success",
        message:
          member.userId === currentUserId
            ? `Вы покинули рабочую область «${workspace.name}».`
            : `${member.email} удалён из рабочей области.`
      });
      if (member.userId === currentUserId) {
        clearTenantPreference("seo_workspace");
        clearTenantPreference("seo_project");
        window.location.assign("/app");
      } else {
        router.refresh();
      }
      return true;
    } catch (error) {
      applyMutationRestriction(error);
      const failure = teamFailure(error, navigator.onLine, "участника");
      setConfirmationError(failure);
      setFeedback({ tone: "danger", ...failure });
      if (isVersionConflict(error)) void reloadMembers();
      return false;
    } finally {
      setOperation(undefined);
    }
  }

  async function revokeInvite(
    invite: WorkspaceInviteSummary
  ): Promise<boolean> {
    if (!canMutate) return false;
    setOperation(`invite:revoke:${invite.id}`);
    setFeedback(undefined);
    setConfirmationError(undefined);
    try {
      await browserApiRequest<unknown>(
        inviteItemPath(workspace.id, invite.id),
        { method: "DELETE" }
      );
      setInvites((current) =>
        current.phase === "ready"
          ? {
              ...current,
              value: {
                ...current.value,
                items: current.value.items.filter(({ id }) => id !== invite.id)
              }
            }
          : current
      );
      setFeedback({
        tone: "success",
        message: `Приглашение для ${invite.email} отозвано.`
      });
      router.refresh();
      return true;
    } catch (error) {
      applyMutationRestriction(error);
      const failure = teamFailure(error, navigator.onLine, "приглашение");
      setConfirmationError(failure);
      setFeedback({ tone: "danger", ...failure });
      return false;
    } finally {
      setOperation(undefined);
    }
  }

  async function confirmAction(): Promise<void> {
    if (!confirmation) return;
    let succeeded = false;
    if (confirmation.kind === "update-member") {
      succeeded = await updateMember(
        confirmation.member,
        confirmation.input
      );
    } else if (confirmation.kind === "remove-member") {
      succeeded = await removeMember(confirmation.member);
    } else {
      succeeded = await revokeInvite(confirmation.invite);
    }
    if (succeeded) {
      setConfirmation(undefined);
      setConfirmationError(undefined);
    }
  }

  function applyMutationRestriction(error: unknown): void {
    if (redirectExpiredTeamSession(error)) return;
    if (isForbidden(error)) setRuntimeRestriction("MISSING_PERMISSION");
    if (
      error instanceof BrowserApiError &&
      (error.status === 402 || error.code === "PAYMENT_REQUIRED")
    ) {
      setRuntimeRestriction("WORKSPACE_READ_ONLY");
    }
  }

  if (forbidden) {
    return (
      <section className="panel panel-empty compact" role="status">
        <span aria-hidden="true" className="state-icon">
          403
        </span>
        <strong><UiText text="Доступ к команде был отозван" /></strong>
        <p>
          <UiText text="Сервер отклонил member.view. Обновите рабочую область или обратитесь к владельцу; ранее загруженные данные скрыты." /></p>
        <a className="primary-button" href="/app">
          <UiText text="Вернуться к обзору" /></a>
      </section>
    );
  }

  return (
    <div className="settings-stack">
      {!online && (
        <aside className="inline-alert warning" role="status">
          <UiText text="Нет подключения к сети. Проверенные данные остаются видимыми, но загрузка страниц и изменения отключены." /></aside>
      )}
      {degraded && (
        <aside className="inline-alert warning" role="status">
          <UiText text="Часть данных команды недоступна. Каждый список ниже показывает своё фактическое состояние; непроверенные partial-страницы не отображаются." /></aside>
      )}
      {!projectCatalogValid && (
        <aside className="inline-alert danger" role="alert">
          <UiText text="Каталог проектов не прошёл tenant-проверку или превышает безопасный предел. Данные команды остаются видимыми, но приглашения и изменения отключены до обновления контекста." /></aside>
      )}
      {restriction && (
        <aside className="status-banner" role="status">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong><UiText text="Управление командой недоступно" /></strong>
            <p>{restriction}</p>
          </div>
        </aside>
      )}
      {feedback && (
        <div
          className={`inline-alert ${feedback.tone}`}
          ref={feedbackRef}
          role={feedback.tone === "danger" ? "alert" : "status"}
          tabIndex={-1}
        >
          {<UiText text={feedback.message ?? ""} />}
          {feedback.requestId && (
            <small className="error-reference">
              <UiText text="Код запроса:" after=" " />{feedback.requestId}
            </small>
          )}
        </div>
      )}

      {roleAllowsManage && (
        <section className="panel security-card team-invite-card">
          <header className="security-card-header">
            <div>
              <h2><UiText text="Пригласить участника" /></h2>
              <p>
                <UiText text="Ссылка действует 7 дней. Новый участник получит выбранную роль и выбранный ниже доступ к проектам рабочей области." /></p>
            </div>
            <span className="security-status"><UiText text="7 дней" /></span>
          </header>
          <form
            className="security-flow team-invite-form"
            id="team-invite-form"
            onSubmit={submitInvite}
          >
            <div className="form-row">
              <label className="form-field">
                <span>Email</span>
                <input
                  aria-describedby={
                    inviteErrors.email ? "team-invite-email-error" : undefined
                  }
                  aria-invalid={Boolean(inviteErrors.email)}
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={
                    !statusAllowsManage ||
                    Boolean(runtimeRestriction) ||
                    Boolean(operation)
                  }
                  inputMode="email"
                  maxLength={320}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteErrors({});
                    setFeedback(undefined);
                  }}
                  placeholder="member@example.com"
                  required
                  type="email"
                  value={inviteEmail}
                />
                {inviteErrors.email && (
                  <small className="field-error" id="team-invite-email-error">
                    {inviteErrors.email}
                  </small>
                )}
              </label>
              <label className="form-field">
                <span><UiText text="Системная роль" /></span>
                <CustomSelect
                  aria-describedby={
                    inviteErrors.roleCode ? "team-invite-role-error" : undefined
                  }
                  aria-invalid={Boolean(inviteErrors.roleCode)}
                  disabled={
                    !statusAllowsManage ||
                    Boolean(runtimeRestriction) ||
                    Boolean(operation)
                  }
                  onChange={(event) => {
                    setInviteRole(event.target.value as AssignableWorkspaceRoleCode);
                    setInviteErrors({});
                    setFeedback(undefined);
                  }}
                  value={inviteRole}
                >
                  {assignableWorkspaceRoleCodes.map((roleCode) => (
                    <option key={roleCode} value={roleCode}>
                      {<UiText text={workspaceRoleLabel(roleCode) ?? ""} />}
                    </option>
                  ))}
                </CustomSelect>
                {inviteErrors.roleCode && (
                  <small className="field-error" id="team-invite-role-error">
                    {inviteErrors.roleCode}
                  </small>
                )}
              </label>
            </div>
            <label className="form-field">
              <span><UiText text="Сообщение участнику (необязательно)" /></span>
              <textarea
                aria-describedby={
                  inviteErrors.message ? "team-invite-message-error" : undefined
                }
                aria-invalid={Boolean(inviteErrors.message)}
                disabled={
                  !statusAllowsManage ||
                  Boolean(runtimeRestriction) ||
                  Boolean(operation)
                }
                maxLength={2_000}
                onChange={(event) => {
                  setInviteMessage(event.target.value);
                  setInviteErrors({});
                  setFeedback(undefined);
                }}
                placeholder={uiText("Например: присоединяйтесь к SEO-команде проекта")}
                rows={3}
                value={inviteMessage}
              />
              <small>{inviteMessage.length} <UiText text="из 2 000" before=" " /></small>
              {inviteErrors.message && (
                <small className="field-error" id="team-invite-message-error">
                  {<UiText text={inviteErrors.message ?? ""} />}
                </small>
              )}
            </label>
            <ProjectAccessEditor
              allProjects={inviteAllProjects}
              assignments={inviteProjectAccesses}
              disabled={
                !statusAllowsManage ||
                Boolean(runtimeRestriction) ||
                Boolean(operation)
              }
              error={inviteErrors.projectAccesses}
              idPrefix="team-invite-project-access"
              onAllProjectsChange={(value) => {
                setInviteAllProjects(value);
                setInviteErrors({});
                setFeedback(undefined);
              }}
              onAssignmentsChange={(value) => {
                setInviteProjectAccesses(value);
                setInviteErrors({});
                setFeedback(undefined);
              }}
              projects={safeProjects}
              workspaceId={workspace.id}
            />
            <footer className="team-invite-actions">
              <span>
                <UiText text="Участник увидит приглашение в приложении и сможет принять или отклонить его." /></span>
              <button
                className="primary-button"
                disabled={!canMutate}
                type="submit"
              >
                {operation === "invite:create"
                  ? <UiText text="Создаём приглашение…" />
                  : <UiText text="Отправить приглашение" />}
              </button>
            </footer>
          </form>
        </section>
      )}

      <MembersPanel
        canMutate={canMutate}
        currentUserId={currentUserId}
        operation={operation}
        onLoadMore={() => void loadMoreMembers()}
        onReload={() => void reloadMembers()}
        onRemove={(member) => {
          setConfirmation({
            kind: "remove-member",
            member,
            self: member.userId === currentUserId
          });
          setConfirmationError(undefined);
        }}
        onUpdate={requestMemberUpdate}
        online={online}
        projects={safeProjects}
        state={members}
        workspaceId={workspace.id}
      />

      <InvitesPanel
        canMutate={canMutate}
        onLoadMore={() => void loadMoreInvites()}
        onReload={() => void reloadInvites()}
        onRevoke={(invite) => {
          setConfirmation({ kind: "revoke-invite", invite });
          setConfirmationError(undefined);
        }}
        online={online}
        operation={operation}
        state={invites}
      />

      {confirmation && (
        <TeamConfirmationDialog
          blocked={!mutationBoundaryAllows}
          busy={Boolean(operation)}
          confirmation={confirmation}
          error={confirmationError}
          offline={!online}
          onCancel={() => {
            if (operation) return;
            setConfirmation(undefined);
            setConfirmationError(undefined);
          }}
          onConfirm={() => void confirmAction()}
          workspaceName={workspace.name}
        />
      )}
    </div>
  );
}

function MembersPanel({
  canMutate,
  currentUserId,
  online,
  operation,
  projects,
  state,
  workspaceId,
  onLoadMore,
  onReload,
  onRemove,
  onUpdate
}: Readonly<{
  canMutate: boolean;
  currentUserId: string;
  online: boolean;
  operation: string | undefined;
  projects: readonly AppProject[];
  state: TeamCollectionState<WorkspaceMemberSummary>;
  workspaceId: string;
  onLoadMore: () => void;
  onReload: () => void;
  onRemove: (member: WorkspaceMemberSummary) => void;
  onUpdate: (
    member: WorkspaceMemberSummary,
    input: UpdateWorkspaceMemberInput
  ) => void;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <section className="panel security-card">
      <header className="security-card-header">
        <div>
          <h2><UiText text="Участники" /></h2>
          <p>
            <UiText text="Системная роль определяет возможности в рабочей области, а роль в каждом проекте может только сузить эти права." /></p>
        </div>
        {state.phase === "ready" && (
          <span className="security-status on">
            {state.value.items.length}
            {state.value.nextCursor ? "+" : ""}
          </span>
        )}
      </header>
      <CollectionBody
        emptyCopy="После создания workspace здесь должен быть хотя бы один владелец."
        emptyTitle="Участники не найдены"
        entityLabel="участников"
        onReload={onReload}
        online={online}
        state={state}
      >
        {(items) => (
          <ul className="session-list">
            {items.map((member) => (
              <MemberRow
                canMutate={canMutate}
                current={member.userId === currentUserId}
                key={member.id}
                member={member}
                onRemove={() => onRemove(member)}
                onUpdate={(input) => onUpdate(member, input)}
                operation={operation}
                projects={projects}
                workspaceId={workspaceId}
              />
            ))}
          </ul>
        )}
      </CollectionBody>
      {state.phase === "ready" && state.value.nextCursor && (
        <CollectionContinuation
          failure={state.continuationFailure}
          disabled={Boolean(operation)}
          label={uiText("участников")}
          loading={state.loadingMore}
          onLoadMore={onLoadMore}
          online={online}
        />
      )}
    </section>
  );
}

function InvitesPanel({
  canMutate,
  online,
  operation,
  state,
  onLoadMore,
  onReload,
  onRevoke
}: Readonly<{
  canMutate: boolean;
  online: boolean;
  operation: string | undefined;
  state: TeamCollectionState<WorkspaceInviteSummary>;
  onLoadMore: () => void;
  onReload: () => void;
  onRevoke: (invite: WorkspaceInviteSummary) => void;
}>) {
  const { t: uiText } = useUiLocale();
  return (
    <section className="panel security-card">
      <header className="security-card-header">
        <div>
          <h2><UiText text="Ожидающие приглашения" /></h2>
          <p>
            <UiText text="Приглашения, которые ещё можно принять." /></p>
        </div>
        {state.phase === "ready" && (
          <span className="security-status">
            {state.value.items.length}
            {state.value.nextCursor ? "+" : ""}
          </span>
        )}
      </header>
      <CollectionBody
        emptyCopy="Новые приглашения появятся здесь до принятия, отзыва или истечения срока."
        emptyTitle="Ожидающих приглашений нет"
        entityLabel="приглашения"
        onReload={onReload}
        online={online}
        state={state}
      >
        {(items) => (
          <ul className="session-list">
            {items.map((invite) => (
              <InviteRow
                canMutate={canMutate}
                invite={invite}
                key={invite.id}
                onRevoke={() => onRevoke(invite)}
                operation={operation}
              />
            ))}
          </ul>
        )}
      </CollectionBody>
      {state.phase === "ready" && state.value.nextCursor && (
        <CollectionContinuation
          failure={state.continuationFailure}
          disabled={Boolean(operation)}
          label={uiText("приглашений")}
          loading={state.loadingMore}
          onLoadMore={onLoadMore}
          online={online}
        />
      )}
    </section>
  );
}

function CollectionBody<Data>({
  children,
  emptyCopy,
  emptyTitle,
  entityLabel,
  online,
  state,
  onReload
}: Readonly<{
  children: (items: readonly Data[]) => React.ReactNode;
  emptyCopy: string;
  emptyTitle: string;
  entityLabel: string;
  online: boolean;
  state: TeamCollectionState<Data>;
  onReload: () => void;
}>) {
  if (state.phase === "loading") {
    return (
      <div className="session-loading" role="status">
        <span aria-hidden="true" className="spinner" />
        <div>
          <strong><UiText text="Загружаем" after=" " /><UiText text={entityLabel} />…</strong>
          <p><UiText text="Получаем проверенную страницу из Platform API." /></p>
        </div>
      </div>
    );
  }
  if (state.phase === "integrity") {
    return (
      <div className="panel-empty compact session-empty" role="alert">
        <span aria-hidden="true" className="state-icon">
          !
        </span>
        <strong><UiText text="Список скрыт из-за ошибки целостности" /></strong>
        <p>
          <UiText text="Cursor или строки страницы несогласованы. Partial-данные не показываются; загрузите список с начала." /></p>
        <button
          className="primary-button"
          disabled={!online}
          onClick={onReload}
          type="button"
        >
          <UiText text="Загрузить заново" /></button>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="panel-empty compact session-empty">
        <span aria-hidden="true" className="state-icon">
          !
        </span>
        <strong><UiText text="Не удалось загрузить" after=" " /><UiText text={entityLabel} /></strong>
        <p>{<UiText text={state.failure.message ?? ""} />}</p>
        {state.failure.requestId && (
          <small className="error-reference">
            <UiText text="Код запроса:" after=" " />{state.failure.requestId}
          </small>
        )}
        <button
          className="primary-button"
          disabled={!online}
          onClick={onReload}
          type="button"
        >
          <UiText text="Повторить" /></button>
      </div>
    );
  }
  if (state.value.items.length === 0) {
    return (
      <div className="panel-empty compact session-empty">
        <span aria-hidden="true" className="state-icon">
          0
        </span>
        <strong><UiText text={emptyTitle} /></strong>
        <p><UiText text={emptyCopy} /></p>
      </div>
    );
  }
  return children(state.value.items);
}

function CollectionContinuation({
  disabled,
  failure,
  label,
  loading,
  online,
  onLoadMore
}: Readonly<{
  disabled: boolean;
  failure: TeamFailure | undefined;
  label: string;
  loading: boolean;
  online: boolean;
  onLoadMore: () => void;
}>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const target = buttonRef.current;
    if (!target || disabled || loading || !online || failure) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: "280px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [disabled, failure, loading, onLoadMore, online]);
  return (
    <footer className="security-flow">
      <div
        className={`inline-alert ${failure ? "warning" : "info"}`}
        role={failure ? "alert" : "status"}
      >
        {failure
          ? <UiText text="Показана только проверенная часть списка: {0}" values={[String(failure.message)]} />
          : <UiText text="Есть ещё {0}. Текущая страница — проверенная, но список пока неполный." values={[String(label)]} />}
        {failure?.requestId && (
          <small className="error-reference">
            <UiText text="Код запроса:" after=" " />{failure.requestId}
          </small>
        )}
      </div>
      <button
        className="secondary-button"
        disabled={!online || loading || disabled}
        onClick={onLoadMore}
        ref={buttonRef}
        type="button"
      >
        {loading
          ? <UiText text="Загружаем…" />
          : failure
            ? <UiText text="Повторить страницу" />
            : <UiText text="Загрузить ещё" />}
      </button>
    </footer>
  );
}

function ProjectAccessEditor({
  allProjects,
  assignments,
  disabled,
  error,
  idPrefix,
  projects,
  workspaceId,
  onAllProjectsChange,
  onAssignmentsChange
}: Readonly<{
  allProjects: boolean;
  assignments: readonly ProjectAccessAssignment[];
  disabled: boolean;
  error: string | undefined;
  idPrefix: string;
  projects: readonly AppProject[];
  workspaceId: string;
  onAllProjectsChange: (value: boolean) => void;
  onAssignmentsChange: (value: readonly ProjectAccessAssignment[]) => void;
}>) {
  const { t: uiText } = useUiLocale();
  const [search, setSearch] = useState("");
  const choices = useMemo(
    () => teamProjectChoices(projects, workspaceId, assignments, search),
    [assignments, projects, search, workspaceId]
  );
  const assignmentByProject = useMemo(
    () =>
      new Map(
        assignments.map(({ projectId, level }) => [projectId, level] as const)
      ),
    [assignments]
  );
  const explicitCount = allProjects
    ? assignments.length
    : assignments.filter(({ level }) => level !== "NONE").length;
  const errorId = `${idPrefix}-error`;

  function changeProject(projectId: string, value: string): void {
    const level = projectAccessValue(value);
    onAssignmentsChange(
      setTeamProjectAccess(
        { allProjects, projectAccesses: assignments },
        projectId,
        level
      )
    );
  }

  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      aria-invalid={Boolean(error)}
      className="team-project-access"
      id={idPrefix}
      tabIndex={error ? -1 : undefined}
    >
      <legend><UiText text="Доступ к проектам" /></legend>
      <label className="checkbox-field team-project-access-toggle">
        <input
          checked={allProjects}
          disabled={disabled}
          onChange={(event) => onAllProjectsChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong><UiText text="Все текущие и будущие проекты" /></strong>
          <small>
            <UiText text="Выключите, чтобы разрешить только явно выбранные проекты. Для каждого проекта можно назначить более узкую роль." /></small>
        </span>
      </label>
      <label className="form-field">
        <span><UiText text="Поиск проекта" /></span>
        <input
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={uiText("Название, домен или ID")}
          type="search"
          value={search}
        />
      </label>
      <p className="session-network-metadata team-project-access-summary" role="status">
        <span><UiText text="В текущем контексте:" after=" " />{projects.length}</span>
        <span><UiText text="Явных назначений:" after=" " />{explicitCount}</span>
        <span><UiText text="Найдено:" after=" " />{choices.totalMatches}</span>
      </p>
      {choices.truncated && (
        <div className="inline-alert info" role="status">
          <UiText text="Показаны первые 50 совпадений из" after=" " />{choices.totalMatches}<UiText text=". Уточните поиск — остальные проекты не удаляются и не теряются." /></div>
      )}
      {choices.items.length === 0 ? (
        <div className="panel-empty compact session-empty">
          <strong><UiText text="Проекты не найдены" /></strong>
          <p>
            <UiText text="Измените запрос или оставьте правило доступа ко всем проектам." /></p>
        </div>
      ) : (
        <ul className="team-project-access-list">
          {choices.items.map((project) => {
            const level = assignmentByProject.get(project.id);
            return (
              <li className="team-project-access-row" key={project.id}>
                <div className="team-project-access-copy">
                  <div className="session-row-title">
                    <strong>{project.name}</strong>
                    {!project.listed && (
                      <span className="security-status"><UiText text="Вне подборки" /></span>
                    )}
                    {project.status === "ARCHIVED" && (
                      <span className="security-status"><UiText text="Архив" /></span>
                    )}
                  </div>
                  <div className="session-network-metadata">
                    {project.domain && <span>{project.domain}</span>}
                  </div>
                </div>
                <label className="form-field">
                  <span><UiText text="Роль в проекте" /></span>
                  <CustomSelect
                    aria-label={uiText("Доступ к проекту {0}", [String(project.name)])}
                    disabled={disabled}
                    onChange={(event) =>
                      changeProject(project.id, event.target.value)
                    }
                    value={level ?? (allProjects ? "INHERIT" : "NONE")}
                  >
                    {allProjects && (
                      <option value="INHERIT">
                        <UiText text="По системной роли" /></option>
                    )}
                    {projectAccessLevels.map((accessLevel) => (
                      <option key={accessLevel} value={accessLevel}>
                        {<UiText text={projectAccessLabel(accessLevel) ?? ""} />}
                      </option>
                    ))}
                  </CustomSelect>
                  <small>
                    <UiText text={projectAccessDescription(
                      level ?? (allProjects ? "INHERIT" : "NONE")
                    )} />
                  </small>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <small className="field-error" id={errorId}>
          {<UiText text={error ?? ""} />}
        </small>
      )}
    </fieldset>
  );
}

function MemberRow({
  canMutate,
  current,
  member,
  operation,
  projects,
  workspaceId,
  onRemove,
  onUpdate
}: Readonly<{
  canMutate: boolean;
  current: boolean;
  member: WorkspaceMemberSummary;
  operation: string | undefined;
  projects: readonly AppProject[];
  workspaceId: string;
  onRemove: () => void;
  onUpdate: (input: UpdateWorkspaceMemberInput) => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [roleCode, setRoleCode] = useState(member.roleCode);
  const [allProjects, setAllProjects] = useState(member.allProjects);
  const [projectAccesses, setProjectAccesses] = useState(
    member.projectAccesses
  );
  const [accessExpanded, setAccessExpanded] = useState(false);
  const owner = member.roleCode === "OWNER";
  const busy = operation?.endsWith(member.id) ?? false;
  const accessDraft = { allProjects, projectAccesses };
  const projectAccessError = validateTeamProjectAccess(accessDraft);
  const input = owner
    ? undefined
    : teamMemberUpdateInput(
        roleCode as AssignableWorkspaceRoleCode,
        accessDraft
      );
  const dirty = input ? !sameTeamMemberInput(member, input) : false;

  useEffect(() => {
    setRoleCode(member.roleCode);
    setAllProjects(member.allProjects);
    setProjectAccesses(member.projectAccesses);
    setAccessExpanded(false);
  }, [
    member.allProjects,
    member.id,
    member.projectAccesses,
    member.roleCode,
    member.version
  ]);

  return (
    <li className={current ? "session-row current" : "session-row"}>
      <span aria-hidden="true" className="session-device-mark">
        {memberInitials(member.displayName)}
      </span>
      <div className="session-row-copy">
        <div className="session-row-title">
          <strong>{member.displayName}</strong>
          {current && <span className="security-status on"><UiText text="Вы" /></span>}
          {member.status === "SUSPENDED" && (
            <span className="security-status"><UiText text="Приостановлен" /></span>
          )}
        </div>
        <div className="session-network-metadata">
          <span>{member.email}</span>
          <span>{<UiText text={memberProjectAccessLabel(member) ?? ""} />}</span>
          {member.joinedAt && (
            <span>
              <UiText text="В команде с" />{" "}
              <time dateTime={member.joinedAt}>
                {formatTeamDate(member.joinedAt, uiLocale)}
              </time>
            </span>
          )}
        </div>
        <label className="form-field">
          <span><UiText text="Системная роль" /></span>
          <CustomSelect
            aria-label={uiText("Роль участника {0}", [String(member.email)])}
            disabled={!canMutate || owner || Boolean(operation)}
            onChange={(event) => setRoleCode(event.target.value)}
            value={roleCode}
          >
            {owner && <option value="OWNER"><UiText text="Владелец" /></option>}
            {assignableWorkspaceRoleCodes.map((role) => (
              <option key={role} value={role}>
                {<UiText text={workspaceRoleLabel(role) ?? ""} />}
              </option>
            ))}
          </CustomSelect>
          {owner && (
            <small>
              <UiText text="Чтобы изменить роль владельца или удалить его из команды, сначала передайте владение другому участнику." /></small>
          )}
        </label>
        {!owner && (
          <>
            <button
              aria-controls={`member-project-access-${member.id}`}
              aria-expanded={accessExpanded}
              className="secondary-button"
              disabled={Boolean(operation)}
              onClick={() => setAccessExpanded((value) => !value)}
              type="button"
            >
              {accessExpanded ? <UiText text="Скрыть доступ к проектам" /> : <UiText text="Настроить доступ к проектам" />}
            </button>
            {accessExpanded && (
              <ProjectAccessEditor
                allProjects={allProjects}
                assignments={projectAccesses}
                disabled={!canMutate || Boolean(operation)}
                error={projectAccessError}
                idPrefix={`member-project-access-${member.id}`}
                onAllProjectsChange={setAllProjects}
                onAssignmentsChange={setProjectAccesses}
                projects={projects}
                workspaceId={workspaceId}
              />
            )}
            <div className="security-actions">
              <button
                className="secondary-button"
                disabled={
                  !canMutate ||
                  !dirty ||
                  Boolean(projectAccessError) ||
                  Boolean(operation)
                }
                onClick={() => {
                  if (input) onUpdate(input);
                }}
                type="button"
              >
                {busy && operation?.startsWith("member:update")
                  ? <UiText text="Сохраняем…" />
                  : <UiText text="Сохранить роль и доступ" />}
              </button>
              <button
                className="danger-button"
                disabled={!canMutate || Boolean(operation)}
                onClick={onRemove}
                type="button"
              >
                {busy && operation?.startsWith("member:remove")
                  ? <UiText text="Удаляем…" />
                  : current
                    ? <UiText text="Покинуть workspace" />
                    : <UiText text="Удалить участника" />}
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function InviteRow({
  canMutate,
  invite,
  operation,
  onRevoke
}: Readonly<{
  canMutate: boolean;
  invite: WorkspaceInviteSummary;
  operation: string | undefined;
  onRevoke: () => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const busy = operation === `invite:revoke:${invite.id}`;
  return (
    <li className="session-row">
      <span aria-hidden="true" className="session-device-mark unknown">
        @
      </span>
      <div className="session-row-copy">
        <div className="session-row-title">
          <strong>{invite.email}</strong>
          <span className="security-status">
            {invite.status === "DELIVERED" ? <UiText text="Доставлено" /> : <UiText text="Отправлено" />}
          </span>
        </div>
        <div className="session-network-metadata">
          <span>{<UiText text={workspaceRoleLabel(invite.roleCode) ?? ""} />}</span>
          <span>
            {invite.allProjects ? <UiText text="Все проекты" /> : <UiText text="Ограниченный доступ" />}
          </span>
          <span>
            <UiText text="Истекает" />{" "}
            <time dateTime={invite.expiresAt}>
              {formatTeamDate(invite.expiresAt, uiLocale)}
            </time>
          </span>
        </div>
        <div className="security-actions">
          <button
            className="danger-button"
            disabled={!canMutate || Boolean(operation)}
            onClick={onRevoke}
            type="button"
          >
            {busy ? <UiText text="Отзываем…" /> : <UiText text="Отозвать приглашение" />}
          </button>
        </div>
      </div>
    </li>
  );
}

function TeamConfirmationDialog({
  blocked,
  busy,
  confirmation,
  error,
  offline,
  workspaceName,
  onCancel,
  onConfirm
}: Readonly<{
  blocked: boolean;
  busy: boolean;
  confirmation: TeamConfirmation;
  error: TeamFailure | undefined;
  offline: boolean;
  workspaceName: string;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const presentation = confirmationPresentation(confirmation, workspaceName);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled)"
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="session-dialog-backdrop">
      <div
        aria-describedby="team-confirmation-description"
        aria-labelledby="team-confirmation-title"
        aria-modal="true"
        className="session-dialog"
        onKeyDown={trapFocus}
        ref={dialog}
        role="alertdialog"
      >
        <span aria-hidden="true" className="session-dialog-mark">
          !
        </span>
        <div>
          <h3 id="team-confirmation-title"><UiText text={presentation.title} /></h3>
          <p id="team-confirmation-description"><UiText text={presentation.description} /></p>
        </div>
        {error && (
          <div className="inline-alert danger session-dialog-error" role="alert">
            {<UiText text={error.message ?? ""} />}
            {error.requestId && (
              <small className="error-reference">
                <UiText text="Код запроса:" after=" " />{error.requestId}
              </small>
            )}
          </div>
        )}
        {!error && offline && (
          <div className="inline-alert warning session-dialog-error" role="status">
            <UiText text="Нет подключения. Отмените действие или повторите после восстановления сети." /></div>
        )}
        {!error && !offline && blocked && (
          <div className="inline-alert warning session-dialog-error" role="status">
            <UiText text="Действие больше недоступно: права или состояние workspace изменились. Закройте подтверждение и обновите список." /></div>
        )}
        <div className="session-dialog-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
            ref={cancelButton}
            type="button"
          >
            <UiText text="Отмена" /></button>
          <button
            className="danger-button"
            disabled={busy || offline || blocked}
            onClick={onConfirm}
            type="button"
          >
            <UiText text={busy ? presentation.busyLabel : presentation.confirmLabel} />
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmationPresentation(
  confirmation: TeamConfirmation,
  workspaceName: string
): {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
} {
  if (confirmation.kind === "update-member") {
    const access = memberProjectAccessLabel(confirmation.input);
    return {
      title: confirmation.self
        ? "Изменить собственные роль и доступ?"
        : `Изменить роль и доступ ${confirmation.member.email}?`,
      description: confirmation.self
        ? `В workspace «${workspaceName}» ваша роль изменится с «${workspaceRoleLabel(confirmation.member.roleCode)}» на «${workspaceRoleLabel(confirmation.input.roleCode)}», доступ к проектам: ${access}. Вы можете сразу потерять права управления или доступ к проектам.`
        : `Для ${confirmation.member.displayName} (${confirmation.member.email}) будет установлена роль «${workspaceRoleLabel(confirmation.input.roleCode)}» и доступ: ${access}. Изменение применяется сразу ко всем активным сессиям.`,
      confirmLabel: confirmation.self
        ? "Изменить мои роль и доступ"
        : "Изменить роль и доступ",
      busyLabel: "Сохраняем…"
    };
  }
  if (confirmation.kind === "remove-member") {
    return {
      title: confirmation.self
        ? `Покинуть workspace «${workspaceName}»?`
        : `Удалить ${confirmation.member.email} из workspace?`,
      description: confirmation.self
        ? `Ваш доступ к «${workspaceName}» и назначенным проектам будет отозван сразу. Для возврата потребуется новое приглашение. Исторические авторские данные сохранятся.`
        : `Доступ ${confirmation.member.displayName} (${confirmation.member.email}) к «${workspaceName}» и назначенным проектам будет отозван сразу. Исторические авторские данные сохранятся.`,
      confirmLabel: confirmation.self
        ? "Покинуть workspace"
        : "Удалить участника",
      busyLabel: "Удаляем…"
    };
  }
  return {
    title: `Отозвать приглашение для ${confirmation.invite.email}?`,
    description: `Ссылка для ${confirmation.invite.email} перестанет работать сразу. Чтобы пригласить пользователя снова, потребуется создать новое приглашение.`,
    confirmLabel: "Отозвать приглашение",
    busyLabel: "Отзываем…"
  };
}

async function loadMemberPage(
  workspaceId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const collection = await browserApiCollectionRequest<unknown>(
    workspaceTeamListPath(workspaceId, "members", cursor),
    signal ? { signal } : {}
  );
  return workspaceMemberPage(collection, workspaceId, cursor);
}

async function loadInvitePage(
  workspaceId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  const collection = await browserApiCollectionRequest<unknown>(
    workspaceTeamListPath(workspaceId, "invites", cursor),
    signal ? { signal } : {}
  );
  return pendingWorkspaceInvitePage(collection, workspaceId, cursor);
}

function readyCollection<Data extends { readonly id: string }>(
  page: Parameters<typeof firstTeamCollection<Data>>[0]
): TeamCollectionState<Data> {
  return {
    phase: "ready",
    value: firstTeamCollection(page),
    loadingMore: false
  };
}

function invitePath(workspaceId: string): string {
  return `/app/api/workspaces/${encodeURIComponent(workspaceId)}/invites`;
}

function inviteItemPath(workspaceId: string, inviteId: string): string {
  return `${invitePath(workspaceId)}/${encodeURIComponent(inviteId)}`;
}

function memberPath(workspaceId: string, memberId: string): string {
  return `/app/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`;
}

function inviteApiFieldErrors(error: unknown): TeamInviteFieldErrors {
  if (!(error instanceof BrowserApiError)) return {};
  const errors: {
    email?: string;
    roleCode?: string;
    projectAccesses?: string;
    message?: string;
  } = {};
  for (const fieldError of error.fieldErrors) {
    const path = fieldError.path.split(".");
    const field = path.at(-1);
    if (field === "email") errors.email = "Проверьте email.";
    if (field === "roleCode") errors.roleCode = "Выберите доступную роль.";
    if (field === "message") {
      errors.message = "Сообщение должно быть не длиннее 2 000 символов.";
    }
    if (
      path.includes("projectAccesses") ||
      path.includes("allProjects")
    ) {
      errors.projectAccesses =
        "Проверьте выбранные проекты и уровни доступа.";
    }
  }
  return errors;
}

function teamFailure(
  error: unknown,
  online: boolean,
  entityLabel: string
): TeamFailure {
  if (!online) {
    return {
      message: `Нет подключения к сети. Не удалось обработать ${entityLabel}.`
    };
  }
  if (error instanceof TeamCollectionIntegrityError) {
    return { message: error.message };
  }
  if (!(error instanceof BrowserApiError)) {
    return {
      message: `Не удалось обработать ${entityLabel}. Повторите попытку.`
    };
  }
  const withRequestId = (message: string): TeamFailure => ({
    message,
    ...(error.requestId ? { requestId: error.requestId } : {})
  });
  if (error.status === 401) {
    return withRequestId("Сессия истекла. Обновите страницу и войдите снова.");
  }
  if (error.status === 403) {
    return withRequestId(
      "Недостаточно прав. Список переведён в безопасный режим без изменений."
    );
  }
  if (error.status === 402 || error.code === "PAYMENT_REQUIRED") {
    return withRequestId(
      "Рабочая область доступна только для чтения. Изменение не отправлено."
    );
  }
  if (error.status === 404) {
    return withRequestId(
      "Объект больше недоступен. Обновите список и повторите действие."
    );
  }
  if (isVersionConflict(error)) {
    return withRequestId(
      "Участник изменён другим администратором. Загружается актуальная версия."
    );
  }
  if (error.code === "DUPLICATE") {
    return withRequestId(
      "Участник уже состоит в workspace или для этого email уже есть активное приглашение."
    );
  }
  if (error.code === "QUOTA_EXCEEDED") {
    return withRequestId(
      "Достигнут лимит участников тарифа. Увеличьте его в разделе «Тариф и оплата»."
    );
  }
  if (error.status === 409) {
    return withRequestId(
      "Состояние объекта изменилось и действие больше неприменимо. Обновите список и повторите попытку."
    );
  }
  if (error.status === 422 || error.fieldErrors.length > 0) {
    return withRequestId("Проверьте введённые данные и повторите действие.");
  }
  if (error.status >= 500 || error.retryable) {
    return withRequestId(
      `Сервис временно недоступен. Не удалось обработать ${entityLabel}.`
    );
  }
  return withRequestId(`Не удалось обработать ${entityLabel}.`);
}

function teamRestrictionMessage(
  workspace: AppWorkspace,
  roleAllowsManage: boolean,
  runtimeRestriction: "MISSING_PERMISSION" | "WORKSPACE_READ_ONLY" | undefined
): string | undefined {
  if (runtimeRestriction === "MISSING_PERMISSION" || !roleAllowsManage) {
    return "Список доступен только для просмотра. Для приглашений и изменений требуются member.invite, member.update и member.remove.";
  }
  if (
    runtimeRestriction === "WORKSPACE_READ_ONLY" ||
    workspace.status === "READ_ONLY"
  ) {
    return "Workspace переведён в режим только для чтения. Просмотр команды остаётся доступным.";
  }
  if (workspace.status === "SUSPENDED") {
    return "Workspace приостановлен. Изменения команды заблокированы до восстановления доступа.";
  }
  return undefined;
}

function redirectExpiredTeamSession(error: unknown): boolean {
  if (!(error instanceof BrowserApiError) || error.status !== 401) return false;
  window.location.assign(
    `/app/auth/refresh?returnTo=${encodeURIComponent("/app/settings/team")}`
  );
  return true;
}

function isForbidden(error: unknown): boolean {
  return error instanceof BrowserApiError && error.status === 403;
}

function isTeamListIntegrityError(error: unknown): boolean {
  return (
    error instanceof TeamCollectionIntegrityError ||
    (error instanceof BrowserApiError && error.code === "INVALID_RESPONSE")
  );
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof BrowserApiError &&
    (error.status === 412 || error.code === "VERSION_CONFLICT")
  );
}

function memberInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.at(0)?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

function formatTeamDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function projectAccessValue(value: string): ProjectAccessLevel | undefined {
  if (value === "INHERIT") return undefined;
  if (projectAccessLevels.includes(value as ProjectAccessLevel)) {
    return value as ProjectAccessLevel;
  }
  throw new Error("Unsupported project access level");
}

function projectAccessLabel(level: ProjectAccessLevel): string {
  if (level === "NONE") return "Нет доступа";
  if (level === "VIEWER") return "Наблюдатель";
  if (level === "MEMBER") return "Участник";
  return "Менеджер проекта";
}

function projectAccessDescription(
  level: ProjectAccessLevel | "INHERIT"
): string {
  if (level === "INHERIT") return "Права определяет системная роль.";
  if (level === "NONE") return "Проект скрыт и недоступен.";
  if (level === "VIEWER") return "Просмотр данных без изменений.";
  if (level === "MEMBER") return "Работа с данными в рамках системной роли.";
  return "Управление проектом и его участниками в рамках системной роли.";
}

function clearTenantPreference(name: string): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
