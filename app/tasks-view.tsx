"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import CalendarDays from "lucide-react/icons/calendar";
import ChevronDown from "lucide-react/icons/chevron-down";
import Columns3 from "lucide-react/icons/columns-3";
import LayoutList from "lucide-react/icons/layout-list";
import ListTodo from "lucide-react/icons/list-todo";
import MessageSquare from "lucide-react/icons/message-square";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Send from "lucide-react/icons/send";
import Trash2 from "lucide-react/icons/trash-2";
import X from "lucide-react/icons/x";
import { describeTaskEvent, dueState, isClosedStatus, sortOrderBetween, taskCode, taskPriorities, taskPriorityLabels, taskStatuses, taskStatusLabels, type TaskEventKind, type TaskPriority, type TaskStatus } from "./tasks";

export type Task = {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number | null;
  dueDate: string | null;
  sortOrder: number;
  createdByName: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
};

type TaskMember = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type Me = { id: number; canEdit: boolean; isAdmin: boolean };
type TaskEvent = { id: number; kind: TaskEventKind; body: string; actorId: number | null; actorName: string; createdAt: string; canDelete: boolean };
type TasksData = { tasks: Task[]; members: TaskMember[]; me: Me };

const boardStatuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function parseStored(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

function relativeTime(value: string) {
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

async function postTask(payload: Record<string, unknown>) {
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

function Avatar({ member, size = 22 }: { member: TaskMember | null | undefined; size?: number }) {
  if (!member) return <span className="task-avatar empty" style={{ width: size, height: size }} title="Sem responsável" />;
  return <span className="task-avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} title={member.name}>
    {member.avatarKey ? <Image src={`/api/media?key=${encodeURIComponent(member.avatarKey)}`} alt="" fill sizes={`${size}px`} unoptimized /> : member.avatarIcon || member.name.slice(0, 1)}
  </span>;
}

function DueChip({ dueDate, closed, today }: { dueDate: string; closed: boolean; today: string }) {
  const state = closed ? "later" : dueState(dueDate, today);
  const label = state === "today" ? "Hoje" : dueLabel(dueDate);
  return <span className={`task-due ${state}`} title={state === "overdue" ? "Prazo vencido" : "Prazo"}><CalendarDays size={11} />{label}</span>;
}

type Filters = { scope: "all" | "mine"; assignee: string; priority: string; search: string };

function readView(): "list" | "board" {
  try { return window.localStorage.getItem("tasks-view") === "board" ? "board" : "list"; } catch { return "list"; }
}

export default function TasksView() {
  const [data, setData] = useState<TasksData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [filters, setFilters] = useState<Filters>({ scope: "all", assignee: "", priority: "", search: "" });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, canceled: true });
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const json = await response.json() as TasksData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as tarefas.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as tarefas.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { setView(readView()); void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible" && !busy.current) void load(); }, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "c" && data?.me.canEdit && !creating && !openTaskId) { event.preventDefault(); setCreating("todo"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, creating, openTaskId]);

  function changeView(next: "list" | "board") {
    setView(next);
    try { window.localStorage.setItem("tasks-view", next); } catch { /* preferência opcional */ }
  }

  const today = todayInSaoPaulo();
  const membersById = useMemo(() => new Map((data?.members ?? []).map((member) => [member.id, member])), [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const query = filters.search.trim().toLocaleLowerCase("pt-BR");
    return data.tasks.filter((task) => {
      if (filters.scope === "mine" && task.assigneeId !== data.me.id) return false;
      if (filters.assignee === "none" && task.assigneeId !== null) return false;
      if (filters.assignee && filters.assignee !== "none" && task.assigneeId !== Number(filters.assignee)) return false;
      if (filters.priority && task.priority !== Number(filters.priority)) return false;
      if (query && !`${taskCode(task.id)} ${task.title}`.toLocaleLowerCase("pt-BR").includes(query)) return false;
      return true;
    }).sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id);
  }, [data, filters]);

  const byStatus = useMemo(() => Object.fromEntries(taskStatuses.map((status) => [status, visible.filter((task) => task.status === status)])) as Record<TaskStatus, Task[]>, [visible]);

  async function update(taskId: number, changes: Record<string, unknown>) {
    if (!data) return;
    busy.current = true;
    setData({ ...data, tasks: data.tasks.map((task) => task.id === taskId ? { ...task, ...changes } as Task : task) });
    try {
      const result = await postTask({ action: "updateTask", taskId, ...changes });
      if (result.task) setData((current) => current && { ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...result.task } : task) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      await load();
    } finally {
      busy.current = false;
    }
  }

  async function moveTask(taskId: number, status: TaskStatus, beforeId: number | null) {
    const column = (byStatus[status] ?? []).filter((task) => task.id !== taskId);
    const index = beforeId === null ? column.length : Math.max(0, column.findIndex((task) => task.id === beforeId));
    const sortOrder = sortOrderBetween(column[index - 1]?.sortOrder ?? null, column[index]?.sortOrder ?? null);
    const task = data?.tasks.find((entry) => entry.id === taskId);
    if (!task || (task.status === status && task.sortOrder === sortOrder)) return;
    await update(taskId, task.status === status ? { sortOrder } : { status, sortOrder });
  }

  const openTask = data?.tasks.find((task) => task.id === openTaskId) ?? null;
  const myOpen = data ? data.tasks.filter((task) => task.assigneeId === data.me.id && !isClosedStatus(task.status)).length : 0;

  return <div className="tasks-page">
    <div className="tasks-toolbar">
      <div className="tasks-scope" role="group" aria-label="Quais tarefas">
        <button className={filters.scope === "all" ? "active" : ""} aria-pressed={filters.scope === "all"} onClick={() => setFilters({ ...filters, scope: "all" })}>Todas</button>
        <button className={filters.scope === "mine" ? "active" : ""} aria-pressed={filters.scope === "mine"} onClick={() => setFilters({ ...filters, scope: "mine" })}>Minhas{myOpen > 0 && <b>{myOpen}</b>}</button>
      </div>
      <label className="tasks-search"><Search size={14} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Buscar por título ou código" /></label>
      <select aria-label="Filtrar por responsável" value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}>
        <option value="">Todos os responsáveis</option>
        <option value="none">Sem responsável</option>
        {data?.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
      <select aria-label="Filtrar por prioridade" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
        <option value="">Todas as prioridades</option>
        {taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}
      </select>
      <div className="tasks-view-toggle" role="group" aria-label="Visualização">
        <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => changeView("list")} title="Lista"><LayoutList size={15} /><span>Lista</span></button>
        <button className={view === "board" ? "active" : ""} aria-pressed={view === "board"} onClick={() => changeView("board")} title="Quadro"><Columns3 size={15} /><span>Quadro</span></button>
      </div>
      {data?.me.canEdit && <button className="primary-button tasks-new" onClick={() => setCreating("todo")} title="Atalho: tecla C"><Plus size={16} /> Nova tarefa</button>}
    </div>

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {!data ? <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div> : data.tasks.length === 0 ? (
      <div className="empty-state"><span><ListTodo /></span><h3>Nenhuma tarefa ainda</h3><p>{data.me.canEdit ? "Crie a primeira tarefa para organizar o trabalho da equipe. Dica: a tecla C abre uma tarefa nova." : "Quando a equipe criar tarefas, elas aparecem aqui."}</p>{data.me.canEdit && <div><button className="primary-button" onClick={() => setCreating("todo")}><Plus size={16} /> Nova tarefa</button></div>}</div>
    ) : view === "list" ? (
      <div className="task-list">
        {visible.length === 0 && <div className="empty-state compact"><Search /><h3>Nenhuma tarefa encontrada</h3><p>Ajuste a busca ou os filtros.</p></div>}
        {taskStatuses.map((status) => {
          const group = byStatus[status];
          if (!group.length) return null;
          const isCollapsed = collapsed[status];
          return <section key={status} className="task-group">
            <header className="task-group-head">
              <button className="task-group-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed({ ...collapsed, [status]: !isCollapsed })}><ChevronDown size={14} className={isCollapsed ? "closed" : ""} /><StatusIcon status={status} /><strong>{taskStatusLabels[status]}</strong><span>{group.length}</span></button>
              {data.me.canEdit && <button className="task-group-add" onClick={() => setCreating(status)} aria-label={`Nova tarefa em ${taskStatusLabels[status]}`} title="Nova tarefa neste status"><Plus size={14} /></button>}
            </header>
            {!isCollapsed && group.map((task) => <button key={task.id} className="task-row" onClick={() => setOpenTaskId(task.id)}>
              <PriorityIcon priority={task.priority} />
              <span className="task-code">{taskCode(task.id)}</span>
              <StatusIcon status={task.status} />
              <span className={`task-title ${task.status === "canceled" ? "canceled" : ""}`}>{task.title}</span>
              <span className="task-row-meta">
                {task.commentCount > 0 && <span className="task-comments" title={`${task.commentCount} comentários`}><MessageSquare size={12} />{task.commentCount}</span>}
                {task.dueDate && <DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} />}
                <Avatar member={task.assigneeId ? membersById.get(task.assigneeId) : null} />
              </span>
            </button>)}
          </section>;
        })}
      </div>
    ) : (
      <Board byStatus={byStatus} membersById={membersById} canEdit={data.me.canEdit} today={today} onOpen={setOpenTaskId} onMove={moveTask} onCreate={setCreating} />
    )}

    {creating && data && <NewTaskModal initialStatus={creating} members={data.members} meId={data.me.id} onClose={() => setCreating(null)} onCreated={async (task) => { setCreating(null); await load(); setOpenTaskId(task.id); }} />}
    {openTask && data && <TaskDrawer key={openTask.id} task={openTask} members={data.members} me={data.me} today={today} onClose={() => setOpenTaskId(null)} onUpdate={(changes) => update(openTask.id, changes)} onDeleted={async () => { setOpenTaskId(null); await load(); }} onCommented={load} />}
  </div>;
}

