import type { SVGProps } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChartNoAxesCombined,
  CheckCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  ClipboardList,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  FileDown,
  Files,
  FolderInput,
  FolderKanban,
  FolderPlus,
  Folders,
  Globe2,
  History,
  Inbox,
  Info,
  LayoutDashboard,
  Link,
  List,
  ListTree,
  LockOpen,
  Mail,
  Minus,
  Monitor,
  Network,
  Palette,
  PanelLeftClose,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Square,
  Star,
  StickyNote,
  Tag,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  Users,
  Wrench,
  X,
  type LucideIcon
} from "lucide-react";


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
  | "ai"
  | "rankCheck"
  | "cluster"
  | "move"
  | "tag"
  | "trash"
  | "export"
  | "history"
  | "operations"
  | "warning"
  | "link"
  | "lockOpen"
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
  | "check"
  | "clock"
  | "stop"
  | "favorite"
  | "minus"
  | "mail"
  | "eye"
  | "eyeOff"
  | "panelLeftClose"
  | "info"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "copy"
  | "palette"
  | "calendar"
  | "desktop"
  | "mobile"
  | "play"
  | "pause"
  | "refresh";

const icons: Readonly<Record<IconName, LucideIcon>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  semantic: ListTree,
  positions: ChartNoAxesCombined,
  tools: Wrench,
  tasks: ClipboardList,
  pages: Files,
  competitors: Users,
  note: StickyNote,
  settings: Settings,
  search: Search,
  bell: Bell,
  plus: Plus,
  trend: TrendingUp,
  import: FileDown,
  frequency: ChartNoAxesColumnIncreasing,
  ai: Sparkles,
  rankCheck: Crosshair,
  cluster: Network,
  move: FolderInput,
  tag: Tag,
  trash: Trash2,
  export: Upload,
  history: History,
  operations: CircleGauge,
  warning: TriangleAlert,
  link: Link,
  lockOpen: LockOpen,
  http: Globe2,
  indexability: Eye,
  sitemap: Network,
  folderPlus: FolderPlus,
  multiGroup: Folders,
  edit: Pencil,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  inbox: Inbox,
  list: List,
  checkDouble: CheckCheck,
  check: Check,
  clock: Clock3,
  stop: Square,
  favorite: Star,
  minus: Minus,
  mail: Mail,
  eye: Eye,
  eyeOff: EyeOff,
  panelLeftClose: PanelLeftClose,
  info: Info,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  close: X,
  copy: Copy,
  palette: Palette,
  calendar: CalendarDays,
  desktop: Monitor,
  mobile: Smartphone,
  play: Play,
  pause: Pause,
  refresh: RefreshCw
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { readonly name: IconName }) {
  const Component = icons[name];
  return (
    <Component
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      {...props}
    />
  );
}
