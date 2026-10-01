"use client";

import { useState } from "react";
import { Icon } from "./icon";

export function OperationIdentity({ id }: Readonly<{ id: string }>) {
  const [state, setState] = useState<"IDLE" | "COPIED" | "FAILED">("IDLE");
  return <span className="operation-identity">
    <span>ID</span><code title={id}>{id}</code>
    <button aria-label="Скопировать ID операции" title={state === "FAILED" ? "Не удалось скопировать — выделите ID вручную" : "Скопировать полный ID"} type="button" onClick={() => {
      void navigator.clipboard.writeText(id).then(() => { setState("COPIED"); window.setTimeout(() => setState("IDLE"), 2000); }).catch(() => setState("FAILED"));
    }}><Icon name={state === "COPIED" ? "check" : "copy"} /></button>
    <span className="visually-hidden" aria-live="polite">{state === "COPIED" ? "ID скопирован" : state === "FAILED" ? "Не удалось скопировать ID" : ""}</span>
  </span>;
}
