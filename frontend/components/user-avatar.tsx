"use client";

import { useEffect, useState } from "react";
import type { AppUser } from "../lib/app-types";
import { useUiLocale } from "./ui-locale";


export function UserAvatar({
  className = "user-avatar",
  size = 38,
  user
}: Readonly<{
  className?: string;
  size?: number;
  user: Pick<AppUser, "displayName" | "avatarUpdatedAt">;
}>) {
  const { t: uiText } = useUiLocale();
  const [failed, setFailed] = useState(false);
  const source = user.avatarUpdatedAt
    ? `/app/api/me/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`
    : undefined;

  useEffect(() => setFailed(false), [source]);

  if (!source || failed) {
    return (
      <span
        aria-label={uiText("Пользователь: {0}", [String(user.displayName)])}
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
