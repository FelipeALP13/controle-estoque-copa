// Relatório do mês para a Liderança: regras puras (sem banco), usadas pela tela e pelos testes.

export type MonthTask = { id: number; title: string; status: string; clientId: number | null; openedOn: string | null; completedOn: string | null; dueDate: string | null; owners: number[] };
export type MonthTicket = { id: number; title: string; status: string; client: string; createdAt: string; resolvedAt: string | null };
export type MonthProject = { id: number; name: string; status: string; phase: string; endForecast: string | null };

const CLOSED = new Set(["done", "canceled"]);
const localDay = (value: string) => new Date(Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value) - 3 * 3600000).toISOString().slice(0, 10);

export function monthBounds(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Números do mês: demandas (abertas, entregues, no prazo, atrasadas), chamados por cliente e projetos. */
export function monthlyNumbers(input: { month: string; today: string; tasks: readonly MonthTask[]; tickets: readonly MonthTicket[]; projects: readonly MonthProject[]; clientName: (id: number | null) => string }) {
  const { from, to } = monthBounds(input.month);
  const inMonth = (day: string | null) => Boolean(day && day >= from && day <= to);
  // "Hoje" para os atrasos: o fim do mês, ou hoje se o mês ainda não acabou.
  const cut = input.today < to ? input.today : to;

  const opened = input.tasks.filter((task) => inMonth(task.openedOn));
  const delivered = input.tasks.filter((task) => task.status === "done" && inMonth(task.completedOn));
  const deliveredOnTime = delivered.filter((task) => !task.dueDate || (task.completedOn ?? "") <= task.dueDate);
  const overdue = input.tasks.filter((task) => !CLOSED.has(task.status) && task.dueDate && task.dueDate < cut && (task.openedOn ?? "") <= to)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  const ticketsOpened = input.tickets.filter((ticket) => ticket.status !== "canceled" && inMonth(localDay(ticket.createdAt)));
  const ticketsResolved = input.tickets.filter((ticket) => ticket.resolvedAt && inMonth(localDay(ticket.resolvedAt)));

  const byClient = new Map<string, { client: string; tasksOpened: number; tasksDelivered: number; ticketsOpened: number; ticketsResolved: number }>();
  const row = (client: string) => {
    const key = client.trim() || "Sem cliente";
    if (!byClient.has(key)) byClient.set(key, { client: key, tasksOpened: 0, tasksDelivered: 0, ticketsOpened: 0, ticketsResolved: 0 });
    return byClient.get(key)!;
  };
  for (const task of opened) row(input.clientName(task.clientId)).tasksOpened += 1;
  for (const task of delivered) row(input.clientName(task.clientId)).tasksDelivered += 1;
  for (const ticket of ticketsOpened) row(ticket.client).ticketsOpened += 1;
  for (const ticket of ticketsResolved) row(ticket.client).ticketsResolved += 1;

  const activeProjects = input.projects.filter((project) => project.status !== "done" && project.status !== "canceled");
  const lateProjects = activeProjects.filter((project) => project.endForecast && project.endForecast < cut);

  return {
    from, to,
    tasksOpened: opened.length,
    tasksDelivered: delivered.length,
    onTimeRate: delivered.length ? deliveredOnTime.length / delivered.length : null,
    overdue,
    delivered,
    ticketsOpened: ticketsOpened.length,
    ticketsResolved: ticketsResolved.length,
    byClient: [...byClient.values()].sort((a, b) => (b.tasksOpened + b.ticketsOpened) - (a.tasksOpened + a.ticketsOpened) || a.client.localeCompare(b.client, "pt-BR")),
    activeProjects: activeProjects.length,
    lateProjects,
  };
}
