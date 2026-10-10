"use client";

import type { HTMLAttributes, ReactNode } from "react";
import styles from "./workspace-sidebar.module.css";

export function WorkspaceSidebar({ as: Tag = "aside", side = "left", className, children, ...props }: Readonly<HTMLAttributes<HTMLElement> & { as?: "aside" | "nav"; side?: "left" | "right"; children: ReactNode }>) {
  return <Tag {...props} className={`${styles.sidebar} ${styles[side]}${className ? ` ${className}` : ""}`} data-workspace-sidebar={side}>{children}</Tag>;
}

export function WorkspaceSidebarSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`${styles.separator}${className ? ` ${className}` : ""}`} role="separator" aria-orientation="vertical" tabIndex={0} data-workspace-sidebar-separator><span aria-hidden="true" className={styles.grip} /></div>;
}
