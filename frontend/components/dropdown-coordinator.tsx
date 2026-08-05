"use client";

import { useEffect } from "react";
import {
  announceWorkspaceDropdownOpen,
  workspaceDropdownOpenEvent
} from "../lib/dropdown-events";

export function DropdownCoordinator() {
  useEffect(() => {
    const closeDetailsExcept = (owner?: EventTarget | null) => {
      for (const details of document.querySelectorAll<HTMLDetailsElement>(
        "details[data-exclusive-dropdown][open]"
      )) {
        // A CustomSelect renders its listbox through a portal, but announces
        // the in-place control root as its owner. Keep an open parent menu
        // when that owner belongs to the parent; only unrelated layers are
        // mutually exclusive.
        if (
          details !== owner &&
          (!(owner instanceof Node) || !details.contains(owner))
        ) {
          details.open = false;
        }
      }
    };
    const onDropdownOpen = (event: Event) => {
      closeDetailsExcept((event as CustomEvent<EventTarget>).detail);
    };
    const onToggle = (event: Event) => {
      const details = event.target;
      if (
        !(details instanceof HTMLDetailsElement) ||
        !details.open ||
        !details.hasAttribute("data-exclusive-dropdown")
      ) {
        return;
      }
      closeDetailsExcept(details);
      announceWorkspaceDropdownOpen(details);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        target instanceof Element &&
        target.closest(".custom-select-popover, [data-exclusive-dropdown-layer]")
      ) {
        return;
      }
      for (const details of document.querySelectorAll<HTMLDetailsElement>(
        "details[data-exclusive-dropdown][open]"
      )) {
        if (!details.contains(target)) details.open = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetailsExcept();
    };
    window.addEventListener(workspaceDropdownOpenEvent, onDropdownOpen);
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(workspaceDropdownOpenEvent, onDropdownOpen);
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
