"use client";

import type {
  ProjectTransferRequestSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import { useEffect, useState } from "react";
import {
  loadProjectTransferWorkspaces,
  projectTransferDestinations
} from "../lib/project-transfers";
import { CustomSelect } from "./custom-select";
import { useUiLocale, UiText } from "./ui-locale";


export function ProjectTransferNotificationList({
  transfers,
  busyTransferId,
  compact = false,
  onAccept,
  onDecline
}: Readonly<{
  transfers: readonly ProjectTransferRequestSummary[];
  busyTransferId?: string;
  compact?: boolean;
  onAccept: (
    transfer: ProjectTransferRequestSummary,
    destinationWorkspaceId: string
  ) => void;
  onDecline: (transfer: ProjectTransferRequestSummary) => void;
}>) {
  const uiLocale = useUiLocale().locale;
  const { t: uiText } = useUiLocale();
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [workspaceFailure, setWorkspaceFailure] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [destinations, setDestinations] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (transfers.length === 0) {
      setLoadingWorkspaces(false);
      return;
    }
    const controller = new AbortController();
    setLoadingWorkspaces(true);
    setWorkspaceFailure(false);
    void loadProjectTransferWorkspaces(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setWorkspaces(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWorkspaceFailure(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWorkspaces(false);
      });
    return () => controller.abort();
  }, [transfers.length]);

  if (transfers.length === 0) return null;
  return (
    <section
      aria-label={uiText("Запросы на передачу проектов")}
      className={compact ? "workspace-invites compact" : "panel workspace-invites"}
    >
      <header>
        <div>
          <span><UiText text="Входящие запросы" /></span>
          <h2><UiText text="Передача проекта" /></h2>
        </div>
        <strong>{transfers.length}</strong>
      </header>
      <div className="workspace-invite-list">
        {transfers.map((transfer) => {
          const busy = busyTransferId === transfer.id;
          const processing = transfer.status === "PROCESSING";
          const availableDestinations = projectTransferDestinations(
            workspaces,
            transfer
          );
          const destinationWorkspaceId =
            destinations[transfer.id] ?? availableDestinations[0]?.id ?? "";
          return (
            <article className="workspace-invite-card project-transfer-notification" key={transfer.id}>
              <div className="workspace-invite-mark" aria-hidden="true">→</div>
              <div className="workspace-invite-copy">
                <span>{transfer.fromDisplayName} <UiText text="передаёт вам проект" before=" " /></span>
                <h3>{transfer.projectName}</h3>
                <p><UiText text="Из рабочей области:" after=" " />{transfer.workspaceName}</p>
                {processing ? (
                  <TransferProcessing transfer={transfer} />
                ) : (
                  <>
                    <label className="project-transfer-destination">
                      <span><UiText text="Перенести в вашу рабочую область" /></span>
                      <CustomSelect
                        aria-label={uiText("Рабочая область для проекта {0}", [String(transfer.projectName)])}
                        disabled={busy || loadingWorkspaces}
                        onChange={(event) =>
                          setDestinations((current) => ({
                            ...current,
                            [transfer.id]: event.target.value
                          }))
                        }
                        value={destinationWorkspaceId}
                      >
                        {availableDestinations.length === 0 && (
                          <option value="">
                            {loadingWorkspaces
                              ? <UiText text="Загружаем рабочие области…" />
                              : <UiText text="Нет доступной рабочей области" />}
                          </option>
                        )}
                        {availableDestinations.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </CustomSelect>
                    </label>
                    {workspaceFailure && (
                      <small className="project-transfer-warning">
                        <UiText text="Не удалось загрузить рабочие области. Закройте и снова откройте уведомления." /></small>
                    )}
                    {!loadingWorkspaces &&
                      !workspaceFailure &&
                      availableDestinations.length === 0 && (
                        <small className="project-transfer-warning">
                          <UiText text="Нужна другая активная рабочая область, где вы можете создавать проекты." /></small>
                      )}
                    <small>
                      <UiText text="Подтвердить до" />{" "}
                      <time dateTime={transfer.expiresAt}>
                        {formatTransferDate(transfer.expiresAt, uiLocale)}
                      </time>
                    </small>
                    <div className="workspace-invite-actions">
                      <button
                        className="primary-button"
                        disabled={busy || !destinationWorkspaceId}
                        onClick={() =>
                          onAccept(transfer, destinationWorkspaceId)
                        }
                        type="button"
                      >
                        {busy ? <UiText text="Переносим…" /> : <UiText text="Принять и перенести" />}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => onDecline(transfer)}
                        type="button"
                      >
                        <UiText text="Отклонить" /></button>
                    </div>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TransferProcessing({
  transfer
}: Readonly<{ transfer: ProjectTransferRequestSummary }>) {
  return (
    <div className="project-transfer-processing" role="status">
      <span className="spinner compact" aria-hidden="true" />
      <div>
        <strong>
          <UiText text="Переносим в" after=" " />{transfer.destinationWorkspaceName ?? <UiText text="рабочую область" />}
        </strong>
        <small>{processingMessage(transfer.processingErrorCode)}</small>
      </div>
    </div>
  );
}

function processingMessage(errorCode?: string): string {
  if (errorCode === "ACTIVE_OPERATIONS") {
    return "Ожидаем завершения активных операций проекта.";
  }
  if (errorCode === "DEPENDENCY_UNAVAILABLE") {
    return "Один из сервисов временно недоступен. Перенос продолжится автоматически.";
  }
  if (errorCode === "STATE_CHANGED") {
    return "Проверяем доступ и состояние проекта перед завершением.";
  }
  return "Подключения проекта сбрасываются, данные переносятся безопасно.";
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
