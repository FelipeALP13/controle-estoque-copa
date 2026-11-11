"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Building2 from "lucide-react/icons/building-2";
import CalendarDays from "lucide-react/icons/calendar";
import ChevronDown from "lucide-react/icons/chevron-down";
import Columns3 from "lucide-react/icons/columns-3";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import LayoutList from "lucide-react/icons/layout-list";
import ListTodo from "lucide-react/icons/list-todo";
import MessageSquare from "lucide-react/icons/message-square";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import Send from "lucide-react/icons/send";
import Trash2 from "lucide-react/icons/trash-2";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import { splitMentions } from "./notifications";
import { describeTaskEvent, dueState, isClosedStatus, sortOrderBetween, taskCode, taskPriorities, taskPriorityLabels, taskStatuses, taskStatusLabels, type TaskEventKind, type TaskPriority, type TaskStatus } from "./tasks";
import ImportModal from "./import-modal";
import Download from "lucide-react/icons/download";
import { downloadXlsx, type CellValue } from "./xlsx-writer";
import CalendarOff from "lucide-react/icons/calendar-off";
import Clock from "lucide-react/icons/clock";
import { absenceOn, describeAbsence } from "./absences";
import { useAbsences } from "./use-absences";
import { formatHours, parseEntryHours, type TimeEntry } from "./time-entries";

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
};

type TaskMember = { id: number; name: string; avatarIcon: string; avatarKey: string | null };
type TaskTeam = { id: number; name: string; color: string };
type TaskClient = { id: number; name: string; active: boolean };
type TaskProject = { id: number; name: string };
type Me = { id: number; canEdit: boolean; isAdmin: boolean; teamIds: number[] };
type TaskEvent = { id: number; kind: TaskEventKind; body: string; actorId: number | null; actorName: string; createdAt: string; canDelete: boolean };
type TasksData = { tasks: Task[]; members: TaskMember[]; teams: TaskTeam[]; clients: TaskClient[]; projects: TaskProject[]; categories: string[]; me: Me };
type Lookups = { members: TaskMember[]; membersById: Map<number, TaskMember>; teams: TaskTeam[]; clients: TaskClient[]; clientsById: Map<number, TaskClient>; projects: TaskProject[]; categories: string[] };

// O quadro mostra o fluxo de trabalho; "Cancelado" fica só na lista.
const boardStatuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused", "done"];
const BOARD_DONE_LIMIT = 30;

