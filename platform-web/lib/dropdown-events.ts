export const workspaceDropdownOpenEvent = "seo-workspace:dropdown-open";

export function announceWorkspaceDropdownOpen(owner: EventTarget): void {
  window.dispatchEvent(
    new CustomEvent<EventTarget>(workspaceDropdownOpenEvent, { detail: owner })
  );
}
