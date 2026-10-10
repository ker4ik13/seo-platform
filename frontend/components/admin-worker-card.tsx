"use client";

import { useState } from "react";
import type { WorkerNodeView } from "@seo-platform/contracts";
import { workerEffectiveCapabilitySlots } from "@seo-platform/contracts";
import { Icon } from "./icon";

const CAPABILITIES: Readonly<Record<string, string>> = { RANK: "Позиции и выдача", WORDSTAT: "Частотности", RESEARCH: "Парсинг Wordstat", AI_ANSWER: "ИИ-ответы", CLUSTERING: "Кластеризация", CRAWL: "Обход сайта", IMPORT: "Импорт", EXPORT: "Экспорт", INSPECTION: "Антивирус" };
export function workerCapabilityLabel(value: string): string { return CAPABILITIES[value] ?? value; }

function workerState(node: WorkerNodeView) {
  const state = !node.lastHeartbeatAt ? "waiting" : !node.online ? "offline" : !node.enabled ? "disabled" : node.draining ? "draining" : "online";
  return { state, label: ({ waiting: "Ожидает связи", offline: "Нет связи", disabled: "Выключен", draining: "Завершает задачи", online: "На связи" } as const)[state] };
}

function workerBuildState(node: WorkerNodeView): { readonly label: string; readonly tone: string } {
  if (!node.reportedBuildHash) return { label: "Версия неизвестна", tone: "unknown" };
  if (node.expectedBuildHash && node.reportedBuildHash !== node.expectedBuildHash) {
    return { label: `Сборка ${node.reportedBuildHash.slice(0, 12)} · обновить`, tone: "outdated" };
  }
  return { label: `Сборка ${node.reportedBuildHash.slice(0, 12)} · актуальна`, tone: "current" };
}

export function AdminWorkerCard({ node, busy, onEnabled, onDraining, onConfigure, onDetails, onDelete }: Readonly<{
  node: WorkerNodeView; busy: boolean; onEnabled: () => void; onDraining: () => void;
  onConfigure: () => void; onDetails: () => void; onDelete: () => void;
}>) {
  const { state, label } = workerState(node);
  const build = workerBuildState(node);
  const http = node.useEnvCapacity === false ? node.maxHttpSlots : Math.min(node.maxHttpSlots, node.reportedHttpSlots);
  return <article className={`panel worker-card worker-state-${state}`}>
    <header className="worker-card-heading"><span className="worker-node-icon"><Icon name="http" /></span><div><h2>{node.name}</h2><code title={node.id}>{node.id.slice(0, 8)}</code><span className={`worker-build worker-build-${build.tone}`} title={node.reportedBuildHash ?? "Версия ещё не сообщена"}>{build.label}</span></div><span className="worker-connectivity"><Icon name={state === "offline" || state === "waiting" ? "warning" : state === "online" ? "check" : "pause"} />{label}</span></header>
    <div className="worker-card-metrics"><div><span>Работают</span><strong>{node.activeWorkItems}</strong></div><div><span>Съём</span><strong>{workerEffectiveCapabilitySlots(node,"RANK")}</strong></div><div><span>HTTP</span><strong>{http}</strong></div><div><span>CPU</span><strong>{node.useEnvCapacity === false ? node.maxCpuSlots : Math.min(node.maxCpuSlots, node.reportedCpuSlots)}</strong></div></div>
    {node.protocolVersion === 1 && node.capabilities.includes("CRAWL") && <p className="worker-build-outdated">Обновите воркер для пакетного обхода сайта.</p>}
    <div className="worker-capability-chips">{node.capabilities.map((value) => <span key={value}>{workerCapabilityLabel(value)}</span>)}</div>
    <div className="worker-last-seen"><Icon name="clock" />{node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleTimeString("ru") : "Связи ещё не было"}<span>{new Set(node.activeAssignments?.map(({ jobId }) => jobId)).size} операций</span></div>
    <div className="worker-actions"><button className="ghost" disabled={busy} onClick={onDetails} type="button"><Icon name="info" />Подробнее</button><button className="ghost" disabled={busy} onClick={onConfigure} type="button"><Icon name="settings" />Настройки</button><button aria-label={node.enabled ? "Выключить воркер" : "Включить воркер"} title={node.enabled ? "Выключить" : "Включить"} className={node.enabled ? "ghost" : "primary"} disabled={busy} onClick={onEnabled} type="button"><Icon name={node.enabled ? "pause" : "play"} /></button>{node.enabled && <button aria-label={node.draining ? "Возобновить выдачу задач" : "Завершить текущие задачи"} title={node.draining ? "Возобновить" : "Остановить плавно"} className="ghost" disabled={busy} onClick={onDraining} type="button"><Icon name={node.draining ? "play" : "history"} /></button>}<button aria-label="Удалить воркер" title="Удалить воркер" className="ghost worker-delete" disabled={busy} onClick={onDelete} type="button"><Icon name="trash" /></button></div>
  </article>;
}

