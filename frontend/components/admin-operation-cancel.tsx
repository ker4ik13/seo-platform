"use client";
import { useState } from "react";
import type { AdminOperationSummary } from "@seo-platform/contracts";
import { adminApi } from "../lib/admin-browser-api";
import { AdminActionDialog } from "./admin-action-dialog";
import { Icon } from "./icon";

const TYPES = new Set(["MANUAL_RANK_CHECK", "FREQUENCY_COLLECTION", "AI_ANSWER_COLLECTION", "CLUSTERING_RUN", "KEYWORD_RESEARCH", "TECHNICAL_CRAWL", "SEMANTIC_EXPORT"]);
const STATES = new Set(["PREPARING", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED", "PAUSED"]);
export function AdminOperationCancel({ operation, onUpdated }: Readonly<{ operation: AdminOperationSummary; onUpdated: () => void }>) {
  const [open, setOpen] = useState(false);
  if (!TYPES.has(operation.type) || !STATES.has(operation.status)) return null;
  return <>
    <button className="danger-button" onClick={() => setOpen(true)} type="button"><Icon name="pause" />Остановить</button>
    {open && <AdminActionDialog title="Остановить операцию?" description={`Операция ${operation.id}. Уже сохранённые результаты останутся. Отправленный провайдеру запрос может завершиться до остановки.`} onClose={() => setOpen(false)} onConfirm={async (reason) => {
      const result = await adminApi(`/api/operations/${operation.id}/cancel`, { method: "POST", body: JSON.stringify({ confirmId: operation.id, confirmed: true, reason }) });
      if (!result.ok) return result.message;
      onUpdated(); return undefined;
    }} />}
  </>;
}
