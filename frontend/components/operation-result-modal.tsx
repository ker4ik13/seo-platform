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
      description={`${description} · ID ${operationId.slice(0, 8)}`}
      footer={(
        <>
          {actions}
          <button className="secondary-button" onClick={onClose} type="button">
            Закрыть
          </button>
        </>
      )}
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
