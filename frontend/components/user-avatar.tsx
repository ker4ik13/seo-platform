"use client";

import { useEffect, useState } from "react";
import type { AppUser } from "../lib/app-types";

export function UserAvatar({
  className = "user-avatar",
  size = 38,
  user
}: Readonly<{
  className?: string;
  size?: number;
  user: Pick<AppUser, "displayName" | "avatarUpdatedAt">;
}>) {
  const [failed, setFailed] = useState(false);
  const source = user.avatarUpdatedAt
    ? `/app/api/me/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`
    : undefined;

  useEffect(() => setFailed(false), [source]);

  if (!source || failed) {
    return (
      <span
        aria-label={`Пользователь: ${user.displayName}`}
        className={`${className} fallback`}
        role="img"
        style={{ height: size, width: size }}
      >
        {initials(user.displayName)}
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
  return (
    value
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("ru"))
      .join("") || "?"
  );
}
