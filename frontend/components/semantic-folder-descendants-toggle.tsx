"use client";

import { Icon } from "./icon";
import { UiText, useUiLocale } from "./ui-locale";

export function SemanticFolderDescendantsToggle({
  disabled = false,
  enabled,
  folderName,
  onChange
}: Readonly<{
  disabled?: boolean;
  enabled: boolean;
  folderName: string;
  onChange: (enabled: boolean) => void;
}>) {
  const { t: uiText } = useUiLocale();
  const action = uiText(
    enabled
      ? "Не включать вложенные папки"
      : "Включить вложенные папки этой папки"
  );
  return (
    <button
      aria-label={`${action}: ${folderName}`}
      aria-pressed={enabled}
      className="semantic-folder-descendants-toggle"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      title={`${action}: ${folderName}`}
      type="button"
    >
      <Icon name="multiGroup" />
      <span className="sr-only"><UiText text="Вложенные" /></span>
    </button>
  );
}
