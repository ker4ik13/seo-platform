"use client";

import { CustomSelect } from "./custom-select";

import { useEffect, useState, type FormEvent } from "react";
import {
  browserApiRequest,
  BrowserApiError
} from "../lib/browser-api";

interface SemanticKeywordGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly path: string;
  readonly color?: string;
  readonly position: number;
  readonly keywordCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface GroupDraft {
  readonly name: string;
  readonly parentId: string;
  readonly color: string;
}

type GroupEditor =
  | Readonly<{ mode: "create"; draft: GroupDraft }>
  | Readonly<{
      mode: "edit";
      groupId: string;
      version: number;
      draft: GroupDraft;
    }>;

export function SemanticGroupManager({
  projectId,
  onChanged
}: Readonly<{
  projectId: string;
  onChanged: () => void;
}>) {
  const [groups, setGroups] = useState<readonly SemanticKeywordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [editor, setEditor] = useState<GroupEditor>();
  const [saving, setSaving] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void browserApiRequest<readonly SemanticKeywordGroup[]>(
      groupPath(projectId),
      { signal: controller.signal }
    )
      .then((result) => {
        if (!controller.signal.aborted) setGroups(result);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(groupErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, reloadVersion]);

  function createGroup(): void {
    setError(undefined);
    setEditor({
      mode: "create",
      draft: { name: "", parentId: "", color: "#6758ef" }
    });
  }

  function editGroup(group: SemanticKeywordGroup): void {
    setError(undefined);
    setEditor({
      mode: "edit",
      groupId: group.id,
      version: group.version,
      draft: {
        name: group.name,
        parentId: group.parentId ?? "",
        color: group.color ?? "#6758ef"
      }
    });
  }

  function updateDraft(patch: Partial<GroupDraft>): void {
    setEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...patch } }
        : current
    );
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || saving) return;
    setSaving(true);
    setError(undefined);
    const body = {
      name: editor.draft.name,
      ...(editor.draft.parentId
        ? { parentId: editor.draft.parentId }
        : editor.mode === "edit"
          ? { parentId: null }
          : {}),
      color: editor.draft.color
    };
    try {
      const result =
        editor.mode === "create"
          ? await browserApiRequest<SemanticKeywordGroup>(
              groupPath(projectId),
              { method: "POST", body }
            )
          : await browserApiRequest<SemanticKeywordGroup>(
              groupPath(projectId, editor.groupId),
              {
                method: "PATCH",
                body,
                ifMatch: editor.version
              }
            );
      setGroups((current) =>
        editor.mode === "create"
          ? sortGroups([...current, result])
          : sortGroups(
              current.map((group) =>
                group.id === result.id ? result : group
              )
            )
      );
      setEditor(undefined);
      setReloadVersion((value) => value + 1);
      onChanged();
    } catch (requestError) {
      setError(groupErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group: SemanticKeywordGroup): Promise<void> {
    if (
      !window.confirm(
        `Удалить группу «${group.path}»? Сначала перенесите вложенные группы и запросы.`
      )
    ) {
      return;
    }
    setError(undefined);
    try {
      await browserApiRequest<void>(groupPath(projectId, group.id), {
        method: "DELETE",
        ifMatch: group.version
      });
      setGroups((current) => current.filter(({ id }) => id !== group.id));
      setEditor(undefined);
      onChanged();
    } catch (requestError) {
      setError(groupErrorMessage(requestError));
    }
  }

  const editingGroup =
    editor?.mode === "edit"
      ? groups.find(({ id }) => id === editor.groupId)
      : undefined;
  const parentOptions = groups.filter(
    (group) =>
      !editingGroup ||
      (group.id !== editingGroup.id &&
        !group.path.startsWith(`${editingGroup.path} / `))
  );

  return (
    <section className="panel semantic-groups" aria-busy={loading}>
      <header className="panel-header">
        <div>
          <h2>Группы</h2>
          <p>Иерархия семантики и количество активных запросов</p>
        </div>
        <button className="secondary-button" onClick={createGroup} type="button">
          Новая группа
        </button>
      </header>

      {editor && (
        <form
          className="semantic-group-editor"
          onSubmit={(event) => void save(event)}
        >
          <label>
            <span>Название</span>
            <input
              autoFocus
              maxLength={255}
              onChange={(event) => updateDraft({ name: event.target.value })}
              required
              value={editor.draft.name}
            />
          </label>
          <label>
            <span>Родительская группа</span>
            <CustomSelect
              onChange={(event) =>
                updateDraft({ parentId: event.target.value })
              }
              value={editor.draft.parentId}
            >
              <option value="">Корневой уровень</option>
              {parentOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.path}
                </option>
              ))}
            </CustomSelect>
          </label>
          <label className="semantic-group-color">
            <span>Цвет</span>
            <div>
              <input
                aria-label="Выбрать цвет"
                onChange={(event) => updateDraft({ color: event.target.value.toUpperCase() })}
                type="color"
                value={/^#[0-9a-f]{6}$/iu.test(editor.draft.color) ? editor.draft.color : "#6758EF"}
              />
              <input
                aria-label="HEX-код цвета"
                maxLength={7}
                onChange={(event) => updateDraft({ color: event.target.value.toUpperCase() })}
                pattern="#[0-9A-Fa-f]{6}"
                required
                value={editor.draft.color}
              />
            </div>
          </label>
          <div className="semantic-group-editor-actions">
            <button
              className="text-button"
              disabled={saving}
              onClick={() => setEditor(undefined)}
              type="button"
            >
              Отмена
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Сохраняем…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="inline-alert danger semantic-table-alert" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => {
              setError(undefined);
              setReloadVersion((value) => value + 1);
            }}
            type="button"
          >
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <div className="semantic-group-skeleton" role="status">
          Загружаем группы…
        </div>
      ) : groups.length === 0 ? (
        <div className="semantic-group-empty">
          <strong>Групп пока нет</strong>
          <span>Создайте структуру или импортируйте её из файла.</span>
        </div>
      ) : (
        <div className="semantic-group-list">
          {groups.map((group) => (
            <div className="semantic-group-row" key={group.id}>
              <i
                aria-hidden="true"
                style={{ backgroundColor: group.color ?? "#a8a5b8" }}
              />
              <div>
                <strong>{group.path}</strong>
                <span>
                  {group.keywordCount} {keywordLabel(group.keywordCount)}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => editGroup(group)}
                type="button"
              >
                Изменить
              </button>
              <button
                className="text-button danger-text"
                onClick={() => void deleteGroup(group)}
                type="button"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function groupPath(projectId: string, groupId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(
    projectId
  )}/keyword-groups`;
  return groupId ? `${base}/${encodeURIComponent(groupId)}` : base;
}

function sortGroups(
  groups: readonly SemanticKeywordGroup[]
): readonly SemanticKeywordGroup[] {
  return [...groups].sort((left, right) =>
    left.path.localeCompare(right.path, "ru")
  );
}

function groupErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") {
      return "Группа уже изменена другим пользователем. Обновите список.";
    }
    if (error.code === "DUPLICATE") {
      return "Группа с таким путём уже существует.";
    }
    if (error.code === "RESOURCE_STATE_CONFLICT") {
      return "Группа не пуста: сначала перенесите запросы и вложенные группы.";
    }
    if (error.code === "FORBIDDEN") {
      return "У вас нет права изменять группы.";
    }
    if (error.code === "VALIDATION_FAILED") {
      return error.fieldErrors[0]?.message ?? "Проверьте данные группы.";
    }
    return error.message;
  }
  return "Не удалось выполнить операцию с группой.";
}

function keywordLabel(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "запросов";
  if (mod10 === 1) return "запрос";
  if (mod10 >= 2 && mod10 <= 4) return "запроса";
  return "запросов";
}
