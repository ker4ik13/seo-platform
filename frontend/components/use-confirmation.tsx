"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SemanticModal } from "./semantic-modal";
import { ConfirmationActions } from "./confirmation-actions";
import { UiText } from "./ui-locale";

interface ConfirmationRequest {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
}

/** Component-owned confirmation; closing or unmounting never approves an action. */
export function useConfirmation() {
  const [request, setRequest] = useState<ConfirmationRequest>();
  const pending = useRef<((approved: boolean) => void) | undefined>(undefined);
  const settle = useCallback((approved: boolean) => {
    pending.current?.(approved);
    pending.current = undefined;
    setRequest(undefined);
  }, []);
  const confirm = useCallback((value: ConfirmationRequest): Promise<boolean> => {
    pending.current?.(false);
    setRequest(value);
    return new Promise(resolve => { pending.current = resolve; });
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = undefined; }, []);
  const dialog = request ? (
    <SemanticModal title={request.title} size="small" onClose={() => settle(false)}
      footer={<ConfirmationActions>
        <button autoFocus className="secondary-button" type="button" onClick={() => settle(false)}><UiText text="Отмена" /></button>
        <button className="danger-button" type="button" onClick={() => settle(true)}><UiText text={request.confirmLabel ?? "Удалить"} /></button>
      </ConfirmationActions>}>
      {request.description && <p><UiText text={request.description} /></p>}
    </SemanticModal>
  ) : null;
  return { confirm, dialog };
}
