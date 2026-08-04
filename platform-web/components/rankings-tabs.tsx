import { rankHistoryReturnTo } from "../lib/rank-history";
import { rankAutomationsReturnTo } from "../lib/rank-automations";

export function RankingsTabs({
  active,
  projectId
}: Readonly<{
  active: "history" | "contexts" | "automations";
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
        aria-current={active === "automations" ? "page" : undefined}
        className={active === "automations" ? "active" : undefined}
        href={rankAutomationsReturnTo(projectId)}
      >
        Автоматизация
      </a>
    </nav>
  );
}
