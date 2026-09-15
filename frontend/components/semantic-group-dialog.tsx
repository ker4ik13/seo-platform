"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { semanticKeywordGroupBulkCreateMaxItems } from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import {
  semanticGroupNameLineCount,
  semanticGroupNamesFromText
} from "../lib/semantic-group-name-batch";
import {
  semanticGroupColors,
  semanticGroupDefaultColor
} from "../lib/semantic-group-colors";
import { SemanticModal } from "./semantic-modal";
import { SemanticGroupPickerField } from "./semantic-group-picker";
import { Icon } from "./icon";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { UiText, useUiLocale } from "./ui-locale";


export type SemanticGroupDialogState =
  | Readonly<{ mode: "create"; parentId?: string; position?: number }>
  | Readonly<{ mode: "duplicate"; group: SemanticGroupTreeItem }>
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
  const { t: uiText } = useUiLocale();
  const initialGroup =
    state.mode === "rename" || state.mode === "duplicate"
      ? state.group
      : undefined;
  const [name, setName] = useState(
    state.mode === "duplicate"
      ? duplicateGroupName(state.group, groups)
      : initialGroup?.name ?? ""
  );
  const [parentId, setParentId] = useState(
    state.mode === "create"
      ? state.parentId ?? ""
      : state.mode === "rename" || state.mode === "duplicate"
        ? state.group.parentId ?? ""
        : state.mode === "move"
          ? state.suggestedTargetId ?? ""
          : ""
  );
  const [color, setColor] = useState(
    initialGroup?.color ?? semanticGroupDefaultColor
  );
  const [saving, setSaving] = useState(false);
  const [deleteKeywords, setDeleteKeywords] = useState(false);
  const [promoteChildren, setPromoteChildren] = useState(false);
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [includeKeywords, setIncludeKeywords] = useState(false);
  const [error, setError] = useState<string>();
  const formId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const namesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const movedGroups = state.mode === "move" ? state.groups : [];
  const parentOptions = groups.filter(
    (candidate) =>
      !candidate.systemKind &&
      !movedGroups.some(
        (moving) =>
          candidate.id === moving.id ||
          candidate.path.startsWith(`${moving.path} / `)
      ) &&
      (state.mode !== "rename" ||
        (candidate.id !== state.group.id &&
          !candidate.path.startsWith(`${state.group.path} / `)))
  );
  const deletedGroup =
    state.mode === "delete" && state.groups.length === 1
      ? state.groups[0]
      : undefined;
  const directChildren = deletedGroup
    ? groups.filter(
        ({ parentId, systemKind }) =>
          !systemKind && parentId === deletedGroup.id
      )
    : [];
  const unavailableSiblingNames = groups
    .filter(
      (group) =>
        !group.systemKind && (group.parentId ?? "") === parentId
    )
    .map(({ name }) => name);
  const pendingCreateCount = semanticGroupNameLineCount(name);

  useEffect(() => {
    if (
      state.mode !== "create" &&
      state.mode !== "rename" &&
      state.mode !== "duplicate"
    ) return;
    const frame = requestAnimationFrame(() => {
      const field =
        state.mode === "create"
          ? namesTextareaRef.current
          : nameInputRef.current;
      field?.focus();
      if (state.mode === "rename") nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [state.mode]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      if (state.mode === "create") {
        const names = semanticGroupNamesFromText(
          name,
          unavailableSiblingNames
        );
        await browserApiRequest(`${groupPath(projectId)}/bulk`, {
          method: "POST",
          body: {
            names,
            color,
            ...(parentId ? { parentId } : {}),
            ...(state.position !== undefined &&
            parentId === (state.parentId ?? "")
              ? { position: state.position }
              : {})
          }
        });
        onCompleted(
          names.length === 1
            ? `Группа «${names[0] ?? ""}» создана`
            : `Создано групп: ${names.length}`
        );
        return;
      }
      if (state.mode === "duplicate") {
        await browserApiRequest(
          `${groupPath(projectId, state.group.id)}/duplicate`,
          {
            method: "POST",
            ifMatch: state.group.version,
            body: {
              name,
              color,
              ...(parentId ? { parentId } : {}),
              includeDescendants,
              includeKeywords
            }
          }
        );
        onCompleted(`Группа «${state.group.name}» дублирована`);
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
            ifMatch: group.version,
            body: {
              deleteKeywords,
              promoteChildren:
                state.groups.length === 1 && promoteChildren
            }
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
      : state.mode === "duplicate"
        ? "Дублировать группу"
      : state.mode === "rename"
        ? "Изменить группу"
        : state.mode === "move"
          ? "Переместить группы"
          : "Удалить группы";
  return (
    <SemanticModal
      description={groupDialogDescription(state)}
      onClose={saving ? () => undefined : onClose}
      presenceKey={`semantic-modal:group:${state.mode}`}
      size="small"
      title={title}
      footer={
        <div className="semantic-modal-actions">
          <button
            className="secondary-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <UiText text="Отмена" /></button>
          <button
            className={state.mode === "delete" ? "danger-button" : "primary-button"}
            disabled={saving}
            form={formId}
            type="submit"
          >
            {saving
              ? state.mode === "duplicate"
                ? <UiText text="Дублируем…" />
                : <UiText text="Сохраняем…" />
              : state.mode === "delete"
                ? <UiText text="Удалить" />
                : state.mode === "move"
                  ? <UiText text="Переместить ({0})" values={[String(state.groups.length)]} />
                  : state.mode === "duplicate"
                    ? <UiText text="Создать копию" />
                    : state.mode === "create"
                      ? pendingCreateCount > 1
                        ? <UiText text="Создать ({0})" values={[String(pendingCreateCount)]} />
                        : <UiText text="Создать" />
                      : <UiText text="Сохранить" />}
          </button>
        </div>
      }
    >
      <form
        className="semantic-dialog-form"
        id={formId}
        onSubmit={(event) => void submit(event)}
      >
        {(state.mode === "create" ||
          state.mode === "rename" ||
          state.mode === "duplicate") && (
          <>
            <label>
              <span>
                {state.mode === "duplicate"
                  ? <UiText text="Название копии" />
                  : state.mode === "create"
                    ? <UiText text="Названия папок" />
                    : <UiText text="Название" />}
              </span>
              {state.mode === "create" ? (
                <textarea
                  aria-describedby={`${formId}-group-names-hint`}
                  autoFocus
                  className="semantic-group-names-textarea"
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(undefined);
                  }}
                  placeholder={uiText("Москва Санкт-Петербург Казань")}
                  ref={namesTextareaRef}
                  required
                  rows={5}
                  value={name}
                />
              ) : (
                <input
                  autoFocus
                  maxLength={255}
                  onChange={(event) => setName(event.target.value)}
                  required
                  ref={nameInputRef}
                  value={name}
                />
              )}
              {state.mode === "create" && (
                <small
                  className="semantic-group-name-hint"
                  id={`${formId}-group-names-hint`}
                >
                  <span><UiText text="Каждая непустая строка станет отдельной папкой" /></span>
                  <strong>
                    {pendingCreateCount} <UiText text="из" before=" " after=" " />{semanticKeywordGroupBulkCreateMaxItems}
                  </strong>
                </small>
              )}
            </label>
            <div className="semantic-dialog-field">
              <span>
                {state.mode === "duplicate" ? <UiText text="Создать копию в" /> : <UiText text="Расположение" />}
              </span>
              <SemanticGroupPickerField
                groups={parentOptions}
                onChange={(nextParentId) => {
                  setParentId(nextParentId);
                  setError(undefined);
                }}
                rootLabel="Корневая папка"
                value={parentId}
              />
            </div>
            <fieldset className="semantic-dialog-color">
              <legend><UiText text="Цвет" /></legend>
              <div className="semantic-dialog-color-custom">
                <label className="semantic-dialog-color-picker">
                  <span className="visually-hidden"><UiText text="Выбрать цвет" /></span>
                  <input
                    aria-label={uiText("Выбрать цвет")}
                    onChange={(event) => setColor(event.target.value.toUpperCase())}
                    type="color"
                    value={/^#[0-9a-f]{6}$/iu.test(color) ? color : semanticGroupDefaultColor}
                  />
                  <Icon name="edit" />
                </label>
                <label>
                  <span className="visually-hidden"><UiText text="HEX-код цвета" /></span>
                  <input
                    aria-label={uiText("HEX-код цвета")}
                    maxLength={7}
                    onChange={(event) => setColor(event.target.value.toUpperCase())}
                    pattern="#[0-9A-Fa-f]{6}"
                    placeholder="#6758EF"
                    required
                    spellCheck={false}
                    value={color}
                  />
                </label>
              </div>
              <div
                aria-label={uiText("Предложенные цвета группы")}
                className="semantic-dialog-color-palette"
                role="group"
              >
                {semanticGroupColors.map(({ value, label }) => (
                  <button
                    aria-label={label}
                    aria-pressed={color.toLowerCase() === value}
                    key={value}
                    onClick={() => setColor(value.toUpperCase())}
                    style={{ backgroundColor: value }}
                    title={label}
                    type="button"
                  />
                ))}
              </div>
            </fieldset>
            {state.mode === "duplicate" && (
              <div className="semantic-group-duplicate-options">
                <label className="semantic-dialog-checkbox">
                  <input
                    checked={includeKeywords}
                    onChange={(event) => setIncludeKeywords(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong><UiText text="Скопировать запросы" /></strong>
                    <small>
                      <UiText text="Те же запросы будут добавлены в копии папок без создания дублей." /></small>
                  </span>
                </label>
                <label className="semantic-dialog-checkbox">
                  <input
                    checked={includeDescendants}
                    onChange={(event) => setIncludeDescendants(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong><UiText text="Скопировать вложенные папки" /></strong>
                    <small><UiText text="Структура и порядок подгрупп сохранятся." /></small>
                  </span>
                </label>
              </div>
            )}
          </>
        )}
        {state.mode === "move" && (
          <>
            <div className="semantic-dialog-selection">
              {state.groups.map((group) => (
                <span key={group.id} title={group.path}>{group.path}</span>
              ))}
            </div>
            <div className="semantic-dialog-field">
              <span><UiText text="Куда переместить" /></span>
              <SemanticGroupPickerField
                autoFocus
                groups={parentOptions}
                onChange={setParentId}
                rootLabel="Корневая папка"
                value={parentId}
              />
            </div>
          </>
        )}
        {state.mode === "delete" && (
          <>
            <div className="inline-alert" role="status">
              {promoteChildren
                ? <UiText text="Вложенные папки и их запросы сохранятся. Удалится только выбранная папка." />
                : <UiText text="Вложенные папки удалятся вместе с выбранной. По умолчанию запросы без другого размещения попадут в «Без группы»." />}
            </div>
            {deletedGroup && directChildren.length > 0 && (
              <label className="semantic-dialog-checkbox">
                <input
                  checked={promoteChildren}
                  onChange={(event) => setPromoteChildren(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>
                    {deletedGroup.parentId
                      ? <UiText text="Перенести подгруппы на уровень выше ({0})" values={[String(directChildren.length)]} />
                      : <UiText text="Перенести подгруппы в корень ({0})" values={[String(directChildren.length)]} />}
                  </strong>
                  <small>
                    <UiText text="Сохранятся непосредственные подгруппы, вся их вложенность и запросы." /></small>
                </span>
              </label>
            )}
            <label className="semantic-dialog-checkbox">
              <input
                checked={deleteKeywords}
                onChange={(event) => setDeleteKeywords(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong><UiText text="Переместить запросы в корзину" /></strong>
                <small>
                  {promoteChildren
                    ? <UiText text="В корзину попадут запросы удаляемой папки, которые не размещены в сохраняемых или других папках." />
                    : <UiText text="Выключено по умолчанию. В корзине запросы можно удалить навсегда." />}
                </small>
              </span>
            </label>
          </>
        )}
        {error && <div className="inline-alert danger" role="alert">{<UiText text={error ?? ""} />}</div>}
      </form>
    </SemanticModal>
  );
}

function groupPath(projectId: string, groupId?: string): string {
  const base = `/app/api/projects/${encodeURIComponent(projectId)}/keyword-groups`;
  return groupId ? `${base}/${encodeURIComponent(groupId)}` : base;
}

function groupDialogDescription(state: SemanticGroupDialogState): string {
  if (state.mode === "create") return "Введите названия папок — по одному на строке.";
  if (state.mode === "duplicate") return "Создайте независимую копию папки, структуры и членств запросов.";
  if (state.mode === "rename") return "Название, цвет и родитель сохраняются с проверкой версии.";
  if (state.mode === "move") return `Выбрано групп: ${state.groups.length}. Вложенные группы переместятся вместе с родителем.`;
  return `Выбрано групп: ${state.groups.length}. Выберите, что сделать с запросами внутри.`;
}

function duplicateGroupName(
  source: SemanticGroupTreeItem,
  groups: readonly SemanticGroupTreeItem[]
): string {
  const siblingNames = new Set(
    groups
      .filter(
        (group) =>
          !group.systemKind && group.parentId === source.parentId
      )
      .map((group) => group.name.normalize("NFKC").toLocaleLowerCase("ru"))
  );
  const copyName = (suffix = "") => {
    const marker = ` — копия${suffix}`;
    return `${source.name.slice(0, 255 - marker.length).trimEnd()}${marker}`;
  };
  const base = copyName();
  if (!siblingNames.has(base.toLocaleLowerCase("ru"))) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = copyName(` (${index})`);
    if (!siblingNames.has(candidate.toLocaleLowerCase("ru"))) return candidate;
  }
  return copyName(` (${source.id.slice(0, 8)})`);
}

function groupErrorMessage(error: unknown): string {
  if (error instanceof Error && !(error instanceof BrowserApiError)) return error.message;
  if (error instanceof BrowserApiError) {
    if (error.code === "VERSION_CONFLICT") return "Группа уже изменена. Обновите дерево и повторите.";
    if (error.code === "DUPLICATE") return "Группа с таким именем уже существует на выбранном уровне.";
    if (error.code === "QUOTA_EXCEEDED") return "Достигнут лимит папок для текущего тарифа.";
    if (error.code === "RESOURCE_STATE_CONFLICT") return "Проверьте циклический перенос, вложенные группы и наличие запросов.";
    if (error.code === "FORBIDDEN") return "Недостаточно прав для изменения групп.";
    return error.message;
  }
  return "Не удалось изменить группы.";
}
