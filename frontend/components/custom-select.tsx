"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes
} from "react";
import { createPortal } from "react-dom";
import {
  announceWorkspaceDropdownOpen,
  workspaceDropdownOpenEvent
} from "../lib/dropdown-events";
import {
  filterSelectOptions,
  moveSelectValue,
  nextSelectIndex,
  normalizeSelectSearchText
} from "../lib/custom-select";

interface CustomSelectOption {
  readonly disabled: boolean;
  readonly key: string;
  readonly label: ReactNode;
  readonly searchText: string;
  readonly value: string;
}

export interface CustomSelectChangeEvent {
  readonly currentTarget: {
    readonly name: string;
    readonly value: string;
  };
  readonly target: {
    readonly name: string;
    readonly value: string;
  };
}

type NativeSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "defaultValue" | "multiple" | "onChange" | "size" | "value"
>;

export interface CustomSelectProps extends NativeSelectProps {
  readonly children: ReactNode;
  readonly defaultValue?: string | number;
  readonly emptyMessage?: string;
  readonly onChange?: (event: CustomSelectChangeEvent) => void;
  readonly onOptionOrderChange?: (
    values: readonly string[]
  ) => void | Promise<void>;
  readonly optionOrderLabel?: string;
  readonly popoverFooter?: ReactNode;
  readonly searchPlaceholder?: string;
  readonly searchable?: boolean;
  readonly showSelectedCheck?: boolean;
  readonly value?: string | number;
}

