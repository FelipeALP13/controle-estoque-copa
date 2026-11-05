export type SupportTeamId = "purple" | "orange";

export type SupportTeam = {
  id: SupportTeamId;
  name: string;
  members: readonly string[];
};

export type SupportWeek = {
  start: string;
  end: string;
  teamId: SupportTeamId;
};

export const supportTeams: readonly SupportTeam[] = [
  {
    id: "purple",
    name: "Equipe Roxa",
    members: ["Lucas Pevarello", "Lucas Boroto", "Gabriel Moraes"],
  },
  {
    id: "orange",
    name: "Equipe Laranja",
    members: ["Caio Viana", "Angelo Salvatti", "Luiz Miguel"],
  },
] as const;

// Escala migrada da planilha "Escala de Atendimento / 2026".
// As semanas mais curtas preservam os dias sem expediente marcados na origem.
export const supportWeeks: readonly SupportWeek[] = [
  { start: "2026-10-26", end: "2026-10-30", teamId: "purple" },
  { start: "2026-11-03", end: "2026-11-06", teamId: "orange" },
  { start: "2026-11-09", end: "2026-11-13", teamId: "purple" },
  { start: "2026-11-16", end: "2026-11-19", teamId: "orange" },
  { start: "2026-11-23", end: "2026-11-27", teamId: "purple" },
  { start: "2026-11-30", end: "2026-12-04", teamId: "orange" },
  { start: "2026-12-07", end: "2026-12-11", teamId: "purple" },
  { start: "2026-12-14", end: "2026-12-18", teamId: "orange" },
] as const;

export function supportTeam(teamId: SupportTeamId) {
  return supportTeams.find((team) => team.id === teamId)!;
}

export function supportWeekForDate(isoDate: string) {
  return supportWeeks.find((week) => isoDate >= week.start && isoDate <= week.end) ?? null;
}

export function nextSupportWeek(isoDate: string) {
  return supportWeeks.find((week) => week.start > isoDate) ?? null;
}
