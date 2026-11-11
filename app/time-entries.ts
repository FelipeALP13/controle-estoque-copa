// Apontamento de horas: regras puras (sem banco), usadas pela API, pelas telas e pelos testes.

export const MAX_HOURS_PER_DAY = 24;
export const MAX_ENTRY_NOTE = 300;
/** Lançamentos podem ser feitos até 90 dias para trás. */
export const MAX_DAYS_BACK = 90;

export type TimeEntry = { id: number; taskId: number; memberId: number | null; memberName: string; workDate: string; hours: number; note: string };

/** "1,5", "1.5", "1:30" ou "1h30" → 1.5. Inválido ou fora de (0, 24] → null. */
export function parseEntryHours(value: unknown): number | null {
  const text = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return null;
  let hours: number;
  const clock = text.match(/^(\d{1,2})(?::|h)(\d{1,2})?(?:min|m)?$/);
  if (clock) {
    const minutes = Number(clock[2] ?? 0);
    if (minutes >= 60) return null;
    hours = Number(clock[1]) + minutes / 60;
  } else if (/^\d+(?:[.,]\d+)?h?$/.test(text)) {
    hours = Number(text.replace("h", "").replace(",", "."));
  } else {
    return null;
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS_PER_DAY) return null;
  return Math.round(hours * 100) / 100;
}

function dayNumber(isoDate: string) {
  return Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10))) / 86400000;
}

/** Data do lançamento: AAAA-MM-DD válida, não futura e no máximo 90 dias atrás. Retorna a mensagem de erro ou null. */
export function entryDateError(value: string, today: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "Informe a data do trabalho.";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) return "Informe uma data válida.";
  if (value > today) return "Não dá para lançar horas em um dia que ainda não chegou.";
  if (dayNumber(today) - dayNumber(value) > MAX_DAYS_BACK) return `Lançamentos podem ser feitos até ${MAX_DAYS_BACK} dias para trás.`;
  return null;
}

/** Total da demanda: horas anteriores + lançamentos. Sem nenhum dos dois → null. */
export function totalHours(baseHours: number | null, entryHours: readonly number[]) {
  if (baseHours === null && !entryHours.length) return null;
  return Math.round(((baseHours ?? 0) + entryHours.reduce((sum, value) => sum + value, 0)) * 100) / 100;
}

/** Formata horas para leitura: 1.5 → "1h30", 2 → "2h", 0.25 → "15min". */
export function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** "2026-11" → "novembro de 2026". */
export function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  const names = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${names[value - 1] ?? "?"} de ${year}`;
}

/** Primeiro e último dia do mês "AAAA-MM". */
export function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

type ReportTask = { id: number; clientId: number | null; status: string; openedOn: string | null; completedOn: string | null; workedHours: number | null; dueDate: string | null };

export type ClientRow = { clientId: number | null; opened: number; completed: number; open: number; overdue: number; hours: number; total: number };

/**
 * Relatório por cliente. Com mês: demandas abertas e concluídas no mês e horas lançadas no mês.
 * Sem mês ("tudo"): todas as demandas e o total de horas (anteriores + lançadas).
 * "Em aberto" e "atrasadas" são sempre a situação de hoje.
 */
export function clientReport(tasks: readonly ReportTask[], entries: readonly Pick<TimeEntry, "taskId" | "hours" | "workDate">[], month: string | null, today: string): ClientRow[] {
  const rows = new Map<number | null, ClientRow>();
  const row = (clientId: number | null) => {
    let current = rows.get(clientId);
    if (!current) { current = { clientId, opened: 0, completed: 0, open: 0, overdue: 0, hours: 0, total: 0 }; rows.set(clientId, current); }
    return current;
  };
  const range = month ? monthRange(month) : null;
  const inMonth = (date: string | null) => !range || (date !== null && date >= range.from && date <= range.to);
  const clientOf = new Map(tasks.map((task) => [task.id, task.clientId]));
  for (const task of tasks) {
    if (task.status === "canceled") continue;
    const openNow = task.status !== "done";
    const opened = inMonth(task.openedOn);
    const completed = task.status === "done" && inMonth(task.completedOn);
    if (!range || opened || completed || openNow) {
      const current = row(task.clientId);
      if (opened) current.opened += 1;
      if (completed) current.completed += 1;
      if (openNow) { current.open += 1; if (task.dueDate && task.dueDate < today) current.overdue += 1; }
      if (!range) { current.total += 1; current.hours += task.workedHours ?? 0; }
      else if (opened || completed || openNow) current.total += 1;
    }
  }
  if (range) {
    for (const entry of entries) {
      if (entry.workDate < range.from || entry.workDate > range.to || !clientOf.has(entry.taskId)) continue;
      row(clientOf.get(entry.taskId) ?? null).hours += entry.hours;
    }
  }
  return [...rows.values()]
    .map((current) => ({ ...current, hours: Math.round(current.hours * 100) / 100 }))
    .filter((current) => current.total || current.hours)
    .sort((a, b) => b.hours - a.hours || b.total - a.total);
}
