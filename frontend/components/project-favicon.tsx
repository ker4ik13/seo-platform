"use client";

import { useState } from "react";
import { projectFaviconUrl } from "../lib/app-path";

interface ProjectFaviconLoadState {
  readonly source: string;
  readonly status: "READY" | "FAILED";
}

export function ProjectFavicon({
  className = "project-favicon",
  domain,
  size = 18
}: Readonly<{
  className?: string;
  domain: string;
  size?: number;
}>) {
  const source = projectFaviconUrl(domain);
  const [loadState, setLoadState] = useState<ProjectFaviconLoadState>();
  const status =
    loadState && loadState.source === source ? loadState.status : "LOADING";

  if (!source || status === "FAILED") return null;

  return (
    <img
      alt=""
      aria-hidden="true"
      className={`${className}${status === "READY" ? " is-ready" : ""}`}
      decoding="async"
      height={size}
      loading="eager"
      onError={() => setLoadState({ source, status: "FAILED" })}
      onLoad={() => setLoadState({ source, status: "READY" })}
      referrerPolicy="no-referrer"
      src={source}
      width={size}
    />
  );
}
