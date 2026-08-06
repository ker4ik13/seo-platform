"use client";

import { useEffect, useState } from "react";
import type { AppWorkspace } from "../lib/app-types";

export function WorkspaceAvatar({
  className = "workspace-avatar",
  size = 38,
  workspace
}: Readonly<{
  className?: string;
  size?: number;
  workspace: Pick<AppWorkspace, "id" | "name" | "avatarUpdatedAt">;
}>) {
  const [failed, setFailed] = useState(false);
  const source = workspace.avatarUpdatedAt
    ? `/app/api/workspaces/${encodeURIComponent(workspace.id)}/avatar?v=${encodeURIComponent(workspace.avatarUpdatedAt)}`
    : undefined;

  useEffect(() => setFailed(false), [source]);

  if (!source || failed) {
    return (
      <span
        aria-label={`Рабочая область: ${workspace.name}`}
        className={`${className} fallback`}
        role="img"
        style={{ height: size, width: size }}
      >
        {initials(workspace.name)}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      decoding="async"
      height={size}
      loading="eager"
      onError={() => setFailed(true)}
      src={source}
      width={size}
    />
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru"))
    .join("") || "?";
}
