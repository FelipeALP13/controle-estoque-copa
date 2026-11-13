"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Building2 from "lucide-react/icons/building-2";
import ChevronDown from "lucide-react/icons/chevron-down";
import Columns3 from "lucide-react/icons/columns-3";
import FileSpreadsheet from "lucide-react/icons/file-spreadsheet";
import LayoutList from "lucide-react/icons/layout-list";
import ListTodo from "lucide-react/icons/list-todo";
import MessageSquare from "lucide-react/icons/message-square";
import Plus from "lucide-react/icons/plus";
import Search from "lucide-react/icons/search";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import X from "lucide-react/icons/x";
import Lock from "lucide-react/icons/lock";
import { dueState, isClosedStatus, sortOrderBetween, taskCode, taskPriorities, taskPriorityLabels, taskStatuses, taskStatusLabels, type TaskPriority, type TaskStatus } from "./tasks";
import ImportModal from "./import-modal";
import Download from "lucide-react/icons/download";
import { downloadXlsx, type CellValue } from "./xlsx-writer";
import ListChecks from "lucide-react/icons/list-checks";
import { type Task, type TaskTeam, type TasksData, type Lookups, boardStatuses, BOARD_DONE_LIMIT, todayInSaoPaulo, fold, postTask, StatusIcon, PriorityIcon, TeamChip, AvatarStack, DueChip } from "./task-shared";
import { NewTaskModal, TaskDrawer, TemplatesModal, ClientsModal } from "./task-drawer";

type Filters = { scope: "all" | "mine" | "team"; person: string; priority: string; team: string; client: string; category: string; search: string };

function readView(): "list" | "board" {
  try { return window.localStorage.getItem("tasks-view") === "board" ? "board" : "list"; } catch { return "list"; }
}

/** Demanda esperando outras terminarem. */
function WaitingChip({ count }: { count: number }) {
  return <span className="task-waiting" title={`Aguardando ${count === 1 ? "1 demanda" : `${count} demandas`} terminar`}><Lock size={11} />{count}</span>;
}

const involves = (task: Task, memberId: number) => task.owners.includes(memberId) || task.support.includes(memberId);

export default function TasksView({ openRequest = null, onOpenRequestHandled, createRequest = 0 }: { openRequest?: number | null; onOpenRequestHandled?: () => void; createRequest?: number }) {
  const [data, setData] = useState<TasksData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "board">("list");
  const [filters, setFilters] = useState<Filters>({ scope: "all", person: "", priority: "", team: "", client: "", category: "", search: "" });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, canceled: true });
  const [creating, setCreating] = useState<TaskStatus | null>(null);
  const [importing, setImporting] = useState(false);
  const [managingClients, setManagingClients] = useState(false);
  const [managingTemplates, setManagingTemplates] = useState(false);
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

  // Atalho "Nova demanda" da visão geral: abre o formulário assim que a lista carregar.
  const handledCreate = useRef(0);
  useEffect(() => {
    if (!createRequest || !data?.me.canEdit || handledCreate.current === createRequest) return;
    handledCreate.current = createRequest;
    const timer = window.setTimeout(() => setCreating("todo"), 0);
    return () => window.clearTimeout(timer);
  }, [createRequest, data]);

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
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]");
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
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
    sprints: data?.sprints ?? [],
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
      {data?.me.isAdmin && <button className="secondary-button" onClick={() => setManagingTemplates(true)} title="Modelos de demanda com checklist"><ListChecks size={15} /> Modelos</button>}
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
                  {Boolean(task.waitingOn) && !isClosedStatus(task.status) && <WaitingChip count={task.waitingOn!} />}
                  {task.teamId && teamsById.get(task.teamId) && <span className="task-team"><TeamChip team={teamsById.get(task.teamId)!} /></span>}
                  {task.checklist && task.checklist.total > 0 && <span className={`task-checklist ${task.checklist.done === task.checklist.total ? "complete" : ""}`} title={`Checklist: ${task.checklist.done} de ${task.checklist.total} passos`}><ListChecks size={12} />{task.checklist.done}/{task.checklist.total}</span>}
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
    {openTask && data && <TaskDrawer key={openTask.id} task={openTask} allTasks={data.tasks} onOpenTask={setOpenTaskId} lookups={lookups} me={data.me} today={today} onClose={() => setOpenTaskId(null)} onUpdate={(changes) => update(openTask.id, changes)} onDeleted={async () => { setOpenTaskId(null); await load(); }} onCommented={load} />}
    {importing && <ImportModal onClose={() => setImporting(false)} onImported={load} />}
    {managingTemplates && <TemplatesModal lookups={lookups} onClose={() => setManagingTemplates(false)} />}
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
                <span className="board-card-meta"><PriorityIcon priority={task.priority} />{task.teamId && teamsById.get(task.teamId) && <TeamChip team={teamsById.get(task.teamId)!} />}{task.dueDate && <DueChip dueDate={task.dueDate} closed={isClosedStatus(task.status)} today={today} />}{task.commentCount > 0 && <span className="task-comments"><MessageSquare size={12} />{task.commentCount}</span>}{task.hoursFlag && <span className="hours-flag" title="Horas importadas fora do normal: revise"><TriangleAlert size={12} /></span>}{Boolean(task.waitingOn) && !isClosedStatus(task.status) && <WaitingChip count={task.waitingOn!} />}</span>
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

// Mantido para quem já importa daqui.
export { type Task, relativeTime, StatusIcon, PriorityIcon, TeamChip, Avatar, AvatarStack, PeoplePicker, MentionTextarea } from "./task-shared";