function Board({ byStatus, membersById, canEdit, today, onOpen, onMove, onCreate }: { byStatus: Record<TaskStatus, Task[]>; membersById: Map<number, TaskMember>; canEdit: boolean; today: string; onOpen: (id: number) => void; onMove: (taskId: number, status: TaskStatus, beforeId: number | null) => void; onCreate: (status: TaskStatus) => void }) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [target, setTarget] = useState<{ status: TaskStatus; beforeId: number | null } | null>(null);

  function finish() { setDragId(null); setTarget(null); }

  return <div className="task-board">
    {boardStatuses.map((status) => {
      const column = byStatus[status];
      return <section key={status} className={`board-column ${target?.status === status ? "drop-target" : ""}`}
        onDragOver={(event) => {
          if (dragId === null) return;
          event.preventDefault();
          // Sobre um cartão, o próprio cartão define a posição; no espaço livre, vai para o fim.
          if (!(event.target as HTMLElement).closest(".board-card") && (target?.status !== status || target.beforeId !== null)) setTarget({ status, beforeId: null });
        }}
        onDrop={(event) => { event.preventDefault(); if (dragId !== null && target) onMove(dragId, target.status, target.beforeId); finish(); }}>
        <header><StatusIcon status={status} /><strong>{taskStatusLabels[status]}</strong><span>{column.length}</span>{canEdit && <button onClick={() => onCreate(status)} aria-label={`Nova tarefa em ${taskStatusLabels[status]}`}><Plus size={14} /></button>}</header>
        <div className="board-cards">
          {column.map((task) => <div key={task.id}>
            {target?.status === status && target.beforeId === task.id && dragId !== task.id && <div className="drop-line" />}
            <button className={`board-card ${dragId === task.id ? "dragging" : ""}`} draggable={canEdit} onClick={() => onOpen(task.id)}
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); setDragId(task.id); }}
              onDragEnd={finish}
              onDragOver={(event) => { if (dragId === null) return; event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); const after = event.clientY > box.top + box.height / 2; const index = column.findIndex((entry) => entry.id === task.id); setTarget({ status, beforeId: after ? column[index + 1]?.id ?? null : task.id }); }}>
              <span className="board-card-top"><span className="task-code">{taskCode(task.id)}</span><Avatar member={task.assigneeId ? membersById.get(task.assigneeId) : null} size={20} /></span>
              <span className="board-card-title"><StatusIcon status={task.status} /><span>{task.title}</span></span>
              <span className="board-card-meta"><PriorityIcon priority={task.priority} />{task.dueDate && <DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} />}{task.commentCount > 0 && <span className="task-comments"><MessageSquare size={12} />{task.commentCount}</span>}</span>
            </button>
          </div>)}
          {target?.status === status && target.beforeId === null && <div className="drop-line" />}
          {column.length === 0 && <p className="board-empty">{canEdit ? "Arraste uma tarefa para cá" : "Nenhuma tarefa"}</p>}
        </div>
      </section>;
    })}
  </div>;
}

