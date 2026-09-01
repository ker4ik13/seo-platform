"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ProjectOrderResult } from "@seo-platform/contracts";
import type { AppProject } from "../lib/app-types";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";
import { CustomSelect } from "./custom-select";
import { ProjectSelectOption } from "./project-select-option";

type SelectableProject = Pick<
  AppProject,
  "id" | "name" | "version" | "activeOperationCount"
>;

export function ProjectSelect({
  ariaLabel,
  canReorder,
  className,
  disabled,
  emptyLabel = "Нет проектов",
  onChange,
  popoverFooter,
  projects,
  searchable,
  value,
  workspaceId
}: Readonly<{
  ariaLabel: string;
  canReorder: boolean;
  className?: string;
  disabled?: boolean;
  emptyLabel?: string;
  onChange: (projectId: string) => void;
  popoverFooter?: ReactNode;
  projects: readonly SelectableProject[];
  searchable?: boolean;
  value: string;
  workspaceId: string;
}>) {
  const projectOrder = projects.map(({ id }) => id);
  const sourceOrderKey = JSON.stringify(projectOrder);
  const expectedOrderRef = useRef<readonly string[]>(projectOrder);

  useEffect(() => {
    expectedOrderRef.current = JSON.parse(sourceOrderKey) as readonly string[];
  }, [sourceOrderKey]);

  async function persistOrder(nextOrder: readonly string[]): Promise<void> {
    try {
      const result = await browserApiRequest<ProjectOrderResult>(
        `/app/api/workspaces/${encodeURIComponent(workspaceId)}/projects/order`,
        {
          method: "PUT",
          body: {
            expectedProjectIds: expectedOrderRef.current,
            projectIds: nextOrder
          }
        }
      );
      if (
        result.projectIds.length !== nextOrder.length ||
        result.projectIds.some((projectId, index) => projectId !== nextOrder[index])
      ) {
        throw new Error("Сервер вернул неполный порядок проектов");
      }
      expectedOrderRef.current = [...nextOrder];
    } catch (error) {
      if (
        error instanceof BrowserApiError &&
        error.code === "VERSION_CONFLICT"
      ) {
        window.setTimeout(() => window.location.reload(), 900);
        throw new Error(
          "Порядок уже изменил другой пользователь. Обновляем список…"
        );
      }
      if (error instanceof Error && !(error instanceof BrowserApiError)) {
        throw error;
      }
      throw new Error("Не удалось сохранить порядок проектов");
    }
  }

  return (
    <CustomSelect
      aria-label={ariaLabel}
      {...(className ? { className } : {})}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      {...(canReorder ? { onOptionOrderChange: persistOrder } : {})}
      optionOrderLabel="Порядок проектов"
      {...(popoverFooter ? { popoverFooter } : {})}
      searchable={searchable ?? projects.length > 8}
      showSelectedCheck={false}
      value={value}
    >
      {projects.length === 0 && <option disabled value="">{emptyLabel}</option>}
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          <ProjectSelectOption project={project} />
        </option>
      ))}
    </CustomSelect>
  );
}
