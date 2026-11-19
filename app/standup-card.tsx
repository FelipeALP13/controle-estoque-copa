"use client";

// Daily assíncrona na Visão geral: responder em 1 minuto e ver o que o time disse hoje.
import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "./live";
import ChevronDown from "lucide-react/icons/chevron-down";
import MessageSquareText from "lucide-react/icons/message-square-text";
import OctagonAlert from "lucide-react/icons/octagon-alert";
import Pencil from "lucide-react/icons/pencil";

type Entry = { memberId: number; name: string; yesterday: string; today: string; blockers: string; updatedAt: string };
type Data = { day: string; canWrite: boolean; mine: Entry | null; previousPlan: string; entries: Entry[]; missing: { id: number; name: string }[] };

const firstName = (name: string) => name.split(/\s+/)[0];

export function StandupCard() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ yesterday: "", today: "", blockers: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/standups", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as Data;
      setData(next);
    } catch { /* a daily é opcional: sem ela, a Visão geral continua */ }
  }, []);
  useLiveRefresh(load);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  function startEditing() {
    if (!data) return;
    setForm(data.mine ? { yesterday: data.mine.yesterday, today: data.mine.today, blockers: data.mine.blockers } : { yesterday: data.previousPlan, today: "", blockers: "" });
    setError("");
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/standups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...form }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar.");
      setEditing(false);
      setOpen(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return null;
  const blocked = data.entries.filter((entry) => entry.blockers);
  const answered = data.entries.length;
  const total = answered + data.missing.length;

  return <section className="standup-card" aria-labelledby="standup-title">
    <header className="standup-head">
      <span className="standup-icon"><MessageSquareText size={18} /></span>
      <div>
        <h3 id="standup-title">Daily de hoje</h3>
        <small>{answered} de {total} responderam{blocked.length ? ` · ${blocked.length} com bloqueio` : ""}</small>
      </div>
      {data.canWrite && !editing && (data.mine
        ? <button className="secondary-button" onClick={startEditing}><Pencil size={14} /> Editar a minha</button>
        : <button className="primary-button" onClick={startEditing}>Responder (1 min)</button>)}
    </header>

    {editing && <form className="standup-form" onSubmit={save}>
      <label><span>O que fiz ontem</span><textarea rows={2} maxLength={600} value={form.yesterday} onChange={(event) => setForm({ ...form, yesterday: event.target.value })} placeholder="Ex.: fechei o DEM-12 e atendi 3 chamados" /></label>
      <label><span>O que vou fazer hoje</span><textarea rows={2} maxLength={600} required autoFocus value={form.today} onChange={(event) => setForm({ ...form, today: event.target.value })} placeholder="Ex.: implantação do cliente X e revisar o CH-8" /></label>
      <label><span>Bloqueios (opcional)</span><textarea rows={2} maxLength={600} value={form.blockers} onChange={(event) => setForm({ ...form, blockers: event.target.value })} placeholder="Algo travando? O líder do seu time recebe um aviso." /></label>
      {error && <p className="modal-error">{error}</p>}
      <div className="standup-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancelar</button><button className="primary-button" disabled={saving || !form.today.trim()}>{saving ? "Salvando..." : "Enviar"}</button></div>
    </form>}

    {blocked.length > 0 && <ul className="standup-blockers">{blocked.map((entry) => <li key={entry.memberId}><OctagonAlert size={14} /><span><b>{firstName(entry.name)}:</b> {entry.blockers}</span></li>)}</ul>}

    {answered > 0 && <>
      <button type="button" className="standup-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Esconder as respostas" : `Ver as respostas (${answered})`} <ChevronDown size={14} /></button>
      {open && <ul className="standup-list">{data.entries.map((entry) => <li key={entry.memberId}>
        <strong>{entry.name}</strong>
        {entry.yesterday && <p><span>Ontem</span>{entry.yesterday}</p>}
        <p><span>Hoje</span>{entry.today}</p>
        {entry.blockers && <p className="blocker"><span>Bloqueio</span>{entry.blockers}</p>}
      </li>)}</ul>}
    </>}
    {data.missing.length > 0 && answered > 0 && <p className="standup-missing">Ainda não responderam: {data.missing.map((person) => firstName(person.name)).join(", ")}</p>}
  </section>;
}