function todayInSaoPaulo() {
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

function fullDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

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

function DueChip({ dueDate, closed, today }: { dueDate: string; closed: boolean; today: string }) {
  const state = closed ? "later" : dueState(dueDate, today);
  const label = state === "today" ? "Hoje" : dueLabel(dueDate);
  return <span className={`task-due ${state}`} title={state === "overdue" ? "Prazo vencido" : "Prazo"}><CalendarDays size={11} />{label}</span>;
}

type Filters = { scope: "all" | "mine" | "team"; person: string; priority: string; team: string; client: string; category: string; search: string };

function readView(): "list" | "board" {
  try { return window.localStorage.getItem("tasks-view") === "board" ? "board" : "list"; } catch { return "list"; }
}

const involves = (task: Task, memberId: number) => task.owners.includes(memberId) || task.support.includes(memberId);

export default function TasksView({ openRequest = null, onOpenRequestHandled }: { openRequest?: number | null; onOpenRequestHandled?: () => void }) {
  const [data, setData] = useState<TasksData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [filters, setFilters] = useState<Filters>({ scope: "all", person: "", priority: "", team: "", client: "", category: "", search: "" });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, canceled: true });
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [importing, setImporting] = useState(false);
  const [managingClients, setManagingClients] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const busy = useRef(false);
  const retriedRequest = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const json = await response.json() as TasksData & { error?: string };
      if (!response.ok) throw new Error(json.error || "Não foi possível carregar as demandas.");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar as demandas.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { setView(readView()); void load(); }, 0);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible" && !busy.current) void load(); }, 30000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  // Pedido vindo do sininho ou da visão geral para abrir uma demanda específica.
  useEffect(() => {
    if (!openRequest || !data) return;
    const timer = window.setTimeout(() => {
      if (data.tasks.some((task) => task.id === openRequest)) {
        setOpenTaskId(openRequest);
      } else if (retriedRequest.current !== openRequest) {
        // A lista pode estar desatualizada: recarrega uma vez antes de desistir.
        retriedRequest.current = openRequest;
        void load();
        return;
      } else {
        setError("Esta demanda não existe mais.");
      }
      retriedRequest.current = null;
      onOpenRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openRequest, data, onOpenRequestHandled, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "c" && data?.me.canEdit && !creating && !openTaskId && !importing) { event.preventDefault(); setCreating("todo"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, creating, openTaskId, importing]);

  function changeView(next: "list" | "board") {
    setView(next);
    try { window.localStorage.setItem("tasks-view", next); } catch { /* preferência opcional */ }
  }

  const today = todayInSaoPaulo();
  const lookups = useMemo<Lookups>(() => ({
    members: data?.members ?? [],
    membersById: new Map((data?.members ?? []).map((member) => [member.id, member])),
    teams: data?.teams ?? [],
    clients: data?.clients ?? [],
    clientsById: new Map((data?.clients ?? []).map((client) => [client.id, client])),
    projects: data?.projects ?? [],
    categories: data?.categories ?? [],
  }), [data]);
  const teamsById = useMemo(() => new Map(lookups.teams.map((team) => [team.id, team])), [lookups.teams]);

  const visible = useMemo(() => {
    if (!data) return [];
    const query = fold(filters.search.trim());
    return data.tasks.filter((task) => {
      if (filters.scope === "mine" && !involves(task, data.me.id)) return false;
      if (filters.scope === "team" && (task.teamId === null || !data.me.teamIds.includes(task.teamId))) return false;
      if (filters.team === "none" && task.teamId !== null) return false;
      if (filters.team && filters.team !== "none" && task.teamId !== Number(filters.team)) return false;
      if (filters.person === "none" && task.owners.length) return false;
      if (filters.person && filters.person !== "none" && !involves(task, Number(filters.person))) return false;
      if (filters.client && task.clientId !== Number(filters.client)) return false;
      if (filters.category && task.category !== filters.category) return false;
      if (filters.priority && task.priority !== Number(filters.priority)) return false;
      if (query) {
        const client = task.clientId ? lookups.clientsById.get(task.clientId)?.name ?? "" : "";
        if (!fold(`${taskCode(task.id)} ${task.codes.join(" ")} ${task.title} ${client} ${task.origin}`).includes(query)) return false;
      }
      return true;
    }).sort((a, b) => a.sortOrder - b.sortOrder || b.id - a.id);
  }, [data, filters, lookups.clientsById]);

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

  // Exporta exatamente o que a tela mostra (mesmos filtros, busca e ordem da lista).
  function exportExcel() {
    if (!data) return;
    const names = (ids: number[]) => ids.map((id) => lookups.membersById.get(id)?.name ?? `#${id}`).join(", ");
    const projectsById = new Map(lookups.projects.map((project) => [project.id, project.name]));
    const ordered = taskStatuses.flatMap((status) => byStatus[status]);
    const rows: CellValue[][] = ordered.map((task) => {
      const closed = isClosedStatus(task.status);
      const due = task.dueDate && !closed ? dueState(task.dueDate, today) : null;
      return [
        taskCode(task.id), task.codes.join(", "), task.title,
        task.clientId ? lookups.clientsById.get(task.clientId)?.name ?? "" : "", task.category,
        taskStatusLabels[task.status], taskPriorityLabels[task.priority],
        names(task.owners), names(task.support),
        task.teamId ? teamsById.get(task.teamId)?.name ?? "" : "", task.projectId ? projectsById.get(task.projectId) ?? "" : "",
        task.openedOn, task.startDate, task.dueDate, task.completedOn,
        due === "overdue" ? "Vencida" : due === "today" ? "Vence hoje" : due === "soon" ? "Vence em breve" : "",
        task.estimatedHours, task.workedHours, task.hoursFlag ? "Sim" : "",
        task.origin, task.notes, task.description, task.commentCount, task.createdByName,
      ];
    });
    const filterRows: CellValue[][] = [
      ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
      ["Demandas no arquivo", `${visible.length} de ${data.tasks.length}`],
      ["Quais", filters.scope === "mine" ? "Minhas" : filters.scope === "team" ? "Do meu time" : "Todas"],
      ["Busca", filters.search.trim()],
      ["Pessoa", filters.person === "none" ? "Sem responsável" : filters.person ? lookups.membersById.get(Number(filters.person))?.name ?? "" : ""],
      ["Cliente", filters.client ? lookups.clientsById.get(Number(filters.client))?.name ?? "" : ""],
      ["Categoria", filters.category],
      ["Time", filters.team === "none" ? "Sem time" : filters.team ? teamsById.get(Number(filters.team))?.name ?? "" : ""],
      ["Prioridade", filters.priority ? taskPriorityLabels[Number(filters.priority) as TaskPriority] : ""],
    ].map(([label, value]) => [label, value || "—"]);
    downloadXlsx(`demandas-${today}.xlsx`, [
      {
        name: "Demandas",
        columns: [
          { header: "Código", width: 10 }, { header: "Códigos antigos", width: 16 }, { header: "Título", width: 50 },
          { header: "Cliente / projeto", width: 22 }, { header: "Categoria", width: 18 },
          { header: "Status", width: 18 }, { header: "Prioridade", width: 14 },
          { header: "Responsáveis", width: 26 }, { header: "Resp. Suporte", width: 22 },
          { header: "Time", width: 16 }, { header: "Projeto grande", width: 22 },
          { header: "Abertura", type: "date", width: 12 }, { header: "Início", type: "date", width: 12 }, { header: "Prazo", type: "date", width: 12 }, { header: "Conclusão", type: "date", width: 12 },
          { header: "Situação do prazo", width: 16 },
          { header: "Horas estimadas", type: "number", width: 15 }, { header: "Horas trabalhadas", type: "number", width: 17 }, { header: "Horas a revisar", width: 14 },
          { header: "Origem", width: 18 }, { header: "Observações", width: 40 }, { header: "Descrição", width: 50 },
          { header: "Comentários", type: "number", width: 12 }, { header: "Criada por", width: 18 },
        ],
        rows,
      },
      { name: "Filtros", columns: [{ header: "Filtro", width: 22 }, { header: "Valor", width: 40 }], rows: filterRows },
    ]);
  }

  const openTask = data?.tasks.find((task) => task.id === openTaskId) ?? null;
  const myOpen = data ? data.tasks.filter((task) => involves(task, data.me.id) && !isClosedStatus(task.status)).length : 0;
  const activeFilters = [filters.person, filters.priority, filters.team, filters.client, filters.category].filter(Boolean).length;

  return <div className="tasks-page">
    <div className="tasks-toolbar">
      <div className="tasks-scope" role="group" aria-label="Quais demandas">
        <button className={filters.scope === "all" ? "active" : ""} aria-pressed={filters.scope === "all"} onClick={() => setFilters({ ...filters, scope: "all" })}>Todas</button>
        <button className={filters.scope === "mine" ? "active" : ""} aria-pressed={filters.scope === "mine"} onClick={() => setFilters({ ...filters, scope: "mine" })}>Minhas{myOpen > 0 && <b>{myOpen}</b>}</button>
        {(data?.me.teamIds.length ?? 0) > 0 && <button className={filters.scope === "team" ? "active" : ""} aria-pressed={filters.scope === "team"} onClick={() => setFilters({ ...filters, scope: "team" })}>Do meu time</button>}
      </div>
      <label className="tasks-search"><Search size={14} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Buscar por título, código (ex.: AS-0019) ou cliente" /></label>
      <div className="tasks-view-toggle" role="group" aria-label="Visualização">
        <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => changeView("list")} title="Lista"><LayoutList size={15} /><span>Lista</span></button>
        <button className={view === "board" ? "active" : ""} aria-pressed={view === "board"} onClick={() => changeView("board")} title="Quadro"><Columns3 size={15} /><span>Quadro</span></button>
      </div>
      {data && data.tasks.length > 0 && <button className="secondary-button" onClick={exportExcel} disabled={!visible.length} title="Baixa em Excel as demandas que estão na tela, com os filtros e a busca aplicados"><Download size={15} /> Exportar Excel</button>}
      {data?.me.isAdmin && <button className="secondary-button" onClick={() => setManagingClients(true)} title="Lista de clientes/projetos"><Building2 size={15} /> Clientes</button>}
      {data?.me.isAdmin && <button className="secondary-button" onClick={() => setImporting(true)}><FileSpreadsheet size={15} /> Importar planilhas</button>}
      {data?.me.canEdit && <button className="primary-button tasks-new" onClick={() => setCreating("todo")} title="Atalho: tecla C"><Plus size={16} /> Nova demanda</button>}
    </div>
    <div className="tasks-filters">
      <select aria-label="Filtrar por pessoa" value={filters.person} onChange={(event) => setFilters({ ...filters, person: event.target.value })}>
        <option value="">Todas as pessoas</option>
        <option value="none">Sem responsável</option>
        {lookups.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
      <select aria-label="Filtrar por cliente ou projeto" value={filters.client} onChange={(event) => setFilters({ ...filters, client: event.target.value })}>
        <option value="">Todos os clientes</option>
        {lookups.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
      <select aria-label="Filtrar por categoria" value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
        <option value="">Todas as categorias</option>
        {lookups.categories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      {lookups.teams.length > 0 && <select aria-label="Filtrar por time" value={filters.team} onChange={(event) => setFilters({ ...filters, team: event.target.value })}>
        <option value="">Todos os times</option>
        {lookups.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        <option value="none">Sem time</option>
      </select>}
      <select aria-label="Filtrar por prioridade" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
        <option value="">Todas as prioridades</option>
        {taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}
      </select>
      {activeFilters > 0 && <button className="filters-clear" onClick={() => setFilters({ ...filters, person: "", priority: "", team: "", client: "", category: "" })}><X size={13} /> Limpar filtros ({activeFilters})</button>}
      {data && <span className="tasks-count">{visible.length} de {data.tasks.length}</span>}
    </div>

    {error && <div className="alert error"><span>{error}</span><button onClick={() => setError("")} aria-label="Fechar aviso"><X size={16} /></button></div>}

    {!data ? <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div> : data.tasks.length === 0 ? (
      <div className="empty-state"><span><ListTodo /></span><h3>Nenhuma demanda ainda</h3><p>{data.me.isAdmin ? "Importe as planilhas de demandas ou crie a primeira demanda. Dica: a tecla C abre uma demanda nova." : data.me.canEdit ? "Crie a primeira demanda. Dica: a tecla C abre uma demanda nova." : "Quando a equipe criar demandas, elas aparecem aqui."}</p>{data.me.canEdit && <div>{data.me.isAdmin && <button className="secondary-button" onClick={() => setImporting(true)}><FileSpreadsheet size={16} /> Importar planilhas</button>}<button className="primary-button" onClick={() => setCreating("todo")}><Plus size={16} /> Nova demanda</button></div>}</div>
    ) : view === "list" ? (
      <div className="task-list">
        {visible.length === 0 && <div className="empty-state compact"><Search /><h3>Nenhuma demanda encontrada</h3><p>Ajuste a busca ou os filtros.</p></div>}
        {taskStatuses.map((status) => {
          const group = byStatus[status];
          if (!group.length) return null;
          const isCollapsed = collapsed[status];
          return <section key={status} className="task-group">
            <header className="task-group-head">
              <button className="task-group-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed({ ...collapsed, [status]: !isCollapsed })}><ChevronDown size={14} className={isCollapsed ? "closed" : ""} /><StatusIcon status={status} /><strong>{taskStatusLabels[status]}</strong><span>{group.length}</span></button>
              {data.me.canEdit && <button className="task-group-add" onClick={() => setCreating(status)} aria-label={`Nova demanda em ${taskStatusLabels[status]}`} title="Nova demanda neste status"><Plus size={14} /></button>}
            </header>
            {!isCollapsed && group.map((task) => {
              const client = task.clientId ? lookups.clientsById.get(task.clientId) : null;
              return <button key={task.id} className="task-row" onClick={() => setOpenTaskId(task.id)}>
                <PriorityIcon priority={task.priority} />
                <span className="task-code" title={task.codes.length ? `Código${task.codes.length > 1 ? "s" : ""} antigo${task.codes.length > 1 ? "s" : ""}: ${task.codes.join(", ")}` : undefined}>{taskCode(task.id)}</span>
                <StatusIcon status={task.status} />
                <span className="task-row-main">
                  <span className={`task-title ${task.status === "canceled" ? "canceled" : ""}`}>{task.title}</span>
                  {(client || task.category) && <span className="task-row-sub">{client?.name}{client && task.category && " · "}{task.category}</span>}
                </span>
                <span className="task-row-meta">
                  {task.hoursFlag && <span className="hours-flag" title="Horas importadas fora do normal: revise"><TriangleAlert size={12} /></span>}
                  {task.teamId && teamsById.get(task.teamId) && <span className="task-team"><TeamChip team={teamsById.get(task.teamId)!} /></span>}
                  {task.commentCount > 0 && <span className="task-comments" title={`${task.commentCount} comentários`}><MessageSquare size={12} />{task.commentCount}</span>}
                  {task.dueDate && <DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} />}
                  <AvatarStack ids={task.owners} membersById={lookups.membersById} />
                </span>
              </button>;
            })}
          </section>;
        })}
      </div>
    ) : (
      <Board byStatus={byStatus} lookups={lookups} teamsById={teamsById} canEdit={data.me.canEdit} today={today} onOpen={setOpenTaskId} onMove={moveTask} onCreate={setCreating} />
    )}

    {creating && data && <NewTaskModal initialStatus={creating} lookups={lookups} meId={data.me.id} defaultTeamId={filters.team && filters.team !== "none" ? Number(filters.team) : data.me.teamIds.length === 1 ? data.me.teamIds[0] : null} defaultClientId={filters.client ? Number(filters.client) : null} onClose={() => setCreating(null)} onCreated={async (task) => { setCreating(null); await load(); setOpenTaskId(task.id); }} />}
    {openTask && data && <TaskDrawer key={openTask.id} task={openTask} lookups={lookups} me={data.me} today={today} onClose={() => setOpenTaskId(null)} onUpdate={(changes) => update(openTask.id, changes)} onDeleted={async () => { setOpenTaskId(null); await load(); }} onCommented={load} />}
    {importing && <ImportModal onClose={() => setImporting(false)} onImported={load} />}
    {managingClients && data && <ClientsModal clients={data.clients} tasks={data.tasks} onClose={() => setManagingClients(false)} onSaved={load} />}
  </div>;
}

function Board({ byStatus, lookups, teamsById, canEdit, today, onOpen, onMove, onCreate }: { byStatus: Record<TaskStatus, Task[]>; lookups: Lookups; teamsById: Map<number, TaskTeam>; canEdit: boolean; today: string; onOpen: (id: number) => void; onMove: (taskId: number, status: TaskStatus, beforeId: number | null) => void; onCreate: (status: TaskStatus) => void }) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [target, setTarget] = useState<{ status: TaskStatus; beforeId: number | null } | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  function finish() { setDragId(null); setTarget(null); }

  return <div className="task-board">
    {boardStatuses.map((status) => {
      const fullColumn = byStatus[status];
      // "Concluído" pode ter centenas de cartões: mostra os mais recentes primeiro.
      const column = status === "done" && !showAllDone ? [...fullColumn].sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? "")).slice(0, BOARD_DONE_LIMIT) : fullColumn;
      return <section key={status} className={`board-column ${target?.status === status ? "drop-target" : ""}`}
        onDragOver={(event) => {
          if (dragId === null) return;
          event.preventDefault();
          // Sobre um cartão, o próprio cartão define a posição; no espaço livre, vai para o fim.
          if (!(event.target as HTMLElement).closest(".board-card") && (target?.status !== status || target.beforeId !== null)) setTarget({ status, beforeId: null });
        }}
        onDrop={(event) => { event.preventDefault(); if (dragId !== null && target) onMove(dragId, target.status, target.beforeId); finish(); }}>
        <header><StatusIcon status={status} /><strong>{taskStatusLabels[status]}</strong><span>{fullColumn.length}</span>{canEdit && <button onClick={() => onCreate(status)} aria-label={`Nova demanda em ${taskStatusLabels[status]}`}><Plus size={14} /></button>}</header>
        <div className="board-cards">
          {column.map((task) => {
            const client = task.clientId ? lookups.clientsById.get(task.clientId) : null;
            return <div key={task.id}>
              {target?.status === status && target.beforeId === task.id && dragId !== task.id && <div className="drop-line" />}
              <button className={`board-card ${dragId === task.id ? "dragging" : ""}`} draggable={canEdit} onClick={() => onOpen(task.id)}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(task.id)); setDragId(task.id); }}
                onDragEnd={finish}
                onDragOver={(event) => { if (dragId === null) return; event.preventDefault(); event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); const after = event.clientY > box.top + box.height / 2; const index = column.findIndex((entry) => entry.id === task.id); setTarget({ status, beforeId: after ? column[index + 1]?.id ?? null : task.id }); }}>
                <span className="board-card-top"><span className="task-code">{taskCode(task.id)}</span><AvatarStack ids={task.owners} membersById={lookups.membersById} size={20} /></span>
                <span className="board-card-title"><StatusIcon status={task.status} /><span>{task.title}</span></span>
                {client && <span className="board-card-client">{client.name}{task.category && ` · ${task.category}`}</span>}
                <span className="board-card-meta"><PriorityIcon priority={task.priority} />{task.teamId && teamsById.get(task.teamId) && <TeamChip team={teamsById.get(task.teamId)!} />}{task.dueDate && <DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} />}{task.commentCount > 0 && <span className="task-comments"><MessageSquare size={12} />{task.commentCount}</span>}{task.hoursFlag && <span className="hours-flag" title="Horas importadas fora do normal: revise"><TriangleAlert size={12} /></span>}</span>
              </button>
            </div>;
          })}
          {target?.status === status && target.beforeId === null && <div className="drop-line" />}
          {status === "done" && fullColumn.length > BOARD_DONE_LIMIT && <button className="board-more" onClick={() => setShowAllDone((value) => !value)}>{showAllDone ? "Mostrar só as mais recentes" : `Ver todas as ${fullColumn.length} concluídas`}</button>}
          {fullColumn.length === 0 && <p className="board-empty">{canEdit ? "Arraste uma demanda para cá" : "Nenhuma demanda"}</p>}
        </div>
      </section>;
    })}
  </div>;
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

