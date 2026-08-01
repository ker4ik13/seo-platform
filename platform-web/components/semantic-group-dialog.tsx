"use client";

import { useState, type FormEvent } from "react";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";

export type SemanticGroupDialogState =
  | Readonly<{ mode: "create"; parentId?: string }>
  | Readonly<{ mode: "rename"; group: SemanticGroupTreeItem }>
  | Readonly<{
      mode: "move";
      groups: readonly SemanticGroupTreeItem[];
      suggestedTargetId?: string;
    }>
  | Readonly<{ mode: "delete"; groups: readonly SemanticGroupTreeItem[] }>;

export function SemanticGroupDialog({
  groups,
  onClose,
  onCompleted,
  projectId,
  state
}: Readonly<{
  groups: readonly SemanticGroupTreeItem[];
  onClose: () => void;
  onCompleted: (message: string) => void;
  projectId: string;
  state: SemanticGroupDialogState;
}>) {
  const initialGroup = state.mode === "rename" ? state.group : undefined;
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [parentId, setParentId] = useState(
    state.mode === "create"
      ? state.parentId ?? ""
      : state.mode === "rename"
        ? state.group.parentId ?? ""
        : state.mode === "move"
          ? state.suggestedTargetId ?? ""
          : ""
  );
  const [color, setColor] = useState(initialGroup?.color ?? "#6758ef");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const movedGroups = state.mode === "move" ? state.groups : [];
  const parentOptions = groups.filter(
    (candidate) =>
      !movedGroups.some(
        (moving) =>
          candidate.id === moving.id ||
          candidate.path.startsWith(`${moving.path} / `)
      ) &&
      (state.mode !== "rename" ||
        (candidate.id !== state.group.id &&
          !candidate.path.startsWith(`${state.group.path} / `)))
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      if (state.mode === "create") {
        await browserApiRequest(groupPath(projectId), {
          method: "POST",
          body: {
            name,
            color,
            ...(parentId ? { parentId } : {})
          }
        });
        onCompleted(`Группа «${name.trim()}» создана`);
        return;
      }
      if (state.mode === "rename") {
        await browserApiRequest(groupPath(projectId, state.group.id), {
          method: "PATCH",
          ifMatch: state.group.version,
          body: {
            name,
            color,
            parentId: parentId || null
          }
        });
        onCompleted(`Группа переименована в «${name.trim()}»`);
        return;
      }
      if (state.mode === "move") {
        const results = await Promise.allSettled(
          state.groups.map((group) =>
            browserApiRequest(groupPath(projectId, group.id), {
              method: "PATCH",
              ifMatch: group.version,
              body: {
                name: group.name,
                color: group.color ?? null,
                parentId: parentId || null
              }
            })
          )
        );
        const moved = results.filter(({ status }) => status === "fulfilled").length;
        if (moved !== state.groups.length) {
          throw new Error(
            `Перенесено ${moved} из ${state.groups.length}. Список обновлён; повторите только оставшиеся группы.`
          );
        }
        onCompleted(
          state.groups.length === 1
            ? `Группа «${state.groups[0]?.name ?? ""}» перемещена`
            : `Перемещено групп: ${state.groups.length}`
        );
        return;
      }
      const results = await Promise.allSettled(
        state.groups.map((group) =>
          browserApiRequest<void>(groupPath(projectId, group.id), {
            method: "DELETE",
            ifMatch: group.version
          })
        )
      );
      const deleted = results.filter(({ status }) => status === "fulfilled").length;
      if (deleted !== state.groups.length) {
        throw new Error(
          `Удалено ${deleted} из ${state.groups.length}. Непустые или изменённые группы сохранены.`
        );
      }
      onCompleted(
        state.groups.length === 1
          ? `Группа «${state.groups[0]?.name ?? ""}» удалена`
          : `Удалено групп: ${state.groups.length}`
      );
    } catch (requestError) {
      setError(groupErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const title =
    state.mode === "create"
      ? "Новая группа"
      : state.mode === "rename"
        ? "Изменить группу"
        : state.mode === "move"
          ? "Переместить группы"
          : "Удалить группы";
  return (
    <SemanticModal
      description={groupDialogDescription(state)}
      onClose={saving ? () => undefined : onClose}
      size="small"
      title={title}
    >
      <form className="semantic-dialog-form" onSubmit={(event) => void submit(event)}>
        {(state.mode === "create" || state.mode === "rename") && (
          <>
            <label>
              <span>Название</span>
              <input
                autoFocus
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label>
              <span>Родительская группа</span>
              <GroupParentSelect
                groups={parentOptions}
                onChange={setParentId}
                value={parentId}
              />
            </label>
            <label className="semantic-dialog-color">
              <span>Цвет</span>
              <input
                onChange={(event) => setColor(event.target.value)}
                type="color"
                value={color}
              />
            </label>
          </>
        )}
        {state.mode === "move" && (
          <>
            <div className="semantic-dialog-selection">
              {state.groups.map((group) => (
                <span key={group.id}>{group.path}</span>
              ))}
            </div>
            <label>
              <span>Куда переместить</span>
              <GroupParentSelect
                autoFocus
                groups={parentOptions}
                onChange={setParentId}
                value={parentId}
              />
            </label>
          </>
        )}
        {state.mode === "delete" && (
          <div className="inline-alert danger" role="alert">
            Удалить можно только пустые группы без вложенных папок. Запросы и
            дочерние группы автоматически не удаляются.
          </div>
        )}
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            Отмена
          </button>
          <button
            className={state.mode === "delete" ? "danger-button" : "primary-button"}
            disabled={saving}
            type="submit"
          >
            {saving
              ? "Сохраняем…"
              : state.mode === "delete"
                ? "Удалить"
                : state.mode === "move"
                  ? `Переместить (${state.groups.length})`
                  : "Сохранить"}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function GroupParentSelect({
  autoFocus,
  groups,
  onChange,
  value
}: Readonly<{
  autoFocus?: boolean;
  groups: readonly SemanticGroupTreeItem[];
  onChange: (value: string) => void;
  value: string;
}>) {
  return (
    <select autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">Корневой уровень</option>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>{group.path}</option>
      ))}
    </select>
  );
}

function groupPath(projectId: string, groupId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`;
  return groupId ? `${base}/${encodeURIComponent(groupId)}` : base;
}

function groupDialogDescription(state: SemanticGroupDialogState): string {
  if (state.mode === "create") return "Создайте папку на выбранном уровне дерева.";
  if (state.mode === "rename") return "Название, цвет и родитель сохраняются с проверкой версии.";
  if (state.mode === "move") return `Выбрано групп: ${state.groups.length}. Вложенные группы переместятся вместе с родителем.`;
  return `Выбрано групп: ${state.groups.length}. Операция необратима для пустых папок.`;
}

function groupErrorMessage(error: unknown): string {
  if (error instanceof Error && !(error instanceof BrowserApiError)) return error.message;
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") return "Группа уже изменена. Обновите дерево и повторите.";
    if (error.code === "DUPLICATE") return "Группа с таким именем уже существует на выбранном уровне.";
    if (error.code === "RESOURCE_STATE_CONFLICT") return "Проверьте циклический перенос, вложенные группы и наличие запросов.";
    if (error.code === "FORBIDDEN") return "Недостаточно прав для изменения групп.";
    return error.message;
  }
  return "Не удалось изменить группы.";
}