function PropertyFields({ status, setStatus, priority, setPriority, assigneeId, setAssigneeId, dueDate, setDueDate, members, disabled }: { status: TaskStatus; setStatus: (value: TaskStatus) => void; priority: TaskPriority; setPriority: (value: TaskPriority) => void; assigneeId: number | null; setAssigneeId: (value: number | null) => void; dueDate: string; setDueDate: (value: string) => void; members: TaskMember[]; disabled?: boolean }) {
  return <>
    <label className="task-prop"><span>Status</span><span className="task-prop-control"><StatusIcon status={status} /><select disabled={disabled} value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>{taskStatuses.map((value) => <option key={value} value={value}>{taskStatusLabels[value]}</option>)}</select></span></label>
    <label className="task-prop"><span>Prioridade</span><span className="task-prop-control"><PriorityIcon priority={priority} /><select disabled={disabled} value={priority} onChange={(event) => setPriority(Number(event.target.value) as TaskPriority)}>{taskPriorities.map((value) => <option key={value} value={value}>{taskPriorityLabels[value]}</option>)}</select></span></label>
    <label className="task-prop"><span>Responsável</span><span className="task-prop-control"><Avatar member={members.find((member) => member.id === assigneeId)} size={18} /><select disabled={disabled} value={assigneeId ?? ""} onChange={(event) => setAssigneeId(event.target.value ? Number(event.target.value) : null)}><option value="">Sem responsável</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></span></label>
    <label className="task-prop"><span>Prazo</span><span className="task-prop-control"><CalendarDays size={14} /><input disabled={disabled} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />{dueDate && !disabled && <button type="button" className="task-prop-clear" onClick={() => setDueDate("")} aria-label="Remover prazo"><X size={12} /></button>}</span></label>
  </>;
}

