// Regras puras (sem banco) dos recursos da equipe: respostas prontas, quadro de chamados, cronômetro,
// dependências entre demandas, passagem de plantão e comemorações. Usadas pela API, telas e testes.

// ---------- Respostas prontas ----------

export const MAX_REPLY_TITLE = 60;
export const MAX_REPLY_BODY = 2000;

export type ReplyContext = { cliente: string; solicitante: string; codigo: string; titulo: string; eu: string };

/** Campos que podem ir no texto: {cliente}, {solicitante}, {codigo}, {titulo} e {eu}. */
export const REPLY_FIELDS: { key: keyof ReplyContext; label: string }[] = [
  { key: "cliente", label: "cliente do chamado" },
  { key: "solicitante", label: "quem abriu" },
  { key: "codigo", label: "código do chamado" },
  { key: "titulo", label: "título do chamado" },
  { key: "eu", label: "seu nome" },
];

/** Troca os campos pelo valor do chamado. Campo vazio some sem deixar espaço duplo. */
export function fillReply(body: string, context: ReplyContext) {
  const filled = body.replace(/\{\s*(cliente|solicitante|codigo|código|titulo|título|eu)\s*\}/gi, (_, raw: string) => {
    const key = raw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") as keyof ReplyContext;
    return context[key]?.trim() ?? "";
  });
  return filled.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").trim();
}

/** Respostas que valem para o chamado: as do time dele primeiro, depois as de todos. */
export function repliesFor<T extends { teamId: number | null; title: string }>(replies: readonly T[], teamId: number | null) {
  return replies
    .filter((reply) => reply.teamId === null || reply.teamId === teamId)
    .sort((a, b) => Number(a.teamId === null) - Number(b.teamId === null) || a.title.localeCompare(b.title, "pt-BR"));
}

// ---------- Quadro de chamados ----------

export const TICKET_BOARD_STATUSES = ["open", "in_progress", "waiting", "resolved"] as const;
export type TicketBoardStatus = (typeof TICKET_BOARD_STATUSES)[number];
/** Resolvidos aparecem no quadro por 7 dias; depois só na lista ("Encerrados"). */
export const BOARD_RESOLVED_DAYS = 7;

export function onTicketBoard(ticket: { status: string; resolvedAt: string | null }, now: number) {
  if (ticket.status === "canceled") return false;
  if (ticket.status !== "resolved") return true;
  if (!ticket.resolvedAt) return false;
  const resolved = Date.parse(ticket.resolvedAt.includes("T") ? ticket.resolvedAt : `${ticket.resolvedAt.replace(" ", "T")}Z`);
  return Number.isFinite(resolved) && now - resolved <= BOARD_RESOLVED_DAYS * 86400000;
}

// ---------- Cronômetro ----------

/** Cronômetro ligado há mais que isso provavelmente foi esquecido: pede para conferir antes de lançar. */
export const TIMER_SUSPICIOUS_HOURS = 10;

/** Minutos inteiros desde o início (mínimo 1). */
export function timerMinutes(startedAt: string, now: number) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 1;
  return Math.max(1, Math.round((now - started) / 60000));
}

/** "0:07:05" / "1:30:00" para o mostrador. */
export function timerClock(startedAt: string, now: number) {
  const started = Date.parse(startedAt);
  const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Sugestão para o campo de horas ao parar: "1:05" (aceito pelo lançamento de horas). */
export function timerSuggestion(startedAt: string, now: number) {
  const minutes = Math.min(24 * 60, timerMinutes(startedAt, now));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------- Dependências entre demandas ----------

export type Dependency = { taskId: number; blockedById: number };

/** Ligar "taskId espera blockedById" criaria um ciclo (A espera B que espera A)? */
export function wouldCreateCycle(edges: readonly Dependency[], taskId: number, blockedById: number) {
  if (taskId === blockedById) return true;
  // Existe caminho de blockedById até taskId seguindo "espera por"?
  const waitsFor = new Map<number, number[]>();
  for (const edge of edges) waitsFor.set(edge.taskId, [...(waitsFor.get(edge.taskId) ?? []), edge.blockedById]);
  const seen = new Set<number>();
  const stack = [blockedById];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(waitsFor.get(current) ?? []));
  }
  return false;
}

const finished = (status: string | undefined) => status === "done" || status === "canceled";

/** Quantas pendências ainda seguram cada demanda (só as que não terminaram). */
export function openBlockers(edges: readonly Dependency[], statusById: ReadonlyMap<number, string>) {
  const counts = new Map<number, number>();
  for (const edge of edges) {
    if (!statusById.has(edge.blockedById) || finished(statusById.get(edge.blockedById))) continue;
    counts.set(edge.taskId, (counts.get(edge.taskId) ?? 0) + 1);
  }
  return counts;
}

