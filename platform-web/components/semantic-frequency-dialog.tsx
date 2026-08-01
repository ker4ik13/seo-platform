"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  FrequencyCollectionSummary,
  SemanticFrequencyDevice,
  SemanticFrequencyType
} from "@seo-platform/contracts";
import { BrowserApiError, browserApiRequest } from "../lib/browser-api";
import { SemanticModal } from "./semantic-modal";

export function SemanticFrequencyDialog({
  onClose,
  onStarted,
  projectId,
  selections
}: Readonly<{
  onClose: () => void;
  onStarted: (collection: FrequencyCollectionSummary) => void;
  projectId: string;
  selections: readonly Readonly<{ id: string; version: number }>[];
}>) {
  const [types, setTypes] = useState<ReadonlySet<SemanticFrequencyType>>(
    new Set(["BASE", "EXACT", "FIXED"])
  );
  const [regionCode, setRegionCode] = useState("213");
  const [device, setDevice] = useState<SemanticFrequencyDevice>("ALL");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const orderedTypes = useMemo(
    () => (["BASE", "EXACT", "FIXED"] as const).filter((type) => types.has(type)),
    [types]
  );

  function toggleType(type: SemanticFrequencyType): void {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (running || orderedTypes.length === 0) return;
    setRunning(true);
    setError(undefined);
    try {
      const collection = await browserApiRequest<FrequencyCollectionSummary>(
        `/app/api/projects/${encodeURIComponent(projectId)}/frequency-collections`,
        {
          method: "POST",
          idempotencyKey: `semantic-frequency:${crypto.randomUUID()}`,
          body: { items: selections, types: orderedTypes, regionCode, device }
        }
      );
      onStarted(collection);
    } catch (requestError) {
      setError(frequencyErrorMessage(requestError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <SemanticModal
      description="Сбор выполняется в фоне через ваш проверенный XMLStock Wordstat API. Секрет не попадает в очередь, браузер или журнал операции."
      onClose={running ? () => undefined : onClose}
      size="large"
      title="Сбор частотности"
    >
      <form className="semantic-frequency-dialog" onSubmit={(event) => void submit(event)}>
        <div className="semantic-frequency-grid">
          <section>
            <h3>Источник данных</h3>
            <div className="semantic-provider-card selected">
              <span aria-hidden="true">Я</span>
              <div><strong>XMLStock Wordstat</strong><small>Ваш API · тарификация провайдера</small></div>
              <i>Подключение проверяется перед запуском</i>
            </div>
            <a href="/app/settings/integrations">Управление API-ключами</a>
          </section>
          <section>
            <h3>Параметры сбора</h3>
            <fieldset>
              <legend>Виды частотности</legend>
              <label><input checked={types.has("BASE")} onChange={() => toggleType("BASE")} type="checkbox" /> Базовая</label>
              <label><input checked={types.has("EXACT")} onChange={() => toggleType("EXACT")} type="checkbox" /> Фразовая</label>
              <label><input checked={types.has("FIXED")} onChange={() => toggleType("FIXED")} type="checkbox" /> Точная словоформа</label>
            </fieldset>
            <label>
              <span>Код региона Wordstat</span>
              <input autoFocus maxLength={100} onChange={(event) => setRegionCode(event.target.value)} pattern="[A-Za-z0-9._:-]+" required value={regionCode} />
              <small>213 — Москва, 225 — Россия. ALL — без регионального ограничения.</small>
            </label>
            <label>
              <span>Устройство</span>
              <select onChange={(event) => setDevice(event.target.value as SemanticFrequencyDevice)} value={device}>
                <option value="ALL">Все устройства</option>
                <option value="DESKTOP">Десктоп</option>
                <option value="MOBILE">Мобильные</option>
                <option value="PHONE_ONLY">Только телефоны</option>
                <option value="TABLET_ONLY">Только планшеты</option>
              </select>
            </label>
          </section>
        </div>
        <dl className="semantic-dialog-estimate">
          <div><dt>Запросов</dt><dd>{selections.length}</dd></div>
          <div><dt>API-операций</dt><dd>до {selections.length * orderedTypes.length}</dd></div>
          <div><dt>Типов</dt><dd>{orderedTypes.length}</dd></div>
          <div><dt>Режим</dt><dd>Фоновый Job</dd></div>
        </dl>
        {error && (
          <div className="inline-alert danger" role="alert">
            <span>{error}</span>{" "}
            <a href={`/app/projects/${encodeURIComponent(projectId)}/settings/integrations`}>Настроить маршрут Wordstat</a>
          </div>
        )}
        <div className="semantic-modal-actions">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">Отмена</button>
          <button className="primary-button" disabled={running || orderedTypes.length === 0} type="submit">
            {running ? "Запускаем…" : `Запустить сбор (${selections.length})`}
          </button>
        </div>
      </form>
    </SemanticModal>
  );
}

function frequencyErrorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "CONNECTOR_NOT_READY") {
      return "Подключите XMLStock, подтвердите ключ и назначьте проекту маршрут WORDSTAT.";
    }
    if (error.code === "FORBIDDEN") return "Недостаточно прав для запуска сборщика.";
    if (error.code === "PAYMENT_REQUIRED") return "Workspace доступен только для чтения.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Не удалось запустить сбор частотности.";
}
