"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapPin from "lucide-react/icons/map-pin";
import MessageSquare from "lucide-react/icons/message-square";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash-2";
import Wrench from "lucide-react/icons/wrench";
import X from "lucide-react/icons/x";
import { relativeTime } from "./tasks-view";
import { isActiveMaintenance, MAINTENANCE_CATEGORIES, MAINTENANCE_PRIORITIES, maintenanceCategory, maintenancePriorityLabels, maintenanceStatusLabels, MAX_MAINTENANCE_LOCATION, MAX_MAINTENANCE_TEXT, MAX_MAINTENANCE_TITLE, openFor, type MaintenancePriority, type MaintenanceStatus } from "./maintenance-tools";

type Update = { id: number; body: string; byName: string; at: string };
type Request = { id: number; title: string; description: string; location: string; category: string; priority: MaintenancePriority; status: MaintenanceStatus; createdByName: string; assigneeId: number | null; assigneeName: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null; updates: Update[]; mine: boolean };
type Data = { requests: Request[]; handlers: { id: number; name: string }[]; me: { id: number; handler: boolean; canCreate: boolean } };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

/** Manutenção do escritório: qualquer pessoa abre o pedido; quem cuida acompanha até resolver. */
export default function MaintenanceView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "mine" | "done">("active");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/maintenance", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar os pedidos.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os pedidos.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const shown = useMemo(() => (data?.requests ?? []).filter((row) => filter === "active" ? isActiveMaintenance(row.status) : filter === "mine" ? row.mine : !isActiveMaintenance(row.status)), [data, filter]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const active = data.requests.filter((row) => isActiveMaintenance(row.status));

  async function act(payload: Record<string, unknown>) {
    setError("");
    try { await post(payload); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
  }

  return <div className="maintenance-page">
    <div className="tasks-toolbar">
      <div className="tasks-scope" role="group" aria-label="Quais pedidos">
        <button className={filter === "active" ? "active" : ""} aria-pressed={filter === "active"} onClick={() => setFilter("active")}>Em aberto{active.length > 0 && <b>{active.length}</b>}</button>
        <button className={filter === "mine" ? "active" : ""} aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>Que eu abri</button>
        <button className={filter === "done" ? "active" : ""} aria-pressed={filter === "done"} onClick={() => setFilter("done")}>Resolvidos</button>
      </div>
      {data.me.canCreate && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Novo pedido</button>}
    </div>
    {!data.me.handler && <p className="muted maintenance-hint">Viu algo quebrado no escritório? Abra um pedido: quem cuida da manutenção é avisado e você acompanha por aqui.{data.handlers.length ? ` Quem cuida: ${data.handlers.map((person) => person.name.split(/\s+/)[0]).join(", ")}.` : ""}</p>}
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {shown.length ? <ul className="maintenance-list">{shown.map((row) => {
      const category = maintenanceCategory(row.category);
      const expanded = openId === row.id;
      return <li key={row.id} className={`maintenance-item ${row.priority} ${isActiveMaintenance(row.status) ? "" : "closed"}`}>
        <button type="button" className="maintenance-summary" onClick={() => setOpenId(expanded ? null : row.id)} aria-expanded={expanded}>
          <span className="maintenance-icon" aria-hidden="true">{category.emoji}</span>
          <span className="maintenance-main">
            <strong>{row.title}</strong>
            <small>{category.label}{row.location && <> · <MapPin size={11} /> {row.location}</>} · {row.createdByName} · {isActiveMaintenance(row.status) ? `aberto há ${openFor(row.createdAt, now)}` : relativeTime(row.resolvedAt ?? row.updatedAt)}</small>
          </span>
          {row.priority !== "normal" && <span className={`maintenance-priority ${row.priority}`}>{maintenancePriorityLabels[row.priority]}</span>}
          <span className={`maintenance-status ${row.status}`}>{maintenanceStatusLabels[row.status]}</span>
          {row.updates.length > 0 && <span className="maintenance-count" title="Atualizações"><MessageSquare size={12} /> {row.updates.length}</span>}
        </button>
        {expanded && <MaintenanceDetail row={row} data={data} onAct={act} />}
      </li>;
    })}</ul> : <div className="empty-state compact"><span><Wrench /></span><h3>{filter === "active" ? "Nada quebrado por aqui" : "Nenhum pedido"}</h3><p>{filter === "active" ? "Nenhum pedido de manutenção em aberto." : "Os pedidos aparecem aqui."}</p></div>}

    {creating && <NewRequestModal onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); setFilter("active"); await load(); }} />}
  </div>;
}