/** Demandas que ficam livres quando `finishedId` termina (todas as outras pendências já terminaram). */
export function releasedBy(edges: readonly Dependency[], finishedId: number, statusById: ReadonlyMap<number, string>) {
  const waiting = [...new Set(edges.filter((edge) => edge.blockedById === finishedId).map((edge) => edge.taskId))];
  return waiting.filter((taskId) => !finished(statusById.get(taskId)) && edges.every((edge) => edge.taskId !== taskId || edge.blockedById === finishedId || finished(statusById.get(edge.blockedById)) || !statusById.has(edge.blockedById)));
}

// ---------- Passagem de plantão ----------

export const MAX_HANDOFF = 4000;

type Week = { id: number; start: string; end: string; teamId: number };

/**
 * Para quem vai a passagem escrita hoje: da semana atual (ou a última que terminou) para a próxima.
 * Sem próxima semana cadastrada, não há quem receba.
 */
export function handoffWeeks<T extends Week>(weeks: readonly T[], today: string) {
  const sorted = [...weeks].sort((a, b) => a.start.localeCompare(b.start));
  const from = sorted.find((week) => week.start <= today && week.end >= today) ?? [...sorted].reverse().find((week) => week.end < today) ?? null;
  const to = sorted.find((week) => week.start > (from?.end ?? today) && week.start > today) ?? null;
  return { from, to };
}

// ---------- Aniversários e tempo de casa ----------

/** "MM-DD" válido (29/02 aceito). */
export function isBirthday(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(0, 2));
  const day = Number(value.slice(3));
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return Boolean(max) && day >= 1 && day <= max;
}

/** "AAAA-MM-DD" válido e não futuro. */
export function isStartDate(value: unknown, today: string): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= today && value >= "1950-01-01";
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Data (AAAA-MM-DD) do aniversário no ano dado; 29/02 vira 28/02 em ano não bissexto. */
function onYear(monthDay: string, year: number) {
  const value = monthDay === "02-29" && !isLeap(year) ? "02-28" : monthDay;
  return `${year}-${value}`;
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

export type Celebration = { memberId: number; name: string; kind: "birthday" | "anniversary"; date: string; daysAway: number; years: number };

/** Aniversários e tempo de casa (a partir de 1 ano) de hoje até `days` dias à frente, do mais próximo ao mais longe. */
export function upcomingCelebrations(people: readonly { id: number; name: string; birthday: string | null; startedOn: string | null }[], today: string, days = 14): Celebration[] {
  const year = Number(today.slice(0, 4));
  const out: Celebration[] = [];
  for (const person of people) {
    const candidates: { kind: Celebration["kind"]; monthDay: string; since: number | null }[] = [];
    if (person.birthday && isBirthday(person.birthday)) candidates.push({ kind: "birthday", monthDay: person.birthday, since: null });
    if (person.startedOn && /^\d{4}-\d{2}-\d{2}$/.test(person.startedOn)) candidates.push({ kind: "anniversary", monthDay: person.startedOn.slice(5), since: Number(person.startedOn.slice(0, 4)) });
    for (const candidate of candidates) {
      let date = onYear(candidate.monthDay, year);
      if (date < today) date = onYear(candidate.monthDay, year + 1);
      const daysAway = dayNumber(date) - dayNumber(today);
      if (daysAway > days) continue;
      const years = candidate.since === null ? 0 : Number(date.slice(0, 4)) - candidate.since;
      if (candidate.kind === "anniversary" && years < 1) continue;
      out.push({ memberId: person.id, name: person.name, kind: candidate.kind, date, daysAway, years });
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name, "pt-BR"));
}

export function celebrationText(entry: Pick<Celebration, "kind" | "name" | "years" | "daysAway">) {
  const first = entry.name.split(/\s+/)[0];
  const when = entry.daysAway === 0 ? "hoje" : entry.daysAway === 1 ? "amanhã" : `em ${entry.daysAway} dias`;
  if (entry.kind === "birthday") return entry.daysAway === 0 ? `Hoje é aniversário de ${entry.name}! 🎂` : `Aniversário de ${first} ${when}`;
  const years = `${entry.years} ${entry.years === 1 ? "ano" : "anos"} de casa`;
  return entry.daysAway === 0 ? `${entry.name} completa ${years} hoje! 🎉` : `${first} completa ${years} ${when}`;
}
