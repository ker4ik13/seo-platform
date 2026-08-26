"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { OperationResultKind } from "../lib/operation-result-routes";
import {
  OperationResultWorkspace,
  RankRuntimeDiagnosticsModal,
  type RankRuntimeLogState
} from "./operation-result-workspace";
import { SemanticModal } from "./semantic-modal";
import { UnsavedChangesConfirmation } from "./unsaved-changes-confirmation";

export function OperationResultModal({
  actions,
  kind,
  onClusteringApplied,
  onClose,
  operationId,
  projectId,
  title
}: Readonly<{
  actions?: ReactNode;
  description: string;
  kind: OperationResultKind;
  onClusteringApplied?: () => void;
  onClose: () => void;
  operationId: string;
  projectId: string;
  title: string;
}>) {
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [rankRuntimeLogState, setRankRuntimeLogState] = useState<RankRuntimeLogState>();
  const [rankRuntimeLogOpen, setRankRuntimeLogOpen] = useState(false);

  useEffect(() => {
    setDirty(false);
    setConfirmClose(false);
    setRankRuntimeLogState(undefined);
    setRankRuntimeLogOpen(false);
  }, [kind, operationId]);

  const handleRankRuntimeLogStateChange = useCallback((state?: RankRuntimeLogState) => {
    setRankRuntimeLogState(state);
    if (!state) setRankRuntimeLogOpen(false);
  }, []);

  function requestClose(): void {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <SemanticModal
        bodyClassName="operation-result-modal-body"
        className="operation-result-modal"
        headerActions={(
          <>
            {rankRuntimeLogState && (
              <button
                aria-haspopup="dialog"
                className="operation-result-header-action operation-result-runtime-log-action"
                onClick={() => setRankRuntimeLogOpen(true)}
                title="Открыть логи XMLStock"
                type="button"
              >
                <span aria-hidden="true" className="operation-result-runtime-log-dot" />
                <span className="operation-result-runtime-log-label">Логи</span>
              </button>
            )}
            {actions}
          </>
        )}
        onClose={requestClose}
        presenceKey="semantic-modal:operation-result"
        size="fullscreen"
        title={`Результат: ${title}`}
      >
        <OperationResultWorkspace
          embedded
          kind={kind}
          {...(onClusteringApplied ? { onClusteringApplied } : {})}
          {...(kind === "clustering" || kind === "research"
            ? { onDirtyChange: setDirty }
            : {})}
          onRankRuntimeLogStateChange={handleRankRuntimeLogStateChange}
          operationId={operationId}
          projectId={projectId}
        />
      </SemanticModal>
      {rankRuntimeLogOpen && rankRuntimeLogState && (
        <RankRuntimeDiagnosticsModal
          active={rankRuntimeLogState.active}
          onClose={() => setRankRuntimeLogOpen(false)}
          operationId={operationId}
          projectId={projectId}
        />
      )}
      {confirmClose && (
        <UnsavedChangesConfirmation
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false);
            setDirty(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function OperationStopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect fill="currentColor" height="10" rx="1.5" width="10" x="7" y="7" />
    </svg>
  );
}

export function OperationRetryIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M19 8a7.5 7.5 0 1 0 .35 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M19 4v4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
