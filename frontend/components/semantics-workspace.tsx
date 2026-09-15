"use client";

import { useEffect, useState } from "react";
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
import { announceProjectSemanticMutation } from "../lib/semantic-realtime";
import { useProjectPresence } from "./project-presence-provider";
import { UiText } from "./ui-locale";

type SemanticTool = "IMPORT" | "CLUSTERS" | "COLUMNS";

export function SemanticsWorkspace({
  canReorderProjects,
  currentUserId,
  projectId,
  projectName,
  projects,
  workspaceId,
  workspaceRoleCode
}: Readonly<{
  canReorderProjects: boolean;
  currentUserId: string;
  projectId: string;
  projectName: string;
  projects: readonly AppProject[];
  workspaceId: string;
  workspaceRoleCode: string;
}>) {
  const { publishActivity, semanticChangeVersion } = useProjectPresence();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
  const [clusterRefreshVersion, setClusterRefreshVersion] = useState(0);
  const [columnRefreshVersion, setColumnRefreshVersion] = useState(0);
  const [activeTool, setActiveTool] = useState<SemanticTool>();
  const [importInProgress, setImportInProgress] = useState(false);
  const [importExpanded, setImportExpanded] = useState(false);
  const [confirmImportClose, setConfirmImportClose] = useState(false);
  const [trashRecoveryItems, setTrashRecoveryItems] = useState<
    readonly SemanticTrashRecoveryItem[]
  >([]);

  useEffect(() => {
    publishActivity(
      activeTool === "IMPORT" || trashRecoveryItems.length > 0
        ? "SEMANTIC_IMPORT"
        : activeTool === "COLUMNS"
          ? "SEMANTIC_LAYOUT"
          : activeTool === "CLUSTERS"
            ? "SEMANTIC_GROUP"
            : null
    );
  }, [activeTool, publishActivity, trashRecoveryItems.length]);

  function closeTool(): void {
    if (activeTool === "IMPORT" && importInProgress) {
      setConfirmImportClose(true);
      return;
    }
    setActiveTool(undefined);
  }

  return (
    <div className="semantic-workspace">
      <SemanticCoreTable
        canReorderProjects={canReorderProjects}
        currentUserId={currentUserId}
        columnRefreshVersion={columnRefreshVersion}
        clusterRefreshVersion={clusterRefreshVersion + semanticChangeVersion}
        groupRefreshVersion={groupRefreshVersion + semanticChangeVersion}
        onGroupsChanged={() => setGroupRefreshVersion((value) => value + 1)}
        onOpenColumns={() => setActiveTool("COLUMNS")}
        onOpenImport={() => setActiveTool("IMPORT")}
        projectId={projectId}
        projectName={projectName}
        projects={projects}
        refreshVersion={refreshVersion + semanticChangeVersion}
        workspaceId={workspaceId}
        workspaceRoleCode={workspaceRoleCode}
      />
      {activeTool && (
        <SemanticModal
          {...(activeTool === "IMPORT"
            ? { className: `semantic-import-modal${importExpanded ? " is-expanded" : ""}` }
            : {})}
          description={toolDescription(activeTool)}
          onClose={closeTool}
          presenceKey={`semantic-modal:${activeTool.toLocaleLowerCase("en")}`}
          size={activeTool === "IMPORT" ? "fullscreen" : "large"}
          title={toolLabel(activeTool)}
        >
          <div className="semantic-tool-modal-content">
            {activeTool === "IMPORT" && (
              <SemanticUpload
                onBusyChange={setImportInProgress}
                onExpandedChange={setImportExpanded}
                onPublished={(result) => {
                  setRefreshVersion((value) => value + 1);
                  setGroupRefreshVersion((value) => value + 1);
                  announceProjectSemanticMutation(projectId);
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
      {confirmImportClose && (
        <SemanticModal
          description="Обработка и подготовленные настройки сохранятся, но окно текущего импорта закроется."
          footer={
            <div className="semantic-modal-actions">
              <button autoFocus className="secondary-button" onClick={() => setConfirmImportClose(false)} type="button"><UiText text="Остаться" /></button>
              <button className="danger-button" onClick={() => {
                setConfirmImportClose(false);
                setActiveTool(undefined);
              }} type="button"><UiText text="Закрыть окно" /></button>
            </div>
          }
          onClose={() => setConfirmImportClose(false)}
          presenceKey="semantic-modal:confirm-import-close"
          size="small"
          title="Закрыть текущий импорт?"
        >
          <div className="semantic-confirm-dialog">
            <div className="inline-alert warning" role="alert">
              <strong>Импорт ещё не завершён</strong>
              <span>При следующем открытии можно продолжить с сохранённого этапа.</span>
            </div>
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
