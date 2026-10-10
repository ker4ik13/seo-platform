"use client";
import { useEffect, useRef, type MouseEvent } from "react";
import { Icon } from "./icon";
export function TableSelectionCheckbox({ checked, mixed = false, label, onChange, onClick }: Readonly<{ checked: boolean; mixed?: boolean; label: string; onChange?: (checked: boolean) => void; onClick?: (event: MouseEvent<HTMLInputElement>) => void }>) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <span className="table-selection-checkbox"><input ref={input} type="checkbox" aria-label={label} checked={checked} onChange={event => onChange?.(event.target.checked)} onClick={onClick} /><span aria-hidden="true">{mixed ? <span className="table-selection-checkbox-mixed" /> : <Icon name="check" />}</span></span>;
}
