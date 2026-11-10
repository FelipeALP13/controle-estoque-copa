// Mesma paleta da escala (support-schedule.ts), para manter o visual consistente.
// Fica repetida aqui porque os testes rodam no Node sem resolver imports entre arquivos do app.
export const teamColors = ["purple", "orange", "blue", "green", "red"] as const;
export type TeamColor = (typeof teamColors)[number];

export const teamColorLabels: Record<TeamColor, string> = {
  purple: "Roxo",
  orange: "Laranja",
  blue: "Azul",
  green: "Verde",
  red: "Vermelho",
};

export function isTeamColor(value: unknown): value is TeamColor {
  return typeof value === "string" && (teamColors as readonly string[]).includes(value);
}

export type TeamMembership = { memberId: number; isLead: boolean };

export function cleanText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Mantém só dígitos e os símbolos comuns de telefone. */
export function cleanPhone(value: unknown) {
  return String(value ?? "").replace(/[^\d+()\-\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
}

/** Remove repetidos e pessoas que não existem; se alguém aparecer duas vezes, vale "líder" se qualquer uma marcar. */
export function normalizeMembership(input: unknown, validIds: ReadonlySet<number>): TeamMembership[] {
  if (!Array.isArray(input)) return [];
  const result = new Map<number, boolean>();
  for (const entry of input) {
    const memberId = Number((entry as { memberId?: unknown })?.memberId);
    if (!Number.isInteger(memberId) || !validIds.has(memberId)) continue;
    const isLead = (entry as { isLead?: unknown }).isLead === true;
    result.set(memberId, (result.get(memberId) ?? false) || isLead);
  }
  return [...result].map(([memberId, isLead]) => ({ memberId, isLead }));
}

/** IDs dos times de uma pessoa, para filtros como "Do meu time". */
export function teamIdsOf(memberId: number, memberships: readonly { teamId: number; memberId: number }[]) {
  return memberships.filter((row) => row.memberId === memberId).map((row) => row.teamId);
}
