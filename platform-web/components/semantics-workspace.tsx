"use client";

import { useState } from "react";
import { SemanticCoreTable } from "./semantic-core-table";
import { SemanticGroupManager } from "./semantic-group-manager";
import { SemanticUpload } from "./semantic-upload";

export function SemanticsWorkspace({
  projectId
}: Readonly<{ projectId: string }>) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [groupRefreshVersion, setGroupRefreshVersion] = useState(0);
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
      <SemanticCoreTable
        groupRefreshVersion={groupRefreshVersion}
        projectId={projectId}
        refreshVersion={refreshVersion}
      />
    </div>
  );
}
