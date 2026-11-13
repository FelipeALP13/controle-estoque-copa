"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BellRing from "lucide-react/icons/bell-ring";
import BellOff from "lucide-react/icons/bell-off";
import CalendarPlus from "lucide-react/icons/calendar-plus";
import Check from "lucide-react/icons/check";
import LogOut from "lucide-react/icons/log-out";
import Pencil from "lucide-react/icons/pencil";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import StickyNote from "lucide-react/icons/sticky-note";
import Trash2 from "lucide-react/icons/trash-2";
import Video from "lucide-react/icons/video";
import X from "lucide-react/icons/x";
import { dayLabel, DEFAULT_REMIND, isoToLocal, isTeamsJoinLink, localToIso, REMIND_OPTIONS, REPEAT_OPTIONS, repeatLabel, teamsMeetingLink, type Repeat } from "./agenda";
import RepeatIcon from "lucide-react/icons/repeat";
import Share2 from "lucide-react/icons/share-2";
import CalendarLinkModal from "./calendar-link";
import { Avatar } from "./tasks-view";
import { agendaChanged, expandAgenda, useNow, type AgendaEvent } from "./use-agenda";

type Person = { id: number; name: string; avatarIcon: string; avatarKey: string | null; email: string | null };
type Data = { events: AgendaEvent[]; members: Person[]; me: { id: number; hasCalendarLink?: boolean } };

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function post<T = { ok: boolean }>(payload: Record<string, unknown>) {
  const response = await fetch("/api/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

const remindLabel = (value: number | null) => REMIND_OPTIONS.find((option) => option.value === value)?.label ?? "Sem aviso";

/** Abre o Teams com a reunião já preenchida (assunto, horário, convidados e pauta). */
export function openTeamsMeeting(event: { title: string; startsAt: string; endsAt: string | null; notes: string; attendees: number[] }, people: Person[]) {
  const emails = people.filter((person) => event.attendees.includes(person.id) && person.email).map((person) => person.email as string);
  window.open(teamsMeetingLink({ subject: event.title, startsAt: event.startsAt, endsAt: event.endsAt, attendees: emails, content: event.notes }), "_blank", "noopener,noreferrer");
}

/** Agenda pessoal: anotações com horário e reuniões do Teams, com aviso antes e na hora. */
export default function AgendaView({ openRequest, onOpenRequestHandled }: { openRequest: number | null; onOpenRequestHandled: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AgendaEvent | "new" | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const today = todayInSaoPaulo();
  const now = useNow();

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agenda", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar a agenda.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a agenda.");
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  // Veio do sino: destaca o compromisso.
  useEffect(() => {
    if (!openRequest || !data) return;
    const timer = window.setTimeout(() => {
      const target = data.events.find((event) => event.id === openRequest);
      if (target) {
        if (isoToLocal(target.startsAt).day < today) setShowPast(true);
        setHighlight(target.id);
        window.setTimeout(() => document.getElementById(`agenda-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      } else setError("Este compromisso foi excluído ou você não participa mais dele.");
      onOpenRequestHandled();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openRequest, data, today, onOpenRequestHandled]);

  const people = useMemo(() => data?.members ?? [], [data]);
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);

  const { upcoming, past } = useMemo(() => {
    const groups = (list: AgendaEvent[]) => {
      const map = new Map<string, AgendaEvent[]>();
      for (const event of list) { const day = isoToLocal(event.startsAt).day; map.set(day, [...(map.get(day) ?? []), event]); }
      return [...map.entries()];
    };
    const events = data?.events ?? [];
    const single = events.filter((event) => !event.repeat);
    // Quem se repete aparece nos próximos 14 dias (cada dia com a sua ocorrência).
    const todayStart = Date.parse(`${today}T00:00:00-03:00`);
    const repeating = expandAgenda(events.filter((event) => event.repeat), todayStart, todayStart + 15 * 86400000 - 1);
    const future = [...single.filter((event) => isoToLocal(event.startsAt).day >= today), ...repeating].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return {
      upcoming: groups(future),
      past: groups(single.filter((event) => isoToLocal(event.startsAt).day < today)).reverse(),
    };
  }, [data, today]);
  const series = (event: AgendaEvent) => data?.events.find((entry) => entry.id === event.id) ?? event;
  const anchored = new Set<number>();

  async function act(payload: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    try {
      await post(payload);
      agendaChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  const row = (event: AgendaEvent) => {
    const { time } = isoToLocal(event.startsAt);
    const end = event.endsAt ? isoToLocal(event.endsAt).time : "";
    const owner = byId.get(event.ownerId);
    const guests = event.attendees.map((id) => byId.get(id)).filter((person): person is Person => Boolean(person));
    const started = Date.parse(event.startsAt) <= now;
    // A primeira ocorrência de cada compromisso recebe a âncora (para o sino rolar até ela).
    const anchor = !anchored.has(event.id);
    anchored.add(event.id);
    return <li key={`${event.id}-${event.startsAt}`} id={anchor ? `agenda-${event.id}` : undefined} className={`agenda-row ${event.kind} ${event.done ? "done" : ""} ${highlight === event.id && anchor ? "highlight" : ""}`}>
      {event.repeat ? <span className="agenda-check repeat" title={repeatLabel(event.repeat, event.repeatUntil)}><RepeatIcon size={12} /></span> : event.isOwner ? <button className="agenda-check" onClick={() => act({ action: "toggleDone", eventId: event.id, done: !event.done })} aria-label={event.done ? "Desmarcar como feito" : "Marcar como feito"} title={event.done ? "Feito. Clique para desmarcar" : "Marcar como feito (para de avisar)"}>{event.done && <Check size={13} />}</button> : <span className="agenda-check guest" aria-hidden="true" />}
      <span className="agenda-time"><b>{time}</b>{end && <small>até {end}</small>}</span>
      <span className={`agenda-kind ${event.kind}`} title={event.kind === "meeting" ? "Reunião" : "Anotação"}>{event.kind === "meeting" ? <Video size={14} /> : <StickyNote size={14} />}</span>
      <div className="agenda-main">
        <strong>{event.title}</strong>
        {event.notes && <p>{event.notes}</p>}
        <span className="agenda-meta">
          {event.remindBefore === null ? <span><BellOff size={12} /> Sem aviso</span> : <span><BellRing size={12} /> {remindLabel(event.remindBefore)}</span>}
          {event.repeat && <span><RepeatIcon size={12} /> {repeatLabel(event.repeat, event.repeatUntil)}</span>}
          {!event.isOwner && <span>Convite de {owner?.name ?? "alguém da equipe"}</span>}
          {guests.length > 0 && <span className="agenda-guests" title={guests.map((person) => person.name).join(", ")}>{guests.slice(0, 5).map((person) => <Avatar key={person.id} member={person} size={20} />)}{guests.length > 5 && <i>+{guests.length - 5}</i>}</span>}
        </span>
      </div>
      <div className="agenda-actions">
        {event.teamsUrl && isTeamsJoinLink(event.teamsUrl) && <a className={`secondary-button agenda-join ${started && !event.done ? "now" : ""}`} href={event.teamsUrl} target="_blank" rel="noopener noreferrer"><Video size={14} /> Entrar no Teams</a>}
        {event.kind === "meeting" && !event.teamsUrl && event.isOwner && !event.done && <button className="secondary-button" onClick={() => openTeamsMeeting(event, people)} title="Abre o Teams com assunto, horário e convidados preenchidos"><CalendarPlus size={14} /> Criar no Teams</button>}
        {event.isOwner ? <>
          <button className="icon-button" onClick={() => setEditing(series(event))} aria-label="Editar" title={event.repeat ? "Editar (vale para todas as repetições)" : "Editar"}><Pencil size={14} /></button>
          <button className="icon-button" onClick={() => act({ action: "deleteEvent", eventId: event.id }, `Excluir “${event.title}”${event.repeat ? " e todas as repetições" : ""}?${event.attendees.length ? " Os convidados também deixam de ver." : ""}`)} aria-label="Excluir" title="Excluir"><Trash2 size={14} /></button>
        </> : <button className="icon-button" onClick={() => act({ action: "leaveEvent", eventId: event.id }, `Sair de “${event.title}”? Você para de receber os avisos.`)} aria-label="Sair do compromisso" title="Sair do compromisso"><LogOut size={14} /></button>}
      </div>
    </li>;
  };

  const section = ([day, events]: [string, AgendaEvent[]]) => <section key={day} className="agenda-day">
    <h3 className={day === today ? "today" : ""}>{dayLabel(day, today)}{day === today || dayLabel(day, today).length < 10 ? <small>{day.split("-").reverse().join("/")}</small> : null}</h3>
    <ul>{events.map(row)}</ul>
  </section>;

  return <div className="agenda-page">
    <div className="agenda-head">
      <p>Anote compromissos e reuniões com horário: o sino toca <b>antes</b> e <b>na hora</b>. Reuniões podem ser criadas no Teams já preenchidas.</p>
      <div className="agenda-head-actions">
        <button className="secondary-button" onClick={() => setLinkOpen(true)} title="Mostra seus compromissos do Portal no calendário do Outlook/Teams"><Share2 size={15} /> Ver no Outlook</button>
        <button className="primary-button" onClick={() => setEditing("new")}><Plus size={16} /> Novo compromisso</button>
      </div>
    </div>
    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}
    {!data ? (error ? null : <div className="loading-list"><span /><span /></div>) : <>
      {upcoming.length ? upcoming.map(section) : <div className="empty-state compact"><StickyNote /><h3>Nada na agenda</h3><p>Ex.: “Reunião com o cliente às 14h”. O Portal avisa 15 minutos antes e na hora.</p><div><button className="primary-button" onClick={() => setEditing("new")}><Plus size={16} /> Novo compromisso</button></div></div>}
      {past.length > 0 && <div className="agenda-past">
        <button className="link-button" onClick={() => setShowPast((value) => !value)}>{showPast ? "Esconder os dias anteriores" : `Ver os últimos 7 dias (${past.reduce((total, [, events]) => total + events.length, 0)})`}</button>
        {showPast && past.map(section)}
      </div>}
    </>}
    {linkOpen && data && <CalendarLinkModal hasLink={Boolean(data.me.hasCalendarLink)} onClose={() => setLinkOpen(false)} onChanged={(hasLink) => setData({ ...data, me: { ...data.me, hasCalendarLink: hasLink } })} />}
    {editing && data && <AgendaModal event={editing === "new" ? null : editing} people={people.filter((person) => person.id !== data.me.id)} today={today} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); agendaChanged(); await load(); }} />}
  </div>;
}

function nextSlot() {
  // Próxima meia hora cheia, em Brasília.
  const { day, time } = isoToLocal(new Date(Math.ceil((Date.now() + 5 * 60000) / 1800000) * 1800000).toISOString());
  return { day, time };
}

function plusMinutes(day: string, time: string, minutes: number) {
  const iso = localToIso(day, time);
  if (!iso) return "";
  const end = isoToLocal(new Date(Date.parse(iso) + minutes * 60000).toISOString());
  return end.day === day ? end.time : "23:59";
}

function AgendaModal({ event, people, today, onClose, onSaved }: { event: AgendaEvent | null; people: Person[]; today: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const start = event ? isoToLocal(event.startsAt) : nextSlot();
  const [form, setForm] = useState({
    kind: event?.kind ?? "note",
    title: event?.title ?? "",
    day: start.day,
    time: start.time,
    endTime: event?.endsAt ? isoToLocal(event.endsAt).time : "",
    remindBefore: event ? (event.remindBefore === null ? "" : String(event.remindBefore)) : String(DEFAULT_REMIND),
    notes: event?.notes ?? "",
    teamsUrl: event?.teamsUrl ?? "",
    attendees: event?.attendees ?? [] as number[],
    repeat: (event?.repeat ?? "") as Repeat,
    repeatUntil: event?.repeatUntil ?? "",
  });
  const [query, setQuery] = useState("");
  const now = useNow();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const meeting = form.kind === "meeting";
  const startsAt = localToIso(form.day, form.time);
  const endsAt = form.endTime ? localToIso(form.day, form.endTime) : null;
  const filtered = people.filter((person) => !query.trim() || person.name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  const chosen = people.filter((person) => form.attendees.includes(person.id));
  const noEmail = chosen.filter((person) => !person.email);

  const toggle = (id: number) => setForm({ ...form, attendees: form.attendees.includes(id) ? form.attendees.filter((value) => value !== id) : [...form.attendees, id] });

  function setKind(kind: "note" | "meeting") {
    // Reunião sem horário de fim ganha 30 minutos, que dá para mudar.
    setForm({ ...form, kind, endTime: kind === "meeting" && !form.endTime ? plusMinutes(form.day, form.time, 30) : form.endTime });
  }

  async function submit(eventForm: React.FormEvent) {
    eventForm.preventDefault();
    setSaving(true);
    setError("");
    try {
      await post({ action: "saveEvent", eventId: event?.id, ...form, remindBefore: form.remindBefore === "" ? null : Number(form.remindBefore) });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      setSaving(false);
    }
  }

  const past = startsAt !== null && Date.parse(startsAt) < now;

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><form className="modal agenda-modal" onSubmit={submit}>
    <div className="modal-head"><div><h2>{event ? "Editar compromisso" : "Novo compromisso"}</h2><p>O sino avisa você e os convidados, com som.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <div className="agenda-kind-switch" role="radiogroup" aria-label="Tipo">
      <button type="button" role="radio" aria-checked={!meeting} className={!meeting ? "active" : ""} onClick={() => setKind("note")}><StickyNote size={15} /> Anotação</button>
      <button type="button" role="radio" aria-checked={meeting} className={meeting ? "active" : ""} onClick={() => setKind("meeting")}><Video size={15} /> Reunião no Teams</button>
    </div>
    <div className="form-grid">
      <label className="full"><span>{meeting ? "Assunto da reunião" : "O que é"}</span><input required autoFocus maxLength={140} value={form.title} onChange={(change) => setForm({ ...form, title: change.target.value })} placeholder={meeting ? "Ex.: Alinhamento com o cliente" : "Ex.: Reunião às 14h com a contabilidade"} /></label>
      <label><span>Dia</span><input type="date" required min={event ? undefined : today} value={form.day} onChange={(change) => setForm({ ...form, day: change.target.value })} /></label>
      <div className="agenda-times">
        <label><span>Início</span><input type="time" required value={form.time} onChange={(change) => setForm({ ...form, time: change.target.value, endTime: form.endTime && meeting && form.endTime <= change.target.value ? plusMinutes(form.day, change.target.value, 30) : form.endTime })} /></label>
        <label><span>Fim {meeting ? "" : "(opcional)"}</span><input type="time" value={form.endTime} min={form.time} onChange={(change) => setForm({ ...form, endTime: change.target.value })} /></label>
      </div>
      <label className="full"><span>Avisar</span><select value={form.remindBefore} onChange={(change) => setForm({ ...form, remindBefore: change.target.value })}>{REMIND_OPTIONS.map((option) => <option key={String(option.value)} value={option.value === null ? "" : String(option.value)}>{option.label}</option>)}</select></label>
      <label className={form.repeat ? "" : "full"}><span>Repetir</span><select value={form.repeat} onChange={(change) => setForm({ ...form, repeat: change.target.value as Repeat })}>{REPEAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {form.repeat && <label><span>Até (opcional)</span><input type="date" min={form.day} value={form.repeatUntil} onChange={(change) => setForm({ ...form, repeatUntil: change.target.value })} /></label>}
      {past && !form.repeat && <p className="full form-hint warn">Este horário já passou: não haverá aviso.</p>}

      <div className="full agenda-people">
        <span className="field-label">Convidados {chosen.length > 0 && <b>{chosen.length}</b>}</span>
        {chosen.length > 0 && <div className="agenda-chosen">{chosen.map((person) => <button type="button" key={person.id} onClick={() => toggle(person.id)} title="Remover"><Avatar member={person} size={18} />{person.name}<X size={12} /></button>)}</div>}
        <label className="search agenda-search"><Search size={15} /><input value={query} onChange={(change) => setQuery(change.target.value)} placeholder="Buscar pessoa da equipe..." aria-label="Buscar convidado" /></label>
        <div className="agenda-picker">{filtered.length ? filtered.map((person) => <label key={person.id} className={form.attendees.includes(person.id) ? "on" : ""}><input type="checkbox" checked={form.attendees.includes(person.id)} onChange={() => toggle(person.id)} /><Avatar member={person} size={22} /><span className="agenda-picker-name">{person.name}</span>{!person.email && <small>sem e-mail</small>}</label>) : <p className="muted">Ninguém encontrado.</p>}</div>
        <small className="form-hint">Convidados recebem o convite e os avisos no sino do Portal.{meeting && noEmail.length > 0 && ` No Teams, ${noEmail.map((person) => person.name.split(" ")[0]).join(", ")} ${noEmail.length === 1 ? "precisa" : "precisam"} ser adicionados à mão (sem e-mail cadastrado).`}</small>
      </div>

      <label className="full"><span>{meeting ? "Pauta (opcional)" : "Observações (opcional)"}</span><textarea rows={3} maxLength={2000} value={form.notes} onChange={(change) => setForm({ ...form, notes: change.target.value })} placeholder={meeting ? "Assuntos que serão tratados" : "Detalhes para lembrar"} /></label>

      {meeting && <div className="full agenda-teams">
        <div>
          <strong>Reunião no Teams</strong>
          <p>1. Clique em <b>Abrir no Teams</b>: assunto, horário, convidados e pauta já vão preenchidos; lá é só <b>Enviar</b>.<br />2. (Opcional) Copie o link “Entrar” da reunião e cole abaixo: o botão <b>Entrar no Teams</b> aparece aqui na agenda.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!form.title.trim() || !startsAt} onClick={() => startsAt && openTeamsMeeting({ title: form.title.trim(), startsAt, endsAt: endsAt && endsAt > startsAt ? endsAt : null, notes: form.notes, attendees: form.attendees }, people)}><CalendarPlus size={15} /> Abrir no Teams</button>
        <label><span>Link para entrar (opcional)</span><input type="url" value={form.teamsUrl} onChange={(change) => setForm({ ...form, teamsUrl: change.target.value })} placeholder="https://teams.microsoft.com/l/meetup-join/..." /></label>
      </div>}
    </div>
    {error && <p className="modal-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? "Salvando..." : event ? "Salvar" : "Adicionar à agenda"}</button></div>
  </form></div>;
}
