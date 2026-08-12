export type AppNavigationSection =
  | "competitors"
  | "notifications"
  | "notes"
  | "overview"
  | "pages"
  | "projects"
  | "semantics"
  | "settings"
  | "tasks"
  | "tools";

const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function appNavigationSection(
  pathname: string | null | undefined
): AppNavigationSection {
  const segments = appPathSegments(pathname);
  if (segments.length === 1) return "overview";
  if (segments[1] === "settings") return "settings";
  if (segments[1] === "semantics" || segments[1] === "rankings") {
    return "semantics";
  }
  if (segments[1] === "tasks") return "tasks";
  if (segments[1] === "tools") return "tools";
  if (segments[1] === "competitors") return "competitors";
  if (segments[1] === "notifications") return "notifications";
  if (segments[1] !== "projects") return "overview";
  if (segments.length === 2) return "projects";
  if (segments[3] === "settings") return "settings";
  if (segments[3] === "tools") return "tools";
  if (segments[3] === "pages") return "pages";
  if (segments[3] === "notes") return "notes";
  if (segments[3] === "rankings" && segments[4] === "contexts") {
    return "settings";
  }
  if (segments[3] === "rankings") return "semantics";
  return "projects";
}

export function appProjectIdFromPath(
  pathWithOptionalQuery: string | null | undefined
): string | undefined {
  const segments = appPathSegments(pathWithOptionalQuery);
  const candidate = segments[1] === "projects" ? segments[2] : undefined;
  return candidate && PROJECT_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function appPathSegments(value: string | null | undefined): readonly string[] {
  const pathname = (value ?? "").split(/[?#]/u, 1)[0] ?? "";
  return pathname.split("/").filter(Boolean).map(safeDecodePathSegment);
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
