export const supportTeamColors = ["purple", "orange", "blue", "green", "red"] as const;
export type SupportTeamColor = (typeof supportTeamColors)[number];

export const supportTeamColorLabels: Record<SupportTeamColor, string> = {
  purple: "Roxo",
  orange: "Laranja",
  blue: "Azul",
  green: "Verde",
  red: "Vermelho",
};

export type SupportTeam = {
  id: number;
  name: string;
  color: SupportTeamColor;
  members: string[];
};

export type SupportWeek = {
  id: number;
  start: string;
  end: string;
  teamId: number;
  note: string;
};

export function isSupportTeamColor(value: unknown): value is SupportTeamColor {
  return typeof value === "string" && (supportTeamColors as readonly string[]).includes(value);
}

/** Lê a lista de integrantes salva em JSON, ignorando valores inválidos. */
export function parseTeamMembers(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try { list = JSON.parse(value); } catch { list = []; }
  }
  return Array.isArray(list) ? normalizeTeamMembers(list) : [];
}

/** Remove espaços, nomes vazios e repetidos, mantendo a ordem informada. */
export function normalizeTeamMembers(list: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of list) {
    const name = String(entry ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const key = name.toLocaleLowerCase("pt-BR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Valida o período de uma semana. Retorna a mensagem de erro ou null. */
export function weekRangeError(start: unknown, end: unknown) {
  if (!isIsoDate(start) || !isIsoDate(end)) return "Informe datas de início e fim válidas.";
  if (end < start) return "A data final precisa ser igual ou posterior à data inicial.";
  if (end > addDays(start, 30)) return "Um período da escala pode ter no máximo 31 dias.";
  return null;
}

export function weeksOverlap(a: Pick<SupportWeek, "start" | "end">, b: Pick<SupportWeek, "start" | "end">) {
  return a.start <= b.end && b.start <= a.end;
}

export function findOverlappingWeek<T extends Pick<SupportWeek, "start" | "end"> & { id: number }>(weeks: readonly T[], candidate: Pick<SupportWeek, "start" | "end">, ignoreId?: number) {
  return weeks.find((week) => week.id !== ignoreId && weeksOverlap(week, candidate)) ?? null;
}

/**
 * Monta semanas consecutivas alternando as equipes na ordem informada.
 * Cada período começa 7 dias depois do anterior e dura `daysPerWeek` dias.
 */
export function generateRotation(start: string, count: number, teamIds: readonly number[], daysPerWeek = 5) {
  if (!isIsoDate(start) || teamIds.length === 0 || count < 1) return [];
  const length = Math.min(7, Math.max(1, Math.round(daysPerWeek)));
  return Array.from({ length: Math.min(52, Math.round(count)) }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    return { start: weekStart, end: addDays(weekStart, length - 1), teamId: teamIds[index % teamIds.length] };
  });
}

export function supportWeekForDate<T extends Pick<SupportWeek, "start" | "end">>(weeks: readonly T[], isoDate: string) {
  return weeks.find((week) => isoDate >= week.start && isoDate <= week.end) ?? null;
}


export function nextSupportWeek<T extends Pick<SupportWeek, "start">>(weeks: readonly T[], isoDate: string) {
  return [...weeks].sort((a, b) => a.start.localeCompare(b.start)).find((week) => week.start > isoDate) ?? null;
}
