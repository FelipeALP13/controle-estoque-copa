// Resumo semanal para os líderes, em texto pronto para o WhatsApp (negrito com *asteriscos*).

// Sem imports de outros arquivos do app em tempo de execução (os testes rodam direto no Node):
// o código da demanda e o texto da ausência chegam prontos em `format`.
import type { Absence } from "./absences";
import type { TaskStatus } from "./tasks";

const openStatuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused"];
const overlaps = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) => a.startDate <= b.endDate && b.startDate <= a.endDate;

export type SummaryTask = { id: number; title: string; status: TaskStatus; teamId: number | null; owners: number[]; dueDate: string | null; completedOn: string | null };

const LIST_LIMIT = 8;

function shift(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const short = (isoDate: string) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** Segunda a sexta da semana do dia informado. */
export function workWeek(today: string) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const monday = shift(today, weekday === 0 ? -6 : 1 - weekday);
  return { start: monday, end: shift(monday, 4) };
}

const clip = (text: string, size = 70) => (text.length > size ? `${text.slice(0, size - 1).trimEnd()}…` : text);

export function weeklySummary(input: {
  today: string;
  tasks: readonly SummaryTask[];
  teams: readonly { id: number; name: string }[];
  people: readonly { id: number; name: string }[];
  absences: readonly Absence[];
  teamLabel: string;
  link?: string;
  format: { code: (id: number) => string; absence: (absence: Absence) => string };
}) {
  const { today, tasks, teams, people, absences } = input;
  const names = new Map(people.map((person) => [person.id, person.name]));
  const owners = (ids: number[]) => ids.map((id) => names.get(id)).filter(Boolean).join(", ") || "sem responsável";
  const week = workWeek(today);
  const isOpen = (task: SummaryTask) => openStatuses.includes(task.status);
  const open = tasks.filter(isOpen);
  const overdue = open.filter((task) => task.dueDate && task.dueDate < today).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const stalled = open.filter((task) => task.status === "blocked" || task.status === "waiting" || task.status === "paused");
  const dueThisWeek = open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= week.end).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const doneLastWeek = tasks.filter((task) => task.status === "done" && task.completedOn && task.completedOn >= shift(today, -6) && task.completedOn <= today);

  const lines: string[] = [];
  lines.push(`*Resumo semanal · ${input.teamLabel}*`);
  lines.push(`Semana de ${short(week.start)} a ${short(week.end)}`);
  lines.push("");
  lines.push("*Visão geral*");
  lines.push(`• ${open.length} demanda${open.length === 1 ? "" : "s"} em aberto`);
  lines.push(`• ${overdue.length} com prazo vencido`);
  lines.push(`• ${stalled.length} parada${stalled.length === 1 ? "" : "s"} (bloqueadas, aguardando ou pausadas)`);
  lines.push(`• ${dueThisWeek.length} vence${dueThisWeek.length === 1 ? "" : "m"} até sexta`);
  lines.push(`• ${doneLastWeek.length} concluída${doneLastWeek.length === 1 ? "" : "s"} nos últimos 7 dias`);

  if (teams.length > 1) {
    lines.push("");
    lines.push("*Por time*");
    for (const team of teams) {
      const list = open.filter((task) => task.teamId === team.id);
      if (!list.length) continue;
      const late = list.filter((task) => task.dueDate && task.dueDate < today).length;
      const stuck = list.filter((task) => task.status === "blocked" || task.status === "waiting" || task.status === "paused").length;
      lines.push(`• ${team.name}: ${list.length} em aberto · ${late} vencida${late === 1 ? "" : "s"} · ${stuck} parada${stuck === 1 ? "" : "s"}`);
    }
  }

  const section = (title: string, list: readonly SummaryTask[], detail: (task: SummaryTask) => string) => {
    if (!list.length) return;
    lines.push("");
    lines.push(`*${title}*`);
    for (const task of list.slice(0, LIST_LIMIT)) lines.push(`• ${input.format.code(task.id)} ${clip(task.title)} (${detail(task)})`);
    if (list.length > LIST_LIMIT) lines.push(`…e mais ${list.length - LIST_LIMIT}`);
  };
  section("Prazos vencidos", overdue, (task) => `venceu ${short(task.dueDate!)} · ${owners(task.owners)}`);
  section("Bloqueadas e aguardando", stalled.filter((task) => task.status !== "paused"), (task) => `${task.status === "blocked" ? "bloqueada" : "aguardando"} · ${owners(task.owners)}`);
  section("Vencem esta semana", dueThisWeek, (task) => `${short(task.dueDate!)} · ${owners(task.owners)}`);

  const away = absences.filter((absence) => names.has(absence.memberId) && overlaps(absence, { startDate: week.start, endDate: week.end }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (away.length) {
    lines.push("");
    lines.push("*Fora esta semana*");
    for (const absence of away) lines.push(`• ${names.get(absence.memberId)}: ${input.format.absence(absence).toLowerCase()}`);
  }

  if (input.link) {
    lines.push("");
    lines.push(`Detalhes no Portal: ${input.link}`);
  }
  return lines.join("\n");
}
