"use client";

import { useState } from "react";
import { SemanticCoreTable } from "./semantic-core-table";
import { SemanticCustomColumnManager } from "./semantic-custom-column-manager";
import { SemanticGroupManager } from "./semantic-group-manager";
import { SemanticUpload } from "./semantic-upload";
import { SemanticVersionHistory } from "./semantic-version-history";

type SemanticTool = "IMPORT" | "GROUPS" | "COLUMNS" | "HISTORY";

export function SemanticsWorkspace({
  projectId
}: Readonly<{ projectId: string }>) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
  const [columnRefreshVersion, setColumnRefreshVersion] = useState(0);
  const [activeTool, setActiveTool] = useState<SemanticTool>();
  return (
    <div className="semantic-workspace">
      <section className="semantic-workspace-toolbar">
        <div>
          <strong>Рабочее ядро</strong>
          <span>Группы, массовые операции, импорт и версии — в одном экране.</span>
        </div>
        <div aria-label="Инструменты семантики" role="toolbar">
          <ToolButton active={activeTool === "IMPORT"} label="Импорт" onClick={() => setActiveTool("IMPORT")} />
          <ToolButton active={activeTool === "GROUPS"} label="Группы" onClick={() => setActiveTool("GROUPS")} />
          <ToolButton active={activeTool === "COLUMNS"} label="Колонки" onClick={() => setActiveTool("COLUMNS")} />
          <ToolButton active={activeTool === "HISTORY"} label="История" onClick={() => setActiveTool("HISTORY")} />
        </div>
      </section>
      <SemanticCoreTable
        columnRefreshVersion={columnRefreshVersion}
        groupRefreshVersion={groupRefreshVersion}
        projectId={projectId}
        refreshVersion={refreshVersion}
      />
      {activeTool && (
        <section className="semantic-tool-drawer">
          <header>
            <div>
              <p className="eyebrow">Инструменты ядра</p>
              <h2>{toolLabel(activeTool)}</h2>
            </div>
            <button className="text-button" onClick={() => setActiveTool(undefined)} type="button">
              Закрыть
            </button>
          </header>
          {activeTool === "IMPORT" && (
            <SemanticUpload onPublished={() => setRefreshVersion((value) => value + 1)} projectId={projectId} />
          )}
          {activeTool === "GROUPS" && (
            <SemanticGroupManager onChanged={() => setGroupRefreshVersion((value) => value + 1)} projectId={projectId} />
          )}
          {activeTool === "COLUMNS" && (
            <SemanticCustomColumnManager onChanged={() => setColumnRefreshVersion((value) => value + 1)} projectId={projectId} />
          )}
          {activeTool === "HISTORY" && (
            <SemanticVersionHistory onRestored={() => setRefreshVersion((value) => value + 1)} projectId={projectId} refreshVersion={refreshVersion} />
          )}
        </section>
      )}
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick
}: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return (
    <button aria-pressed={active} className="semantic-tool-button" onClick={onClick} type="button">
      {label}
    </button>
  );
}

function toolLabel(tool: SemanticTool): string {
  switch (tool) {
    case "IMPORT":
      return "Импорт запросов";
    case "GROUPS":
      return "Группы ядра";
    case "COLUMNS":
      return "Пользовательские колонки";
    case "HISTORY":
      return "История версий";
  }
}