type Fields = Pick<Task, "status" | "priority" | "owners" | "support" | "teamId" | "clientId" | "projectId" | "category" | "startDate" | "dueDate" | "completedOn" | "estimatedHours" | "origin">;

/** Campos da demanda; usado na criação e no painel lateral. Horas e textos salvam ao sair do campo. */
function PropertyFields({ value, onChange, lookups, disabled, compact }: { value: Fields; onChange: (changes: Partial<Fields>) => void; lookups: Lookups; disabled?: boolean; compact?: boolean }) {
  const team = lookups.teams.find((entry) => entry.id === value.teamId);
  const [hours, setHours] = useState({ estimatedHours: value.estimatedHours?.toString().replace(".", ",") ?? "" });
  const [origin, setOrigin] = useState(value.origin);
  const categories = value.category && !lookups.categories.includes(value.category) ? [value.category, ...lookups.categories] : lookups.categories;
  const commitHours = (field: "estimatedHours") => {
    const text = hours[field].trim();
    const parsed = text ? Number(text.replace(",", ".")) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) { setHours({ ...hours, [field]: value[field]?.toString().replace(".", ",") ?? "" }); return; }
    if (parsed !== value[field]) onChange({ [field]: parsed });
  };
  const dateField = (field: "startDate" | "dueDate" | "completedOn", label: string) => <label className="task-prop"><span>{label}</span><span className="task-prop-control"><CalendarDays size={14} /><input disabled={disabled} type="date" value={value[field] ?? ""} onChange={(event) => onChange({ [field]: event.target.value || null })} />{value[field] && !disabled && <button type="button" className="task-prop-clear" onClick={() => onChange({ [field]: null })} aria-label={`Remover ${label.toLowerCase()}`}><X size={12} /></button>}</span></label>;

  return <div className={`task-fields ${compact ? "compact" : ""}`}>
    <label className="task-prop"><span>Status</span><span className="task-prop-control"><StatusIcon status={value.status} /><select disabled={disabled} value={value.status} onChange={(event) => onChange({ status: event.target.value as TaskStatus })}>{taskStatuses.map((status) => <option key={status} value={status}>{taskStatusLabels[status]}</option>)}</select></span></label>
    <label className="task-prop"><span>Prioridade</span><span className="task-prop-control"><PriorityIcon priority={value.priority} /><select disabled={disabled} value={value.priority} onChange={(event) => onChange({ priority: Number(event.target.value) as TaskPriority })}>{taskPriorities.map((priority) => <option key={priority} value={priority}>{taskPriorityLabels[priority]}</option>)}</select></span></label>
    <PeoplePicker label="Responsáveis" value={value.owners} onChange={(owners) => onChange({ owners, support: value.support.filter((id) => !owners.includes(id)) })} members={lookups.members} disabled={disabled} />
    <PeoplePicker label="Resp. Suporte" value={value.support} onChange={(support) => onChange({ support })} members={lookups.members} exclude={value.owners} disabled={disabled} />
    <label className="task-prop"><span>Cliente / Projeto</span><span className="task-prop-control"><Building2 size={14} /><select disabled={disabled} value={value.clientId ?? ""} onChange={(event) => onChange({ clientId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem cliente</option>{lookups.clients.filter((client) => client.active || client.id === value.clientId).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></span></label>
    <label className="task-prop"><span>Categoria</span><span className="task-prop-control"><select disabled={disabled} value={value.category} onChange={(event) => onChange({ category: event.target.value })}><option value="">Sem categoria</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></span></label>
    {lookups.teams.length > 0 && <label className="task-prop"><span>Time</span><span className="task-prop-control"><span className={`team-chip-dot ${team?.color ?? "none"}`} /><select disabled={disabled} value={value.teamId ?? ""} onChange={(event) => onChange({ teamId: event.target.value ? Number(event.target.value) : null })}><option value="">Sem time</option>{lookups.teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></span></label>}
    {lookups.projects.length > 0 && <label className="task-prop"><span>Projeto grande</span><span className="task-prop-control"><select disabled={disabled} value={value.projectId ?? ""} onChange={(event) => onChange({ projectId: event.target.value ? Number(event.target.value) : null })}><option value="">Nenhum</option>{lookups.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></span></label>}
    {dateField("startDate", "Data de Início")}
    {dateField("dueDate", "Prazo")}
    {!compact && dateField("completedOn", "Data de Conclusão")}
    <div className="task-hours">
      <label className="task-prop"><span>Horas estimadas</span><span className="task-prop-control"><input disabled={disabled} inputMode="decimal" value={hours.estimatedHours} onChange={(event) => setHours({ ...hours, estimatedHours: event.target.value })} onBlur={() => commitHours("estimatedHours")} placeholder="0" /><small>h</small></span></label>
    </div>
    <label className="task-prop"><span>Origem / Ticket</span><span className="task-prop-control"><input disabled={disabled} maxLength={300} value={origin} onChange={(event) => setOrigin(event.target.value)} onBlur={() => { if (origin !== value.origin) onChange({ origin }); }} placeholder="Ex.: WhatsApp, TICKET-663" /></span></label>
  </div>;
}

function NewTaskModal({ initialStatus, lookups, meId, defaultTeamId, defaultClientId, onClose, onCreated }: { initialStatus: TaskStatus; lookups: Lookups; meId: number; defaultTeamId: number | null; defaultClientId: number | null; onClose: () => void; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Fields>({ status: initialStatus, priority: 0, owners: lookups.members.some((member) => member.id === meId) ? [meId] : [], support: [], teamId: defaultTeamId, clientId: defaultClientId, projectId: null, category: "", startDate: null, dueDate: null, completedOn: null, estimatedHours: null, origin: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await postTask({ action: "createTask", title, description, ...fields });
      if (result.task) onCreated(result.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a demanda.");
      setSaving(false);
    }
  }

  return <div className="modal-layer" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <button className="backdrop" onClick={onClose} aria-label="Fechar janela" />
    <form className="modal task-modal" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit(event); }}>
      <div className="modal-head"><div><p className="eyebrow">DEMANDAS</p><h2>Nova demanda</h2><p>Ctrl + Enter cria a demanda.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
      <div className="task-modal-body">
        <input className="task-title-input" autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Demanda / atividade" />
        <textarea className="task-description-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição (opcional)" rows={3} />
        <PropertyFields value={fields} onChange={(changes) => setFields((current) => ({ ...current, ...changes }))} lookups={lookups} compact />
      </div>
      {error && <p className="modal-error">{error}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving || !title.trim()}>{saving ? "Criando..." : "Criar demanda"}</button></div>
    </form>
  </div>;
}

function TaskDrawer({ task, lookups, me, today, onClose, onUpdate, onDeleted, onCommented }: { task: Task; lookups: Lookups; me: Me; today: string; onClose: () => void; onUpdate: (changes: Record<string, unknown>) => Promise<void>; onDeleted: () => void; onCommented: () => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [notes, setNotes] = useState(task.notes);
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    const response = await fetch(`/api/tasks?taskId=${task.id}`, { cache: "no-store" });
    const data = await response.json() as { events?: TaskEvent[]; error?: string };
    if (response.ok && data.events) setEvents(data.events); else setError(data.error || "Não foi possível carregar a atividade.");
  }, [task.id]);

  // Recarrega a atividade quando a demanda muda (status, responsáveis...).
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
      setError(err instanceof Error ? err.message : "Não foi possível excluir a demanda.");
    }
  }

  const readOnly = !me.canEdit;
  const fields = <PropertyFields key={task.updatedAt} value={task} onChange={(changes) => void save(changes)} lookups={lookups} disabled={readOnly} />;

  return <div className="task-drawer-layer">
    <button className="backdrop" onClick={onClose} aria-label="Fechar demanda" />
    <aside className="task-drawer" role="dialog" aria-label={`${taskCode(task.id)} ${task.title}`}>
      <header className="task-drawer-head">
        <span className="task-code">{taskCode(task.id)}</span>
        <span className="task-drawer-created">{task.createdByName === "Planilha" ? `Importada das planilhas · aberta em ${fullDate(task.openedOn)}` : `Criada por ${task.createdByName} · ${relativeTime(task.createdAt)}`}</span>
        {me.isAdmin && <button className="task-drawer-icon danger" onClick={removeTask} aria-label="Excluir demanda" title="Excluir demanda"><Trash2 size={15} /></button>}
        <button className="task-drawer-icon" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)"><X size={16} /></button>
      </header>
      <div className="task-drawer-body">
        <div className="task-drawer-main">
          {task.codes.length > 0 && <p className="task-legacy">Código{task.codes.length > 1 ? "s" : ""} na planilha: {task.codes.map((code) => <b key={code}>{code}</b>)}</p>}
          <textarea className="task-title-input" rows={1} readOnly={readOnly} value={title} maxLength={160}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
            onBlur={() => { const next = title.trim(); if (!next) setTitle(task.title); else if (next !== task.title) void save({ title: next }); }} />
          <textarea className="task-description-input" readOnly={readOnly} value={description} rows={4} placeholder={readOnly ? "Sem descrição." : "Adicione uma descrição..."}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => { if (description !== task.description) void save({ description }); }} />
          <label className="task-notes"><span>OBS / Impedimentos</span><textarea readOnly={readOnly} value={notes} rows={3} placeholder={readOnly ? "Nenhuma observação." : "Bloqueios, dependências, combinados..."} onChange={(event) => setNotes(event.target.value)} onBlur={() => { if (notes !== task.notes) void save({ notes }); }} /></label>
          {task.hoursFlag && <p className="hours-warning"><TriangleAlert size={14} /> As horas vieram da planilha com um valor fora do normal para o período. Confira e corrija em “Horas anteriores”; o aviso some quando o valor for salvo.</p>}
          <div className="mobile-only task-mobile-fields">{fields}</div>

          {error && <p className="modal-error task-drawer-error">{error}</p>}

          <TimeLog task={task} me={me} lookups={lookups} today={today} onSaveBase={(baseHours) => save({ baseHours })} onChanged={onCommented} />

          <h3 className="task-activity-title">Atividade</h3>
          {!events ? <div className="loading-list"><span /></div> : <ol className="task-activity">
            {events.map((event) => event.kind === "comment" ? (
              <li key={event.id} className="task-comment">
                <Avatar member={event.actorId ? lookups.membersById.get(event.actorId) : null} size={24} />
                <div><p><strong>{event.actorName}</strong><span>{relativeTime(event.createdAt)}</span>{event.canDelete && <button onClick={() => removeComment(event.id)} aria-label="Excluir comentário" title="Excluir comentário"><Trash2 size={12} /></button>}</p><div className="task-comment-body">{splitMentions(event.body, lookups.members).map((part, index) => part.mention ? <mark key={index} className="mention">{part.text}</mark> : <span key={index}>{part.text}</span>)}</div></div>
              </li>
            ) : (
              <li key={event.id} className="task-change"><span className="task-change-dot" /><p><strong>{event.actorName}</strong> {describeTaskEvent(event.kind, event.body)} <span>· {relativeTime(event.createdAt)}</span></p></li>
            ))}
          </ol>}
          {me.canEdit && <form className="task-comment-form" onSubmit={sendComment}>
            <MentionTextarea value={comment} onChange={setComment} members={lookups.members} onSubmit={() => void sendComment()} />
            <button className="primary-button" disabled={sending || !comment.trim()}><Send size={14} /> {sending ? "Enviando..." : "Comentar"}</button>
          </form>}
        </div>
        <div className="task-drawer-side">
          {fields}
          {task.dueDate && <p className="task-side-note"><DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} /></p>}
          <p className="task-side-note">Aberta em {fullDate(task.openedOn)}{task.completedOn ? ` · concluída em ${fullDate(task.completedOn)}` : ""}</p>
        </div>
      </div>
    </aside>
  </div>;
}