function MaintenanceDetail({ row, data, onAct }: { row: Request; data: Data; onAct: (payload: Record<string, unknown>) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const handler = data.me.handler;
  const run = async (payload: Record<string, unknown>) => { setBusy(true); await onAct({ requestId: row.id, ...payload }); setBusy(false); };
  return <div className="maintenance-detail">
    {row.description && <p className="maintenance-description">{row.description}</p>}
    <div className="maintenance-actions">
      {handler && <label><span>Responsável</span><select value={row.assigneeId ?? ""} disabled={busy} onChange={(event) => void run({ action: "assign", assigneeId: Number(event.target.value) || null })}><option value="">Ninguém</option>{data.handlers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {handler && <label><span>Situação</span><select value={row.status} disabled={busy} onChange={(event) => { const status = event.target.value; const note = status === "done" || status === "waiting" ? window.prompt(status === "done" ? "O que foi feito? (opcional)" : "Aguardando o quê? (opcional)") ?? "" : ""; void run({ action: "setStatus", status, note }); }}>{(Object.keys(maintenanceStatusLabels) as MaintenanceStatus[]).map((status) => <option key={status} value={status}>{maintenanceStatusLabels[status]}</option>)}</select></label>}
      {!handler && row.mine && isActiveMaintenance(row.status) && <button className="secondary-button" disabled={busy} onClick={() => { if (window.confirm("Cancelar este pedido?")) void run({ action: "setStatus", status: "canceled" }); }}><X size={14} /> Cancelar pedido</button>}
      {!handler && row.mine && row.status === "done" && <button className="secondary-button" disabled={busy} onClick={() => void run({ action: "setStatus", status: "open", note: window.prompt("O que voltou a acontecer?") ?? "" })}>Reabrir (voltou a dar problema)</button>}
      {(data.me.handler || (row.mine && row.status === "open" && !row.assigneeId)) && <button className="link-button danger" disabled={busy} onClick={() => { if (window.confirm("Apagar este pedido e o histórico?")) void run({ action: "delete" }); }}><Trash2 size={13} /> Apagar</button>}
    </div>
    {row.updates.length > 0 && <ol className="maintenance-history">{row.updates.map((update) => <li key={update.id}><b>{update.byName}</b> <span>{update.body}</span> <small>{relativeTime(update.at)}</small></li>)}</ol>}
    {(handler || row.mine) && <form className="maintenance-comment" onSubmit={async (event) => { event.preventDefault(); if (!comment.trim()) return; await run({ action: "comment", body: comment }); setComment(""); }}>
      <input value={comment} maxLength={MAX_MAINTENANCE_TEXT} onChange={(event) => setComment(event.target.value)} placeholder={handler ? "Atualização (ex.: técnico vem amanhã às 10h)" : "Comentário (ex.: piorou, está pingando no teclado)"} aria-label="Comentário" />
      <button className="secondary-button" disabled={busy || !comment.trim()}>Enviar</button>
    </form>}
  </div>;
}

function NewRequestModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: "", category: "other", location: "", priority: "normal", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await post({ action: "create", ...form }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível abrir o pedido."); setSaving(false); }
  }
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>Novo pedido de manutenção</h2><p>Quem cuida da manutenção recebe um aviso. Você acompanha o andamento aqui.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>O que aconteceu</span><input autoFocus required maxLength={MAX_MAINTENANCE_TITLE} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Ar-condicionado pingando" /></label>
      <div className="full maintenance-categories" role="radiogroup" aria-label="Tipo">{MAINTENANCE_CATEGORIES.map((entry) => <button key={entry.key} type="button" role="radio" aria-checked={form.category === entry.key} className={form.category === entry.key ? "active" : ""} onClick={() => setForm({ ...form, category: entry.key })}>{entry.emoji} {entry.label}</button>)}</div>
      <label><span>Onde <em>opcional</em></span><input maxLength={MAX_MAINTENANCE_LOCATION} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: Sala de reunião 2" /></label>
      <label><span>Urgência</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{MAINTENANCE_PRIORITIES.map((priority) => <option key={priority} value={priority}>{maintenancePriorityLabels[priority]}</option>)}</select></label>
      <label className="full"><span>Detalhes <em>opcional</em></span><textarea rows={3} maxLength={MAX_MAINTENANCE_TEXT} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Desde quando, o que já tentaram, se atrapalha o trabalho..." /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || form.title.trim().length < 3}>{saving ? "Abrindo..." : "Abrir pedido"}</button></div>
  </form></div>;
}
