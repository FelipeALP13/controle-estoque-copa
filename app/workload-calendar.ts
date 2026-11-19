// Carga do time por dia (regras puras, testáveis): para cada pessoa, os próximos dias úteis com as demandas
// em aberto que vencem em cada dia, quem está fora (férias, folga) e o que já está atrasado.

export type WorkloadTask = { id: number; title: string; status: string; dueDate: string | null; owners: number[] };
export type WorkloadAbsence = { memberId: number; startDate: string; endDate: string };
export type WorkloadCell = { day: string; tasks: { id: number; title: string }[]; away: boolean };
export type WorkloadRow = { memberId: number; open: number; overdue: { id: number; title: string }[]; cells: WorkloadCell[] };

const DAY_MS = 86400000;
const CLOSED = new Set(["done", "canceled"]);

/** Próximos `count` dias úteis (seg. a sex.) a partir de hoje, inclusive. */
export function nextBusinessDays(today: string, count: number) {
  const days: string[] = [];
  for (let ms = Date.parse(`${today}T12:00:00Z`); days.length < count; ms += DAY_MS) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

/** Linhas da grade, da pessoa mais carregada para a menos (atrasadas pesam mais). */
export function workloadCalendar(tasks: readonly WorkloadTask[], absences: readonly WorkloadAbsence[], today: string, count = 10): { days: string[]; rows: WorkloadRow[] } {
  const days = nextBusinessDays(today, count);
  const open = tasks.filter((task) => !CLOSED.has(task.status));
  const people = [...new Set(open.flatMap((task) => task.owners))];
  const rows = people.map((memberId) => {
    const mine = open.filter((task) => task.owners.includes(memberId));
    const overdue = mine.filter((task) => task.dueDate && task.dueDate < today).map((task) => ({ id: task.id, title: task.title }));
    const cells = days.map((day) => ({
      day,
      tasks: mine.filter((task) => task.dueDate === day).map((task) => ({ id: task.id, title: task.title })),
      away: absences.some((absence) => absence.memberId === memberId && absence.startDate <= day && absence.endDate >= day),
    }));
    return { memberId, open: mine.length, overdue, cells };
  });
  const weight = (row: WorkloadRow) => row.overdue.length * 3 + row.cells.reduce((sum, cell) => sum + cell.tasks.length, 0) * 2 + row.open;
  rows.sort((a, b) => weight(b) - weight(a) || a.memberId - b.memberId);
  return { days, rows };
}

/** Intensidade da célula: 0 (livre) a 3 (3 ou mais entregas no dia). */
export const cellLevel = (cell: WorkloadCell) => Math.min(3, cell.tasks.length);
