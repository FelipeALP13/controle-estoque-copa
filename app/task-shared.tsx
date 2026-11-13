"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import CalendarDays from "lucide-react/icons/calendar";
import Plus from "lucide-react/icons/plus";
import X from "lucide-react/icons/x";
import { dueState, taskPriorityLabels, type TaskEventKind, type TaskPriority, type TaskStatus } from "./tasks";
import CalendarOff from "lucide-react/icons/calendar-off";
import { absenceOn, describeAbsence } from "./absences";
import { useAbsences } from "./use-absences";

export type Task = {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  teamId: number | null;
  clientId: number | null;
  projectId: number | null;
  category: string;
  openedOn: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedOn: string | null;
  estimatedHours: number | null;
  workedHours: number | null;
  baseHours: number | null;
  hoursFlag: boolean;
  origin: string;
  notes: string;
  sortOrder: number;
  createdByName: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  owners: number[];
  support: number[];
  codes: string[];
  checklist: { done: number; total: number } | null;
  /** Quantas demandas das quais esta depende ainda não terminaram. */
  waitingOn?: number;
  sprintId?: number | null;
};

type TaskMember = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
export type TaskTeam = { id: number; name: string; color: string };
export type TaskClient = { id: number; name: string; active: boolean };
type TaskProject = { id: number; name: string };
export type Me = { id: number; canEdit: boolean; isAdmin: boolean; teamIds: number[] };
export type TaskEvent = { id: number; kind: TaskEventKind; body: string; actorId: number | null; actorName: string; createdAt: string; canDelete: boolean };
export type TasksData = { tasks: Task[]; members: TaskMember[]; teams: TaskTeam[]; clients: TaskClient[]; projects: TaskProject[]; categories: string[]; sprints?: TaskSprint[]; me: Me };
export type TaskSprint = { id: number; name: string; status: string };
export type Lookups = { members: TaskMember[]; membersById: Map<number, TaskMember>; teams: TaskTeam[]; clients: TaskClient[]; clientsById: Map<number, TaskClient>; projects: TaskProject[]; categories: string[]; sprints?: TaskSprint[] };

// O quadro mostra o fluxo de trabalho; "Cancelado" fica só na lista.
export const boardStatuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused", "done"];
export const BOARD_DONE_LIMIT = 30;

