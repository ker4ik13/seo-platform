"use client";

import { useEffect, useState } from "react";
import { projectFaviconUrl } from "../lib/app-path";

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
  const [status, setStatus] = useState<"LOADING" | "READY" | "FAILED">(
    "LOADING"
  );

  useEffect(() => setStatus("LOADING"), [source]);
  if (!source || status === "FAILED") return null;

  return (
    <img
      alt=""
      aria-hidden="true"
      className={`${className}${status === "READY" ? " is-ready" : ""}`}
      decoding="async"
      height={size}
      loading="lazy"
      onError={() => setStatus("FAILED")}
      onLoad={() => setStatus("READY")}
      referrerPolicy="no-referrer"
      src={source}
      width={size}
    />
  );
}
