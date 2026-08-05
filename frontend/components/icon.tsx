import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "projects"
  | "semantic"
  | "positions"
  | "tools"
  | "tasks"
  | "pages"
  | "competitors"
  | "note"
  | "settings"
  | "search"
  | "bell"
  | "plus"
  | "trend"
  | "import"
  | "frequency"
  | "rankCheck"
  | "cluster"
  | "move"
  | "tag"
  | "trash"
  | "export"
  | "history"
  | "operations"
  | "warning"
  | "http"
  | "indexability"
  | "sitemap"
  | "close";

const paths: Record<IconName, string> = {
  dashboard: "M4 4h6v6H4V4Zm10 0h6v10h-6V4ZM4 14h6v6H4v-6Zm10 4h6v2h-6v-2Z",
  projects: "M4 5h7l2 2h7v12H4V5Zm2 4v8h12V9H6Z",
  semantic: "M5 5h14v4H5V5Zm0 7h9v3H5v-3Zm0 6h12v2H5v-2Z",
  positions: "m4 16 5-5 4 3 7-8v5h-2V9.8l-4.8 5.5-4-3L5.4 17.4 4 16Z",
  tools: "M5 3h14v4H5V3Zm2 6h10v12H7V9Zm2 2v8h6v-8H9Z",
  tasks: "M6 3h12v3h3v15H3V6h3V3Zm2 3h8V5H8v1Zm-1 5h10V9H7v2Zm0 4h10v-2H7v2Z",
  pages: "M5 3h10l4 4v14H5V3Zm9 2v3h3l-3-3ZM8 12h8v-2H8v2Zm0 4h8v-2H8v2Z",
  competitors: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-3c0-3 2.7-5 6-5s6 2 6 5v3H2Zm13.5 0v-3c0-1.4-.5-2.6-1.4-3.6.6-.3 1.2-.4 1.9-.4 2.8 0 5 1.8 5 4.3V21h-5.5Z",
  note: "M5 3h14v14l-4 4H5V3Zm3 5h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z",
  settings: "M10.8 2h2.4l.5 2a8 8 0 0 1 1.5.9l2-.6 1.2 2.1-1.5 1.4c.2.5.4 1.1.4 1.7l2 .6v2.4l-2 .6c-.1.6-.2 1.1-.5 1.7l1.5 1.4-1.2 2.1-2-.6c-.5.4-1 .7-1.5.9l-.5 2h-2.4l-.5-2a8 8 0 0 1-1.5-.9l-2 .6-1.2-2.1L7 14.8a8 8 0 0 1-.4-1.7l-2-.6v-2.4l2-.6c.1-.6.2-1.2.5-1.7L5.6 6.4l1.2-2.1 2 .6c.5-.4 1-.7 1.5-.9l.5-2ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  search: "M10.5 4a6.5 6.5 0 1 0 3.9 11.7l4.9 4.9 1.4-1.4-4.9-4.9A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
  bell: "M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2Zm7-5-2-2v-4a5 5 0 0 0-4-4.9V5h-2v1.1A5 5 0 0 0 7 11v4l-2 2v1h14v-1Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  trend: "m4 16 5-5 4 3 7-8v5h-2V9.8l-4.8 5.5-4-3L5.4 17.4 4 16Z",
  import: "M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3Zm-6 16h14v2H5v-2Z",
  frequency: "M4 18h3V9H4v9Zm5 0h3V5H9v13Zm5 0h3v-6h-3v6Zm5 0h2V2h-2v16Z",
  rankCheck: "M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 2a7 7 0 0 1 6.7 5H15a3 3 0 0 0-2-2V5Zm0 14a7 7 0 0 1-6.7-5H9a3 3 0 0 0 2 2v3Zm0-5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
  cluster: "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.5 6h7v2h-7V6Zm-1.2 3 2 6h2.1l-2-6H7.3Zm9.4 0-2 6h-2.1l2-6h2.1Z",
  move: "m14 4 6 6-6 6v-4H8a4 4 0 0 0-4 4v4H2v-4a6 6 0 0 1 6-6h6V4Z",
  tag: "M3 4v7l9 9 8-8-9-8H3Zm4 5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
  trash: "M8 4V2h8v2h5v2H3V4h5Zm-2 4h12l-1 14H7L6 8Zm4 2v9h2v-9h-2Zm4 0v9h2v-9h-2Z",
  export: "M11 17h2V6.8l3.6 3.6L18 9l-6-6-6 6 1.4 1.4L11 6.8V17Zm-6 2h14v2H5v-2Z",
  history: "M12 4a8 8 0 1 1-7.4 5H2l3.5-4L9 9H6.7A6 6 0 1 0 12 6v4h-2v2h4V6.3A6 6 0 0 0 12 6V4Z",
  operations: "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm1 5v5.6l3.8 2.2-1 1.7L11 13.7V7h2Z",
  warning: "M12 2 1 21h22L12 2Zm0 5.4 6.6 11.6H5.4L12 7.4ZM11 10v5h2v-5h-2Zm0 6.5v2h2v-2h-2Z",
  http: "M4 4h16v16H4V4Zm2 3v2h12V7H6Zm0 4v6h12v-6H6Zm2 2h5v2H8v-2Z",
  indexability: "M12 4C7 4 3.1 8.1 2 12c1.1 3.9 5 8 10 8s8.9-4.1 10-8c-1.1-3.9-5-8-10-8Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  sitemap: "M11 3h2v4h6v5h-2V9h-4v3h3v7h-3v2h-2v-2H8v-7h3V9H7v3H5V7h6V3Z",
  close: "m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z"
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { readonly name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
