import { rankHistoryReturnTo } from "../lib/rank-history";
import { trackingContextsReturnTo } from "../lib/tracking-contexts";

export function RankingsTabs({
  active,
  projectId
}: Readonly<{
  active: "history" | "contexts";
  projectId: string;
}>) {
  return (
    <nav
      aria-label="Разделы позиций"
      className="settings-tabs rankings-tabs"
    >
      <a
        aria-current={active === "history" ? "page" : undefined}
        className={active === "history" ? "active" : undefined}
        href={rankHistoryReturnTo(projectId)}
      >
        История
      </a>
      <a
        aria-current={active === "contexts" ? "page" : undefined}
        className={active === "contexts" ? "active" : undefined}
        href={trackingContextsReturnTo(projectId)}
      >
        Контексты
      </a>
    </nav>
  );
}
