// Agenda pessoal: regras puras (horários dos avisos, datas em Brasília e link do Teams).
// Sem imports de outros arquivos do app em tempo de execução (os testes rodam direto no Node).

/** Opções de primeiro aviso (minutos antes). 0 = só na hora; null = sem aviso. */
export const REMIND_OPTIONS: { value: number | null; label: string }[] = [
  { value: 15, label: "15 min antes e na hora" },
  { value: 5, label: "5 min antes e na hora" },
  { value: 10, label: "10 min antes e na hora" },
  { value: 30, label: "30 min antes e na hora" },
  { value: 60, label: "1 hora antes e na hora" },
  { value: 0, label: "Só na hora" },
  { value: null, label: "Sem aviso" },
];
export const DEFAULT_REMIND = 15;
/** Aviso "na hora" ainda dispara até 2 h depois (ex.: Portal estava fechado); depois disso não incomoda mais. */
export const START_GRACE_MS = 2 * 3600000;

const OFFSET = "-03:00"; // Brasília (sem horário de verão)

/** "2026-11-12" + "14:00" (horário de Brasília) → ISO em UTC. Inválido → null. */
export function localToIso(day: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const date = new Date(`${day}T${time}:00${OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejeita datas impossíveis (ex.: 31/02), que o Date "corrigiria".
  const check = isoToLocal(date.toISOString());
  return check.day === day && check.time === time ? date.toISOString() : null;
}

/** ISO (UTC) → dia e hora em Brasília. */
export function isoToLocal(iso: string) {
  const local = new Date(Date.parse(iso) - 3 * 3600000).toISOString();
  return { day: local.slice(0, 10), time: local.slice(11, 16) };
}

export type AgendaTiming = { startsAt: string; remindBefore: number | null; done?: boolean };
export type ReminderStage = "before" | "start";

/** Momentos de aviso de um compromisso (em milissegundos). */
export function reminderTimes(event: AgendaTiming) {
  if (event.remindBefore === null || event.done) return [];
  const start = Date.parse(event.startsAt);
  const times: { stage: ReminderStage; at: number }[] = [];
  if (event.remindBefore > 0) times.push({ stage: "before", at: start - event.remindBefore * 60000 });
  times.push({ stage: "start", at: start });
  return times;
}

/**
 * Avisos que já deveriam ter saído agora. "Antes" vale até o horário do compromisso;
 * "na hora" vale por até 2 h. Avisos já enviados são filtrados por quem chama.
 */
export function dueStages(event: AgendaTiming, now: number) {
  const start = Date.parse(event.startsAt);
  return reminderTimes(event).filter((reminder) => now >= reminder.at && (reminder.stage === "before" ? now < start : now < start + START_GRACE_MS)).map((reminder) => reminder.stage);
}

/** Texto do aviso: "Reunião X em 15 min" / "Agora: Reunião X". */
export function reminderText(title: string, stage: ReminderStage, minutesBefore: number | null) {
  if (stage === "start") return `Agora: ${title}`;
  const minutes = minutesBefore ?? 0;
  return `${title} em ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`}`;
}

/** E-mail de verdade (as pessoas importadas das planilhas têm e-mail provisório "@pendente.local"). */
export const isRealEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/@pendente\.local$/i.test(email);

/**
 * Link que abre o Teams com a reunião já preenchida (o usuário só confirma e envia o convite).
 * Formato oficial de "deep link" do Teams para nova reunião.
 */
export function teamsMeetingLink(input: { subject: string; startsAt: string; endsAt: string | null; attendees: readonly string[]; content?: string }) {
  const local = (iso: string) => { const { day, time } = isoToLocal(iso); return `${day}T${time}:00${OFFSET}`; };
  const end = input.endsAt ?? new Date(Date.parse(input.startsAt) + 30 * 60000).toISOString();
  const params = new URLSearchParams({ subject: input.subject, startTime: local(input.startsAt), endTime: local(end) });
  const emails = input.attendees.filter(isRealEmail);
  if (emails.length) params.set("attendees", emails.join(","));
  if (input.content?.trim()) params.set("content", input.content.trim().slice(0, 1000));
  return `https://teams.microsoft.com/l/meeting/new?${params.toString().replace(/\+/g, "%20")}`;
}

/** Só aceita links de reunião do Teams (o botão "Entrar" não pode levar a outro site). */
export function isTeamsJoinLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && (url.hostname === "teams.microsoft.com" || url.hostname === "teams.live.com");
  } catch {
    return false;
  }
}

const weekdays = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/** "Hoje", "Amanhã", "Ontem" ou "qua., 19/11" (dia em Brasília). */
export function dayLabel(day: string, today: string) {
  const diff = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  const date = new Date(`${day}T12:00:00Z`);
  return `${weekdays[date.getUTCDay()]}, ${day.slice(8, 10)}/${day.slice(5, 7)}${day.slice(0, 4) === today.slice(0, 4) ? "" : `/${day.slice(0, 4)}`}`;
}
