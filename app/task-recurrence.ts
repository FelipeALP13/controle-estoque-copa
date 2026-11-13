// Demandas que se repetem: regras puras das datas (sem banco), usadas pela tela, pela rotina e pelos testes.

export type Frequency = "weekly" | "monthly";
export const WEEKDAY_NAMES = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
export const DUE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Sem prazo" },
  { value: 0, label: "No mesmo dia" },
  { value: 1, label: "1 dia depois" },
  { value: 2, label: "2 dias depois" },
  { value: 3, label: "3 dias depois" },
  { value: 5, label: "5 dias depois" },
  { value: 7, label: "1 semana depois" },
  { value: 14, label: "2 semanas depois" },
];

const DAY = 86400000;
const parse = (day: string) => Date.parse(`${day}T12:00:00Z`);
export const addDays = (day: string, days: number) => new Date(parse(day) + days * DAY).toISOString().slice(0, 10);
/** 1 = segunda ... 7 = domingo. */
export const isoWeekday = (day: string) => ((new Date(parse(day)).getUTCDay() + 6) % 7) + 1;

export function validRecurrence(frequency: unknown, day: unknown): frequency is Frequency {
  const value = Number(day);
  if (frequency === "weekly") return Number.isInteger(value) && value >= 1 && value <= 7;
  if (frequency === "monthly") return Number.isInteger(value) && value >= 1 && value <= 28;
  return false;
}

/** Primeira data em que a repetição cai, a partir de `from` (inclusive). */
export function runOnOrAfter(frequency: Frequency, day: number, from: string) {
  if (frequency === "weekly") return addDays(from, (day - isoWeekday(from) + 7) % 7);
  const [year, month, dayOfMonth] = from.split("-").map(Number);
  const target = (y: number, m: number) => new Date(Date.UTC(y, m - 1, day, 12)).toISOString().slice(0, 10);
  return dayOfMonth <= day ? target(year, month) : target(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
}

/** Próxima data depois de `after` (exclusivo). */
export const runAfter = (frequency: Frequency, day: number, after: string) => runOnOrAfter(frequency, day, addDays(after, 1));

/**
 * O que a rotina faz hoje: cria a cópia se a data chegou (uma só, mesmo que o Portal tenha ficado
 * dias fechado) e marca a próxima data depois de hoje.
 */
export function plan(frequency: Frequency, day: number, nextOn: string, today: string) {
  if (nextOn > today) return { create: false, nextOn };
  return { create: true, nextOn: runAfter(frequency, day, today) };
}

export function dueFor(runDay: string, dueDays: number | null) {
  return dueDays === null ? null : addDays(runDay, dueDays);
}

export function describeRecurrence(frequency: Frequency, day: number) {
  return frequency === "weekly" ? `Toda ${WEEKDAY_NAMES[day]}${day >= 6 ? "" : "-feira"}`.replace("Toda sábado", "Todo sábado").replace("Toda domingo", "Todo domingo") : `Todo dia ${day} do mês`;
}
