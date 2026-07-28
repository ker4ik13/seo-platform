import type { SVGProps } from "react";

export type IconName =
  | "dashboard"
  | "semantic"
  | "positions"
  | "tasks"
  | "pages"
  | "competitors"
  | "note"
  | "settings"
  | "search"
  | "bell"
  | "plus"
  | "trend";

const paths: Record<IconName, string> = {
  dashboard: "M4 4h6v6H4V4Zm10 0h6v10h-6V4ZM4 14h6v6H4v-6Zm10 4h6v2h-6v-2Z",
  semantic: "M5 5h14v4H5V5Zm0 7h9v3H5v-3Zm0 6h12v2H5v-2Z",
  positions: "m4 16 5-5 4 3 7-8v5h-2V9.8l-4.8 5.5-4-3L5.4 17.4 4 16Z",
  tasks: "M6 3h12v3h3v15H3V6h3V3Zm2 3h8V5H8v1Zm-1 5h10V9H7v2Zm0 4h10v-2H7v2Z",
  pages: "M5 3h10l4 4v14H5V3Zm9 2v3h3l-3-3ZM8 12h8v-2H8v2Zm0 4h8v-2H8v2Z",
  competitors: "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-3c0-3 2.7-5 6-5s6 2 6 5v3H2Zm13.5 0v-3c0-1.4-.5-2.6-1.4-3.6.6-.3 1.2-.4 1.9-.4 2.8 0 5 1.8 5 4.3V21h-5.5Z",
  note: "M5 3h14v14l-4 4H5V3Zm3 5h8V6H8v2Zm0 4h8v-2H8v2Zm0 4h5v-2H8v2Z",
  settings: "M10.8 2h2.4l.5 2a8 8 0 0 1 1.5.9l2-.6 1.2 2.1-1.5 1.4c.2.5.4 1.1.4 1.7l2 .6v2.4l-2 .6c-.1.6-.2 1.1-.5 1.7l1.5 1.4-1.2 2.1-2-.6c-.5.4-1 .7-1.5.9l-.5 2h-2.4l-.5-2a8 8 0 0 1-1.5-.9l-2 .6-1.2-2.1L7 14.8a8 8 0 0 1-.4-1.7l-2-.6v-2.4l2-.6c.1-.6.2-1.2.5-1.7L5.6 6.4l1.2-2.1 2 .6c.5-.4 1-.7 1.5-.9l.5-2ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  search: "M10.5 4a6.5 6.5 0 1 0 3.9 11.7l4.9 4.9 1.4-1.4-4.9-4.9A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
  bell: "M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2Zm7-5-2-2v-4a5 5 0 0 0-4-4.9V5h-2v1.1A5 5 0 0 0 7 11v4l-2 2v1h14v-1Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  trend: "m4 16 5-5 4 3 7-8v5h-2V9.8l-4.8 5.5-4-3L5.4 17.4 4 16Z"
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

