"use client";
import { useEffect, useState } from "react";
import { parseAdminStateResult, type AdminStateResult } from "@seo-platform/contracts";
import { adminApi } from "../lib/admin-browser-api";
import { AdminActionDialog } from "./admin-action-dialog";
import { Icon } from "./icon";

export function AdminStateAction({ kind, id, version, status, name, onUpdated }: Readonly<{ kind: "WORKSPACE" | "USER"; id: string; version?: number; status: string; name: string; onUpdated: () => void }>) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<{ status: string; version?: number }>({ status, ...(version ? { version } : {}) });
  useEffect(() => setCurrent({ status, ...(version ? { version } : {}) }), [id, status, version]);
  const blocked = current.status === "SUSPENDED";
  const label = blocked ? kind === "USER" ? "Разблокировать аккаунт" : "Разблокировать область" : kind === "USER" ? "Заблокировать аккаунт" : "Заблокировать область";
  const [commandKey, setCommandKey] = useState("");
  return <>
    <button className={blocked ? "ghost" : "danger-button"} disabled={!current.version || status === "DELETED" || status === "DELETING"} onClick={() => { setCommandKey(crypto.randomUUID()); setOpen(true); }} type="button"><Icon name={blocked ? "play" : "pause"} />{label}</button>
    {open && <AdminActionDialog title={`${label}: ${name}`} description={blocked ? "Доступ будет восстановлен. Данные и история сохраняются." : kind === "USER" ? "Вход будет запрещён, активные сессии отозваны. Рабочие области и данные аккаунта не удаляются." : "Доступ участников к области будет заблокирован. Данные, история и подписка не удаляются."} onClose={() => setOpen(false)} onConfirm={async (reason) => {
      const result = await adminApi<unknown>(`/api/${kind === "USER" ? "users" : "workspaces"}/${id}/state`, { method: "PATCH", headers: { "If-Match": `"v${current.version}"`, "Idempotency-Key": commandKey }, body: JSON.stringify({ status: blocked ? "ACTIVE" : "SUSPENDED", confirmId: id, confirmed: true, reason }) });
      if (!result.ok) return result.message;
      let updated: AdminStateResult; try { updated = parseAdminStateResult(result.data); if (updated.id !== id) throw new TypeError(); } catch { return "Некорректный ответ сервера"; }
      setCurrent(updated); onUpdated(); return undefined;
    }} />}
  </>;
}
