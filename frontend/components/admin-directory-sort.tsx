"use client";
import type { AdminDirectorySort } from "@seo-platform/contracts";
import { CustomSelect } from "./custom-select";
import { Icon } from "./icon";

export function AdminDirectorySortControl({ value, onChange }: Readonly<{ value: AdminDirectorySort; onChange: (value: AdminDirectorySort) => void }>) {
  return <CustomSelect aria-label="Сортировка" value={value} onChange={(event) => onChange(event.target.value as AdminDirectorySort)}>
    <option value="CREATED_DESC"><span className="admin-select-label"><Icon name="history" />Новые сначала</span></option>
    <option value="CREATED_ASC"><span className="admin-select-label"><Icon name="clock" />Старые сначала</span></option>
    <option value="NAME_ASC"><span className="admin-select-label"><Icon name="arrowDown" />Название: А — Я</span></option>
    <option value="NAME_DESC"><span className="admin-select-label"><Icon name="arrowUp" />Название: Я — А</span></option>
  </CustomSelect>;
}
