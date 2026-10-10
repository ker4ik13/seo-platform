"use client";

import { useEffect, useState } from "react";
import { projectPresenceMembers, type ProjectPresenceMember } from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import { CustomSelect, type CustomSelectProps } from "./custom-select";
import { UiText } from "./ui-locale";

export function ProjectMemberSelect({ projectId, value, onChange, ...fieldProps }: Readonly<Omit<CustomSelectProps, "children" | "value" | "onChange"> & { projectId: string; value: string; onChange: (value: string) => void }>) {
  const [members, setMembers] = useState<readonly ProjectPresenceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    async function loadMembers() {
      try {
        const data = await browserApiRequest<unknown>(`/app/api/projects/${encodeURIComponent(projectId)}/presence-members`, { signal: controller.signal });
        if (!controller.signal.aborted) setMembers(projectPresenceMembers(data));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadMembers();
    return () => controller.abort();
  }, [projectId, revision]);
  return <CustomSelect {...fieldProps} value={value} onChange={(event) => onChange(event.target.value)} searchable disabled={fieldProps.disabled || loading} popoverFooter={error && <div role="alert"><UiText text="Не удалось загрузить участников" /><button className="text-button" onClick={() => setRevision((current) => current + 1)} type="button"><UiText text="Повторить" /></button></div>}>
    <option value=""><UiText text={loading ? "Загрузка…" : "Не назначен"} /></option>
    {value && !members.some((member) => member.userId === value) && <option value={value}><UiText text="Текущий ответственный" /></option>}
    {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
  </CustomSelect>;
}