export function AdminWorkerDetails({ node, busy, onRotate, onDelete }: Readonly<{ node: WorkerNodeView; busy: boolean; onRotate: () => void; onDelete: () => void }>) {
  const [candidate, setCandidate] = useState("");
  const [tokenResult, setTokenResult] = useState<"MATCH" | "MISMATCH" | "INVALID">();
  async function verifyToken(): Promise<void> {
    if (!/^wn_[A-Za-z0-9_-]{43}$/u.test(candidate) || !node.tokenFingerprint) {
      setTokenResult("INVALID"); return;
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidate));
    setCandidate("");
    const prefix = [...new Uint8Array(digest)].slice(0,8).map(value => value.toString(16).padStart(2,"0")).join("");
    setTokenResult(prefix === node.tokenFingerprint ? "MATCH" : "MISMATCH");
  }
  const { label } = workerState(node);
  const build = workerBuildState(node);
  const http = node.useEnvCapacity === false ? node.maxHttpSlots : Math.min(node.maxHttpSlots, node.reportedHttpSlots);
  const assigned = node.activeAssignments ?? [];
  return <div className="worker-detail">
    <dl className="admin-detail-fields"><div><dt>ID</dt><dd><code>{node.id}</code></dd></div><div><dt>Состояние</dt><dd>{label}</dd></div><div><dt>Сборка воркера</dt><dd className={`worker-build-${build.tone}`} title={node.reportedBuildHash ?? ""}>{build.label}</dd></div><div><dt>Сборка центра</dt><dd><code title={node.expectedBuildHash ?? ""}>{node.expectedBuildHash?.slice(0, 12) ?? "—"}</code></dd></div><div><dt>Лимиты</dt><dd>{node.useEnvCapacity ? "Из .env воркера" : "Настроены в админке"}</dd></div><div><dt>Последняя связь</dt><dd>{node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString("ru") : "—"}</dd></div><div><dt>Протокол</dt><dd>{node.protocolVersion ?? "—"}</dd></div><div><dt>ОЗУ узла</dt><dd>{node.reportedMemoryBytes === "0" ? "—" : `${(Number(node.reportedMemoryBytes) / 1024 ** 3).toLocaleString("ru", { maximumFractionDigits: 1 })} ГБ`}</dd></div><div><dt>Текущие задачи</dt><dd>{node.activeWorkItems}</dd></div></dl>
    <h3>Ресурсы</h3><table className="worker-capacity-table"><thead><tr><th>Ресурс</th><th>Настройка</th><th>.env узла</th><th>Итог</th></tr></thead><tbody><tr><th>HTTP</th><td>{node.maxHttpSlots}</td><td>{node.reportedHttpSlots}</td><td>{http}</td></tr><tr><th>CPU</th><td>{node.maxCpuSlots}</td><td>{node.reportedCpuSlots}</td><td>{node.useEnvCapacity === false ? node.maxCpuSlots : Math.min(node.maxCpuSlots, node.reportedCpuSlots)}</td></tr>{node.capabilities.map(capability=><tr key={capability}><th>{workerCapabilityLabel(capability)}</th><td>{node.capabilityLimits?.[capability] ?? (["IMPORT","EXPORT","INSPECTION"].includes(capability) ? node.maxCpuSlots : node.maxHttpSlots)}</td><td>{node.reportedCapabilitySlots?.[capability] ?? (capability==="RANK" ? node.reportedRankSlots : 0)}</td><td>{workerEffectiveCapabilitySlots(node,capability)}</td></tr>)}</tbody></table>
    <h3>Операции</h3><div className="worker-capability-chips">{node.capabilities.map((value) => <span key={value}>{workerCapabilityLabel(value)}</span>)}</div>
    {node.tokenFingerprint && <div className="worker-token-check"><h3>Проверка подключения</h3><p>Сверьте WORKER_NODE_TOKEN из Environment Dokploy. Проверка проходит в браузере; ключ не отправляется на сервер.</p><div><input aria-label="Ключ воркера для проверки" autoComplete="off" type="password" value={candidate} onChange={event => { setCandidate(event.target.value); setTokenResult(undefined); }} /><button className="ghost" disabled={!candidate || busy} onClick={() => void verifyToken()} type="button">Сверить ключ</button></div>{tokenResult && <p role="status" className={tokenResult === "MATCH" ? "success" : "form-alert"}>{tokenResult === "MATCH" ? "Ключ совпадает с записью в центре. Если воркер получает 401, проверьте значение в запущенном контейнере и WORKER_NODE_ID." : tokenResult === "MISMATCH" ? "Ключ не совпадает с записью в центре. Скопируйте новый ключ после перевыпуска и пересоздайте контейнер воркера." : "Неверный формат ключа воркера."}</p>}</div>}
    <div className="worker-assignment-list">{assigned.length === 0 ? <p>Назначенных операций нет.</p> : assigned.map((assignment) => {
      const content = <><span><strong>{assignment.searchEngine === "YANDEX" ? "Яндекс" : assignment.searchEngine === "GOOGLE" ? "Google" : workerCapabilityLabel(assignment.capability)}</strong><code>{assignment.jobId}</code></span><small>{assignment.activeTasks > 0 ? `${assignment.activeTasks} задач` : "Ожидание слотов"}</small></>;
      const key = `${assignment.jobId}:${assignment.capability}:${assignment.searchEngine}`;
      return ["IMPORT", "INSPECTION"].includes(assignment.capability)
        ? <div className="worker-assignment-item" key={key}>{content}</div>
        : <a href={`/admin?screen=operations&operation=${assignment.jobId}&status=ALL`} key={key}>{content}<Icon name="chevronRight" /></a>;
    })}</div>
    <button className="ghost" disabled={busy} onClick={onRotate} type="button"><Icon name="refresh" />Перевыпустить ключ доступа</button>
    <button className="ghost worker-delete" disabled={busy} onClick={onDelete} type="button"><Icon name="trash" />Удалить воркер</button>
  </div>;
}
