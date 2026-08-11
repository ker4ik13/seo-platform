"use client";

import { useEffect, useRef, useState } from "react";
import type { AppProject } from "../lib/app-types";
import { projectLogoUrl } from "../lib/app-path";

interface ProjectFaviconLoadState {
  readonly source: string;
  readonly status: "READY" | "FAILED";
}

export function ProjectFavicon({
  className = "project-favicon",
  project,
  size = 18
}: Readonly<{
  className?: string;
  project: Pick<AppProject, "id" | "version">;
  size?: number;
}>) {
  const source = projectLogoUrl(project.id, project.version);
  const imageRef = useRef<HTMLImageElement>(null);
  const [loadState, setLoadState] = useState<ProjectFaviconLoadState>();
  const status =
    loadState && loadState.source === source ? loadState.status : "LOADING";

  useEffect(() => {
    const image = imageRef.current;
    if (!source || !image?.complete) return;

    setLoadState({
      source,
      status: image.naturalWidth > 0 ? "READY" : "FAILED"
    });
  }, [source]);

  if (status === "FAILED") return null;

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
      ref={imageRef}
      referrerPolicy="no-referrer"
      src={source}
      width={size}
    />
  );
}
