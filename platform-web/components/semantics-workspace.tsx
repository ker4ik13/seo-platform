"use client";

import { useState } from "react";
import { SemanticClusterManager } from "./semantic-cluster-manager";
import { SemanticCoreTable } from "./semantic-core-table";
import { SemanticCustomColumnManager } from "./semantic-custom-column-manager";
import { SemanticModal } from "./semantic-modal";
import { SemanticUpload } from "./semantic-upload";
import { SemanticVersionHistory } from "./semantic-version-history";

type SemanticTool = "IMPORT" | "CLUSTERS" | "COLUMNS" | "HISTORY";

export function SemanticsWorkspace({
  projectId,
  projectName
}: Readonly<{ projectId: string; projectName: string }>) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
  const [clusterRefreshVersion, setClusterRefreshVersion] = useState(0);
  const [columnRefreshVersion, setColumnRefreshVersion] = useState(0);
  const [activeTool, setActiveTool] = useState<SemanticTool>();

  return (
    <div className="semantic-workspace">
      <SemanticCoreTable
        columnRefreshVersion={columnRefreshVersion}
        clusterRefreshVersion={clusterRefreshVersion}
        groupRefreshVersion={groupRefreshVersion}
        onGroupsChanged={() => setGroupRefreshVersion((value) => value + 1)}
        onOpenClusters={() => setActiveTool("CLUSTERS")}
        onOpenColumns={() => setActiveTool("COLUMNS")}
        onOpenHistory={() => setActiveTool("HISTORY")}
        onOpenImport={() => setActiveTool("IMPORT")}
        projectId={projectId}
        projectName={projectName}
        refreshVersion={refreshVersion}
      />
      {activeTool && (
        <SemanticModal
          description={toolDescription(activeTool)}
          onClose={() => setActiveTool(undefined)}
          size={activeTool === "IMPORT" ? "fullscreen" : "large"}
          title={toolLabel(activeTool)}
        >
          <div className="semantic-tool-modal-content">
            {activeTool === "IMPORT" && (
              <SemanticUpload
                onPublished={() => {
                  setRefreshVersion((value) => value + 1);
                  setGroupRefreshVersion((value) => value + 1);
                }}
                projectId={projectId}
              />
            )}
            {activeTool === "CLUSTERS" && (
              <SemanticClusterManager
                onChanged={() => setClusterRefreshVersion((value) => value + 1)}
                projectId={projectId}
              />
            )}
            {activeTool === "COLUMNS" && (
              <SemanticCustomColumnManager
                onChanged={() => setColumnRefreshVersion((value) => value + 1)}
                projectId={projectId}
              />
            )}
            {activeTool === "HISTORY" && (
              <SemanticVersionHistory
                onRestored={() => setRefreshVersion((value) => value + 1)}
                projectId={projectId}
                refreshVersion={refreshVersion}
              />
            )}
          </div>
        </SemanticModal>
      )}
    </div>
  );
}

function toolLabel(tool: SemanticTool): string {
  switch (tool) {
    case "IMPORT":
      return "Импорт запросов";
    case "CLUSTERS":
      return "Кластеры запросов";
    case "COLUMNS":
      return "Колонки и представления";
    case "HISTORY":
      return "История семантического ядра";
  }
}

function toolDescription(tool: SemanticTool): string {
  switch (tool) {
    case "IMPORT":
      return "CSV, TSV и XLSX: загрузка, сопоставление колонок, проверка и публикация.";
    case "CLUSTERS":
      return "Создание, объединение, разделение и привязка кластеров к страницам.";
    case "COLUMNS":
      return "Типизированные пользовательские поля и настройка рабочей таблицы.";
    case "HISTORY":
      return "Версии, изменения и безопасный откат без перезаписи новых правок.";
  }
}