function NewTaskModal({ initialStatus, members, meId, onClose, onCreated }: { initialStatus: TaskStatus; members: TaskMember[]; meId: number; onClose: () => void; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [priority, setPriority] = useState<TaskPriority>(0);
  const [assigneeId, setAssigneeId] = useState<number | null>(members.some((member) => member.id === meId) ? meId : null);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await postTask({ action: "createTask", title, description, status, priority, assigneeId, dueDate });
      if (result.task) onCreated(result.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a tarefa.");
      setSaving(false);
    }
  }

  return <div className="modal-layer" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <button className="backdrop" onClick={onClose} aria-label="Fechar janela" />
    <form className="modal task-modal" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(event); }}>
      <div className="modal-head"><div><p className="eyebrow">TAREFAS</p><h2>Nova tarefa</h2><p>Ctrl + Enter cria a tarefa.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
      <div className="task-modal-body">
        <input className="task-title-input" autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título da tarefa" />
        <textarea className="task-description-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição (opcional)" rows={5} />
        <div className="task-props-row"><PropertyFields status={status} setStatus={setStatus} priority={priority} setPriority={setPriority} assigneeId={assigneeId} setAssigneeId={setAssigneeId} dueDate={dueDate} setDueDate={setDueDate} members={members} /></div>
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !title.trim()}>{saving ? "Criando..." : "Criar tarefa"}</button></div>
    </form>
  </div>;
}