export function CustomSelect({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  autoFocus,
  children,
  className,
  defaultValue,
  disabled = false,
  emptyMessage = "Ничего не найдено",
  id,
  name = "",
  onBlur,
  onChange,
  onOptionOrderChange,
  onFocus,
  popoverFooter,
  required = false,
  searchPlaceholder = "Поиск…",
  searchable = false,
  showSelectedCheck = true,
  title,
  optionOrderLabel = "Изменить порядок",
  value
}: CustomSelectProps) {
  const generatedId = useId();
  const selectId = id ?? `custom-select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [opensUpward, setOpensUpward] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties>({});
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    String(defaultValue ?? "")
  );
  const options = useMemo(() => collectOptions(children), [children]);
  const sourceOptionOrder = JSON.stringify(options.map(({ value }) => value));
  const sourceOptionValues = useMemo(
    () => JSON.parse(sourceOptionOrder) as readonly string[],
    [sourceOptionOrder]
  );
  const [orderedValues, setOrderedValues] = useState<readonly string[]>(() =>
    options.map(({ value }) => value)
  );
  const [draggedValue, setDraggedValue] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    readonly edge: "before" | "after";
    readonly value: string;
  }>();
  const [ordering, setOrdering] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string>();
  const suppressChooseRef = useRef(false);
  useEffect(() => {
    setOrderedValues(sourceOptionValues);
  }, [sourceOptionValues]);
  const orderedOptions = useMemo(() => {
    const byValue = new Map(options.map((option) => [option.value, option]));
    return [
      ...orderedValues.flatMap((value) => {
        const option = byValue.get(value);
        return option ? [option] : [];
      }),
      ...options.filter((option) => !orderedValues.includes(option.value))
    ];
  }, [options, orderedValues]);
  const selectedValue = value === undefined ? uncontrolledValue : String(value);
  const selectedOption = orderedOptions.find(
    (option) => option.value === selectedValue
  );
  const filteredOptions = useMemo(
    () => filterSelectOptions(orderedOptions, query),
    [orderedOptions, query]
  );

  useEffect(() => {
    if (!autoFocus) return;
    triggerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const root = rootRef.current;
    const form = root?.closest("form");
    if (!form || value !== undefined) return;
    const reset = () => setUncontrolledValue(String(defaultValue ?? ""));
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) close();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    const reposition = () => updatePopoverPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    const closeForAnotherDropdown = (event: Event) => {
      if (
        open &&
        (event as CustomEvent<EventTarget>).detail !== rootRef.current
      ) {
        close();
      }
    };
    window.addEventListener(
      workspaceDropdownOpenEvent,
      closeForAnotherDropdown
    );
    return () =>
      window.removeEventListener(
        workspaceDropdownOpenEvent,
        closeForAnotherDropdown
      );
  }, [open]);

  useEffect(() => {
    if (!open || !searchable) return;
    searchRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredOptions.findIndex(
      (option) => option.value === selectedValue && !option.disabled
    );
    setActiveIndex(
      selectedIndex >= 0
        ? selectedIndex
        : nextSelectIndex(filteredOptions, -1, 1)
    );
  }, [filteredOptions, open, selectedValue]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  function show(): void {
    if (disabled) return;
    const root = rootRef.current;
    setPortalTarget(
      root?.closest<HTMLElement>("[data-dropdown-portal-root]") ??
        root?.closest<HTMLDialogElement>("dialog[open]") ??
        root?.ownerDocument.body ??
        null
    );
    updatePopoverPosition();
    setOpen(true);
    setQuery("");
    if (root) announceWorkspaceDropdownOpen(root);
  }

  function close(restoreFocus = false): void {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(option: CustomSelectOption): void {
    if (option.disabled || suppressChooseRef.current) return;
    if (value === undefined) setUncontrolledValue(option.value);
    const event = {
      currentTarget: { name, value: option.value },
      target: { name, value: option.value }
    } satisfies CustomSelectChangeEvent;
    onChange?.(event);
    close(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (
      open &&
      onOptionOrderChange &&
      !query &&
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      const target = filteredOptions[
        activeIndex + (event.key === "ArrowUp" ? -1 : 1)
      ];
      if (option && target && !option.disabled && !target.disabled) {
        const next = moveSelectValue(
          orderedOptions.map(({ value }) => value),
          option.value,
          target.value,
          event.key === "ArrowUp" ? "before" : "after"
        );
        void commitOptionOrder(next, option.searchText);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      setActiveIndex((current) =>
        nextSelectIndex(
          filteredOptions,
          current,
          event.key === "ArrowDown" ? 1 : -1
        )
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(
        nextSelectIndex(
          filteredOptions,
          event.key === "Home" ? -1 : 0,
          event.key === "Home" ? 1 : -1
        )
      );
      return;
    }
    if (
      event.key === "Enter" ||
      (event.key === " " && event.currentTarget === triggerRef.current)
    ) {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const option = filteredOptions[activeIndex];
      if (option) choose(option);
    }
  }

  async function commitOptionOrder(
    nextValues: readonly string[],
    movedLabel: string
  ): Promise<void> {
    if (!onOptionOrderChange || ordering) return;
    const previous = orderedOptions.map(({ value }) => value);
    if (
      nextValues.length === previous.length &&
      nextValues.every((value, index) => value === previous[index])
    ) return;
    setOrderedValues(nextValues);
    setOrdering(true);
    setOrderMessage("Сохраняем порядок…");
    try {
      await onOptionOrderChange(nextValues);
      setOrderMessage(`Порядок сохранён: ${movedLabel}`);
    } catch (error) {
      setOrderedValues(previous);
      setOrderMessage(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить порядок"
      );
    } finally {
      setOrdering(false);
    }
  }

  function startOptionDrag(
    event: DragEvent<HTMLButtonElement>,
    option: CustomSelectOption
  ): void {
    if (!onOptionOrderChange || query || ordering || option.disabled) {
      event.preventDefault();
      return;
    }
    suppressChooseRef.current = true;
    setDraggedValue(option.value);
    setOrderMessage(undefined);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", option.value);
  }

  function updateOptionDropTarget(
    event: DragEvent<HTMLButtonElement>,
    option: CustomSelectOption
  ): void {
    if (!draggedValue || draggedValue === option.value || query || ordering) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      value: option.value,
      edge: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after"
    });
  }

  function dropOption(
    event: DragEvent<HTMLButtonElement>,
    option: CustomSelectOption
  ): void {
    event.preventDefault();
    if (!draggedValue || !dropTarget || dropTarget.value !== option.value) {
      endOptionDrag();
      return;
    }
    const dragged = orderedOptions.find(({ value }) => value === draggedValue);
    const next = moveSelectValue(
      orderedOptions.map(({ value }) => value),
      draggedValue,
      option.value,
      dropTarget.edge
    );
    endOptionDrag();
    void commitOptionOrder(next, dragged?.searchText ?? draggedValue);
  }

  function endOptionDrag(): void {
    setDraggedValue(undefined);
    setDropTarget(undefined);
    window.setTimeout(() => {
      suppressChooseRef.current = false;
    }, 0);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (
      event.relatedTarget &&
      (rootRef.current?.contains(event.relatedTarget) ||
        popoverRef.current?.contains(event.relatedTarget))
    ) return;
    onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>);
  }

  function updatePopoverPosition(): void {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const viewportPadding = 8;
    const width = Math.min(
      Math.max(rect.width, 220),
      window.innerWidth - viewportPadding * 2
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding
    );
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const upward = spaceBelow < 220 && spaceAbove > spaceBelow;
    setOpensUpward(upward);
    setPopoverPosition({
      bottom: upward ? window.innerHeight - rect.top + gap : undefined,
      left,
      maxHeight: Math.max(120, Math.min(320, upward ? spaceAbove : spaceBelow)),
      top: upward ? undefined : rect.bottom + gap,
      width
    });
  }

  return (
    <div
      className={`custom-select${open ? " is-open" : ""}${opensUpward ? " opens-upward" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      onBlur={handleBlur}
      onFocus={(event) => onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>)}
      ref={rootRef}
    >
      {name && <input name={name} type="hidden" value={selectedValue} />}
      <button
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        className="custom-select-trigger"
        disabled={disabled}
        id={selectId}
        onClick={() => (open ? close() : show())}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        role="combobox"
        title={title}
        type="button"
      >
        <span className={`custom-select-value${selectedOption ? "" : " is-placeholder"}`}>
          {selectedOption?.label ?? "Выберите значение"}
        </span>
        <span aria-hidden="true" className="custom-select-chevron" />
      </button>
      {open && portalTarget && createPortal(
        <div
          className={`custom-select-popover${opensUpward ? " opens-upward" : ""}${showSelectedCheck ? "" : " without-selected-check"}`}
          data-exclusive-dropdown-layer
          ref={popoverRef}
          style={popoverPosition}
        >
          {searchable && (
            <div className="custom-select-search-wrap">
              <span aria-hidden="true" className="custom-select-search-icon">⌕</span>
              <input
                aria-label={searchPlaceholder}
                className="custom-select-search"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                ref={searchRef}
                type="search"
                value={query}
              />
            </div>
          )}
          <div aria-label={ariaLabel} className="custom-select-options" id={listboxId} role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="custom-select-empty">{emptyMessage}</div>
            ) : (
              filteredOptions.map((option, index) => (
                <button
                  aria-disabled={option.disabled}
                  aria-selected={option.value === selectedValue}
                  className={`custom-select-option${index === activeIndex ? " is-active" : ""}${option.value === selectedValue ? " is-selected" : ""}${draggedValue === option.value ? " is-dragging" : ""}${dropTarget?.value === option.value ? ` drop-${dropTarget.edge}` : ""}${onOptionOrderChange ? " is-reorderable" : ""}`}
                  disabled={option.disabled}
                  draggable={Boolean(onOptionOrderChange && !query && !ordering && !option.disabled)}
                  id={`${listboxId}-option-${index}`}
                  key={option.key}
                  onClick={() => choose(option)}
                  onDragEnd={endOptionDrag}
                  onDragOver={(event) => updateOptionDropTarget(event, option)}
                  onDragStart={(event) => startOptionDrag(event, option)}
                  onDrop={(event) => dropOption(event, option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  {onOptionOrderChange && (
                    <span
                      aria-hidden="true"
                      className="custom-select-drag-handle"
                      title={`${optionOrderLabel}. Также доступно Alt + стрелка`}
                    >
                      ⋮⋮
                    </span>
                  )}
                  {showSelectedCheck && (
                    <span className="custom-select-check" aria-hidden="true">
                      {option.value === selectedValue ? "✓" : ""}
                    </span>
                  )}
                  <span>{option.label}</span>
                </button>
              ))
            )}
          </div>
          {popoverFooter && (
            <div
              className="custom-select-popover-footer"
              onClick={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest("a,button")) {
                  close();
                }
              }}
            >
              {popoverFooter}
            </div>
          )}
          {onOptionOrderChange && (
            <p
              aria-live="polite"
              className={`custom-select-order-status${orderMessage && !ordering && orderMessage.startsWith("Не удалось") ? " is-error" : ""}`}
            >
              {orderMessage ?? `${optionOrderLabel}: перетащите строку или нажмите Alt + ↑/↓`}
            </p>
          )}
        </div>,
        portalTarget
      )}
      {required && !selectedValue && (
        <span aria-live="polite" className="visually-hidden">Выберите обязательное значение</span>
      )}
    </div>
  );
}

function collectOptions(children: ReactNode): readonly CustomSelectOption[] {
  const result: CustomSelectOption[] = [];
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === "option") {
        const option = child as ReactElement<{
          children?: ReactNode;
          disabled?: boolean;
          value?: string | number;
        }>;
        const value = String(option.props.value ?? textFromNode(option.props.children));
        const searchText = normalizeSelectSearchText(
          `${textFromNode(option.props.children)} ${value}`
        );
        result.push({
          disabled: Boolean(option.props.disabled),
          key: String(option.key ?? `${value}-${result.length}`),
          label: option.props.children,
          searchText,
          value
        });
        return;
      }
      const nested = child as ReactElement<{ children?: ReactNode }>;
      if (child.type === "optgroup" || child.type === Fragment) {
        visit(nested.props.children);
      }
    });
  };
  visit(children);
  return result;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  let text = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      text += ` ${String(child)}`;
    } else if (isValidElement(child)) {
      text += ` ${textFromNode((child as ReactElement<{ children?: ReactNode }>).props.children)}`;
    }
  });
  return text.trim();
}
