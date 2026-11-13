// Regras puras (sem banco) de clientes, sistemas monitorados, sprints, retrospectivas e integração.
// Usadas pelas APIs, telas e testes; não importam outros arquivos do app.

// ---------- Sistemas dos clientes ----------

export const ENVIRONMENTS = [
  { value: "production", label: "Produção" },
  { value: "homolog", label: "Homologação" },
  { value: "demo", label: "Demonstração" },
  { value: "training", label: "Treinamento" },
  { value: "other", label: "Outro" },
] as const;
export type Environment = (typeof ENVIRONMENTS)[number]["value"];
export const isEnvironment = (value: unknown): value is Environment => ENVIRONMENTS.some((entry) => entry.value === value);
export const environmentLabel = (value: string) => ENVIRONMENTS.find((entry) => entry.value === value)?.label ?? "Outro";

/** Portas que o servidor do Portal (Cloudflare) consegue acessar; fora delas o monitor pode errar. */
const REACHABLE_PORTS = new Set([80, 8080, 8880, 2052, 2082, 2086, 2095, 443, 2053, 2083, 2087, 2096, 8443]);

/** Endereço http(s) válido e que não aponta para a própria máquina ou rede interna. Devolve o erro ou null. */
export function systemUrlError(value: string) {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return "Informe o endereço completo, começando com http:// ou https://."; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "O endereço precisa começar com http:// ou https://.";
  if (url.username || url.password) return "Não coloque usuário ou senha dentro do endereço; use os campos próprios.";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "0.0.0.0" || host === "[::1]") return "Endereços internos (localhost, rede local) não são acessíveis pelo Portal.";
  return null;
}

/** A porta do endereço pode não ser alcançável pelo monitor (ex.: :8066). */
export function portWarning(value: string) {
  try {
    const url = new URL(value);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return !REACHABLE_PORTS.has(port);
  } catch {
    return false;
  }
}

/** Quantas falhas seguidas para considerar fora do ar (evita alarme por uma oscilação). */
export const DOWN_AFTER_FAILURES = 2;
/** Intervalo mínimo entre verificações do mesmo sistema. */
export const CHECK_EVERY_MS = 5 * 60000;

export type MonitorState = { status: string; failCount: number };

/** Próximo estado depois de uma verificação; `changed` diz se caiu ou voltou agora. */
export function monitorTransition(previous: MonitorState, ok: boolean): MonitorState & { changed: "down" | "up" | null } {
  if (ok) return { status: "up", failCount: 0, changed: previous.status === "down" ? "up" : null };
  const failCount = previous.failCount + 1;
  if (failCount >= DOWN_AFTER_FAILURES) return { status: "down", failCount, changed: previous.status === "down" ? null : "down" };
  return { status: previous.status === "unknown" ? "unknown" : previous.status, failCount, changed: null };
}

/** Resposta HTTP que conta como "no ar": qualquer coisa abaixo de 500 (tela de login com 401/403 está no ar). */
export const isUpStatus = (status: number) => status > 0 && status < 500;

/** Percentual no ar a partir das quedas e voltas (do mais antigo ao mais novo) num período. */
export function uptimePercent(events: readonly { kind: "down" | "up"; at: string }[], from: number, to: number, statusAtStart: "up" | "down" = "up") {
  if (to <= from) return 100;
  let down = 0;
  let state = statusAtStart;
  let since = from;
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const at = Math.min(to, Math.max(from, Date.parse(event.at)));
    if (state === "down") down += at - since;
    state = event.kind;
    since = at;
  }
  if (state === "down") down += to - since;
  return Math.round((1 - down / (to - from)) * 10000) / 100;
}

// ---------- Ficha do cliente ----------

/** Uso do pacote de horas no mês: "warn" a partir de 80%, "over" acima de 100%. */
export function hoursUsage(logged: number, monthly: number | null) {
  if (!monthly || monthly <= 0) return { percent: null, state: "none" as const, left: null };
  const percent = Math.round((logged / monthly) * 100);
  return { percent, state: percent > 100 ? ("over" as const) : percent >= 80 ? ("warn" as const) : ("ok" as const), left: Math.round((monthly - logged) * 100) / 100 };
}

/** Mesmo nome de cliente, sem diferença de maiúsculas, acentos e espaços (os chamados guardam o nome em texto). */
export const sameClientName = (a: string, b: string) => {
  const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  return Boolean(a.trim()) && fold(a) === fold(b);
};

export type ReportTicket = { createdAt: string; resolvedAt: string | null; status: string; firstResponseMinutes: number | null; firstResponseOnTime: boolean | null };

/** Resumo do mês para o relatório do cliente. `month` = "AAAA-MM"; datas em ISO. */
export function clientMonthSummary(input: { month: string; tickets: readonly ReportTicket[]; tasksDone: number; hours: number; monthlyHours: number | null }) {
  const inMonth = (iso: string | null) => Boolean(iso) && toLocalDay(iso!).startsWith(input.month);
  const opened = input.tickets.filter((ticket) => inMonth(ticket.createdAt));
  const resolved = input.tickets.filter((ticket) => ticket.status === "resolved" && inMonth(ticket.resolvedAt));
  const answered = opened.filter((ticket) => ticket.firstResponseOnTime !== null);
  const onTime = answered.filter((ticket) => ticket.firstResponseOnTime).length;
  const times = opened.map((ticket) => ticket.firstResponseMinutes).filter((value): value is number => value !== null);
  return {
    opened: opened.length,
    resolved: resolved.length,
    slaPercent: answered.length ? Math.round((onTime / answered.length) * 100) : null,
    avgFirstResponseMinutes: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
    tasksDone: input.tasksDone,
    hours: Math.round(input.hours * 100) / 100,
    usage: hoursUsage(input.hours, input.monthlyHours),
  };
}

