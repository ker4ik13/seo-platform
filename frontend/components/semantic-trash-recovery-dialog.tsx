"use client";

import { useMemo, useState } from "react";
import type {
  SemanticKeywordBulkCreateItemInput,
  SemanticKeywordBulkCreateResult
} from "@seo-platform/contracts";
import { browserApiRequest } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";

export interface SemanticTrashRecoveryItem {
  readonly keywordId: string;
  readonly text: string;
  readonly input: SemanticKeywordBulkCreateItemInput;
}

export function SemanticTrashRecoveryDialog({
  items,
  onClose,
  onCompleted,
  projectId
}: Readonly<{
  items: readonly SemanticTrashRecoveryItem[];
  onClose: () => void;
  onCompleted: (result: { restored: number; skipped: number }) => void;
  projectId: string;
}>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(items.map(({ keywordId }) => keywordId))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const selectedItems = useMemo(
    () => items.filter(({ keywordId }) => selected.has(keywordId)),
    [items, selected]
  );

  function toggle(keywordId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keywordId)) next.delete(keywordId);
      else next.add(keywordId);
      return next;
    });
  }

  async function restore(): Promise<void> {
    if (saving || selectedItems.length === 0) return;
    setSaving(true);
    setError(undefined);
    let restored = 0;
    let skipped = 0;
    try {
      for (let offset = 0; offset < selectedItems.length; offset += 100) {
        const chunk = selectedItems.slice(offset, offset + 100);
        const result = await browserApiRequest<SemanticKeywordBulkCreateResult>(
          `/app/api/projects/${encodeURIComponent(projectId)}/keywords/bulk`,
          {
            method: "POST",
            body: {
              duplicatePolicy: "RESTORE_TRASHED",
              items: chunk.map(({ input }) => input)
            }
          }
        );
        restored += result.restored;
        skipped += result.skipped;
        if (result.failed > 0 || result.rejected > 0) {
          throw new Error(
            `Не удалось восстановить ${result.failed + result.rejected} запросов.`
          );
        }
      }
      onCompleted({ restored, skipped });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось восстановить запросы из корзины."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SemanticModal
      description="Эти запросы уже находятся в корзине. Отметьте те, которые нужно восстановить и добавить в проект."
      onClose={saving ? () => undefined : onClose}
      presenceKey="semantic-modal:trash-recovery"
      size="large"
      title="Найдены запросы в корзине"
    >
      <div className="semantic-trash-recovery">
        <div className="semantic-trash-recovery-summary">
          <label>
            <input
              checked={selected.size === items.length}
              onChange={() =>
                setSelected(
                  selected.size === items.length
                    ? new Set()
                    : new Set(items.map(({ keywordId }) => keywordId))
                )
              }
              type="checkbox"
            />
            <span>Выбрать все</span>
          </label>
          <span>Выбрано: {selected.size} из {items.length}</span>
        </div>
        <div className="semantic-trash-recovery-table" role="region" aria-label="Запросы в корзине">
          <table>
            <thead>
              <tr>
                <th aria-label="Выбор" />
                <th>Запрос</th>
                <th>Язык</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.keywordId}>
                  <td>
                    <input
                      aria-label={`Восстановить ${item.text}`}
                      checked={selected.has(item.keywordId)}
                      onChange={() => toggle(item.keywordId)}
                      type="checkbox"
                    />
                  </td>
                  <td><strong>{item.text}</strong></td>
                  <td>{item.input.language}</td>
                  <td>Убрать из корзины</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <div className="inline-alert danger" role="alert">{error}</div>}
        <div className="semantic-editor-actions">
          <button className="secondary-button" disabled={saving} onClick={onClose} type="button">
            Пропустить
          </button>
          <button className="primary-button" disabled={saving || selected.size === 0} onClick={() => void restore()} type="button">
            {saving ? "Восстанавливаем…" : `Восстановить (${selected.size})`}
          </button>
        </div>
      </div>
    </SemanticModal>
  );
}
