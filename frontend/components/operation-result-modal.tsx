"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { OperationResultKind } from "../lib/operation-result-routes";
import { OperationResultWorkspace } from "./operation-result-workspace";
import { SemanticModal } from "./semantic-modal";
import { UnsavedChangesConfirmation } from "./unsaved-changes-confirmation";

export function OperationResultModal({
  actions,
  description,
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

  useEffect(() => {
    setDirty(false);
    setConfirmClose(false);
  }, [kind, operationId]);

  function requestClose(): void {
    if (kind === "clustering" && dirty) {
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
        description={`${description} · ID ${operationId.slice(0, 8)}`}
        headerActions={actions}
        onClose={requestClose}
        presenceKey="semantic-modal:operation-result"
        size="fullscreen"
        title={`Результат: ${title}`}
      >
        <OperationResultWorkspace
          embedded
          kind={kind}
          {...(onClusteringApplied ? { onClusteringApplied } : {})}
          {...(kind === "clustering" ? { onDirtyChange: setDirty } : {})}
          operationId={operationId}
          projectId={projectId}
        />
      </SemanticModal>
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
