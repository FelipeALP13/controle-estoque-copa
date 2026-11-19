"use client";

// Troca de semana na escala: pedir (qualquer pessoa da equipe) e aprovar ou recusar (quem gerencia a escala).
import { useCallback, useEffect, useState } from "react";
import ArrowLeftRight from "lucide-react/icons/arrow-left-right";
import Check from "lucide-react/icons/check";
import X from "lucide-react/icons/x";
import type { SupportTeam, SupportWeek } from "./support-schedule";

type WeekInfo = { id: number; startDate: string; endDate: string; teamId: number; teamName: string };
type Swap = { id: number; status: "pending" | "approved" | "rejected" | "canceled"; reason: string; requesterName: string; createdAt: string; decidedByName: string | null; decisionNote: string; from: WeekInfo; to: WeekInfo; canDecide: boolean; canCancel: boolean };
type Data = { canManage: boolean; canRequest: boolean; swaps: Swap[] };

const shortDate = (value: string) => value.split("-").reverse().slice(0, 2).join("/");
const range = (week: { startDate: string; endDate: string }) => `${shortDate(week.startDate)} a ${shortDate(week.endDate)}`;
const STATUS: Record<Swap["status"], string> = { pending: "Aguardando aprovação", approved: "Aprovada", rejected: "Recusada", canceled: "Cancelada" };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/shift-swaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
}

export function ShiftSwaps({ weeks, teams, today, onScheduleChanged }: { weeks: SupportWeek[]; teams: SupportTeam[]; today: string; onScheduleChanged: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/shift-swaps", { cache: "no-store" });
      if (response.ok) setData(await response.json() as Data);
    } catch { /* a troca é opcional: sem ela, a escala continua funcionando */ }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function act(payload: Record<string, unknown>, changesSchedule = false) {
    setError("");
    try {
      await post(payload);
      await load();
      if (changesSchedule) onScheduleChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir.");
    }
  }

  if (!data) return null;
  const upcoming = weeks.filter((week) => week.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  const pending = data.swaps.filter((swap) => swap.status === "pending");
  const done = data.swaps.filter((swap) => swap.status !== "pending");
  if (!data.canRequest && !pending.length) return null;

  return <section className="swap-panel">
    <div className="swap-head">
      <div><strong><ArrowLeftRight size={15} /> Trocas de semana</strong><small>{data.canManage ? "Você aprova as trocas: ao aprovar, as duas semanas trocam de equipe na hora." : "Precisa trocar de semana com outra equipe? Peça aqui; quem gerencia a escala aprova."}</small></div>
      {data.canRequest && upcoming.length > 1 && <button className="secondary-button" onClick={() => setAsking(true)}><ArrowLeftRight size={15} /> Pedir troca</button>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    {pending.length > 0 && <ul className="swap-list">{pending.map((swap) => <li key={swap.id} className="swap-row pending">
      <div className="swap-weeks"><b>{swap.from.teamName}</b> <span>{range(swap.from)}</span><ArrowLeftRight size={14} aria-label="troca com" /><b>{swap.to.teamName}</b> <span>{range(swap.to)}</span></div>
      <p>Pedido por {swap.requesterName}: “{swap.reason}”</p>
      <div className="swap-actions">
        <small className="swap-status pending">{STATUS.pending}</small>
        {swap.canDecide && <>
          <button className="secondary-button approve" onClick={() => { if (window.confirm(`Aprovar? ${swap.from.teamName} passa a ficar com ${range(swap.to)} e ${swap.to.teamName} com ${range(swap.from)}.`)) void act({ action: "decideSwap", swapId: swap.id, approve: true }, true); }}><Check size={14} /> Aprovar</button>
          <button className="secondary-button" onClick={() => { const note = window.prompt("Recusar a troca? Se quiser, escreva o motivo (vai junto no aviso).", ""); if (note !== null) void act({ action: "decideSwap", swapId: swap.id, approve: false, note }); }}>Recusar</button>
        </>}
        {swap.canCancel && !swap.canDecide && <button className="secondary-button" onClick={() => { if (window.confirm("Cancelar o seu pedido de troca?")) void act({ action: "cancelSwap", swapId: swap.id }); }}><X size={14} /> Cancelar pedido</button>}
      </div>
    </li>)}</ul>}
    {done.length > 0 && <>
      <button className="link-button" onClick={() => setShowDone((value) => !value)}>{showDone ? "Esconder as trocas recentes" : `Ver trocas recentes (${done.length})`}</button>
      {showDone && <ul className="swap-list">{done.map((swap) => <li key={swap.id} className={`swap-row ${swap.status}`}>
        <div className="swap-weeks"><b>{swap.from.teamName}</b> <span>{range(swap.from)}</span><ArrowLeftRight size={14} aria-label="troca com" /><b>{swap.to.teamName}</b> <span>{range(swap.to)}</span></div>
        <p>{STATUS[swap.status]}{swap.decidedByName ? ` por ${swap.decidedByName}` : ""}{swap.decisionNote ? `: “${swap.decisionNote}”` : ""} · pedido por {swap.requesterName}</p>
      </li>)}</ul>}
    </>}
    {asking && <SwapModal weeks={upcoming} teams={teams} onClose={() => setAsking(false)} onSend={async (payload) => { await post({ action: "requestSwap", ...payload }); setAsking(false); await load(); }} />}
  </section>;
}

function SwapModal({ weeks, teams, onClose, onSend }: { weeks: SupportWeek[]; teams: SupportTeam[]; onClose: () => void; onSend: (payload: { fromWeekId: number; toWeekId: number; reason: string }) => Promise<void> }) {
  const teamName = (id: number) => teams.find((team) => team.id === id)?.name ?? "Equipe";
  const label = (week: SupportWeek) => `${teamName(week.teamId)} · ${shortDate(week.start)} a ${shortDate(week.end)}`;
  const [fromId, setFromId] = useState(String(weeks[0]?.id ?? ""));
  const from = weeks.find((week) => String(week.id) === fromId);
  const options = weeks.filter((week) => from && week.teamId !== from.teamId);
  const [toId, setToId] = useState("");
  const to = options.find((week) => String(week.id) === toId) ?? options[0];
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!from || !to) return;
    setSaving(true);
    setError("");
    try { await onSend({ fromWeekId: from.id, toWeekId: to.id, reason }); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível pedir a troca."); setSaving(false); }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>Pedir troca de semana</h2><p>Quem gerencia a escala recebe um aviso. Aprovada, as duas semanas trocam de equipe.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Semana que sai</span><select value={fromId} onChange={(event) => { setFromId(event.target.value); setToId(""); }}>{weeks.map((week) => <option key={week.id} value={week.id}>{label(week)}</option>)}</select></label>
      <label className="full"><span>Trocar com</span>{options.length ? <select value={to ? String(to.id) : ""} onChange={(event) => setToId(event.target.value)}>{options.map((week) => <option key={week.id} value={week.id}>{label(week)}</option>)}</select> : <small className="form-hint">Não há semana futura de outra equipe para trocar.</small>}</label>
      <label className="full"><span>Motivo</span><input required maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: consulta médica na quarta; a equipe Roxa topou trocar" /></label>
      {from && to && <p className="full form-hint"><ArrowLeftRight size={13} /> Fica: {teamName(from.teamId)} em {shortDate(to.start)} a {shortDate(to.end)} e {teamName(to.teamId)} em {shortDate(from.start)} a {shortDate(from.end)}.</p>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !from || !to || !reason.trim()}>{saving ? "Enviando..." : "Enviar pedido"}</button></div>
  </form></div>;
}
