"use client";

import { useCallback, useEffect, useState } from "react";
import CalendarPlus from "lucide-react/icons/calendar-plus";
import Check from "lucide-react/icons/check";
import Handshake from "lucide-react/icons/handshake";
import Lock from "lucide-react/icons/lock";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Sprout from "lucide-react/icons/sprout";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { devStatusLabels, weakestCriteria, type DevStatus } from "./people-tools";
import { Avatar, relativeTime } from "./task-shared";

type Person = { id: number; name: string; jobTitle: string; avatarIcon: string; avatarKey: string | null };
type Meeting = { id: number; leaderId: number; memberId: number; date: string; status: "planned" | "done"; agenda: string; notes: string; privateNotes?: string; updatedAt: string; canEdit: boolean; isLeader: boolean };
type DevAction = { id: number; memberId: number; title: string; criterion: string; description: string; dueDate: string | null; status: DevStatus; createdByName: string; updatedAt: string; doneAt: string | null };
type Insight = { memberId: number; cycleTitle: string; count: number; hidden: boolean; averages: { criterion: string; average: number }[]; overall: number | null };
type Data = { meetings: Meeting[]; actions: DevAction[]; people: Person[]; reports: number[]; insights: Insight[]; me: { id: number; isAdmin: boolean } };

async function call(payload: Record<string, unknown>) {
  const response = await fetch("/api/one-on-ones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short" });
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** 1:1 entre líder e liderado e o plano de desenvolvimento de cada pessoa, ligado às médias da avaliação. */
export default function OneOnOnesView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [personId, setPersonId] = useState<number | null>(null);
  const [meeting, setMeeting] = useState<Meeting | "new" | null>(null);
  const [action, setAction] = useState<DevAction | { criterion: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/one-on-ones", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  if (!data) return error ? <div className="alert error"><span>{error}</span></div> : <div className="loading-list"><span /><span /></div>;
  const selected = personId ?? data.me.id;
  const person = data.people.find((entry) => entry.id === selected);
  const isMe = selected === data.me.id;
  const reports = data.reports.map((id) => data.people.find((entry) => entry.id === id)).filter((entry): entry is Person => Boolean(entry)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const meetings = data.meetings.filter((row) => row.memberId === selected).sort((a, b) => b.date.localeCompare(a.date));
  const actions = data.actions.filter((row) => row.memberId === selected);
  const insight = data.insights.find((row) => row.memberId === selected);
  const today = todayIso();
  const next = [...meetings].reverse().find((row) => row.status === "planned" && row.date >= today);
  const nameOf = (id: number) => data.people.find((entry) => entry.id === id)?.name ?? "Pessoa";

  async function act(payload: Record<string, unknown>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setError("");
    try { await call(payload); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível concluir."); }
  }

  return <div className="reviews-tab">
    {reports.length > 0 && <div className="oneonone-people" role="tablist" aria-label="Pessoa">
      <button role="tab" aria-selected={isMe} className={isMe ? "active" : ""} onClick={() => setPersonId(null)}><Sprout size={14} /> Meu desenvolvimento</button>
      {/* Muitas pessoas (administradores): lista de escolha em vez de botões. */}
      {reports.length > 8 ? <select aria-label="Liderado" value={isMe ? "" : selected} onChange={(event) => setPersonId(Number(event.target.value) || null)}>
        <option value="">Escolha a pessoa…</option>
        {reports.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select> : reports.map((entry) => {
        const first = entry.name.split(" ")[0];
        const label = reports.filter((other) => other.name.split(" ")[0] === first).length > 1 ? entry.name : first;
        return <button role="tab" key={entry.id} aria-selected={selected === entry.id} className={selected === entry.id ? "active" : ""} onClick={() => setPersonId(entry.id)}><Avatar member={entry} size={20} /> {label}</button>;
      })}
    </div>}
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    <section className="review-hero oneonone-hero">
      <div>
        
        <h2>{isMe ? "Seu plano e suas conversas 1:1" : person?.name}</h2>
        <p>{next ? <>Próximo 1:1: <b>{weekday(next.date)}, {shortDate(next.date)}</b>{isMe ? ` com ${nameOf(next.leaderId)}` : ""}</> : isMe ? "Nenhum 1:1 marcado. Seu líder marca por aqui; você pode incluir assuntos na pauta." : "Nenhum 1:1 marcado com esta pessoa."}</p>
      </div>
      {!isMe && <button className="primary-button" onClick={() => setMeeting("new")}><CalendarPlus size={15} /> Marcar 1:1</button>}
    </section>

    <div className="oneonone-grid">
      <section className="client-section">
        <header><h3>Avaliação</h3>{insight && <span className="muted">{insight.cycleTitle}</span>}</header>
        {!insight ? <p className="muted">Ainda não há ciclo de avaliação encerrado.</p>
          : insight.hidden ? <p className="muted">{insight.count ? `${insight.count} avaliação${insight.count === 1 ? "" : "ões"}: precisa de pelo menos 3 para mostrar as médias.` : "Nenhuma avaliação recebida neste ciclo."}</p>
          : <>
            <ul className="result-bars">{insight.averages.map((item) => <li key={item.criterion}><span>{item.criterion}</span><i><b style={{ width: `${(item.average / 5) * 100}%` }} className={item.average < 3 ? "low" : item.average >= 4 ? "high" : ""} /></i><em>{item.average.toFixed(1).replace(".", ",")}</em></li>)}</ul>
            {weakestCriteria(insight.averages).length > 0 ? <div className="oneonone-focus"><small>Pontos para desenvolver</small>{weakestCriteria(insight.averages).map((item) => <button key={item.criterion} onClick={() => setAction({ criterion: item.criterion })} title="Criar uma ação de desenvolvimento para este ponto"><Plus size={12} /> {item.criterion}</button>)}</div>
              : <p className="muted">Todas as médias estão em 4 ou mais.</p>}
            {!isMe && <p className="muted small"><Lock size={11} /> Você vê só as médias; os comentários ficam com a pessoa e os administradores.</p>}
          </>}
      </section>

      <section className="client-section">
        <header><h3>Plano de desenvolvimento</h3><button className="secondary-button" onClick={() => setAction({ criterion: "" })}><Plus size={14} /> Nova ação</button></header>
        {actions.length ? <ul className="dev-actions">{[...actions].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")).map((item) => <li key={item.id} className={item.status}>
          <div>
            <strong>{item.title}</strong>
            <small>{[item.criterion, item.dueDate ? `até ${shortDate(item.dueDate)}` : "", `por ${item.createdByName.split(" ")[0]}`].filter(Boolean).join(" · ")}</small>
            {item.description && <p>{item.description}</p>}
          </div>
          <select aria-label="Situação" className={`dev-status ${item.status}`} value={item.status} onChange={(event) => void act({ action: "setActionStatus", actionId: item.id, status: event.target.value })}>{(Object.keys(devStatusLabels) as DevStatus[]).map((status) => <option key={status} value={status}>{devStatusLabels[status]}</option>)}</select>
          <button className="person-edit" onClick={() => setAction(item)} aria-label="Editar ação" title="Editar"><Pencil size={13} /></button>
          <button className="person-edit" onClick={() => void act({ action: "deleteAction", actionId: item.id }, `Excluir a ação “${item.title}”?`)} aria-label="Excluir ação" title="Excluir"><Trash2 size={13} /></button>
        </li>)}</ul> : <p className="muted">Nenhuma ação ainda. Combine no 1:1 o que desenvolver (um curso, acompanhar alguém, assumir uma entrega) e registre aqui.</p>}
      </section>
    </div>

    <section className="client-section">
      <header><h3><Handshake size={15} /> Reuniões 1:1</h3><span className="muted">{meetings.length} {meetings.length === 1 ? "reunião" : "reuniões"}</span></header>
      {meetings.length ? <ul className="oneonone-list">{meetings.map((row) => <li key={row.id}><button onClick={() => setMeeting(row)} className={row.status}>
        <span className="oneonone-date"><b>{shortDate(row.date)}</b><small>{weekday(row.date)}</small></span>
        <span><strong>{row.status === "done" ? "Realizada" : row.date < today ? "Marcada (passou da data)" : "Marcada"}{isMe ? ` · com ${nameOf(row.leaderId)}` : row.leaderId !== data.me.id ? ` · por ${nameOf(row.leaderId)}` : ""}</strong><small>{row.agenda ? row.agenda.split("\n")[0] : "Sem pauta ainda"}</small></span>
        <em>{row.status === "done" ? <Check size={14} /> : null} Atualizada {relativeTime(row.updatedAt)}</em>
      </button></li>)}</ul> : <p className="muted">{isMe ? "Quando seu líder marcar um 1:1, ele aparece aqui." : "Marque o primeiro 1:1: uma conversa de 30 minutos a cada 2 ou 4 semanas sobre como a pessoa está, o que atrapalha e o plano de desenvolvimento."}</p>}
    </section>

    {meeting && <MeetingModal meeting={meeting === "new" ? null : meeting} memberId={selected} memberName={person?.name ?? ""} meId={data.me.id} onClose={() => setMeeting(null)} onSaved={async () => { setMeeting(null); await load(); }} />}
    {action && <ActionModal action={"id" in action ? action : null} criterion={action.criterion} criteria={insight?.averages.map((item) => item.criterion) ?? []} memberId={selected} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await load(); }} />}
  </div>;
}

