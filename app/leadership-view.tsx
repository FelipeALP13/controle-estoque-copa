"use client";

import { useEffect, useMemo, useState } from "react";
import Download from "lucide-react/icons/download";
import TriangleAlert from "lucide-react/icons/triangle-alert";
import { downloadXlsx } from "./xlsx-writer";
import { isOpen, inPeriod, summarize, workload, type PanelTask } from "./leadership";
import { isClosedProject, projectFarolLabels, projectFarois, type ProjectFarol } from "./projects";
import { StatusIcon } from "./tasks-view";
import { taskCode, taskStatuses, taskStatusLabels, type TaskStatus } from "./tasks";

type Task = PanelTask & { title: string; clientId: number | null };
type Person = { id: number; name: string };
type Team = { id: number; name: string; color: string };
type Project = { id: number; status: TaskStatus; phase: string; farol: ProjectFarol };

const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

export default function LeadershipView({ onOpenTask, onOpenProjects }: { onOpenTask: (taskId: number) => void; onOpenProjects: () => void }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"all" | "30" | "90" | "year">("all");
  const [team, setTeam] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [taskResponse, projectResponse] = await Promise.all([fetch("/api/tasks", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" })]);
        const taskData = await taskResponse.json() as { tasks: Task[]; members: Person[]; teams: Team[]; error?: string };
        if (!taskResponse.ok) throw new Error(taskData.error || "Não foi possível carregar as demandas.");
        const projectData = projectResponse.ok ? await projectResponse.json() as { projects: Project[] } : { projects: [] };
        if (cancelled) return;
        setTasks(taskData.tasks);
        setPeople(taskData.members);
        setTeams(taskData.teams);
        setProjects(projectData.projects);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar o painel.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const today = todayInSaoPaulo();
  const filtered = useMemo(() => (tasks ?? []).filter((task) => inPeriod(task, period, today) && (!team || task.teamId === Number(team))), [tasks, period, team, today]);
  const summary = useMemo(() => summarize(filtered, today), [filtered, today]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);

  if (error) return <div className="alert error"><span>{error}</span></div>;
  if (!tasks) return <div className="loading-list">{[1, 2, 3].map((line) => <span key={line} />)}</div>;

  const activeProjects = projects.filter((project) => !isClosedProject(project));
  const origin = [
    { label: "Projetos Grandes", total: projects.length, open: activeProjects.length, action: onOpenProjects },
    ...teams.filter((entry) => !team || entry.id === Number(team)).map((entry) => {
      const list = filtered.filter((task) => task.teamId === entry.id);
      return { label: entry.name, total: list.length, open: list.filter((task) => isOpen(task.status)).length, action: undefined };
    }),
  ];
  const statusRows = taskStatuses.map((status) => ({ status, count: summary.byStatus.get(status) ?? 0 })).filter((row) => row.count > 0);
  const maxStatus = Math.max(...statusRows.map((row) => row.count), 1);
  const overdueList = filtered.filter((task) => isOpen(task.status) && task.dueDate && task.dueDate < today).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).slice(0, 8);
  const stuckAll = filtered.filter((task) => task.status === "blocked" || task.status === "waiting");
  const stuckList = stuckAll.slice(0, 8);
  const hoursToReview = filtered.filter((task) => task.hoursFlag);
  const visibleTeams = team ? teams.filter((entry) => entry.id === Number(team)) : teams;
  const teamName = (id: number | null) => (id ? teams.find((entry) => entry.id === id)?.name : "") ?? "";
  const ownerNames = (ids: number[]) => ids.map((id) => peopleById.get(id) ?? "Pessoa removida").join(", ");

  // Exporta o painel com o mesmo time e período escolhidos; as listas saem completas (a tela mostra só as 8 primeiras).
  function exportExcel() {
    const periodLabel = { all: "Tudo", "30": "Últimos 30 dias", "90": "Últimos 90 dias", year: "Este ano" }[period];
    const taskColumns = [{ header: "Código", width: 10 }, { header: "Título", width: 50 }, { header: "Status", width: 18 }, { header: "Prazo", type: "date" as const, width: 12 }, { header: "Responsáveis", width: 30 }, { header: "Time", width: 16 }];
    const taskRow = (task: Task) => [taskCode(task.id), task.title, taskStatusLabels[task.status], task.dueDate, ownerNames(task.owners), teamName(task.teamId)];
    downloadXlsx(`painel-lideranca-${today}.xlsx`, [
      {
        name: "Indicadores",
        columns: [{ header: "Indicador", width: 26 }, { header: "Valor", type: "number", width: 12 }, { header: "Detalhe", width: 40 }],
        rows: [
          ["Demandas", summary.total, `${summary.open} em aberto`],
          ["A fazer", summary.toDo, "A Fazer + Backlog"],
          ["Fazendo", summary.doing, "Fazendo + Em Validação"],
          ["Concluídas", summary.done, summary.completion === null ? "" : `${percent.format(summary.completion)} de conclusão`],
          ["Paradas", summary.stalled, "Pausadas, bloqueadas ou aguardando"],
          ["Prazo vencido", summary.overdue, "Em aberto e atrasadas"],
          ["Colaboradores", summary.people, "com demandas no período"],
          ["Horas a revisar", hoursToReview.length, "Horas importadas fora do normal"],
          [],
          ["Time (filtro)", null, team ? teamName(Number(team)) : "Todos os times"],
          ["Período de abertura (filtro)", null, periodLabel],
          ["Exportado em", null, new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
        ],
      },
      {
        name: "Por status",
        columns: [{ header: "Status", width: 22 }, { header: "Quantidade", type: "number", width: 12 }, { header: "Participação", type: "percent", width: 13 }],
        rows: statusRows.map((row) => [taskStatusLabels[row.status], row.count, row.count / Math.max(summary.total, 1)]),
      },
      {
        name: "Por origem",
        columns: [{ header: "Origem", width: 22 }, { header: "Total", type: "number", width: 10 }, { header: "Em aberto", type: "number", width: 11 }],
        rows: origin.map((row) => [row.label, row.total, row.open]),
      },
      {
        name: "Carga por pessoa",
        columns: [{ header: "Time", width: 16 }, { header: "Colaborador", width: 24 }, { header: "Em aberto", type: "number", width: 11 }, { header: "Atrasadas", type: "number", width: 11 }, { header: "Concluídas", type: "number", width: 11 }, { header: "Total", type: "number", width: 9 }, { header: "Horas trabalhadas", type: "number", width: 17 }],
        rows: visibleTeams.flatMap((entry) => workload(filtered.filter((task) => task.teamId === entry.id), today)
          .map((row) => [entry.name, peopleById.get(row.memberId) ?? "Pessoa removida", row.open, row.overdue, row.done, row.total, Math.round(row.hours * 100) / 100])),
      },
      {
        name: "Prazos vencidos",
        columns: taskColumns,
        rows: filtered.filter((task) => isOpen(task.status) && task.dueDate && task.dueDate < today).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")).map(taskRow),
      },
      { name: "Bloqueadas e aguardando", columns: taskColumns, rows: stuckAll.map(taskRow) },
    ]);
  }

  return <div className="leadership-page">
    <div className="report-filters">
      <div><h2>Painel de demandas</h2><p>Substitui o Dashboard da planilha da Liderança. Demanda compartilhada conta uma vez para cada responsável na carga por pessoa.</p></div>
      <div className="leadership-filters">
        <select aria-label="Time" value={team} onChange={(event) => setTeam(event.target.value)}><option value="">Todos os times</option>{teams.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        <div className="report-period" role="group" aria-label="Período de abertura">{([["all", "Tudo"], ["30", "30 dias"], ["90", "90 dias"], ["year", "Este ano"]] as const).map(([value, label]) => <button key={value} className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>
        <button className="secondary-button" onClick={exportExcel} title="Baixa o painel em Excel com o time e o período escolhidos"><Download size={15} /> Exportar Excel</button>
      </div>
    </div>

    <div className="leadership-tiles">
      <article><small>Demandas</small><strong>{summary.total}</strong><p>{summary.open} em aberto</p></article>
      <article><small>A fazer</small><strong>{summary.toDo}</strong><p>A Fazer + Backlog</p></article>
      <article><small>Fazendo</small><strong>{summary.doing}</strong><p>Fazendo + Em Validação</p></article>
      <article><small>Concluídas</small><strong>{summary.done}</strong><p>{summary.completion === null ? "—" : `${percent.format(summary.completion)} de conclusão`}</p></article>
      <article className={summary.stalled ? "warn" : ""}><small>Paradas</small><strong>{summary.stalled}</strong><p>Pausadas, bloqueadas ou aguardando</p></article>
      <article className={summary.overdue ? "late" : ""}><small>Prazo vencido</small><strong>{summary.overdue}</strong><p>Em aberto e atrasadas</p></article>
      <article><small>Colaboradores</small><strong>{summary.people}</strong><p>com demandas no período</p></article>
    </div>

    <div className="report-columns">
      <section className="report-card">
        <div className="report-card-head"><div><h3>Distribuição por status</h3><p>Quantidade e participação no total.</p></div></div>
        <div className="status-bars">{statusRows.map((row) => <div key={row.status} className="status-bar-row">
          <span className="status-bar-label"><StatusIcon status={row.status} />{taskStatusLabels[row.status]}</span>
          <span className="status-bar-track"><i style={{ width: `${(row.count / maxStatus) * 100}%` }} /></span>
          <span className="status-bar-value">{row.count}<small>{percent.format(row.count / Math.max(summary.total, 1))}</small></span>
        </div>)}</div>
      </section>
      <section className="report-card">
        <div className="report-card-head"><div><h3>Resumo por origem</h3><p>Total e em aberto.</p></div></div>
        <table className="report-table"><thead><tr><th>Origem</th><th>Total</th><th>Em aberto</th></tr></thead>
          <tbody>{origin.map((row) => <tr key={row.label}><td>{row.action ? <button className="link-button" onClick={row.action}>{row.label}</button> : row.label}</td><td>{row.total}</td><td>{row.open}</td></tr>)}</tbody></table>
        {activeProjects.length > 0 && <p className="farol-line">{projectFarois.map((value) => { const count = activeProjects.filter((project) => project.farol === value).length; return count ? <span key={value}><span className={`farol-dot ${value}`} />{count} {projectFarolLabels[value].toLowerCase()}</span> : null; })}</p>}
      </section>
    </div>

    <div className="report-columns equal">
      {visibleTeams.map((entry) => {
        const rows = workload(filtered.filter((task) => task.teamId === entry.id), today);
        const maxOpen = Math.max(...rows.map((row) => row.open), 1);
        return <section key={entry.id} className="report-card">
          <div className="report-card-head"><div><h3>Carga · {entry.name}</h3><p>Em aberto, concluídas e horas trabalhadas por pessoa.</p></div></div>
          {rows.length ? <div className="report-table-wrap"><table className="report-table workload-table">
            <thead><tr><th>Colaborador</th><th>Em aberto</th><th>Atrasadas</th><th>Concluídas</th><th>Total</th><th>Horas</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.memberId}>
              <td>{peopleById.get(row.memberId) ?? "Pessoa removida"}</td>
              <td><span className="inline-bar"><i style={{ width: `${(row.open / maxOpen) * 100}%` }} /><b>{row.open}</b></span></td>
              <td className={row.overdue ? "late" : ""}>{row.overdue}</td><td>{row.done}</td><td>{row.total}</td><td>{number.format(row.hours)}</td>
            </tr>)}</tbody>
          </table></div> : <p className="muted">Nenhuma demanda deste time no período.</p>}
        </section>;
      })}
    </div>

    <div className="report-columns equal">
      <section className="report-card">
        <div className="report-card-head"><div><h3>Prazos vencidos</h3><p>Em aberto, do prazo mais antigo para o mais recente.</p></div></div>
        {overdueList.length ? <ul className="attention-list">{overdueList.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task.id)}><span className="task-code">{taskCode(task.id)}</span><span>{task.title}</span><small>venceu {shortDate(task.dueDate!)} · {task.owners.map((id) => peopleById.get(id)).filter(Boolean).join(", ")}</small></button></li>)}</ul> : <p className="muted">Nenhum prazo vencido.</p>}
      </section>
      <section className="report-card">
        <div className="report-card-head"><div><h3>Bloqueadas e aguardando</h3><p>Demandas paradas por dependência.</p></div></div>
        {stuckList.length ? <ul className="attention-list">{stuckList.map((task) => <li key={task.id}><button onClick={() => onOpenTask(task.id)}><StatusIcon status={task.status} /><span>{task.title}</span><small>{taskStatusLabels[task.status]} · {task.owners.map((id) => peopleById.get(id)).filter(Boolean).join(", ")}</small></button></li>)}</ul> : <p className="muted">Nada bloqueado.</p>}
        {hoursToReview.length > 0 && <p className="hours-warning"><TriangleAlert size={14} /> {hoursToReview.length} demanda{hoursToReview.length > 1 ? "s" : ""} com horas importadas fora do normal para revisar (ícone ⚠ na lista de Demandas).</p>}
      </section>
    </div>
  </div>;
}
