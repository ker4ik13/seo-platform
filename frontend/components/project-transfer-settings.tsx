"use client";

import type {
  ProjectTransferRequestSummary,
  WorkspaceMemberSummary
} from "@seo-platform/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { canTransferProject } from "../lib/app-permissions";
import type { AppProject, AppWorkspace } from "../lib/app-types";
import {
  browserApiCollectionRequest,
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { CustomSelect } from "./custom-select";
import { UiText, useUiLocale } from "./ui-locale";


interface TransferFailure {
  readonly message: string;
  readonly requestId?: string;
}

export function ProjectTransferSettings({
  currentUserId,
  project,
  workspace
}: Readonly<{
  currentUserId: string;
  project: AppProject;
  workspace: AppWorkspace;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [members, setMembers] = useState<readonly WorkspaceMemberSummary[]>([]);
  const [transfer, setTransfer] = useState<ProjectTransferRequestSummary | null>();
  const [targetMemberId, setTargetMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"create" | "cancel">();
  const [failure, setFailure] = useState<TransferFailure>();
  const [success, setSuccess] = useState<string>();
  const isOwner = project.ownerUserId === currentUserId;
  const permission = canTransferProject(
    workspace.roleCode,
    project.projectAccessLevel,
    isOwner
  );

  useEffect(() => {
    if (!permission || !isOwner) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void Promise.all([
      browserApiCollectionRequest<WorkspaceMemberSummary>(
        `/app/api/workspaces/${encodeURIComponent(workspace.id)}/members?limit=100`,
        { signal: controller.signal }
      ),
      browserApiRequest<ProjectTransferRequestSummary | null>(
        `/app/api/projects/${encodeURIComponent(project.id)}/transfer`,
        { signal: controller.signal }
      )
    ])
      .then(([memberResult, currentTransfer]) => {
        if (controller.signal.aborted) return;
        setMembers(memberResult.data);
        setTransfer(currentTransfer);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(transferFailure(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isOwner, permission, project.id, workspace.id]);

  const candidates = useMemo(
    () =>
      members.filter(
        (member) =>
          member.status === "ACTIVE" && member.userId !== project.ownerUserId
      ),
    [members, project.ownerUserId]
  );

  if (!permission || !isOwner) return null;

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!targetMemberId || busy) return;
    setBusy("create");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      const created = await browserApiRequest<ProjectTransferRequestSummary>(
        `/app/api/projects/${encodeURIComponent(project.id)}/transfer`,
        { method: "POST", body: { targetMemberId } }
      );
      setTransfer(created);
      setTargetMemberId("");
      setSuccess("Запрос отправлен. Новый владелец должен принять передачу в уведомлениях.");
    } catch (error) {
      setFailure(transferFailure(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancel(): Promise<void> {
    if (!transfer || busy) return;
    setBusy("cancel");
    setFailure(undefined);
    setSuccess(undefined);
    try {
      await browserApiRequest<ProjectTransferRequestSummary>(
        `/app/api/projects/${encodeURIComponent(project.id)}/transfer`,
        { method: "DELETE" }
      );
      setTransfer(null);
      setSuccess("Запрос на передачу отменён.");
    } catch (error) {
      setFailure(transferFailure(error));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="panel security-card project-transfer-card">
      <header className="security-card-header">
        <div>
          <h2><UiText text="Передача проекта" /></h2>
          <p>
            <UiText text="Новый владелец выберет свою рабочую область. После подтверждения подключения проекта будут сброшены, а провайдеры нужно будет настроить заново уже в новой рабочей области." /></p>
        </div>
        <span className="security-status"><UiText text="7 дней" /></span>
      </header>

      {failure && (
        <div className="inline-alert danger" role="alert">
          {<UiText text={failure.message ?? ""} />}
          {failure.requestId && (
            <small className="error-reference"><UiText text="Код запроса:" after=" " />{failure.requestId}</small>
          )}
        </div>
      )}
      {success && <div className="inline-alert success" role="status">{<UiText text={success ?? ""} />}</div>}

      {loading ? (
        <div className="project-transfer-loading" aria-busy="true">
          <span className="spinner compact" />
          <span><UiText text="Проверяем текущий запрос…" /></span>
        </div>
      ) : transfer ? (
        <div
          className={`project-transfer-pending${
            transfer.status === "PROCESSING" ? " processing" : ""
          }`}
        >
          <span aria-hidden="true">→</span>
          <div>
            <small>
              {transfer.status === "PROCESSING"
                ? <UiText text="Безопасный перенос" />
                : <UiText text="Ожидает подтверждения" />}
            </small>
            <strong>{transfer.toDisplayName}</strong>
            <p>
              {transfer.status === "PROCESSING"
                ? <UiText text="Проект переносится в {0}. {1}" values={[String(transfer.destinationWorkspaceName ?? "новую рабочую область"), String(ownerProcessingMessage(transfer.processingErrorCode))]} />
                : (
                  <>
                    {transfer.toEmail} <UiText text="· действует до" before=" " />{" "}
                    <time dateTime={transfer.expiresAt}>
                      {formatTransferDate(transfer.expiresAt, uiLocale)}
                    </time>
                  </>
                )}
            </p>
          </div>
          {transfer.status === "PENDING" && (
            <button
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={() => void cancel()}
              type="button"
            >
              {busy === "cancel" ? <UiText text="Отменяем…" /> : <UiText text="Отменить запрос" />}
            </button>
          )}
        </div>
      ) : candidates.length === 0 ? (
        <p className="project-transfer-empty">
          <UiText text="Для передачи нужен другой активный участник рабочей области." /></p>
      ) : (
        <form className="project-transfer-form" onSubmit={create}>
          <label className="form-field">
            <span><UiText text="Новый владелец" /></span>
            <CustomSelect
              disabled={Boolean(busy)}
              onChange={(event) => setTargetMemberId(event.target.value)}
              searchable
              searchPlaceholder={uiText("Найти участника")}
              value={targetMemberId}
            >
              <option value=""><UiText text="Выберите участника" /></option>
              {candidates.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName} · {member.email}
                </option>
              ))}
            </CustomSelect>
          </label>
          <button
            className="primary-button"
            disabled={!targetMemberId || Boolean(busy)}
            type="submit"
          >
            {busy === "create" ? <UiText text="Отправляем…" /> : <UiText text="Запросить передачу" />}
          </button>
        </form>
      )}
    </section>
  );
}

function transferFailure(error: unknown): TransferFailure {
  if (error instanceof BrowserApiError) {
    return {
      message: error.message,
      ...(error.requestId ? { requestId: error.requestId } : {})
    };
  }
  return { message: "Не удалось изменить запрос на передачу проекта." };
}

function formatTransferDate(value: string, uiLocale: string = "ru-RU"): string {
  return new Intl.DateTimeFormat(uiLocale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function ownerProcessingMessage(errorCode?: string): string {
  if (errorCode === "ACTIVE_OPERATIONS") {
    return "Сначала завершите или остановите активные операции проекта.";
  }
  if (errorCode === "DEPENDENCY_UNAVAILABLE") {
    return "Перенос продолжится автоматически после восстановления сервисов.";
  }
  return "Изменять проект до завершения переноса нельзя.";
}
