"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  SemanticKeywordMergeInput,
  SemanticKeywordMergeResult,
  SemanticKeywordMergeSuggestion
} from "@seo-platform/contracts";
import { browserApiRequest, BrowserApiError } from "../lib/browser-api";
import { Icon } from "./icon";
import { UiText } from "./ui-locale";

type KeeperChoice = "SOURCE" | "CANDIDATE";

export function SemanticKeywordMergeSettings({
  projectId
}: Readonly<{ projectId: string }>) {
  const [suggestions, setSuggestions] = useState<readonly SemanticKeywordMergeSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [keeperBySource, setKeeperBySource] = useState<ReadonlyMap<string, KeeperChoice>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function load(): Promise<void> {
    setLoading(true);
    setError(undefined);
    try {
      const rows = await browserApiRequest<readonly SemanticKeywordMergeSuggestion[]>(
        `/app/api/projects/${encodeURIComponent(projectId)}/keywords/merge-suggestions`
      );
      setSuggestions(rows);
      setSelectedIds(new Set());
      setKeeperBySource(new Map(rows.map(({ source }) => [source.id, "CANDIDATE" as const])));
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // The project id is the complete server scope for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selectedCount = selectedIds.size;
  const commands = useMemo(() => {
    const grouped = new Map<string, SemanticKeywordMergeInput>();
    for (const suggestion of suggestions) {
      if (!selectedIds.has(suggestion.source.id)) continue;
      const sourceWins = keeperBySource.get(suggestion.source.id) === "SOURCE";
      const keeper = sourceWins ? suggestion.source : suggestion.candidate;
      const merged = sourceWins ? suggestion.candidate : suggestion.source;
      const current = grouped.get(keeper.id);
      grouped.set(keeper.id, {
        keeper: { id: keeper.id, version: keeper.version },
        sources: [
          ...(current?.sources ?? []),
          { id: merged.id, version: merged.version }
        ]
      });
    }
    return [...grouped.values()];
  }, [keeperBySource, selectedIds, suggestions]);

  async function apply(): Promise<void> {
    if (commands.length === 0 || saving) return;
    const participants = commands.flatMap(({ keeper, sources }) => [
      keeper.id,
      ...sources.map(({ id }) => id)
    ]);
    if (new Set(participants).size !== participants.length) {
      setError("Один запрос участвует сразу в нескольких выбранных объединениях. Оставьте только один вариант для него.");
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const results: SemanticKeywordMergeResult[] = [];
      for (const command of commands) {
        results.push(await browserApiRequest<SemanticKeywordMergeResult>(
          `/app/api/projects/${encodeURIComponent(projectId)}/keywords/merge`,
          { method: "POST", body: command }
        ));
      }
      const merged = results.reduce(
        (total, result) => total + result.mergedKeywordIds.length,
        0
      );
      setNotice(`Объединено запросов: ${merged}. История и данные доступны у сохранённых запросов.`);
      await load();
    } catch (requestError) {
      setError(message(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel security-card semantic-merge-settings">
      <header className="security-card-header">
        <div>
          <h2><UiText text="Похожие и повреждённые запросы" /></h2>
          <p><UiText text="Система находит названия с ошибками кодировки и предлагает ближайший запрос. Вы сами выбираете пары и название, которое останется." /></p>
        </div>
        <button className="secondary-button" disabled={loading || saving} onClick={() => void load()} type="button">
          <Icon name="refresh" />
          {loading ? <UiText text="Ищем…" /> : <UiText text="Проверить снова" />}
        </button>
      </header>
      {error && <div className="inline-alert danger" role="alert">{error}</div>}
      {notice && <div className="inline-alert success" role="status">{notice}</div>}
      {!loading && suggestions.length === 0 && (
        <div className="semantic-merge-empty"><Icon name="checkDouble" /><span><strong><UiText text="Похожих повреждённых запросов не найдено" /></strong><small><UiText text="Новые импорты также проверяют кодировку до создания запросов." /></small></span></div>
      )}
      {suggestions.length > 0 && (
        <div className="semantic-merge-suggestions">
          {suggestions.map((suggestion) => {
            const selected = selectedIds.has(suggestion.source.id);
            const keeper = keeperBySource.get(suggestion.source.id) ?? "CANDIDATE";
            return (
              <article className={selected ? "selected" : undefined} key={suggestion.source.id}>
                <label className="semantic-merge-select">
                  <input checked={selected} disabled={saving} onChange={() => setSelectedIds((current) => {
                    const next = new Set(current);
                    if (next.has(suggestion.source.id)) next.delete(suggestion.source.id);
                    else next.add(suggestion.source.id);
                    return next;
                  })} type="checkbox" />
                  <span><UiText text="Объединить эту пару" /></span>
                  <b>{Math.round(suggestion.similarity * 100)}%</b>
                </label>
                <fieldset disabled={!selected || saving}>
                  <legend><UiText text="Какое название сохранить" /></legend>
                  <label className={keeper === "SOURCE" ? "selected" : undefined}>
                    <input checked={keeper === "SOURCE"} name={`merge-keeper-${suggestion.source.id}`} onChange={() => setKeeperBySource((current) => new Map(current).set(suggestion.source.id, "SOURCE"))} type="radio" />
                    <span><small><UiText text="Текущее повреждённое" /></small><strong>{suggestion.source.text}</strong></span>
                  </label>
                  <label className={keeper === "CANDIDATE" ? "selected" : undefined}>
                    <input checked={keeper === "CANDIDATE"} name={`merge-keeper-${suggestion.source.id}`} onChange={() => setKeeperBySource((current) => new Map(current).set(suggestion.source.id, "CANDIDATE"))} type="radio" />
                    <span><small><UiText text="Найденный вариант" /></small><strong>{suggestion.candidate.text}</strong></span>
                  </label>
                </fieldset>
              </article>
            );
          })}
        </div>
      )}
      {suggestions.length > 0 && (
        <footer className="settings-savebar">
          <span><UiText text="Выбрано пар:" after=" " />{selectedCount}</span>
          <button className="primary-button" disabled={selectedCount === 0 || saving} onClick={() => void apply()} type="button">
            {saving ? <UiText text="Объединяем…" /> : <UiText text="Объединить выбранные" />}
          </button>
        </footer>
      )}
    </section>
  );
}

function message(error: unknown): string {
  if (error instanceof BrowserApiError) return error.message;
  return "Не удалось проверить или объединить запросы.";
}