type LoggedEntry = TimeEntry & { canDelete: boolean };

/** Apontamento de horas da demanda: total, horas anteriores e lançamentos por pessoa e dia. */
function TimeLog({ task, me, lookups, today, onSaveBase, onChanged }: { task: Task; me: Me; lookups: Lookups; today: string; onSaveBase: (value: number | null) => Promise<void>; onChanged: () => Promise<void> }) {
  const [entries, setEntries] = useState<LoggedEntry[] | null>(null);
  const [form, setForm] = useState({ workDate: today, hours: "", note: "", memberId: String(me.id) });
  const [base, setBase] = useState(task.baseHours?.toString().replace(".", ",") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/time-entries?taskId=${task.id}`, { cache: "no-store" });
    const data = await response.json() as { entries?: LoggedEntry[]; error?: string };
    if (response.ok && data.entries) setEntries(data.entries); else { setEntries([]); setError(data.error || "Não foi possível carregar as horas."); }
  }, [task.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string; message?: string };
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
    return data;
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const hours = parseEntryHours(form.hours);
    if (hours === null) { setError("Informe as horas: por exemplo 1,5 ou 1:30."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post({ action: "addEntry", taskId: task.id, workDate: form.workDate, hours: form.hours, note: form.note, memberId: Number(form.memberId) });
      setForm({ ...form, hours: "", note: "" });
      setNotice(result.message ?? "Horas lançadas.");
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível lançar as horas.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: LoggedEntry) {
    if (!window.confirm(`Excluir o lançamento de ${formatHours(entry.hours)} de ${entry.memberName} em ${fullDate(entry.workDate)}?`)) return;
    setError(""); setNotice("");
    try {
      await post({ action: "deleteEntry", entryId: entry.id });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir.");
    }
  }

  function commitBase() {
    const text = base.trim();
    const parsed = text ? Number(text.replace(",", ".")) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) { setBase(task.baseHours?.toString().replace(".", ",") ?? ""); return; }
    if (parsed !== task.baseHours) void onSaveBase(parsed);
  }

  const logged = (entries ?? []).reduce((sum, entry) => sum + entry.hours, 0);
  const total = task.workedHours ?? 0;
  const estimate = task.estimatedHours;
  const canLog = me.canEdit;
  const people = me.isAdmin ? lookups.members : lookups.members.filter((member) => member.id === me.id);

  return <section className="time-log">
    <header className="time-log-head">
      <h3>Horas</h3>
      <p><strong>{formatHours(total)}</strong> no total{estimate ? <> de <b>{formatHours(estimate)}</b> estimadas{total > estimate && <span className="time-log-over"> · {formatHours(total - estimate)} acima</span>}</> : null}</p>
    </header>
    {estimate ? <span className="time-log-bar" aria-hidden="true"><i className={total > estimate ? "over" : ""} style={{ width: `${Math.min(100, (total / estimate) * 100)}%` }} /></span> : null}
    <p className="time-log-split">
      {task.baseHours !== null || me.isAdmin ? <label>Horas anteriores <input disabled={!canLog} inputMode="decimal" value={base} onChange={(event) => setBase(event.target.value)} onBlur={commitBase} placeholder="0" /> h</label> : null}
      <span>{formatHours(logged)} lançadas{entries && entries.length ? ` em ${entries.length} registro${entries.length > 1 ? "s" : ""}` : ""}</span>
    </p>
    {canLog && people.length > 0 && <form className="time-log-form" onSubmit={add}>
      {me.isAdmin && <select aria-label="Pessoa" value={form.memberId} onChange={(event) => setForm({ ...form, memberId: event.target.value })}>{people.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}
      <input aria-label="Dia trabalhado" type="date" max={today} value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required />
      <input aria-label="Horas" className="time-log-hours" inputMode="decimal" placeholder="1:30" value={form.hours} onChange={(event) => setForm({ ...form, hours: event.target.value })} required />
      <input aria-label="O que foi feito" className="time-log-note" maxLength={300} placeholder="O que foi feito (opcional)" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
      <button className="primary-button" disabled={busy || !form.hours.trim()}><Clock size={14} /> {busy ? "Lançando..." : "Lançar"}</button>
    </form>}
    {error && <p className="modal-error">{error}</p>}
    {notice && !error && <p className="time-log-notice">{notice}</p>}
    {entries && entries.length > 0 && <ul className="time-log-list">
      {[...entries].reverse().map((entry) => <li key={entry.id}>
        <span className="time-log-date">{fullDate(entry.workDate)}</span>
        <span className="time-log-person">{entry.memberName}</span>
        <b>{formatHours(entry.hours)}</b>
        <span className="time-log-text">{entry.note}</span>
        {entry.canDelete && <button onClick={() => remove(entry)} aria-label="Excluir lançamento" title="Excluir lançamento"><Trash2 size={12} /></button>}
      </li>)}
    </ul>}
  </section>;
}

/** Lista de clientes/projetos usada nos menus (antes ficava na aba Configurações das planilhas). */
function ClientsModal({ clients, tasks, onClose, onSaved }: { clients: TaskClient[]; tasks: Task[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const usage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const task of tasks) if (task.clientId) counts.set(task.clientId, (counts.get(task.clientId) ?? 0) + 1);
    return counts;
  }, [tasks]);

  async function save(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await postTask({ action: "saveClient", ...payload });
      await onSaved();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-layer"><button className="backdrop" onClick={onClose} aria-label="Fechar janela" /><div className="modal clients-modal">
    <div className="modal-head"><div><p className="eyebrow">DEMANDAS</p><h2>Clientes e projetos</h2><p>É a lista que aparece em “Cliente / Projeto”. Desativar tira o nome dos menus sem mexer nas demandas antigas.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X /></button></div>
    <form className="clients-add" onSubmit={async (event) => { event.preventDefault(); if (name.trim() && await save({ name })) setName(""); }}>
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Novo cliente ou projeto" />
      <button className="primary-button" disabled={busy || !name.trim()}><Plus size={15} /> Adicionar</button>
    </form>
    {error && <p className="modal-error">{error}</p>}
    <ul className="clients-list">{clients.map((client) => <li key={client.id} className={client.active ? "" : "inactive"}>
      {editing?.id === client.id
        ? <form onSubmit={async (event) => { event.preventDefault(); if (await save({ clientId: client.id, name: editing.name, active: client.active })) setEditing(null); }}><input autoFocus value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /><button className="secondary-button" disabled={busy}>Salvar</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button></form>
        : <><strong>{client.name}</strong><small>{usage.get(client.id) ?? 0} demanda{usage.get(client.id) === 1 ? "" : "s"}</small><button type="button" className="person-edit" onClick={() => setEditing({ id: client.id, name: client.name })} aria-label={`Renomear ${client.name}`}>✎</button><button type="button" className={`access-toggle ${client.active ? "active" : "inactive"}`} disabled={busy} onClick={() => void save({ clientId: client.id, name: client.name, active: !client.active })}>{client.active ? "Ativo" : "Desativado"}</button></>}
    </li>)}</ul>
  </div></div>;
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

/** Resumo para a visão geral: as demandas abertas de quem está logado. */
export function MyTasksPanel({ onOpen }: { onOpen: (taskId?: number) => void }) {
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
    .filter((task) => involves(task, data.me.id) && !isClosedStatus(task.status))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || priorityRank(a.priority) - priorityRank(b.priority));
  const overdue = mine.filter((task) => task.dueDate && task.dueDate < today).length;

  return <article className="hub-tasks">
    <div className="hub-panel-title"><div><span><ListTodo /></span><div><h3>Minhas demandas</h3><p>{mine.length ? `${mine.length} em aberto${overdue ? ` · ${overdue} com prazo vencido` : ""}` : "Nada atribuído a você agora"}</p></div></div><button onClick={() => onOpen()}>Abrir demandas</button></div>
    {mine.length ? mine.slice(0, 4).map((task) => <button key={task.id} className="hub-task-row" onClick={() => onOpen(task.id)}>
      <PriorityIcon priority={task.priority} /><span className="task-code">{taskCode(task.id)}</span><StatusIcon status={task.status} /><span className="task-title">{task.title}</span>{task.dueDate && <DueChip dueDate={task.dueDate} closed={false} today={today} />}
    </button>) : <div className="hub-empty-row"><ListTodo /><span><strong>Tudo em dia</strong><small>As demandas em que você é responsável aparecem aqui.</small></span></div>}
  </article>;
}
