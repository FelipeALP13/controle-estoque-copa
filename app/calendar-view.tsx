"use client";

import { useEffect, useMemo, useState } from "react";
import CalendarDays from "lucide-react/icons/calendar-days";
import ChevronLeft from "lucide-react/icons/chevron-left";
import ChevronRight from "lucide-react/icons/chevron-right";
import { absenceKindLabels } from "./absences";
import { buildCalendar, monthGrid, type CalendarEvent, type CalendarKind } from "./calendar";
import { projectCode } from "./projects";
import { taskCode } from "./tasks";
import { monthLabel, shiftMonth } from "./time-entries";
import { useAbsences } from "./use-absences";

type Schedule = { teams: { id: number; name: string; color: string; members: string[] }[]; weeks: { id: number; start: string; end: string; teamId: number }[] };
type TaskRow = { id: number; title: string; status: string; dueDate: string | null; teamId: number | null; owners: number[]; support: number[] };
type TasksData = { tasks: TaskRow[]; members: { id: number; name: string }[]; me: { id: number; teamIds: number[] } };
type ProjectRow = { id: number; name: string; startDate: string | null; endForecast: string; status: string; phase: string };

const layers: { kind: CalendarKind; label: string }[] = [
  { kind: "due", label: "Prazos de demandas" },
  { kind: "absence", label: "Férias e ausências" },
  { kind: "schedule", label: "Escala do Suporte" },
  { kind: "project", label: "Projetos" },
];
const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Calendário único: prazos, ausências, escala e projetos numa visão de mês. */
export default function CalendarView({ schedule, onOpenTask, onOpenProject }: { schedule: Schedule; onOpenTask: (taskId: number) => void; onOpenProject: (projectId: number) => void }) {
  const today = todayInSaoPaulo();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [visible, setVisible] = useState<Record<CalendarKind, boolean>>({ due: true, absence: true, schedule: true, project: true });
  const [scope, setScope] = useState<"mine" | "team" | "all">("mine");
  const [tasksData, setTasksData] = useState<TasksData | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState("");
  const { absences, people } = useAbsences();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [taskResponse, projectResponse] = await Promise.all([fetch("/api/tasks", { cache: "no-store" }), fetch("/api/projects", { cache: "no-store" })]);
        const taskJson = await taskResponse.json() as TasksData & { error?: string };
        if (!taskResponse.ok) throw new Error(taskJson.error || "Não foi possível carregar as demandas.");
        const projectJson = projectResponse.ok ? await projectResponse.json() as { projects: ProjectRow[] } : { projects: [] };
        if (cancelled) return;
        setTasksData(taskJson);
        setProjects(projectJson.projects);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar o calendário.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const grid = useMemo(() => monthGrid(month), [month]);
  const calendar = useMemo(() => {
    const names = new Map([...(tasksData?.members ?? []), ...people].map((person) => [person.id, person.name]));
    const me = tasksData?.me;
    const tasks = (tasksData?.tasks ?? []).filter((task) => {
      if (scope === "mine") return Boolean(me) && (task.owners.includes(me!.id) || task.support.includes(me!.id));
      if (scope === "team") return Boolean(me) && task.teamId !== null && me!.teamIds.includes(task.teamId);
      return true;
    });
    return buildCalendar({
      from: grid.from, to: grid.to, today,
      tasks: visible.due ? tasks.map((task) => ({ id: task.id, title: task.title, code: taskCode(task.id), dueDate: task.dueDate, closed: task.status === "done" || task.status === "canceled", owners: task.owners.map((id) => names.get(id)).filter(Boolean).join(", ") })) : [],
      absences: visible.absence ? absences.map((absence) => ({ id: absence.id, person: names.get(absence.memberId) ?? "Alguém", label: absenceKindLabels[absence.kind], startDate: absence.startDate, endDate: absence.endDate })) : [],
      weeks: visible.schedule ? schedule.weeks.map((week) => { const team = schedule.teams.find((entry) => entry.id === week.teamId); return { id: week.id, start: week.start, end: week.end, team: team?.name ?? "Equipe", color: team?.color ?? "purple", members: team?.members.join(", ") ?? "" }; }) : [],
      projects: visible.project ? projects.filter((project) => project.status !== "done" && project.status !== "canceled" && project.phase !== "closing").map((project) => ({ id: project.id, name: project.name, code: projectCode(project.id), startDate: project.startDate, endForecast: project.endForecast })) : [],
    });
  }, [tasksData, projects, absences, people, schedule, grid, today, scope, visible]);

  function go(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
  }

  function open(event: CalendarEvent) {
    if (event.kind === "due") onOpenTask(event.refId);
    else if (event.kind === "project") onOpenProject(event.refId);
  }

  const selectedEvents = calendar.get(selected) ?? [];
  const monthDays = grid.days.filter((day) => day.inMonth && (calendar.get(day.date)?.length ?? 0) > 0);

  return <div className="calendar-page">
    <div className="calendar-toolbar">
      <div className="calendar-nav">
        <button className="secondary-button" onClick={() => go(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
        <h2>{monthLabel(month)}</h2>
        <button className="secondary-button" onClick={() => go(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
        {month !== today.slice(0, 7) && <button className="link-button" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Hoje</button>}
      </div>
      <div className="calendar-layers" role="group" aria-label="O que mostrar">
        {layers.map((layer) => <label key={layer.kind} className={`calendar-layer ${layer.kind}`}><input type="checkbox" checked={visible[layer.kind]} onChange={(event) => setVisible({ ...visible, [layer.kind]: event.target.checked })} /><i />{layer.label}</label>)}
        {visible.due && <select aria-label="Quais prazos" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="mine">Meus prazos</option><option value="team">Do meu time</option><option value="all">Todos os prazos</option></select>}
      </div>
    </div>
    {error && <div className="alert error"><span>{error}</span></div>}

    <div className="calendar-layout">
      <div className="calendar-grid" role="grid" aria-label={monthLabel(month)}>
        {weekdays.map((day) => <span key={day} className="calendar-weekday">{day}</span>)}
        {grid.days.map((day) => {
          const events = calendar.get(day.date) ?? [];
          return <button key={day.date} role="gridcell" className={`calendar-day ${day.inMonth ? "" : "outside"} ${day.date === today ? "today" : ""} ${day.date === selected ? "selected" : ""}`} onClick={() => setSelected(day.date)} aria-label={`${Number(day.date.slice(8))}: ${events.length} ${events.length === 1 ? "item" : "itens"}`}>
            <span className="calendar-number">{Number(day.date.slice(8))}</span>
            {events.slice(0, 3).map((event) => <span key={event.id} className={`calendar-chip ${event.kind} ${event.tone ?? ""} ${event.late ? "late" : ""}`}>{event.label}</span>)}
            {events.length > 3 && <span className="calendar-more">+{events.length - 3} mais</span>}
          </button>;
        })}
      </div>

      <aside className="calendar-side">
        <h3><CalendarDays size={15} /> {new Date(`${selected}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" })}</h3>
        {selectedEvents.length ? <ul>{selectedEvents.map((event) => <li key={event.id} className={`calendar-item ${event.kind} ${event.tone ?? ""} ${event.late ? "late" : ""}`}>
          {event.kind === "due" || event.kind === "project" ? <button onClick={() => open(event)}><strong>{event.label}</strong><small>{event.late ? `Vencida · ${event.detail}` : event.detail}</small></button>
            : <div><strong>{event.label}</strong><small>{event.detail}</small></div>}
        </li>)}</ul> : <p className="muted">Nada marcado neste dia.</p>}
      </aside>
    </div>

    {/* No celular a grade fica apertada: mostra a agenda do mês em lista. */}
    <div className="calendar-agenda">
      {monthDays.length ? monthDays.map((day) => <section key={day.date}>
        <h4 className={day.date === today ? "today" : ""}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" })}</h4>
        {(calendar.get(day.date) ?? []).map((event) => <button key={event.id} className={`calendar-item ${event.kind} ${event.tone ?? ""} ${event.late ? "late" : ""}`} onClick={() => open(event)} disabled={event.kind !== "due" && event.kind !== "project"}><strong>{event.label}</strong><small>{event.detail}</small></button>)}
      </section>) : <p className="muted">Nada marcado neste mês.</p>}
    </div>
  </div>;
}
