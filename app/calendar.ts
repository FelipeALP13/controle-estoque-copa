// Calendário único: monta o mês e distribui prazos, ausências, escala e projetos pelos dias.
// Regras puras (sem banco), usadas pela tela e pelos testes.

export type CalendarKind = "due" | "absence" | "schedule" | "project";
export type CalendarEvent = { kind: CalendarKind; id: string; refId: number; label: string; detail: string; tone?: string; late?: boolean };

const DAY = 86400000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const parse = (date: string) => Date.parse(`${date}T12:00:00Z`);
/** Data real no formato AAAA-MM-DD (30/02 e afins são recusados). */
export const isIsoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value)) && iso(parse(value)) === value;

/** Semanas do mês (segunda a domingo), completas com dias do mês anterior e do seguinte. */
export function monthGrid(month: string) {
  const first = parse(`${month}-01`);
  const weekday = (new Date(first).getUTCDay() + 6) % 7; // 0 = segunda
  const start = first - weekday * DAY;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells = Math.ceil((weekday + lastDay) / 7) * 7;
  const days = Array.from({ length: cells }, (_, index) => {
    const date = iso(start + index * DAY);
    return { date, inMonth: date.slice(0, 7) === month };
  });
  return { days, from: days[0].date, to: days[days.length - 1].date };
}

/** Dias de um período (inclusive), cortado ao intervalo visível. */
export function spanDays(start: string, end: string, from: string, to: string) {
  const first = Math.max(parse(start), parse(from));
  const last = Math.min(parse(end), parse(to));
  const days: string[] = [];
  for (let time = first; time <= last; time += DAY) days.push(iso(time));
  return days;
}

type DueTask = { id: number; title: string; code: string; dueDate: string | null; closed: boolean; owners: string };
type AbsenceEntry = { id: number; person: string; label: string; startDate: string; endDate: string };
type ScheduleWeek = { id: number; start: string; end: string; team: string; color: string; members: string };
type ProjectEntry = { id: number; name: string; code: string; startDate: string | null; endForecast: string | null };

export function buildCalendar(input: { from: string; to: string; today: string; tasks?: DueTask[]; absences?: AbsenceEntry[]; weeks?: ScheduleWeek[]; projects?: ProjectEntry[] }) {
  const byDay = new Map<string, CalendarEvent[]>();
  const add = (date: string, event: CalendarEvent) => {
    if (date < input.from || date > input.to) return;
    const list = byDay.get(date) ?? [];
    list.push(event);
    byDay.set(date, list);
  };
  for (const week of input.weeks ?? []) {
    for (const date of spanDays(week.start, week.end, input.from, input.to)) add(date, { kind: "schedule", id: `w${week.id}`, refId: week.id, label: `Escala: ${week.team}`, detail: week.members, tone: week.color });
  }
  for (const absence of input.absences ?? []) {
    for (const date of spanDays(absence.startDate, absence.endDate, input.from, input.to)) add(date, { kind: "absence", id: `a${absence.id}`, refId: absence.id, label: `${absence.person}: ${absence.label.toLowerCase()}`, detail: absence.label });
  }
  for (const project of input.projects ?? []) {
    if (isIsoDay(project.startDate)) add(project.startDate, { kind: "project", id: `ps${project.id}`, refId: project.id, label: `Início ${project.code} · ${project.name}`, detail: "Início do projeto" });
    if (isIsoDay(project.endForecast)) add(project.endForecast, { kind: "project", id: `pe${project.id}`, refId: project.id, label: `Previsão ${project.code} · ${project.name}`, detail: "Previsão de término" });
  }
  for (const task of input.tasks ?? []) {
    if (!isIsoDay(task.dueDate) || task.closed) continue;
    add(task.dueDate, { kind: "due", id: `t${task.id}`, refId: task.id, label: `${task.code} ${task.title}`, detail: task.owners || "Sem responsável", late: task.dueDate < input.today });
  }
  // Ordem dentro do dia: prazos vencidos, prazos, ausências, projetos, escala.
  const rank = (event: CalendarEvent) => (event.kind === "due" ? (event.late ? 0 : 1) : event.kind === "absence" ? 2 : event.kind === "project" ? 3 : 4);
  for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "pt-BR"));
  return byDay;
}