/** Dia em São Paulo (AAAA-MM-DD) de um instante ISO ou "AAAA-MM-DD HH:MM:SS" (UTC, formato do SQLite). */
export function toLocalDay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(ms)) return value.slice(0, 10);
  return new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
}

// ---------- Sprints ----------

const dayMs = 86400000;
const parseDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Dias úteis (segunda a sexta) entre as datas, inclusive. */
export function workingDays(start: string, end: string) {
  const days: string[] = [];
  for (let ms = parseDay(start); ms <= parseDay(end) && days.length < 400; ms += dayMs) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(formatDay(ms));
  }
  return days;
}

/** Capacidade do sprint em horas: dias úteis × horas por dia de cada pessoa, sem os dias de ausência. */
export function sprintCapacity(input: { memberIds: readonly number[]; absences: readonly { memberId: number; startDate: string; endDate: string }[]; start: string; end: string; hoursPerDay: number }) {
  const days = workingDays(input.start, input.end);
  let hours = 0;
  const perPerson = input.memberIds.map((memberId) => {
    const free = days.filter((day) => !input.absences.some((absence) => absence.memberId === memberId && absence.startDate <= day && absence.endDate >= day)).length;
    hours += free * input.hoursPerDay;
    return { memberId, days: free, hours: free * input.hoursPerDay };
  });
  return { workingDays: days.length, hours: Math.round(hours * 100) / 100, perPerson };
}

/**
 * Gráfico de queima: horas estimadas que ainda faltam a cada dia útil (demandas concluídas saem no dia da conclusão)
 * e a linha ideal. Dias futuros ficam com `remaining` null.
 */
export function burndown(tasks: readonly { estimatedHours: number | null; status: string; completedOn: string | null }[], start: string, end: string, today: string) {
  const days = workingDays(start, end);
  const counted = tasks.filter((task) => task.status !== "canceled");
  const total = counted.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  return days.map((day, index) => {
    const remaining = day > today ? null : counted.reduce((sum, task) => sum + (task.status === "done" && task.completedOn && task.completedOn <= day ? 0 : task.estimatedHours ?? 0), 0);
    const ideal = days.length > 1 ? total - (total * index) / (days.length - 1) : 0;
    return { day, ideal: Math.round(ideal * 10) / 10, remaining: remaining === null ? null : Math.round(remaining * 10) / 10 };
  });
}

export function sprintRangeError(start: unknown, end: unknown) {
  const valid = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && formatDay(parseDay(value)) === value;
  if (!valid(start) || !valid(end)) return "Informe o início e o fim do sprint.";
  if ((end as string) < (start as string)) return "O fim precisa ser depois do início.";
  if ((parseDay(end as string) - parseDay(start as string)) / dayMs > 62) return "Um sprint pode ter no máximo dois meses.";
  return null;
}

// ---------- Retrospectivas ----------

export const RETRO_COLUMNS = [
  { kind: "good", label: "O que foi bem", hint: "Vale repetir" },
  { kind: "improve", label: "O que melhorar", hint: "Atrapalhou ou pode ser melhor" },
  { kind: "action", label: "Ações", hint: "O que vamos fazer (pode virar demanda)" },
] as const;
export type RetroKind = (typeof RETRO_COLUMNS)[number]["kind"];
export const isRetroKind = (value: unknown): value is RetroKind => RETRO_COLUMNS.some((column) => column.kind === value);
export const MAX_RETRO_TEXT = 500;

/** Mais votados primeiro; empate pelo mais antigo. */
export function sortRetroItems<T extends { votes: number; id: number }>(items: readonly T[]) {
  return [...items].sort((a, b) => b.votes - a.votes || a.id - b.id);
}

// ---------- Integração de quem chega ----------

export const DEFAULT_ONBOARDING_STEPS = [
  "Criar o usuário no Portal e no e-mail da empresa",
  "Liberar acessos: GitHub/GitLab, Jira, VPN e servidores necessários",
  "Preparar o computador e o ambiente de desenvolvimento",
  "Apresentar a equipe, os times e quem lidera cada um",
  "Explicar o fluxo de demandas, chamados e a escala de atendimento",
  "Ler os artigos principais da base de conhecimento",
  "Conhecer os principais clientes e sistemas (ficha do cliente)",
  "Acompanhar o atendimento do Suporte por um dia",
  "Primeira demanda pequena com acompanhamento do padrinho",
  "Conversa de 30 dias: o que está indo bem e o que falta",
];

/** Um passo por linha, sem vazios nem repetidos, até 40. */
export function parseSteps(text: unknown) {
  const seen = new Set<string>();
  return String(text ?? "").split(/\r?\n/).map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim().slice(0, 200)).filter((line) => {
    const key = line.toLocaleLowerCase("pt-BR");
    if (!line || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}
