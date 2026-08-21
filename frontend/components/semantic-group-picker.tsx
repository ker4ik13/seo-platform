"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";
import type { SemanticGroupTreeItem } from "./semantic-group-tree";
import { Icon, type IconName } from "./icon";

interface GroupPickerRow {
  readonly group: SemanticGroupTreeItem;
  readonly depth: number;
  readonly hasChildren: boolean;
}

const GROUP_PICKER_OPEN_EVENT = "semantic-group-picker-open";
const EMPTY_SPECIAL_OPTIONS: readonly SemanticGroupPickerSpecialOption[] = [];

export interface SemanticGroupPickerSpecialOption {
  readonly icon?: IconName;
  readonly label: string;
  readonly value: string;
}

export function SemanticGroupPickerField({
  autoFocus = false,
  dialogTitle = "Расположение папки",
  groups,
  onChange,
  rootIcon = "projects",
  rootLabel = "Корневой уровень",
  searchPlaceholder = "Найти папку по названию или пути",
  specialOptions = EMPTY_SPECIAL_OPTIONS,
  value
}: Readonly<{
  autoFocus?: boolean;
  dialogTitle?: string;
  groups: readonly SemanticGroupTreeItem[];
  onChange: (groupId: string) => void;
  rootIcon?: IconName;
  rootLabel?: string;
  searchPlaceholder?: string;
  specialOptions?: readonly SemanticGroupPickerSpecialOption[];
  value: string;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => !systemKind),
    [groups]
  );
  const selected = availableGroups.find(({ id }) => id === value);
  const selectedSpecial = specialOptions.find((option) => option.value === value);
  const selectedLabel = selected?.path ?? selectedSpecial?.label ?? rootLabel;
  const selectedName = selected?.name ?? selectedSpecial?.label ?? rootLabel;
  const portalTarget =
    typeof document === "undefined"
      ? undefined
      : triggerRef.current?.closest("dialog") ?? document.body;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const viewportPadding = 10;
    const gap = 6;
    const width = Math.min(
      Math.max(bounds.width, 360),
      window.innerWidth - viewportPadding * 2
    );
    const left = Math.min(
      Math.max(viewportPadding, bounds.left),
      window.innerWidth - width - viewportPadding
    );
    const below = window.innerHeight - bounds.bottom - gap - viewportPadding;
    const above = bounds.top - gap - viewportPadding;
    const openBelow = below >= 280 || below >= above;
    const availableHeight = Math.max(220, openBelow ? below : above);
    setPopoverStyle({
      left,
      maxHeight: Math.min(430, availableHeight),
      top: openBelow
        ? bounds.bottom + gap
        : Math.max(
            viewportPadding,
            bounds.top - Math.min(430, availableHeight) - gap
          ),
      width
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const closeForAnotherPicker = (event: Event) => {
      if ((event as CustomEvent<EventTarget>).detail !== triggerRef.current) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener(GROUP_PICKER_OPEN_EVENT, closeForAnotherPicker);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener(GROUP_PICKER_OPEN_EVENT, closeForAnotherPicker);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => triggerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  return (
    <>
      <button
        aria-label={`${dialogTitle}: ${selectedLabel}${selected ? `. Запросов в группе: ${formatInteger(selected.keywordCount)}` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="semantic-group-picker-trigger"
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) {
              window.dispatchEvent(
                new CustomEvent(GROUP_PICKER_OPEN_EVENT, {
                  detail: triggerRef.current
                })
              );
            }
            return next;
          });
        }}
        ref={triggerRef}
        type="button"
      >
        <i style={{ backgroundColor: selected?.color ?? "transparent" }} />
        <span className="semantic-group-picker-trigger-copy">
          <strong>{selectedName}</strong>
          {selected && selected.path !== selected.name && (
            <OverflowingGroupPath path={selected.path} />
          )}
        </span>
        {selected && (
          <b
            className="semantic-group-picker-trigger-count"
            title={`Запросов в группе: ${formatInteger(selected.keywordCount)}`}
          >
            {formatInteger(selected.keywordCount)}
          </b>
        )}
        <Icon className={open ? "expanded" : undefined} name="chevronRight" />
      </button>
      {open && popoverStyle && portalTarget &&
        createPortal(
          <div
            aria-label={`Выбор: ${dialogTitle}`}
            className="semantic-group-picker-popover"
            data-exclusive-dropdown-layer
            onMouseDown={(event) => event.stopPropagation()}
            ref={popoverRef}
            role="dialog"
            style={popoverStyle}
          >
            <header>
              <span>
                <strong>{dialogTitle}</strong>
                <small title={selectedLabel}>{selectedLabel}</small>
              </span>
              <button
                aria-label={`Закрыть: ${dialogTitle}`}
                onClick={() => setOpen(false)}
                type="button"
              >
                <Icon name="close" />
              </button>
            </header>
            <SemanticGroupPicker
              autoFocus
              groups={availableGroups}
              onChange={(groupId) => {
                onChange(groupId);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
              rootIcon={rootIcon}
              rootLabel={rootLabel}
              searchPlaceholder={searchPlaceholder}
              specialOptions={specialOptions}
              value={value}
            />
          </div>,
          portalTarget
        )}
    </>
  );
}

function OverflowingGroupPath({ path }: Readonly<{ path: string }>) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const measure = () => {
      const trailingGap = Number.parseFloat(
        window.getComputedStyle(content).paddingRight
      );
      const naturalWidth = content.scrollWidth - (trailingGap || 0);
      setOverflowing(naturalWidth > viewport.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [path]);

  return (
    <small
      aria-hidden="true"
      className={`semantic-group-picker-trigger-path${overflowing ? " is-overflowing" : ""}`}
      ref={viewportRef}
      title={path}
    >
      <span className="semantic-group-picker-trigger-path-track">
        <span ref={contentRef}>{path}</span>
        {overflowing && <span>{path}</span>}
      </span>
    </small>
  );
}

export function SemanticGroupPicker({
  autoFocus = false,
  className,
  groups,
  onChange,
  rootIcon = "inbox",
  rootLabel = "Без группы",
  searchPlaceholder = "Найти папку по названию или пути",
  showRootOption = true,
  specialOptions = EMPTY_SPECIAL_OPTIONS,
  value
}: Readonly<{
  autoFocus?: boolean;
  className?: string;
  groups: readonly SemanticGroupTreeItem[];
  onChange: (groupId: string) => void;
  rootIcon?: IconName;
  rootLabel?: string;
  searchPlaceholder?: string;
  showRootOption?: boolean;
  specialOptions?: readonly SemanticGroupPickerSpecialOption[];
  value: string;
}>) {
  const availableGroups = useMemo(
    () => groups.filter(({ systemKind }) => !systemKind),
    [groups]
  );
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => initiallyExpandedGroupIds(availableGroups, value)
  );
  const rows = useMemo(
    () => groupPickerRows(availableGroups, expandedIds, search),
    [availableGroups, expandedIds, search]
  );

  function toggleExpanded(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={`semantic-group-picker${className ? ` ${className}` : ""}`}>
      <label className="semantic-move-search">
        <span className="visually-hidden">Поиск группы</span>
        <Icon name="search" />
        <input
          autoFocus={autoFocus}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          type="search"
          value={search}
        />
      </label>
      <div aria-label="Дерево групп" className="semantic-move-tree" role="tree">
        {specialOptions.map((option) => (
          <button
            aria-selected={value === option.value}
            className={`semantic-move-tree-row root special${value === option.value ? " selected" : ""}`}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="treeitem"
            type="button"
          >
            <span className="semantic-move-tree-spacer" />
            <Icon name={option.icon ?? "list"} />
            <span>{option.label}</span>
            {value === option.value && <Icon name="checkDouble" />}
          </button>
        ))}
        {showRootOption && (
          <button
            aria-selected={value === ""}
            className={`semantic-move-tree-row root${value === "" ? " selected" : ""}`}
            onClick={() => onChange("")}
            role="treeitem"
            type="button"
          >
            <span className="semantic-move-tree-spacer" />
            <Icon name={rootIcon} />
            <span>{rootLabel}</span>
            {value === "" && <Icon name="checkDouble" />}
          </button>
        )}
        {rows.map(({ group, depth, hasChildren }) => {
          const expanded = expandedIds.has(group.id) || Boolean(search.trim());
          const selected = group.id === value;
          return (
            <div
              className={`semantic-move-tree-row${selected ? " selected" : ""}`}
              key={group.id}
              role="none"
              style={{ "--move-group-depth": depth } as CSSProperties}
            >
              <button
                aria-label={hasChildren
                  ? expanded
                    ? `Свернуть ${group.name}`
                    : `Развернуть ${group.name}`
                  : undefined}
                className="semantic-move-tree-toggle"
                disabled={!hasChildren || Boolean(search.trim())}
                onClick={() => toggleExpanded(group.id)}
                tabIndex={hasChildren ? 0 : -1}
                type="button"
              >
                {hasChildren && (
                  <Icon
                    className={expanded ? "expanded" : undefined}
                    name="chevronRight"
                  />
                )}
              </button>
              <button
                aria-selected={selected}
                className="semantic-move-tree-choice"
                onClick={() => onChange(group.id)}
                role="treeitem"
                title={group.path}
                type="button"
              >
                <i style={{ backgroundColor: group.color ?? "#aaa6bb" }} />
                <span>
                  <strong>{group.name}</strong>
                  {depth > 0 && <small>{group.path}</small>}
                </span>
                <b>{formatInteger(group.keywordCount)}</b>
                {selected && <Icon name="checkDouble" />}
              </button>
            </div>
          );
        })}
        {rows.length === 0 && search.trim() && (
          <div className="semantic-move-tree-empty">Группы не найдены</div>
        )}
      </div>
    </div>
  );
}

function initiallyExpandedGroupIds(
  groups: readonly SemanticGroupTreeItem[],
  selectedId: string
): ReadonlySet<string> {
  const result = new Set(
    groups.filter(({ parentId }) => !parentId).map(({ id }) => id)
  );
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (let current = byId.get(selectedId); current?.parentId; ) {
    result.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return result;
}

function groupPickerRows(
  groups: readonly SemanticGroupTreeItem[],
  expandedIds: ReadonlySet<string>,
  search: string
): readonly GroupPickerRow[] {
  const normalizedSearch = search.normalize("NFKC").trim().toLocaleLowerCase("ru");
  const byParent = new Map<string, SemanticGroupTreeItem[]>();
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    const parent = group.parentId && byId.has(group.parentId) ? group.parentId : "";
    const siblings = byParent.get(parent) ?? [];
    siblings.push(group);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (left, right) =>
        left.position - right.position || left.name.localeCompare(right.name, "ru")
    );
  }
  const visibleIds = new Set<string>();
  if (normalizedSearch) {
    for (const group of groups) {
      if (!`${group.name}\n${group.path}`
        .normalize("NFKC")
        .toLocaleLowerCase("ru")
        .includes(normalizedSearch)) continue;
      for (
        let current: SemanticGroupTreeItem | undefined = group;
        current;
        current = current.parentId ? byId.get(current.parentId) : undefined
      ) {
        if (visibleIds.has(current.id)) break;
        visibleIds.add(current.id);
      }
    }
  }
  const rows: GroupPickerRow[] = [];
  const visited = new Set<string>();
  const append = (parentId: string, depth: number): void => {
    for (const group of byParent.get(parentId) ?? []) {
      if (visited.has(group.id) || (normalizedSearch && !visibleIds.has(group.id))) continue;
      visited.add(group.id);
      const children = byParent.get(group.id) ?? [];
      rows.push({ group, depth, hasChildren: children.length > 0 });
      if (normalizedSearch || expandedIds.has(group.id)) append(group.id, depth + 1);
    }
  };
  append("", 0);
  return rows;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
