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
  | "folderPlus"
  | "multiGroup"
  | "edit"
  | "arrowUp"
  | "arrowDown"
  | "inbox"
  | "list"
  | "checkDouble"
  | "eye"
  | "eyeOff"
  | "panelLeftClose"
  | "chevronRight"
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
  settings: "M10 2h4l.5 2.1c.6.2 1.1.4 1.6.7L18 3.7l2.8 2.8-1.1 1.9c.3.5.5 1 .7 1.6l2.1.5v4l-2.1.5c-.2.6-.4 1.1-.7 1.6l1.1 1.9-2.8 2.8-1.9-1.1c-.5.3-1 .5-1.6.7L14 22h-4l-.5-2.1c-.6-.2-1.1-.4-1.6-.7L6 20.3l-2.8-2.8 1.1-1.9c-.3-.5-.5-1-.7-1.6l-2.1-.5v-4L3.6 10c.2-.6.4-1.1.7-1.6L3.2 6.5 6 3.7l1.9 1.1c.5-.3 1-.5 1.6-.7L10 2Zm2 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
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
  folderPlus: "M3 5h7l2 2h9v12H3V5Zm2 4v8h14V9H5Zm6 1h2v2h2v2h-2v2h-2v-2H9v-2h2v-2Z",
  multiGroup: "M3 4h6l2 2h8v11H3V4Zm2 4v7h12V8H5Zm3 10h13V9h-2v7H8v2Zm3 3h13V12h-2v7H11v2Z",
  edit: "m4 16.5-.5 4 4-.5L19 8.5 15.5 5 4 16.5Zm12.9-12.9 1.2-1.2a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2l-1.2 1.2-3.5-3.5Z",
  arrowUp: "m12 4-7 7 1.4 1.4L11 7.8V20h2V7.8l4.6 4.6L19 11l-7-7Z",
  arrowDown: "m12 20 7-7-1.4-1.4-4.6 4.6V4h-2v13.2l-4.6-4.6L5 13l7 7Z",
  inbox: "M4 4h16l2 10v6H2v-6L4 4Zm1.6 2-1.4 7H8l1.5 2h5l1.5-2h3.8l-1.4-7H5.6Z",
  list: "M4 5h3v3H4V5Zm5 0h11v3H9V5Zm-5 6h3v3H4v-3Zm5 0h11v3H9v-3Zm-5 6h3v3H4v-3Zm5 0h11v3H9v-3Z",
  checkDouble: "m1.8 12.2 1.4-1.4 4.1 4.1 1.4 1.4-1.4 1.4-5.5-5.5Zm5.8 0L9 10.8l4.1 4.1 7.7-7.7 1.4 1.4-9.1 9.1-5.5-5.5Zm4.1-3.6 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1Z",
  eye: "M12 5c5.2 0 8.8 4.2 10 7-1.2 2.8-4.8 7-10 7S3.2 14.8 2 12c1.2-2.8 4.8-7 10-7Zm0 2c-3.7 0-6.5 2.8-7.8 5 1.3 2.2 4.1 5 7.8 5s6.5-2.8 7.8-5C18.5 9.8 15.7 7 12 7Zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z",
  eyeOff: "m3.3 2 18.7 18.7-1.3 1.3-3.1-3.1A10.3 10.3 0 0 1 12 20C6.8 20 3.2 15.8 2 13c.7-1.6 2.2-3.7 4.3-5.2L2 3.3 3.3 2Zm4.5 7.3A9.3 9.3 0 0 0 4.2 13c1.3 2.2 4.1 5 7.8 5 1.5 0 2.8-.5 4-1.1l-1.7-1.7a4.2 4.2 0 0 1-5.5-5.5l-1-1Zm4.1-4.2h.1c5.2 0 8.8 4.2 10 7a13.4 13.4 0 0 1-2.1 3.4l-1.5-1.5c.6-.7 1.1-1.4 1.4-2-1.3-2.2-4.1-5-7.8-5h-.1V5.1Zm.1 4.1a2.8 2.8 0 0 1 2.8 2.8v.1l-2.9-2.9h.1Z",
  panelLeftClose: "M3 3h18v18H3V3Zm2 2v14h5V5H5Zm10.6 3.6L12.2 12l3.4 3.4 1.4-1.4-2-2 2-2-1.4-1.4Z",
  chevronRight: "m9 4 8 8-8 8-1.5-1.5L14 12 7.5 5.5 9 4Z",
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
      <path
        clipRule={name === "settings" ? "evenodd" : undefined}
        d={paths[name]}
        fillRule={name === "settings" ? "evenodd" : undefined}
      />
    </svg>
  );
}
