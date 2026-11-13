"use client";

import { useCallback, useEffect, useState } from "react";
import Plus from "lucide-react/icons/plus";
import Radar from "lucide-react/icons/radar";
import Send from "lucide-react/icons/send";
import Siren from "lucide-react/icons/siren";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { isoToLocal } from "./agenda";
import { durationLabel, incidentStatusLabels, minutesBetween, severityLabels, type IncidentStatus, type Severity } from "./people-tools";
import { relativeTime } from "./task-shared";

type Update = { id: number; body: string; byName: string; at: string };
type Incident = { id: number; clientId: number | null; systemId: number | null; title: string; severity: Severity; status: IncidentStatus; startedAt: string; resolvedAt: string | null; impact: string; cause: string; resolution: string; prevention: string; auto: boolean; createdByName: string; updates: Update[] };
type Data = { incidents: Incident[]; clients: { id: number; name: string; active: boolean }[]; systems: { id: number; clientId: number; name: string }[]; stats: { count: number; open: number; pendingAnalysis: number; totalMinutes: number; averageMinutes: number | null }; me: { id: number; isAdmin: boolean; canEdit: boolean } };

async function call(payload: Record<string, unknown>) {
  const response = await fetch("/api/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; id?: number };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
const toInput = (iso: string | null) => { if (!iso) return ""; const local = isoToLocal(iso); return `${local.day}T${local.time}`; };
const whenLabel = (iso: string) => { const local = isoToLocal(iso); return `${local.day.split("-").reverse().join("/")} às ${local.time}`; };

/** Registro de incidentes: o que aconteceu, a causa e o que muda para não repetir. O monitor abre e fecha sozinho. */
export default function IncidentsView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | IncidentStatus>("all");
  const [editing, setEditing] = useState<Incident | "new" | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/incidents", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
      setEditing((current) => current && current !== "new" ? json.incidents.find((row) => row.id === current.id) ?? null : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const nowIso = new Date().toISOString();
  const clientName = (id: number | null) => data.clients.find((client) => client.id === id)?.name ?? "";
  const systemName = (id: number | null) => data.systems.find((system) => system.id === id)?.name ?? "";
  const list = data.incidents.filter((row) => filter === "all" || row.status === filter);
  const stats = [
    { label: "Em andamento", value: data.stats.open, detail: data.stats.open ? "acompanhe até voltar ao normal" : "nada fora do ar agora", danger: data.stats.open > 0 },
    { label: "Falta análise", value: data.stats.pendingAnalysis, detail: "causa e o que muda para não repetir", warn: data.stats.pendingAnalysis > 0 },
    { label: "Incidentes (30 dias)", value: data.stats.count, detail: data.stats.totalMinutes ? `${durationLabel(data.stats.totalMinutes)} no total` : "sem tempo fora do ar" },
    { label: "Tempo médio até resolver", value: data.stats.averageMinutes !== null ? durationLabel(data.stats.averageMinutes) : "—", detail: "dos incidentes resolvidos" },
  ];

  return <div className="clients-page">
    <div className="client-stats">{stats.map((stat) => <article key={stat.label} className={"danger" in stat && stat.danger ? "danger" : "warn" in stat && stat.warn ? "warn" : ""}><small>{stat.label}</small><strong>{stat.value}</strong><span>{stat.detail}</span></article>)}</div>
    <div className="client-report">
      <div className="tasks-scope" role="tablist" aria-label="Mostrar">{([["all", "Todos"], ["open", "Em andamento"], ["resolved", "Falta análise"], ["analyzed", "Analisados"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {data.me.canEdit && <button className="primary-button" onClick={() => setEditing("new")}><Plus size={15} /> Registrar incidente</button>}
      <span className="muted inline-hint"><Radar size={13} /> Quando o monitor vê um sistema cair, o incidente abre sozinho; quando volta, fica resolvido esperando a análise.</span>
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {list.length ? <ul className="incident-list">{list.map((row) => <li key={row.id}><button className={`incident-row ${row.status} sev-${row.severity}`} onClick={() => setEditing(row)}>
      <em className={`incident-sev ${row.severity}`}>{severityLabels[row.severity]}</em>
      <span className="incident-main"><strong>{row.title}</strong><small>{[clientName(row.clientId), systemName(row.systemId), whenLabel(row.startedAt)].filter(Boolean).join(" · ")}{row.auto ? " · aberto pelo monitor" : ""}</small></span>
      <span className="incident-duration">{row.resolvedAt ? durationLabel(minutesBetween(row.startedAt, row.resolvedAt)) : <>há {durationLabel(minutesBetween(row.startedAt, nowIso))}</>}</span>
      <em className={`incident-status ${row.status}`}>{incidentStatusLabels[row.status]}</em>
    </button></li>)}</ul> : <div className="empty-state"><span><Siren /></span><h3>{data.incidents.length ? "Nada neste filtro" : "Nenhum incidente registrado"}</h3><p>Registre quando um sistema de cliente cair ou houver um problema grave: o que aconteceu, a causa e o que muda para não repetir. Quedas detectadas pelo monitor entram sozinhas.</p></div>}
    {editing && <IncidentModal incident={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} onSaved={async (close) => { if (close) setEditing(null); await load(); }} />}
  </div>;
}

function IncidentModal({ incident, data, onClose, onSaved }: { incident: Incident | null; data: Data; onClose: () => void; onSaved: (close: boolean) => Promise<void> }) {
  const [form, setForm] = useState({ title: incident?.title ?? "", clientId: String(incident?.clientId ?? ""), systemId: String(incident?.systemId ?? ""), severity: incident?.severity ?? "medium", status: incident?.status ?? "open", startedAt: toInput(incident?.startedAt ?? new Date().toISOString()), resolvedAt: toInput(incident?.resolvedAt ?? null), impact: incident?.impact ?? "", cause: incident?.cause ?? "", resolution: incident?.resolution ?? "", prevention: incident?.prevention ?? "" });
  const [update, setUpdate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const readOnly = !data.me.canEdit;
  const systems = data.systems.filter((system) => !form.clientId || system.clientId === Number(form.clientId));
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal incident-modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call({ action: "saveIncident", incidentId: incident?.id, ...form, clientId: Number(form.clientId) || null, systemId: Number(form.systemId) || null }); await onSaved(true); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{incident ? incident.title : "Registrar incidente"}</h2><p>{incident?.auto ? "Aberto pelo monitor. " : ""}Para concluir a análise, preencha a causa e o que muda para não repetir.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <fieldset className="form-grid" disabled={readOnly}>
      <label className="full"><span>O que aconteceu</span><input autoFocus={!incident} required maxLength={140} value={form.title} onChange={(event) => set({ title: event.target.value })} placeholder="Ex.: SGE do cliente fora do ar" /></label>
      <label><span>Cliente <em>opcional</em></span><select value={form.clientId} onChange={(event) => set({ clientId: event.target.value, systemId: "" })}><option value="">Nenhum (interno)</option>{data.clients.filter((client) => client.active || String(client.id) === form.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label><span>Sistema <em>opcional</em></span><select value={form.systemId} onChange={(event) => set({ systemId: event.target.value })}><option value="">Nenhum</option>{systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}</select></label>
      <label><span>Gravidade</span><select value={form.severity} onChange={(event) => set({ severity: event.target.value as Severity })}>{(Object.keys(severityLabels) as Severity[]).map((value) => <option key={value} value={value}>{severityLabels[value]}</option>)}</select></label>
      <label><span>Situação</span><select value={form.status} onChange={(event) => set({ status: event.target.value as IncidentStatus })}>{(Object.keys(incidentStatusLabels) as IncidentStatus[]).map((value) => <option key={value} value={value}>{incidentStatusLabels[value]}</option>)}</select></label>
      <label><span>Começou</span><input type="datetime-local" required value={form.startedAt} onChange={(event) => set({ startedAt: event.target.value })} /></label>
      <label><span>Terminou <em>vazio se ainda está acontecendo</em></span><input type="datetime-local" value={form.resolvedAt} onChange={(event) => set({ resolvedAt: event.target.value })} /></label>
      <label className="full"><span>Impacto <em>quem foi afetado e como</em></span><textarea rows={2} maxLength={2000} value={form.impact} onChange={(event) => set({ impact: event.target.value })} /></label>
      <label className="full"><span>Causa</span><textarea rows={2} maxLength={3000} value={form.cause} onChange={(event) => set({ cause: event.target.value })} placeholder="O que provocou o problema (a causa de verdade, não só o sintoma)." /></label>
      <label className="full"><span>Como foi resolvido</span><textarea rows={2} maxLength={3000} value={form.resolution} onChange={(event) => set({ resolution: event.target.value })} /></label>
      <label className="full"><span>O que muda para não repetir</span><textarea rows={2} maxLength={3000} value={form.prevention} onChange={(event) => set({ prevention: event.target.value })} placeholder="Ex.: alerta de disco a 80%, revisão do backup, rotina nova no checklist." /></label>
    </fieldset>
    {incident && <div className="incident-timeline">
      <small>Linha do tempo</small>
      {data.me.canEdit && <div className="incident-add"><input value={update} maxLength={2000} onChange={(event) => setUpdate(event.target.value)} placeholder="Atualização (ex.: cliente avisado, reiniciado o servidor)" aria-label="Nova atualização" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click(); } }} /><button type="button" className="secondary-button" disabled={!update.trim()} onClick={async () => { try { await call({ action: "addUpdate", incidentId: incident.id, body: update }); setUpdate(""); await onSaved(false); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); } }}><Send size={13} /> Adicionar</button></div>}
      <ul>{incident.updates.map((entry) => <li key={entry.id}><span>{entry.body}</span><em>{entry.byName.split(" ")[0]} · {relativeTime(entry.at)}</em></li>)}</ul>
    </div>}
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions">
      {incident && data.me.isAdmin && <button type="button" className="secondary-button danger-text" onClick={async () => { if (!window.confirm(`Excluir o incidente “${incident.title}” e a linha do tempo?`)) return; try { await call({ action: "deleteIncident", incidentId: incident.id }); await onSaved(true); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); } }}><Trash2 size={14} /> Excluir</button>}
      <button type="button" className="secondary-button" onClick={onClose}>{readOnly ? "Fechar" : "Cancelar"}</button>
      {!readOnly && <button className="primary-button" disabled={saving || !form.title.trim()}>{saving ? "Salvando..." : "Salvar"}</button>}
    </div>
  </form></div>;
}
