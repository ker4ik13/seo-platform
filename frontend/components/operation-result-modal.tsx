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
import { useUiLocale, UiText } from "./ui-locale";
import { Icon } from "./icon";


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
  const { t: uiText } = useUiLocale();
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
                title={uiText("Открыть логи XMLStock")}
                type="button"
              >
                <span aria-hidden="true" className="operation-result-runtime-log-dot" />
                <span className="operation-result-runtime-log-label"><UiText text="Логи" /></span>
              </button>
            )}
            {actions}
          </>
        )}
        onClose={requestClose}
        presenceKey="semantic-modal:operation-result"
        size="fullscreen"
        title={uiText("Результат: {0}", [String(title)])}
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
  return <Icon name="stop" />;
}

export function OperationRetryIcon() {
  return <Icon name="refresh" />;
}
