"use client";

import { useState } from "react";
import CalendarOff from "lucide-react/icons/calendar-off";
import Check from "lucide-react/icons/check";
import Plus from "lucide-react/icons/plus";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { absenceKindLabels, absenceKinds, daysBetween, describeAbsence, splitAbsences, type AbsenceKind } from "./absences";
import { Avatar } from "./tasks-view";
import { absencesChanged, useAbsences, type AbsenceRequest, type LoadedAbsence } from "./use-absences";

type Person = { id: number; name: string; active: boolean; avatarIcon: string; avatarKey: string | null };

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const fullDate = (value: string) => value.split("-").reverse().join("/");

async function post(payload: Record<string, unknown>) {
  const response = await fetch("/api/absences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
}

/** Lista de férias e ausências (fora hoje, próximas e recentes) com registro e exclusão. */
export default function AbsencesView({ people }: { people: Person[] }) {
  const { absences, requests, me, loaded } = useAbsences();
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const today = todayInSaoPaulo();
  const byId = new Map(people.map((person) => [person.id, person]));
  const groups = splitAbsences(absences, today, 60);
  const manageable = me ? people.filter((person) => person.active && (me.manageable === "all" || me.manageable.includes(person.id))) : [];

  async function remove(absence: LoadedAbsence) {
    const name = byId.get(absence.memberId)?.name ?? "a pessoa";
    if (!window.confirm(`Excluir ${describeAbsence(absence, today).toLowerCase()} de ${name}?`)) return;
    setError("");
    try {
      await post({ action: "deleteAbsence", absenceId: absence.id });
      absencesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir.");
    }
  }

  async function decide(request: AbsenceRequest, approve: boolean) {
    const name = byId.get(request.memberId)?.name ?? "a pessoa";
    const note = approve ? "" : window.prompt(`Recusar o pedido de ${name}? Se quiser, escreva o motivo (vai junto no aviso).`, "");
    if (note === null) return;
    setError("");
    try {
      await post({ action: "decideAbsence", absenceId: request.id, approve, note });
      setNotice(approve ? `Pedido de ${name} aprovado.` : `Pedido de ${name} recusado.`);
      absencesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível decidir.");
    }
  }

  const pending = requests.filter((request) => request.status === "pending");
  const rejected = requests.filter((request) => request.status === "rejected" && request.memberId === me?.id);
  const requestList = (title: string, items: AbsenceRequest[]) => <section className="absence-group absence-requests">
    <h3>{title} <span>{items.length}</span></h3>
    <ul>{items.map((request) => {
      const person = byId.get(request.memberId);
      return <li key={request.id} className={`absence-row ${request.kind} ${request.status}`}>
        <Avatar member={person} size={28} />
        <div><strong>{person?.name ?? "Pessoa removida"}</strong><span>{describeAbsence(request, today)}{request.startDate !== request.endDate && ` · ${daysBetween(request.startDate, request.endDate)} dias`}{request.note && ` · ${request.note}`}{request.status === "rejected" && ` · recusado por ${request.decidedByName ?? "liderança"}${request.decisionNote ? `: “${request.decisionNote}”` : ""}`}</span></div>
        <small className={`absence-status ${request.status}`}>{request.status === "pending" ? "Aguardando aprovação" : "Recusado"}</small>
        {request.canDecide && <span className="absence-decide">
          <button className="secondary-button approve" onClick={() => void decide(request, true)}><Check size={14} /> Aprovar</button>
          <button className="secondary-button" onClick={() => void decide(request, false)}>Recusar</button>
        </span>}
        {request.canDelete && !request.canDecide && <button onClick={() => remove(request)} aria-label={request.status === "pending" ? "Cancelar pedido" : "Apagar pedido recusado"} title={request.status === "pending" ? "Cancelar pedido" : "Apagar"}><Trash2 size={13} /></button>}
      </li>;
    })}</ul>
  </section>;

  const list = (title: string, items: LoadedAbsence[], empty: string) => <section className="absence-group">
    <h3>{title} <span>{items.length}</span></h3>
    {items.length ? <ul>{items.map((absence) => {
      const person = byId.get(absence.memberId);
      return <li key={absence.id} className={`absence-row ${absence.kind}`}>
        <Avatar member={person} size={28} />
        <div><strong>{person?.name ?? "Pessoa removida"}</strong><span>{describeAbsence(absence, today)}{absence.startDate !== absence.endDate && ` · ${daysBetween(absence.startDate, absence.endDate)} dias`}{absence.note && ` · ${absence.note}`}</span></div>
        <small className="absence-kind">{absenceKindLabels[absence.kind]}</small>
        {absence.canDelete && <button onClick={() => remove(absence)} aria-label="Excluir ausência" title={`Registrada por ${absence.createdByName}. Excluir`}><Trash2 size={13} /></button>}
      </li>;
    })}</ul> : <p className="muted">{empty}</p>}
  </section>;

  return <div className="absences-page">
    <div className="absences-head">
      <p>Férias, folgas e atestados aparecem na escala, no painel e na hora de escolher responsáveis para uma demanda.</p>
      {manageable.length > 0 && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> {me && me.manageable !== "all" && manageable.length === 1 ? "Pedir ausência" : "Registrar ausência"}</button>}
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {notice && <div className="alert success"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {!loaded ? <div className="loading-list"><span /><span /></div> : <>
      {pending.length > 0 && requestList("Pedidos aguardando aprovação", pending)}
      {rejected.length > 0 && requestList("Seus pedidos recusados", rejected)}
      {list("Fora hoje", groups.now, "Todo mundo trabalhando hoje.")}
      {list("Próximos 60 dias", groups.upcoming, "Nenhuma ausência marcada.")}
      {groups.past.length > 0 && list("Últimos 30 dias", groups.past, "")}
    </>}
    {creating && me && <AbsenceModal people={manageable} meId={me.id} today={today} isAdmin={me.manageable === "all"} onClose={() => setCreating(false)} onSaved={(pendingApproval) => { setCreating(false); setNotice(pendingApproval ? "Pedido enviado. Seu líder recebe um aviso para aprovar; a ausência entra na escala depois da aprovação." : "Ausência registrada."); absencesChanged(); }} />}
  </div>;
}

function AbsenceModal({ people, meId, today, isAdmin, onClose, onSaved }: { people: Person[]; meId: number; today: string; isAdmin: boolean; onClose: () => void; onSaved: (pendingApproval: boolean) => void }) {
  const [form, setForm] = useState({ memberId: String(people.some((person) => person.id === meId) ? meId : people[0]?.id ?? ""), kind: "vacation" as AbsenceKind, startDate: today, endDate: today, note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/absences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "addAbsence", ...form, memberId: Number(form.memberId) }) });
      const data = await response.json() as { error?: string; pending?: boolean };
      if (!response.ok) throw new Error(data.error || "Não foi possível registrar.");
      onSaved(Boolean(data.pending));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar.");
      setSaving(false);
    }
  }

  const days = form.endDate >= form.startDate ? daysBetween(form.startDate, form.endDate) : 0;
  // A própria ausência (sem ser administrador) vira pedido para o líder aprovar.
  const isRequest = !isAdmin && Number(form.memberId) === meId;
  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>{isRequest ? "Pedir ausência" : "Registrar ausência"}</h2><p>{isRequest ? "O pedido vai para o líder do seu time (ou um administrador) aprovar. Depois de aprovado, avisa a escala, o painel e quem atribui demandas." : "O período avisa a escala, o painel e quem for atribuir demandas."}</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="form-grid">
      {people.length > 1 && <label className="full"><span>Pessoa</span><select value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === meId ? " (você)" : ""}</option>)}</select></label>}
      <label className="full"><span>Tipo</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as AbsenceKind })}>{absenceKinds.map((kind) => <option key={kind} value={kind}>{absenceKindLabels[kind]}</option>)}</select></label>
      <label><span>De</span><input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value, endDate: form.endDate < event.target.value ? event.target.value : form.endDate })} /></label>
      <label><span>Até (inclusive)</span><input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label className="full"><span>Observação (opcional)</span><input maxLength={200} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Ex.: volta na segunda; quem cobre é a Taís" /></label>
      {days > 0 && <p className="full form-hint"><CalendarOff size={13} /> {days} {days === 1 ? "dia" : "dias"}, de {fullDate(form.startDate)} a {fullDate(form.endDate)}.</p>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !form.memberId}>{saving ? "Salvando..." : isRequest ? "Enviar pedido" : "Registrar"}</button></div>
  </form></div>;
}
