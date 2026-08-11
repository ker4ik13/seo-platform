"use client";

import type { ReactNode } from "react";
import type { OperationResultKind } from "../lib/operation-result-routes";
import { OperationResultWorkspace } from "./operation-result-workspace";
import { SemanticModal } from "./semantic-modal";

export function OperationResultModal({
  actions,
  description,
  kind,
  onClose,
  operationId,
  projectId,
  title
}: Readonly<{
  actions?: ReactNode;
  description: string;
  kind: OperationResultKind;
  onClose: () => void;
  operationId: string;
  projectId: string;
  title: string;
}>) {
  return (
    <SemanticModal
      bodyClassName="operation-result-modal-body"
      description={`${description} · ID ${operationId.slice(0, 8)}`}
      headerActions={actions}
      onClose={onClose}
      size="fullscreen"
      title={`Результат: ${title}`}
    >
      <OperationResultWorkspace
        embedded
        kind={kind}
        operationId={operationId}
        projectId={projectId}
      />
    </SemanticModal>
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
