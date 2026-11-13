"use client";

import { useCallback, useEffect, useState } from "react";
import Check from "lucide-react/icons/check";
import ClipboardList from "lucide-react/icons/clipboard-list";
import Repeat from "lucide-react/icons/repeat-2";
import Trash2 from "lucide-react/icons/trash-2";
import { ticketCode, ticketStatusLabels, ticketUrgencyLabels, type TicketStatus, type TicketUrgency } from "./tickets";
import { relativeTime } from "./task-shared";
import { MAX_HANDOFF } from "./team-tools";
import { scheduleDate } from "./dashboard-shared";

type Side = { weekId: number; start: string; end: string; teamName: string; color: string; members: string[] } | null;
type Handoff = { id: number; teamName: string; body: string; createdByName: string; createdAt: string; canDelete: boolean; readBy: string[]; readByMe: boolean };
type OpenTicket = { id: number; title: string; status: TicketStatus; urgency: TicketUrgency; client: string; assigneeName: string | null };
type Data = { from: Side; to: Side; handoffs: Handoff[]; openTickets: OpenTicket[]; me: { id: number; canWrite: boolean } };

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/handoffs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; notified?: number; toTeam?: string | null };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

const range = (side: NonNullable<Side>) => `${scheduleDate(side.start, { day: "2-digit", month: "2-digit" })} a ${scheduleDate(side.end, { day: "2-digit", month: "2-digit" })}`;

/** Passagem de plantão: a equipe que sai deixa o que ficou pendente; a que entra recebe aviso e marca como lida. */
export default function HandoffPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showOlder, setShowOlder] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/handoffs", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a passagem de plantão.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a passagem de plantão.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }

  // Monta um rascunho com os chamados do Suporte ainda em aberto.
  function draftFromTickets() {
    if (!data?.openTickets.length) return;
    const lines = data.openTickets.map((ticket) => `- ${ticketCode(ticket.id)} ${ticket.title}${ticket.client ? ` (${ticket.client})` : ""} · ${ticketStatusLabels[ticket.status]}${ticket.urgency === "critical" || ticket.urgency === "high" ? ` · urgência ${ticketUrgencyLabels[ticket.urgency].toLowerCase()}` : ""}${ticket.assigneeName ? ` · com ${ticket.assigneeName.split(" ")[0]}` : ""}`);
    setText((current) => `${current.trim() ? `${current.trimEnd()}\n\n` : ""}Chamados em aberto:\n${lines.join("\n")}\n\nCombinados e observações:\n- `);
  }

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : null;
  const latest = data.handoffs[0] ?? null;
  const older = data.handoffs.slice(1);

  return <section className="handoff">
    <header>
      <span className="handoff-icon"><Repeat size={18} /></span>
      <div><h3>Passagem de plantão</h3><p>{data.to ? <>Da <b>{data.from?.teamName ?? "semana atual"}</b> para <b>{data.to.teamName}</b> ({range(data.to)})</> : "Cadastre a próxima semana da escala para saber quem recebe."}</p></div>
      {data.me.canWrite && !writing && <button className="primary-button" onClick={() => { setWriting(true); setNotice(""); }}><ClipboardList size={15} /> Registrar passagem</button>}
    </header>

    {writing && <form className="handoff-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await post({ action: "createHandoff", body: text }); setText(""); setWriting(false); setNotice(result.notified ? `Passagem registrada. ${result.notified} ${result.notified === 1 ? "pessoa da" : "pessoas da"} ${result.toTeam} ${result.notified === 1 ? "foi avisada" : "foram avisadas"} no sino.` : "Passagem registrada."); }); }}>
      <textarea autoFocus rows={8} maxLength={MAX_HANDOFF} value={text} onChange={(event) => setText(event.target.value)} placeholder={"O que ficou pendente, combinados com clientes, alertas para a próxima equipe…"} />
      <div className="handoff-form-actions">
        {data.openTickets.length > 0 && <button type="button" className="secondary-button" onClick={draftFromTickets}>Incluir os {data.openTickets.length} chamados em aberto</button>}
        <span />
        <button type="button" className="secondary-button" onClick={() => setWriting(false)}>Cancelar</button>
        <button className="primary-button" disabled={busy || !text.trim()}>{busy ? "Salvando..." : data.to ? `Enviar para ${data.to.teamName}` : "Salvar"}</button>
      </div>
    </form>}

    {error && <p className="modal-error">{error}</p>}
    {notice && !error && <p className="time-log-notice">{notice}</p>}

    {latest ? <HandoffItem item={latest} busy={busy} highlight={!latest.readByMe} onRead={() => void run(async () => { await post({ action: "markRead", handoffId: latest.id }); })} onDelete={() => { if (window.confirm("Excluir esta passagem de plantão?")) void run(async () => { await post({ action: "deleteHandoff", handoffId: latest.id }); }); }} />
      : !writing && <p className="muted handoff-empty">Nenhuma passagem registrada ainda. No fim da semana, quem está no atendimento conta o que ficou pendente.</p>}
    {older.length > 0 && <button className="link-button" onClick={() => setShowOlder((value) => !value)}>{showOlder ? "Esconder anteriores" : `Ver ${older.length} anteriores`}</button>}
    {showOlder && older.map((item) => <HandoffItem key={item.id} item={item} busy={busy} highlight={false} onRead={() => void run(async () => { await post({ action: "markRead", handoffId: item.id }); })} onDelete={() => { if (window.confirm("Excluir esta passagem de plantão?")) void run(async () => { await post({ action: "deleteHandoff", handoffId: item.id }); }); }} />)}
  </section>;
}

function HandoffItem({ item, busy, highlight, onRead, onDelete }: { item: Handoff; busy: boolean; highlight: boolean; onRead: () => void; onDelete: () => void }) {
  return <article className={`handoff-item ${highlight ? "unread" : ""}`}>
    <p className="handoff-meta"><b>{item.createdByName}</b>{item.teamName && <> · {item.teamName}</>} · {relativeTime(item.createdAt)}
      {item.canDelete && <button className="task-drawer-icon danger" disabled={busy} onClick={onDelete} aria-label="Excluir passagem" title="Excluir"><Trash2 size={13} /></button>}</p>
    <div className="handoff-body">{item.body}</div>
    <footer>
      <small>{item.readBy.length ? `Lido por ${item.readBy.join(", ")}` : "Ninguém confirmou a leitura ainda"}</small>
      {!item.readByMe && <button className="secondary-button" disabled={busy} onClick={onRead}><Check size={14} /> Li e estou ciente</button>}
    </footer>
  </article>;
}
