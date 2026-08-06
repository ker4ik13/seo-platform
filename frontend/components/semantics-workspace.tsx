"use client";

import { useState } from "react";
import { SemanticClusterManager } from "./semantic-cluster-manager";
import { SemanticCoreTable } from "./semantic-core-table";
import { SemanticCustomColumnManager } from "./semantic-custom-column-manager";
import { SemanticModal } from "./semantic-modal";
import { SemanticUpload } from "./semantic-upload";
import {
  SemanticTrashRecoveryDialog,
  type SemanticTrashRecoveryItem
} from "./semantic-trash-recovery-dialog";
import type { AppProject } from "../lib/app-types";

type SemanticTool = "IMPORT" | "CLUSTERS" | "COLUMNS";

export function SemanticsWorkspace({
  projectId,
  projectName,
  projects,
  workspaceId
}: Readonly<{
  projectId: string;
  projectName: string;
  projects: readonly AppProject[];
  workspaceId: string;
}>) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
  const [clusterRefreshVersion, setClusterRefreshVersion] = useState(0);
  const [columnRefreshVersion, setColumnRefreshVersion] = useState(0);
  const [activeTool, setActiveTool] = useState<SemanticTool>();
  const [trashRecoveryItems, setTrashRecoveryItems] = useState<
    readonly SemanticTrashRecoveryItem[]
  >([]);

  return (
    <div className="semantic-workspace">
      <SemanticCoreTable
        columnRefreshVersion={columnRefreshVersion}
        clusterRefreshVersion={clusterRefreshVersion}
        groupRefreshVersion={groupRefreshVersion}
        onGroupsChanged={() => setGroupRefreshVersion((value) => value + 1)}
        onOpenColumns={() => setActiveTool("COLUMNS")}
        onOpenImport={() => setActiveTool("IMPORT")}
        projectId={projectId}
        projectName={projectName}
        projects={projects}
        refreshVersion={refreshVersion}
        workspaceId={workspaceId}
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
                onPublished={(result) => {
                  setRefreshVersion((value) => value + 1);
                  setGroupRefreshVersion((value) => value + 1);
                  if (result.trashedDuplicateCandidates?.length) {
                    setActiveTool(undefined);
                    setTrashRecoveryItems(
                      result.trashedDuplicateCandidates.map((candidate) => ({
                        keywordId: candidate.keywordId,
                        text: candidate.text,
                        input: {
                          text: candidate.text,
                          language: candidate.language,
                          priority: 0,
                          isFavorite: false,
                          tagNames: []
                        }
                      }))
                    );
                  }
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
          </div>
        </SemanticModal>
      )}
      {trashRecoveryItems.length > 0 && (
        <SemanticTrashRecoveryDialog
          items={trashRecoveryItems}
          onClose={() => setTrashRecoveryItems([])}
          onCompleted={() => {
            setTrashRecoveryItems([]);
            setRefreshVersion((value) => value + 1);
            setGroupRefreshVersion((value) => value + 1);
          }}
          projectId={projectId}
        />
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
  }
}
