"use client";

import { useState } from "react";
import { SemanticCoreTable } from "./semantic-core-table";
import { SemanticCustomColumnManager } from "./semantic-custom-column-manager";
import { SemanticGroupManager } from "./semantic-group-manager";
import { SemanticUpload } from "./semantic-upload";
import { SemanticVersionHistory } from "./semantic-version-history";

export function SemanticsWorkspace({
  projectId
}: Readonly<{ projectId: string }>) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
  const [columnRefreshVersion, setColumnRefreshVersion] = useState(0);
  return (
    <div className="settings-stack semantic-stack">
      <SemanticUpload
        onPublished={() => setRefreshVersion((value) => value + 1)}
        projectId={projectId}
      />
      <SemanticGroupManager
        onChanged={() => setGroupRefreshVersion((value) => value + 1)}
        projectId={projectId}
      />
      <SemanticCustomColumnManager
        onChanged={() => setColumnRefreshVersion((value) => value + 1)}
        projectId={projectId}
      />
      <SemanticCoreTable
        columnRefreshVersion={columnRefreshVersion}
        groupRefreshVersion={groupRefreshVersion}
        projectId={projectId}
        refreshVersion={refreshVersion}
      />
      <SemanticVersionHistory
        onRestored={() => setRefreshVersion((value) => value + 1)}
        projectId={projectId}
        refreshVersion={refreshVersion}
      />
    </div>
  );
}
