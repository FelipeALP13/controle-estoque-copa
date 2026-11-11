// Cálculos do Painel da liderança (substitui a aba "Dashboard" da planilha). Puro e testável.
import type { TaskStatus } from "./tasks";

export type PanelTask = { id: number; status: TaskStatus; teamId: number | null; owners: number[]; openedOn: string | null; dueDate: string | null; workedHours: number | null; hoursFlag: boolean };

export const openStatuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused"];
export const isOpen = (status: TaskStatus) => openStatuses.includes(status);

export function summarize(tasks: readonly PanelTask[], today: string) {
  const counted = tasks.filter((task) => task.status !== "canceled");
  const byStatus = new Map<TaskStatus, number>();
  for (const task of tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
  const done = byStatus.get("done") ?? 0;
  const people = new Set(tasks.flatMap((task) => task.owners));
  return {
    total: tasks.length,
    open: tasks.filter((task) => isOpen(task.status)).length,
    toDo: (byStatus.get("todo") ?? 0) + (byStatus.get("backlog") ?? 0),
    doing: (byStatus.get("in_progress") ?? 0) + (byStatus.get("in_review") ?? 0),
    done,
    stalled: (byStatus.get("paused") ?? 0) + (byStatus.get("blocked") ?? 0) + (byStatus.get("waiting") ?? 0),
    overdue: tasks.filter((task) => isOpen(task.status) && task.dueDate !== null && task.dueDate < today).length,
    people: people.size,
    completion: counted.length ? done / counted.length : null,
    byStatus,
  };
}

export type Workload = { memberId: number; total: number; open: number; doing: number; done: number; overdue: number; hours: number };

/** Carga por pessoa: demanda compartilhada conta uma vez para cada responsável (como no Dashboard da planilha). */
export function workload(tasks: readonly PanelTask[], today: string) {
  const rows = new Map<number, Workload>();
  for (const task of tasks) {
    if (task.status === "canceled") continue;
    for (const memberId of new Set(task.owners)) {
      const row = rows.get(memberId) ?? { memberId, total: 0, open: 0, doing: 0, done: 0, overdue: 0, hours: 0 };
      row.total += 1;
      if (isOpen(task.status)) row.open += 1;
      if (task.status === "in_progress" || task.status === "in_review") row.doing += 1;
      if (task.status === "done") row.done += 1;
      if (isOpen(task.status) && task.dueDate !== null && task.dueDate < today) row.overdue += 1;
      // Horas da demanda divididas entre os responsáveis, para não contar em dobro no total do time.
      if (task.workedHours) row.hours += task.workedHours / new Set(task.owners).size;
      rows.set(memberId, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, hours: Math.round(row.hours * 10) / 10 })).sort((a, b) => b.open - a.open || b.total - a.total);
}

/** Filtro de período pela data de abertura (demandas sem data entram só em "todo o período"). */
export function inPeriod(task: Pick<PanelTask, "openedOn">, period: "all" | "30" | "90" | "year", today: string) {
  if (period === "all") return true;
  if (!task.openedOn) return false;
  if (period === "year") return task.openedOn.slice(0, 4) === today.slice(0, 4);
  const days = Number(period);
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  return task.openedOn >= start;
}