function MeetingModal({ meeting, memberId, memberName, meId, onClose, onSaved }: { meeting: Meeting | null; memberId: number; memberName: string; meId: number; onClose: () => void; onSaved: () => void }) {
  const asLeader = !meeting || meeting.isLeader;
  const ownLeader = !meeting || meeting.leaderId === meId;
  const [form, setForm] = useState({ date: meeting?.date ?? todayIso(), status: meeting?.status ?? "planned", agenda: meeting?.agenda ?? "", notes: meeting?.notes ?? "", privateNotes: meeting?.privateNotes ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal oneonone-modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call({ action: "saveMeeting", meetingId: meeting?.id, memberId, ...form }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{meeting ? `1:1 de ${shortDate(meeting.date)}` : `Marcar 1:1 com ${memberName}`}</h2><p>Pauta e anotações aparecem para os dois. {ownLeader ? "A nota privada só você vê." : ""}</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label><span>Data</span><input type="date" required disabled={!asLeader} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label><span>Situação</span><select disabled={!asLeader} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "planned" | "done" })}><option value="planned">Marcada</option><option value="done">Realizada</option></select></label>
      <label className="full"><span>Pauta</span><textarea rows={4} maxLength={4000} value={form.agenda} onChange={(event) => setForm({ ...form, agenda: event.target.value })} placeholder={"Um assunto por linha. Ex.:\nComo está a carga de trabalho\nAndamento do plano de desenvolvimento"} /></label>
      <label className="full"><span>Anotações e combinados</span><textarea rows={5} maxLength={8000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="O que foi conversado e o que ficou combinado (com prazo e responsável)." /></label>
      {ownLeader && <label className="full private-note"><span><Lock size={12} /> Nota privada <em>só você vê</em></span><textarea rows={3} maxLength={4000} value={form.privateNotes} onChange={(event) => setForm({ ...form, privateNotes: event.target.value })} placeholder="Percepções para acompanhar nas próximas conversas." /></label>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions">
      {meeting && ownLeader && <button type="button" className="secondary-button danger-text" onClick={async () => { if (!window.confirm("Excluir esta reunião e as anotações?")) return; try { await call({ action: "deleteMeeting", meetingId: meeting.id }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível excluir."); } }}><Trash2 size={14} /> Excluir</button>}
      <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
      <button className="primary-button" disabled={saving}>{saving ? "Salvando..." : meeting ? "Salvar" : "Marcar e avisar"}</button>
    </div>
  </form></div>;
}

function ActionModal({ action, criterion, criteria, memberId, onClose, onSaved }: { action: DevAction | null; criterion: string; criteria: string[]; memberId: number; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: action?.title ?? "", criterion: action?.criterion ?? criterion, description: action?.description ?? "", dueDate: action?.dueDate ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = [...new Set([...criteria, form.criterion].filter(Boolean))];
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setError(""); try { await call({ action: "saveAction", actionId: action?.id, memberId, ...form, dueDate: form.dueDate || null }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível salvar."); setSaving(false); } }}>
    <div className="modal-head"><div><h2>{action ? "Editar ação" : "Nova ação"}</h2><p>Algo concreto, com prazo, que ajude a desenvolver um ponto da avaliação ou um objetivo de carreira.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      <label className="full"><span>Ação</span><input autoFocus required maxLength={140} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: Apresentar a solução dos chamados críticos na reunião do time" /></label>
      <label><span>Ponto da avaliação <em>opcional</em></span><select value={form.criterion} onChange={(event) => setForm({ ...form, criterion: event.target.value })}><option value="">Nenhum (objetivo de carreira)</option>{options.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Prazo <em>opcional</em></span><input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
      <label className="full"><span>Como vai ser feito <em>opcional</em></span><textarea rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Passos, quem ajuda, como saber que deu certo." /></label>
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.title.trim()}>{saving ? "Salvando..." : "Salvar ação"}</button></div>
  </form></div>;
}
