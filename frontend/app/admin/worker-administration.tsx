"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  parseCreatedWorkerNode,
  parseWorkerNodeView,
  parseRemovedWorkerNode,
  type RemovedWorkerNode,
  workerCapabilities,
  type CreatedWorkerNode,
  type WorkerCapability,
  type WorkerNodeConfiguration,
  type WorkerNodeView
} from "@seo-platform/contracts";
import { adminApi } from "../../lib/admin-browser-api";
import { AdminWorkerCard, AdminWorkerDetails, workerCapabilityLabel } from "../../components/admin-worker-card";
import { AdminHeaderActions, AdminOverlay } from "../../components/admin-overlay";
import { Icon } from "../../components/icon";
import { useAdminAutoRefresh } from "../../lib/use-admin-auto-refresh";
import { UiText } from "../../components/ui-locale";

const DEFAULT_CAPABILITIES: readonly WorkerCapability[] = workerCapabilities;
type WorkerStopAction = Readonly<{ kind: "disable" | "drain" | "delete"; node: WorkerNodeView }>;

export function WorkerAdministration() {
  const [nodes, setNodes] = useState<readonly WorkerNodeView[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [issuedToken, setIssuedToken] = useState<CreatedWorkerNode>();
  const [editingNodeId, setEditingNodeId] = useState<string>();
  const [detailsNodeId, setDetailsNodeId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [rotatingNode, setRotatingNode] = useState<WorkerNodeView>();
  const [stopAction, setStopAction] = useState<WorkerStopAction>();
  const [editForm, setEditForm] = useState<WorkerNodeConfiguration>();
  const [form, setForm] = useState<WorkerNodeConfiguration>({
    name: "", capabilities: DEFAULT_CAPABILITIES,
    maxHttpSlots: 16, maxCpuSlots: 2, useEnvCapacity: true
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
  }, [load]);
  useAdminAutoRefresh(load, !busy && !stopAction);

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
    setCreating(false);
    setForm((current) => ({ ...current, name: "" }));
  }

  async function update(
    node: WorkerNodeView,
    action: "enabled" | "draining",
    value: boolean
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(node.id);
    setError(undefined);
    const result = await adminApi<WorkerNodeView>(
      `/api/worker-nodes/${encodeURIComponent(node.id)}/${action}`,
      { method: "PATCH", body: JSON.stringify({ [action]: value }) }
    );
    setBusy(undefined);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    let updated: WorkerNodeView;
    try { updated = parseWorkerNodeView(result.data); }
    catch { setError("Некорректный ответ обновления воркера"); return false; }
    setNodes((current) => current?.map((item) =>
      item.id === updated.id ? updated : item
    ));
    return true;
  }

  async function confirmStop(): Promise<void> {
    if (!stopAction || busy) return;
    const { node, kind } = stopAction;
    if (kind !== "delete") {
      if (await update(node, kind === "disable" ? "enabled" : "draining", kind === "drain")) setStopAction(undefined);
      return;
    }
    setBusy(node.id); setError(undefined);
    const result = await adminApi<RemovedWorkerNode>(`/api/worker-nodes/${encodeURIComponent(node.id)}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) });
    setBusy(undefined);
    if (!result.ok) { setError(result.message); return; }
    try { if (parseRemovedWorkerNode(result.data).id !== node.id) throw new TypeError(); }
    catch { setError("Некорректный ответ удаления воркера"); return; }
    setNodes((current) => current?.filter((item) => item.id !== node.id));
    if (detailsNodeId === node.id) setDetailsNodeId(undefined);
    if (editingNodeId === node.id) setEditingNodeId(undefined);
    setStopAction(undefined);
  }

  async function rotate(node: WorkerNodeView): Promise<void> {
    if (busy) return;
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
    setRotatingNode(undefined);
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

  const detailsNode = nodes?.find((node) => node.id === detailsNodeId);
  return (
    <div className="content worker-admin">
      <AdminHeaderActions><button className="primary" disabled={Boolean(busy)} onClick={() => { setError(undefined); setCreating(true); }} type="button"><Icon name="plus" />Создать воркер</button></AdminHeaderActions>
      {error && <p className="form-alert" role="alert"><UiText text={error} /></p>}
      {issuedToken && (
        <AdminOverlay title="Ключ доступа воркера" onClose={() => setIssuedToken(undefined)}>
          <div className="worker-secret">
          <p><UiText text="Сохрани ключ в WORKER_NODE_TOKEN в Environment удалённого воркера. Повторно прочитать его из базы нельзя." /></p>
          <code>{issuedToken.token}</code>
          <button className="ghost" onClick={() => setIssuedToken(undefined)} type="button"><UiText text="Я сохранил ключ" /></button>
          </div>
        </AdminOverlay>
      )}
      {creating && <AdminOverlay title="Создать воркер" onClose={() => setCreating(false)} busy={Boolean(busy)}><form className="worker-form" onSubmit={(event) => void create(event)}><WorkerFields value={form} onChange={setForm} />{error && <p className="form-alert" role="alert">{error}</p>}<footer><button className="ghost" disabled={Boolean(busy)} onClick={() => setCreating(false)} type="button">Отмена</button><button className="primary" disabled={Boolean(busy) || form.capabilities.length === 0} type="submit">{busy ? "Создаём…" : "Создать и показать ключ"}</button></footer></form></AdminOverlay>}
      {!nodes ? (
        <section className="panel"><UiText text="Загружаем воркеры…" /></section>
      ) : nodes.length === 0 ? (
        <section className="panel"><UiText text="Удалённых воркеров пока нет. Главный сервер продолжает выполнять операции сам." /></section>
      ) : (
        <div className="worker-grid">
          {nodes.map((node) => (
            <AdminWorkerCard key={node.id} node={node} busy={Boolean(busy)}
              onEnabled={() => { setError(undefined); if (node.enabled) setStopAction({ kind: "disable", node }); else void update(node, "enabled", true); }}
              onDraining={() => { setError(undefined); if (!node.draining) setStopAction({ kind: "drain", node }); else void update(node, "draining", false); }}
              onDelete={() => { setError(undefined); setStopAction({ kind: "delete", node }); }}
              onDetails={() => setDetailsNodeId(node.id)}
              onConfigure={() => {
                setError(undefined); setEditingNodeId(node.id); setEditForm({ name: node.name, capabilities: [...node.capabilities], maxHttpSlots: node.maxHttpSlots, maxCpuSlots: node.maxCpuSlots,
                  useEnvCapacity: node.useEnvCapacity ?? false, ...(node.capabilityLimits ? {capabilityLimits:node.capabilityLimits} : {}) });
              }} />
          ))}
        </div>
      )}
      {editingNodeId && editForm && <AdminOverlay title="Настройки воркера" onClose={() => setEditingNodeId(undefined)} busy={Boolean(busy)}><form className="worker-form" onSubmit={(event) => void configure(event, editingNodeId)}><WorkerFields value={editForm} onChange={setEditForm} />{error && <p className="form-alert" role="alert">{error}</p>}<footer><button className="ghost" disabled={Boolean(busy)} onClick={() => setEditingNodeId(undefined)} type="button">Отмена</button><button className="primary" disabled={Boolean(busy) || editForm.capabilities.length === 0} type="submit">{busy ? "Сохраняем…" : "Сохранить"}</button></footer></form></AdminOverlay>}
      {detailsNode && <AdminOverlay drawer title={detailsNode.name} onClose={() => setDetailsNodeId(undefined)}><AdminWorkerDetails node={detailsNode} busy={Boolean(busy)} onRotate={() => setRotatingNode(detailsNode)} onDelete={() => { setError(undefined); setStopAction({ kind: "delete", node: detailsNode }); }} /></AdminOverlay>}
      {rotatingNode && <AdminOverlay title="Перевыпустить ключ доступа?" onClose={() => setRotatingNode(undefined)} busy={Boolean(busy)}><p>Старый ключ воркера «{rotatingNode.name}» перестанет работать. Новый ключ нужно будет сохранить в Environment узла.</p><div className="admin-overlay-actions"><button className="ghost" disabled={Boolean(busy)} onClick={() => setRotatingNode(undefined)} type="button">Отмена</button><button className="primary" disabled={Boolean(busy)} onClick={() => void rotate(rotatingNode)} type="button">Перевыпустить</button></div></AdminOverlay>}
      {stopAction && <AdminOverlay title={stopAction.kind === "delete" ? "Удалить воркер?" : stopAction.kind === "drain" ? "Остановить воркер плавно?" : "Выключить воркер?"} busy={Boolean(busy)} onClose={() => { setStopAction(undefined); setError(undefined); }}>
        <p>Воркер «{stopAction.node.name}» {stopAction.kind === "delete" ? "будет удалён из списка, его ключ доступа перестанет работать. Незавершённые этапы возобновятся на другом воркере или основном сервере по правилам повторов." : "перестанет получать новые задания. Уже выданные этапы смогут завершиться; дальнейшую работу подхватит другой воркер или основной сервер."} Сохранённые результаты и история операций останутся.</p>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="admin-overlay-actions"><button className="ghost" disabled={Boolean(busy)} onClick={() => { setStopAction(undefined); setError(undefined); }} type="button">Отмена</button><button className="primary" disabled={Boolean(busy)} onClick={() => void confirmStop()} type="button">{busy ? "Выполняем…" : stopAction.kind === "delete" ? "Удалить" : stopAction.kind === "drain" ? "Остановить плавно" : "Выключить"}</button></div>
      </AdminOverlay>}
    </div>
  );
}

function WorkerFields({ value, onChange }: Readonly<{ value: WorkerNodeConfiguration; onChange: (value: WorkerNodeConfiguration) => void }>) {
  return <>
    <label className="worker-capacity-source"><input checked={value.useEnvCapacity === true} onChange={(event) => onChange({ ...value, useEnvCapacity: event.target.checked })} type="checkbox" />Брать слоты из .env воркера</label>
    <p className="worker-capacity-hint">{value.useEnvCapacity ? "После подключения воркер сообщит свои значения. Изменения .env применяются после его перезапуска." : "Значения из админки применятся после следующего heartbeat воркера."}</p>
    <div className="worker-fields">
      <label>Название<input maxLength={100} required value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
      <label>HTTP-слоты<input min={1} max={512} disabled={value.useEnvCapacity} required type="number" value={value.maxHttpSlots} onChange={(event) => onChange({ ...value, maxHttpSlots: Number(event.target.value) })} /></label>
      <label>CPU-слоты<input min={1} max={128} disabled={value.useEnvCapacity} required type="number" value={value.maxCpuSlots} onChange={(event) => onChange({ ...value, maxCpuSlots: Number(event.target.value) })} /></label>
    </div>
    <fieldset className="worker-capabilities"><legend>Операции · максимум слотов</legend>
      {workerCapabilities.map((capability) => {
        const enabled=value.capabilities.includes(capability),cpu=["IMPORT","EXPORT","INSPECTION"].includes(capability);
        return <div className="worker-capability-control" key={capability}>
          <label><input checked={enabled} onChange={(event) => onChange({ ...value, capabilities: event.target.checked ? [...value.capabilities, capability] : value.capabilities.filter((item) => item !== capability) })} type="checkbox" />{workerCapabilityLabel(capability)}</label>
          <input aria-label={`${workerCapabilityLabel(capability)}: слоты`} min={0} max={cpu ? 128 : 512} disabled={!enabled || value.useEnvCapacity} required type="number"
            value={value.capabilityLimits?.[capability] ?? (cpu ? value.maxCpuSlots : value.maxHttpSlots)}
            onChange={(event)=>onChange({...value,capabilityLimits:{...value.capabilityLimits,[capability]:Number(event.target.value)}})} />
        </div>;
      })}
    </fieldset>
  </>;
}