export function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseStored(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

export function relativeTime(value: string) {
  const minutes = Math.round((Date.now() - parseStored(value).getTime()) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(parseStored(value));
}

function dueLabel(dueDate: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${dueDate}T12:00:00Z`)).replace(".", "");
}

export function fullDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

export async function postTask(payload: Record<string, unknown>) {
  const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json() as { error?: string; task?: Task };
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", className: `status-icon ${status}`, "aria-hidden": true } as const;
  if (status === "backlog") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2.2" /></svg>;
  if (status === "todo") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
  if (status === "in_progress") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor" /></svg>;
  if (status === "in_review") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 4.5a3.5 3.5 0 1 1-3.5 3.5H8Z" fill="currentColor" /></svg>;
  if (status === "waiting") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  if (status === "blocked") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m4 12 8-8" stroke="currentColor" strokeWidth="1.6" /></svg>;
  if (status === "paused") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6.6 5.5v5M9.4 5.5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  if (status === "done") return <svg {...common}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="m5 8.2 2 2 4-4.2" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="white" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", className: `priority-icon p${priority}`, role: "img", "aria-label": taskPriorityLabels[priority] } as const;
  if (priority === 1) return <svg {...common}><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" /><path d="M8 4.5v4.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="11.3" r="1" fill="white" /></svg>;
  if (priority === 0) return <svg {...common}><path d="M3 8h2m1.5 0h3m1.5 0h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  const filled = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return <svg {...common}>{[0, 1, 2].map((bar) => <rect key={bar} x={2 + bar * 4.5} y={10 - bar * 3.5} width="3" height={4 + bar * 3.5} rx="1" fill="currentColor" opacity={bar < filled ? 1 : 0.25} />)}</svg>;
}

export function TeamChip({ team, lead }: { team: { name: string; color: string }; lead?: boolean }) {
  return <span className={`team-chip ${team.color}`}><i />{team.name}{lead && <b>Líder</b>}</span>;
}

export function Avatar({ member, size = 22 }: { member: TaskMember | null | undefined; size?: number }) {
  if (!member) return <span className="task-avatar empty" style={{ width: size, height: size }} title="Sem responsável" />;
  return <span className="task-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} title={member.name}>
    {member.avatarKey ? <Image src={`/api/media?key=${encodeURIComponent(member.avatarKey)}`} alt="" fill sizes={`${size}px`} unoptimized /> : member.avatarIcon || member.name.slice(0, 1)}
  </span>;
}

/** Até 3 avatares sobrepostos e "+N" para o resto. */
export function AvatarStack({ ids, membersById, size = 22 }: { ids: number[]; membersById: Map<number, TaskMember>; size?: number }) {
  if (!ids.length) return <Avatar member={null} size={size} />;
  const names = ids.map((id) => membersById.get(id)?.name ?? "Pessoa removida").join(", ");
  return <span className="avatar-stack" title={names} aria-label={`Responsáveis: ${names}`}>
    {ids.slice(0, 3).map((id) => <Avatar key={id} member={membersById.get(id)} size={size} />)}
    {ids.length > 3 && <span className="avatar-more" style={{ height: size, minWidth: size }}>+{ids.length - 3}</span>}
  </span>;
}

export function DueChip({ dueDate, closed, today }: { dueDate: string; closed: boolean; today: string }) {
  const state = closed ? "later" : dueState(dueDate, today);
  const label = state === "today" ? "Hoje" : dueLabel(dueDate);
  return <span className={`task-due ${state}`} title={state === "overdue" ? "Prazo vencido" : "Prazo"}><CalendarDays size={11} />{label}</span>;
}

/** Seleção de várias pessoas com busca. */
export function PeoplePicker({ label, value, onChange, members, exclude = [], disabled }: { label: string; value: number[]; onChange: (ids: number[]) => void; members: TaskMember[]; exclude?: number[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const byId = new Map(members.map((member) => [member.id, member]));
  const { absences } = useAbsences();
  const today = todayInSaoPaulo();
  const away = (id: number) => { const absence = absenceOn(absences, id, today); return absence ? describeAbsence(absence, today) : ""; };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const options = members.filter((member) => !exclude.includes(member.id) && (!query || fold(member.name).includes(fold(query))));
  return <div className="people-picker" ref={root}>
    <span className="people-picker-label">{label}</span>
    <div className={`people-picker-box ${disabled ? "disabled" : ""}`}>
      {value.map((id) => <span key={id} className={`people-chip ${away(id) ? "away" : ""}`} title={away(id) || undefined}><Avatar member={byId.get(id)} size={16} />{byId.get(id)?.name ?? "Pessoa removida"}{away(id) && <CalendarOff size={11} className="people-chip-away" aria-label={away(id)} />}{!disabled && <button type="button" onClick={() => onChange(value.filter((entry) => entry !== id))} aria-label={`Remover ${byId.get(id)?.name ?? "pessoa"}`}><X size={11} /></button>}</span>)}
      {!disabled && <button type="button" className="people-add" onClick={() => setOpen((current) => !current)} aria-expanded={open}><Plus size={12} /> {value.length ? "Adicionar" : "Escolher"}</button>}
      {disabled && !value.length && <span className="people-empty">Ninguém</span>}
    </div>
    {open && <div className="people-menu">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } if (event.key === "Enter") { event.preventDefault(); const first = options.find((member) => !value.includes(member.id)); if (first) { onChange([...value, first.id]); setQuery(""); } } }} />
      <ul>{options.length ? options.map((member) => {
        const selected = value.includes(member.id);
        return <li key={member.id}><label><input type="checkbox" checked={selected} onChange={() => onChange(selected ? value.filter((id) => id !== member.id) : [...value, member.id])} /><Avatar member={member} size={18} />{member.name}{away(member.id) && <small className="people-menu-away">{away(member.id)}</small>}</label></li>;
      }) : <li className="people-menu-empty">Ninguém encontrado</li>}</ul>
    </div>}
  </div>;
}

/** Campo de comentário que sugere pessoas ao digitar "@". */
export function MentionTextarea({ value, onChange, members, onSubmit }: { value: string; onChange: (value: string) => void; members: TaskMember[]; onSubmit: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = mention ? members.filter((member) => fold(member.name).includes(fold(mention.query))).slice(0, 6) : [];

  function detect(text: string, caret: number) {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    const query = at >= 0 ? before.slice(at + 1) : "";
    const valid = at >= 0 && (at === 0 || /\s/.test(before[at - 1])) && !/\n/.test(query) && query.length <= 30 && !/\s{2}/.test(query);
    setMention(valid ? { start: at, query } : null);
    setActive(0);
  }

  function choose(member: TaskMember) {
    if (!mention || !ref.current) return;
    const caret = ref.current.selectionStart;
    const inserted = `@${member.name} `;
    const next = value.slice(0, mention.start) + inserted + value.slice(caret);
    onChange(next);
    setMention(null);
    const position = mention.start + inserted.length;
    window.requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(position, position); });
  }

  return <div className="mention-field">
    <textarea ref={ref} value={value} rows={3} maxLength={4000} placeholder="Escreva um comentário... Use @ para mencionar alguém (Ctrl + Enter envia)"
      onChange={(event) => { onChange(event.target.value); detect(event.target.value, event.target.selectionStart); }}
      onClick={(event) => detect(event.currentTarget.value, event.currentTarget.selectionStart)}
      onBlur={() => window.setTimeout(() => setMention(null), 150)}
      onKeyDown={(event) => {
        if (suggestions.length) {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((active + 1) % suggestions.length); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((active - 1 + suggestions.length) % suggestions.length); return; }
          if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(suggestions[active]); return; }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onSubmit();
      }} />
    {suggestions.length > 0 && <ul className="mention-menu" role="listbox" aria-label="Mencionar">
      {suggestions.map((member, index) => <li key={member.id} role="option" aria-selected={index === active}>
        <button type="button" className={index === active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); choose(member); }}><Avatar member={member} size={20} />{member.name}</button>
      </li>)}
    </ul>}
  </div>;
}