function TaskDrawer({ task, members, me, today, onClose, onUpdate, onDeleted, onCommented }: { task: Task; members: TaskMember[]; me: Me; today: string; onClose: () => void; onUpdate: (changes: Record<string, unknown>) => Promise<void>; onDeleted: () => void; onCommented: () => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const loadEvents = useCallback(async () => {
    const response = await fetch(`/api/tasks?taskId=${task.id}`, { cache: "no-store" });
    const data = await response.json() as { events?: TaskEvent[]; error?: string };
    if (response.ok && data.events) setEvents(data.events); else setError(data.error || "Não foi possível carregar a atividade.");
  }, [task.id]);

  // Recarrega a atividade quando a tarefa muda (status, responsável...).
  useEffect(() => { const timer = window.setTimeout(() => { void loadEvents(); }, 0); return () => window.clearTimeout(timer); }, [loadEvents, task.updatedAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !(event.target as HTMLElement).closest("textarea, input")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(changes: Record<string, unknown>) {
    setError("");
    await onUpdate(changes);
  }

  async function sendComment(event?: React.FormEvent) {
    event?.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    setError("");
    try {
      await postTask({ action: "addComment", taskId: task.id, body: comment });
      setComment("");
      await Promise.all([loadEvents(), onCommented()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível comentar.");
    } finally {
      setSending(false);
    }
  }

  async function removeComment(eventId: number) {
    if (!window.confirm("Excluir este comentário?")) return;
    try {
      await postTask({ action: "deleteComment", eventId });
      await Promise.all([loadEvents(), onCommented()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o comentário.");
    }
  }

  async function removeTask() {
    if (!window.confirm(`Excluir ${taskCode(task.id)} “${task.title}”? Os comentários também serão apagados. Esta ação não pode ser desfeita.`)) return;
    try {
      await postTask({ action: "deleteTask", taskId: task.id });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir a tarefa.");
    }
  }

  const readOnly = !me.canEdit;

  return <div className="task-drawer-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar tarefa" />
    <aside className="task-drawer" role="dialog" aria-label={`${taskCode(task.id)} ${task.title}`}>
      <header className="task-drawer-head">
        <span className="task-code">{taskCode(task.id)}</span>
        <span className="task-drawer-created">Criada por {task.createdByName} · {relativeTime(task.createdAt)}</span>
        {me.isAdmin && <button className="task-drawer-icon danger" onClick={removeTask} aria-label="Excluir tarefa" title="Excluir tarefa"><Trash2 size={15} /></button>}
        <button className="task-drawer-icon" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><X size={16} /></button>
      </header>
      <div className="task-drawer-body">
        <div className="task-drawer-main">
          <textarea className="task-title-input" rows={1} readOnly={readOnly} value={title} maxLength={160}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            onBlur={() => { const next = title.trim(); if (!next) setTitle(task.title); else if (next !== task.title) void save({ title: next }); }} />
          <textarea className="task-description-input" readOnly={readOnly} value={description} rows={6} placeholder={readOnly ? "Sem descrição." : "Adicione uma descrição..."}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== task.description) void save({ description }); }} />
          <div className="task-props-row mobile-only"><PropertyFields status={task.status} setStatus={(value) => save({ status: value })} priority={task.priority} setPriority={(value) => save({ priority: value })} assigneeId={task.assigneeId} setAssigneeId={(value) => save({ assigneeId: value })} dueDate={task.dueDate ?? ""} setDueDate={(value) => save({ dueDate: value })} members={members} disabled={readOnly} /></div>

          {error && <p className="modal-error task-drawer-error">{error}</p>}

          <h3 className="task-activity-title">Atividade</h3>
          {!events ? <div className="loading-list"><span /></div> : <ol className="task-activity">
            {events.map((event) => event.kind === "comment" ? (
              <li key={event.id} className="task-comment">
                <Avatar member={event.actorId ? membersById.get(event.actorId) : null} size={24} />
                <div><p><strong>{event.actorName}</strong><span>{relativeTime(event.createdAt)}</span>{event.canDelete && <button onClick={() => removeComment(event.id)} aria-label="Excluir comentário" title="Excluir comentário"><Trash2 size={12} /></button>}</p><div className="task-comment-body">{event.body}</div></div>
              </li>
            ) : (
              <li key={event.id} className="task-change"><span className="task-change-dot" /><p><strong>{event.actorName}</strong> {describeTaskEvent(event.kind, event.body)} <span>· {relativeTime(event.createdAt)}</span></p></li>
            ))}
          </ol>}
          {me.canEdit && <form className="task-comment-form" onSubmit={sendComment}>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Escreva um comentário... (Ctrl + Enter envia)" rows={3} maxLength={4000}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendComment(); }} />
            <button className="primary-button" disabled={sending || !comment.trim()}><Send size={14} /> {sending ? "Enviando..." : "Comentar"}</button>
          </form>}
        </div>
        <div className="task-drawer-side">
          <PropertyFields status={task.status} setStatus={(value) => save({ status: value })} priority={task.priority} setPriority={(value) => save({ priority: value })} assigneeId={task.assigneeId} setAssigneeId={(value) => save({ assigneeId: value })} dueDate={task.dueDate ?? ""} setDueDate={(value) => save({ dueDate: value })} members={members} disabled={readOnly} />
          {task.dueDate && <p className="task-side-note"><DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} /></p>}
          {task.completedAt && <p className="task-side-note">Concluída {relativeTime(task.completedAt)}</p>}
        </div>
      </div>
    </aside>
  </div>;
}

/** Resumo para a visão geral: as tarefas abertas atribuídas a quem está logado. */
export function MyTasksPanel({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<TasksData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        if (!response.ok) return;
        const json = await response.json() as TasksData;
        if (!cancelled) setData(json);
      } catch { /* o painel é opcional */ }
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;
  const today = todayInSaoPaulo();
  const priorityRank = (priority: TaskPriority) => priority === 0 ? 5 : priority;
  const mine = data.tasks
    .filter((task) => task.assigneeId === data.me.id && !isClosedStatus(task.status))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || priorityRank(a.priority) - priorityRank(b.priority));
  const overdue = mine.filter((task) => task.dueDate && task.dueDate < today).length;

  return <article className="hub-tasks">
    <div className="hub-panel-title"><div><span><ListTodo /></span><div><h3>Minhas tarefas</h3><p>{mine.length ? `${mine.length} em aberto${overdue ? ` · ${overdue} com prazo vencido` : ""}` : "Nada atribuído a você agora"}</p></div></div><button onClick={onOpen}>Abrir tarefas</button></div>
    {mine.length ? mine.slice(0, 4).map((task) => <button key={task.id} className="hub-task-row" onClick={onOpen}>
      <PriorityIcon priority={task.priority} /><span className="task-code">{taskCode(task.id)}</span><StatusIcon status={task.status} /><span className="task-title">{task.title}</span>{task.dueDate && <DueChip dueDate={task.dueDate} closed={false} today={today} />}
    </button>) : <div className="hub-empty-row"><ListTodo /><span><strong>Tudo em dia</strong><small>As tarefas atribuídas a você aparecem aqui.</small></span></div>}
  </article>;
}
