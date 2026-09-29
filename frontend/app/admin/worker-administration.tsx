"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  parseCreatedWorkerNode,
  parseWorkerNodeView,
  workerCapabilities,
  type CreatedWorkerNode,
  type WorkerCapability,
  type WorkerNodeConfiguration,
  type WorkerNodeView
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { UiText } from "../../components/ui-locale";

const DEFAULT_CAPABILITIES: readonly WorkerCapability[] = ["RANK"];

export function WorkerAdministration() {
  const [nodes, setNodes] = useState<readonly WorkerNodeView[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [issuedToken, setIssuedToken] = useState<CreatedWorkerNode>();
  const [editingNodeId, setEditingNodeId] = useState<string>();
  const [editForm, setEditForm] = useState<WorkerNodeConfiguration>();
  const [form, setForm] = useState<WorkerNodeConfiguration>({
    name: "", capabilities: DEFAULT_CAPABILITIES,
    maxHttpSlots: 16, maxCpuSlots: 2
  });

  const load = useCallback(async () => {
    const result = await adminApi<readonly WorkerNodeView[]>("/api/worker-nodes");
    if (result.ok) {
      try {
        if (!Array.isArray(result.data) || result.data.length > 200) throw new TypeError();
        setNodes(result.data.map(parseWorkerNodeView));
        setError(undefined);
      } catch {
        setError("Некорректный ответ списка воркеров");
      }
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || form.capabilities.length === 0) return;
    setBusy("create");
    setError(undefined);
    const result = await adminApi<CreatedWorkerNode>("/api/worker-nodes", {
      method: "POST", body: JSON.stringify(form)
    });
    setBusy(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    let created: CreatedWorkerNode;
    try { created = parseCreatedWorkerNode(result.data); }
    catch { setError("Некорректный ответ создания воркера"); return; }
    setNodes((current) => [created.node, ...(current ?? [])]);
    setIssuedToken(created);
    setForm((current) => ({ ...current, name: "" }));
  }

  async function update(
    node: WorkerNodeView,
    action: "enabled" | "draining",
    value: boolean
  ): Promise<void> {
    if (busy) return;
    setBusy(node.id);
    setError(undefined);
    const result = await adminApi<WorkerNodeView>(
      `/api/worker-nodes/${encodeURIComponent(node.id)}/${action}`,
      { method: "PATCH", body: JSON.stringify({ [action]: value }) }
    );
    setBusy(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    let updated: WorkerNodeView;
    try { updated = parseWorkerNodeView(result.data); }
    catch { setError("Некорректный ответ обновления воркера"); return; }
    setNodes((current) => current?.map((item) =>
      item.id === updated.id ? updated : item
    ));
  }

  async function rotate(node: WorkerNodeView): Promise<void> {
    if (busy || !window.confirm(`Перевыпустить ключ воркера «${node.name}»? Старый ключ перестанет работать сразу.`)) return;
    setBusy(node.id);
    setError(undefined);
    const result = await adminApi<CreatedWorkerNode>(
      `/api/worker-nodes/${encodeURIComponent(node.id)}/rotate`,
      { method: "POST", body: "{}" }
    );
    setBusy(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    let rotated: CreatedWorkerNode;
    try { rotated = parseCreatedWorkerNode(result.data); }
    catch { setError("Некорректный ответ перевыпуска ключа"); return; }
    setIssuedToken(rotated);
    setNodes((current) => current?.map((item) =>
      item.id === rotated.node.id ? rotated.node : item
    ));
  }

  async function configure(event: FormEvent<HTMLFormElement>, nodeId: string): Promise<void> {
    event.preventDefault();
    if (busy || !editForm || editForm.capabilities.length === 0) return;
    setBusy(nodeId);
    setError(undefined);
    const result = await adminApi<WorkerNodeView>(
      `/api/worker-nodes/${encodeURIComponent(nodeId)}/configuration`,
      { method: "PATCH", body: JSON.stringify(editForm) }
    );
    setBusy(undefined);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    let updated: WorkerNodeView;
    try { updated = parseWorkerNodeView(result.data); }
    catch { setError("Некорректный ответ настройки воркера"); return; }
    setNodes((current) => current?.map((item) =>
      item.id === updated.id ? updated : item
    ));
    setEditingNodeId(undefined);
    setEditForm(undefined);
  }

  return (
    <div className="content worker-admin">
      <section className="page-heading">
        <div>
          <p className="eyebrow"><UiText text="Execution fleet" /></p>
          <h1><UiText text="Удалённые воркеры" /></h1>
          <p><UiText text="У каждого узла собственный ключ доступа и предел мощности. Общие лимиты физических ключей провайдеров сохраняются на центральном сервере." /></p>
        </div>
        <button className="ghost" onClick={() => void load()} type="button"><UiText text="Обновить" /></button>
      </section>
      {error && <p className="form-alert" role="alert"><UiText text={error} /></p>}
      {issuedToken && (
        <section className="panel worker-secret" role="alert">
          <h2><UiText text="Ключ нового воркера — показывается только сейчас" /></h2>
          <p><UiText text="Сохрани его в приватный файл на удалённом сервере (доступ только владельцу). Повторно прочитать ключ из базы нельзя." /></p>
          <code>{issuedToken.token}</code>
          <button className="ghost" onClick={() => setIssuedToken(undefined)} type="button"><UiText text="Я сохранил ключ" /></button>
        </section>
      )}
      <form className="panel worker-create" onSubmit={(event) => void create(event)}>
        <h2><UiText text="Создать узел" /></h2>
        <div className="worker-fields">
          <label><UiText text="Название" />
            <input maxLength={100} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required value={form.name} />
          </label>
          <label><UiText text="HTTP-слоты" />
            <input max={512} min={1} onChange={(event) => setForm((current) => ({ ...current, maxHttpSlots: Number(event.target.value) }))} required type="number" value={form.maxHttpSlots} />
          </label>
          <label><UiText text="CPU-слоты" />
            <input max={128} min={1} onChange={(event) => setForm((current) => ({ ...current, maxCpuSlots: Number(event.target.value) }))} required type="number" value={form.maxCpuSlots} />
          </label>
        </div>
        <fieldset className="worker-capabilities">
          <legend><UiText text="Разрешённые операции — пока удалённо работает только съём позиций" /></legend>
          {workerCapabilities.map((capability) => (
            <label key={capability}>
              <input checked={form.capabilities.includes(capability)} disabled={capability !== "RANK"} onChange={(event) => setForm((current) => ({
                ...current,
                capabilities: event.target.checked
                  ? [...current.capabilities, capability]
                  : current.capabilities.filter((value) => value !== capability)
              }))} type="checkbox" />
              {capability}
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={Boolean(busy) || form.capabilities.length === 0} type="submit"><UiText text="Создать и показать ключ" /></button>
      </form>
      {!nodes ? (
        <section className="panel"><UiText text="Загружаем воркеры…" /></section>
      ) : nodes.length === 0 ? (
        <section className="panel"><UiText text="Удалённых воркеров пока нет. Главный сервер продолжает выполнять операции сам." /></section>
      ) : (
        <div className="worker-grid">
          {nodes.map((node) => (
            <article className="panel worker-card" key={node.id}>
              <header><div><h2>{node.name}</h2><p>{node.id}</p></div>
                <strong>{!node.enabled ? "Выключен" : !node.online ? "Нет связи" : node.draining ? "Останавливается" : "На связи"}</strong>
              </header>
              <p>{node.capabilities.join(" · ")}</p>
              <p><UiText text="Лимиты" />: HTTP {node.maxHttpSlots}, CPU {node.maxCpuSlots}. <UiText text="Сообщил" />: HTTP {node.reportedHttpSlots}, съём {node.reportedRankSlots}, CPU {node.reportedCpuSlots}.</p>
              <p><UiText text="Активных единиц" />: {node.activeWorkItems}. <UiText text="Последняя связь" />: {node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString() : "—"}</p>
              {node.activeAssignments && node.activeAssignments.length > 0 && (
                <div className="worker-assignment-list">
                  <strong><UiText text="Назначенные операции" /></strong>
                  {node.activeAssignments.map((assignment) => (
                    <span key={`${assignment.jobId}:${assignment.searchEngine}`}>
                      {assignment.searchEngine === "YANDEX" ? "Яндекс" : assignment.searchEngine === "GOOGLE" ? "Google" : "Поиск"} · {assignment.jobId.slice(0, 8)} · {assignment.activeTasks} <UiText text="назначенных страниц" />
                    </span>
                  ))}
                </div>
              )}
              <div className="worker-actions">
                <button className="ghost" disabled={Boolean(busy)} onClick={() => void update(node, "enabled", !node.enabled)} type="button">
                  <UiText text={node.enabled ? "Выключить" : "Включить"} />
                </button>
                {node.enabled && <button className="ghost" disabled={Boolean(busy)} onClick={() => void update(node, "draining", !node.draining)} type="button">
                  <UiText text={node.draining ? "Возобновить" : "Остановить плавно"} />
                </button>}
                <button className="ghost" disabled={Boolean(busy)} onClick={() => void rotate(node)} type="button"><UiText text="Перевыпустить ключ" /></button>
                <button className="ghost" disabled={Boolean(busy)} onClick={() => {
                  if (editingNodeId === node.id) {
                    setEditingNodeId(undefined);
                    setEditForm(undefined);
                  } else {
                    setEditingNodeId(node.id);
                    setEditForm({
                      name: node.name,
                      capabilities: [...node.capabilities],
                      maxHttpSlots: node.maxHttpSlots,
                      maxCpuSlots: node.maxCpuSlots
                    });
                  }
                }} type="button"><UiText text={editingNodeId === node.id ? "Закрыть настройки" : "Настроить"} /></button>
              </div>
              {editingNodeId === node.id && editForm && (
                <form className="worker-edit" onSubmit={(event) => void configure(event, node.id)}>
                  <div className="worker-fields">
                    <label><UiText text="Название" /><input maxLength={100} onChange={(event) => setEditForm((current) => current ? { ...current, name: event.target.value } : current)} required value={editForm.name} /></label>
                    <label><UiText text="HTTP-слоты" /><input max={512} min={1} onChange={(event) => setEditForm((current) => current ? { ...current, maxHttpSlots: Number(event.target.value) } : current)} required type="number" value={editForm.maxHttpSlots} /></label>
                    <label><UiText text="CPU-слоты" /><input max={128} min={1} onChange={(event) => setEditForm((current) => current ? { ...current, maxCpuSlots: Number(event.target.value) } : current)} required type="number" value={editForm.maxCpuSlots} /></label>
                  </div>
                  <fieldset className="worker-capabilities"><legend><UiText text="Разрешённые операции — пока удалённо работает только съём позиций" /></legend>
                    {workerCapabilities.map((capability) => <label key={capability}><input checked={editForm.capabilities.includes(capability)} disabled={capability !== "RANK"} onChange={(event) => setEditForm((current) => current ? {
                      ...current,
                      capabilities: event.target.checked
                        ? [...current.capabilities, capability]
                        : current.capabilities.filter((value) => value !== capability)
                    } : current)} type="checkbox" />{capability}</label>)}
                  </fieldset>
                  <button className="primary" disabled={Boolean(busy) || editForm.capabilities.length === 0} type="submit"><UiText text="Сохранить лимиты" /></button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
