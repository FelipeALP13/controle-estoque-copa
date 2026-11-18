// Linha do tempo dos projetos (estilo Gantt): regras puras das posições das barras.

const DAY = 86400000;
export const isDay = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
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

/** Dia somado de n dias (AAAA-MM-DD). */
export const shiftDay = (day: string, days: number) => new Date(time(day) + days * DAY).toISOString().slice(0, 10);

/** Posição (em %) de um dia na linha do tempo. */
export const dayLeft = (day: string, range: { from: string; to: string }) => ((time(day) - time(range.from)) / (time(range.to) - time(range.from))) * 100;

/** Quantos dias cabem em 1% da largura (para converter o arraste do mouse em dias). */
export const daysPerPercent = (range: { from: string; to: string }) => (time(range.to) - time(range.from)) / DAY / 100;

/**
 * Novas datas depois de arrastar a barra: "move" leva as duas juntas, "start"/"end" mexem só numa ponta.
 * O início nunca passa do fim (a barra tem pelo menos 1 dia).
 */
export function dragDates(kind: "move" | "start" | "end", startDate: string, endDate: string, deltaDays: number) {
  const delta = Math.round(deltaDays);
  if (kind === "move") return { startDate: shiftDay(startDate, delta), endDate: shiftDay(endDate, delta) };
  if (kind === "start") { const next = shiftDay(startDate, delta); return { startDate: next > endDate ? endDate : next, endDate }; }
  const next = shiftDay(endDate, delta);
  return { startDate, endDate: next < startDate ? startDate : next };
}

/** Início efetivo da barra (com o início presumido quando não foi informado). */
export const effectiveStart = (project: { startDate: string | null; endForecast: string | null }) =>
  isDay(project.startDate) ? project.startDate : isDay(project.endForecast) ? shiftDay(project.endForecast, -ASSUMED_DAYS) : null;

/** Ligar "projectId depende de dependsOnId" criaria um ciclo (A depende de B que depende de A)? */
export function wouldCreateCycle(edges: readonly { projectId: number; dependsOnId: number }[], projectId: number, dependsOnId: number) {
  if (projectId === dependsOnId) return true;
  // Procura um caminho de dependsOnId até projectId seguindo "depende de".
  const seen = new Set<number>();
  const stack = [dependsOnId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === projectId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of edges) if (edge.projectId === current) stack.push(edge.dependsOnId);
  }
  return false;
}

/** A dependência está em conflito: o projeto começa antes de o outro terminar. */
export function dependencyConflict(project: { startDate: string | null; endForecast: string | null }, dependsOn: { endForecast: string | null }) {
  const start = effectiveStart(project);
  return Boolean(start && isDay(dependsOn.endForecast) && start <= dependsOn.endForecast);
}

/** Posição (em %) de uma barra de um projeto. null = sem previsão em data (não entra na linha do tempo). */
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
