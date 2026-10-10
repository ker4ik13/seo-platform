"use client";

import { cloneElement, useId, type AriaAttributes, type ReactElement } from "react";
import { UiText } from "./ui-locale";

interface FieldControlProps extends AriaAttributes { readonly id?: string; }

export function FormField({ label, error, className, children }: Readonly<{ label: string; error?: string | undefined; className?: string | undefined; children: ReactElement<FieldControlProps> }>) {
  const generatedId = useId();
  const id = children.props.id ?? `field-${generatedId}`;
  const errorId = `${id}-error`;
  const describedBy = [children.props["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return <label className={`form-field${className ? ` ${className}` : ""}`} htmlFor={id}><span><UiText text={label} /></span>{cloneElement(children, { id, "aria-invalid": error ? true : children.props["aria-invalid"], "aria-describedby": describedBy })}{error && <small className="field-error" id={errorId} role="alert"><UiText text={error} /></small>}</label>;
}
