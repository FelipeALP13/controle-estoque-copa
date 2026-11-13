// Linha do tempo dos projetos (estilo Gantt): regras puras das posições das barras.

const DAY = 86400000;
const isDay = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
const time = (day: string) => Date.parse(`${day}T12:00:00Z`);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonths = (day: string, months: number) => { const date = new Date(time(monthStart(day))); date.setUTCMonth(date.getUTCMonth() + months); return date.toISOString().slice(0, 10); };

export type TimelineProject = { id: number; startDate: string | null; endForecast: string | null; closed: boolean };

/** Sem data de início, a barra começa 30 dias antes da previsão (tracejada na tela). */
export const ASSUMED_DAYS = 30;

/** Intervalo mostrado: do mês do primeiro início ao mês da última previsão (sempre incluindo hoje), até 24 meses. */
export function timelineRange(projects: readonly TimelineProject[], today: string) {
  const days = [today];
  for (const project of projects) {
    if (!isDay(project.endForecast)) continue;
    days.push(project.endForecast, isDay(project.startDate) ? project.startDate : new Date(time(project.endForecast) - ASSUMED_DAYS * DAY).toISOString().slice(0, 10));
  }
  days.sort();
  let from = monthStart(days[0]);
  const to = addMonths(days[days.length - 1], 1); // primeiro dia do mês seguinte
  // Muito longo: centraliza perto de hoje (6 meses antes, 18 depois).
  if ((time(to) - time(from)) / DAY > 731) from = addMonths(today, -6);
  const end = (time(to) - time(from)) / DAY > 731 ? addMonths(from, 24) : to;
  const months: { day: string; left: number }[] = [];
  for (let cursor = from; cursor < end; cursor = addMonths(cursor, 1)) months.push({ day: cursor, left: ((time(cursor) - time(from)) / (time(end) - time(from))) * 100 });
  return { from, to: end, months, todayLeft: ((time(today) - time(from)) / (time(end) - time(from))) * 100 };
}

/** Posição (em %) da barra de um projeto. null = sem previsão em data (não entra na linha do tempo). */
export function barFor(project: TimelineProject, range: { from: string; to: string }, today: string) {
  if (!isDay(project.endForecast)) return null;
  const assumed = !isDay(project.startDate);
  const start = assumed ? time(project.endForecast) - ASSUMED_DAYS * DAY : time(project.startDate!);
  const end = Math.max(time(project.endForecast), start) + DAY; // inclui o último dia
  const span = time(range.to) - time(range.from);
  const left = Math.max(0, ((start - time(range.from)) / span) * 100);
  const right = Math.min(100, ((end - time(range.from)) / span) * 100);
  if (right <= 0 || left >= 100) return { left: 0, width: 0, assumed, late: !project.closed && project.endForecast < today, outside: true };
  return { left, width: Math.max(right - left, 0.6), assumed, late: !project.closed && project.endForecast < today, outside: false };
}
