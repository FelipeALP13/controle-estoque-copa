// Avaliação do atendimento (1 a 5) feita por quem abriu o chamado: regras puras.

export const RATING_LABELS = ["", "Muito ruim", "Ruim", "Regular", "Bom", "Ótimo"];
export const MAX_RATING_COMMENT = 500;

export const isRating = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;

/** Quem abriu pode avaliar um chamado resolvido, aberto no Portal, ainda sem nota. */
export function canRate(ticket: { status: string; source: string; requesterId: number | null; rating: number | null }, memberId: number) {
  return ticket.status === "resolved" && ticket.source === "portal" && ticket.requesterId === memberId && ticket.rating === null;
}

/** Dia de Brasília (AAAA-MM-DD) de uma data do banco. */
const localDay = (value: string) => new Date(Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value) - 3 * 3600000).toISOString().slice(0, 10);

export type RatedTicket = { id: number; title: string; assigneeId: number | null; teamId?: number | null; rating: number | null; ratingComment: string; ratedAt: string | null; ratedBy?: string | null };

/** Quem deu a nota: o cliente (pelo link de avaliação) ou quem abriu o chamado na equipe. */
export type RaterFilter = "all" | "client" | "team";
export const isClientRating = (ticket: { ratedBy?: string | null }) => ticket.ratedBy === "client";

/** Resumo do período [from, to] (pelo dia da avaliação): média, % de satisfeitos (4 e 5), distribuição e comentários. */
export function satisfactionSummary(tickets: readonly RatedTicket[], from: string, to: string, rater: RaterFilter = "all") {
  const rated = tickets.filter((ticket) => ticket.rating !== null && ticket.ratedAt && localDay(ticket.ratedAt) >= from && localDay(ticket.ratedAt) <= to
    && (rater === "all" || (rater === "client") === isClientRating(ticket)));
  const distribution = [0, 0, 0, 0, 0, 0];
  for (const ticket of rated) distribution[ticket.rating!] += 1;
  const total = rated.length;
  const average = total ? rated.reduce((sum, ticket) => sum + ticket.rating!, 0) / total : null;
  const satisfied = total ? (distribution[4] + distribution[5]) / total : null;
  const byPerson = new Map<number | null, { count: number; sum: number }>();
  for (const ticket of rated) {
    const entry = byPerson.get(ticket.assigneeId) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += ticket.rating!;
    byPerson.set(ticket.assigneeId, entry);
  }
  const byTeam = new Map<number | null, { count: number; sum: number }>();
  for (const ticket of rated) {
    const entry = byTeam.get(ticket.teamId ?? null) ?? { count: 0, sum: 0 };
    entry.count += 1;
    entry.sum += ticket.rating!;
    byTeam.set(ticket.teamId ?? null, entry);
  }
  return {
    total,
    average,
    satisfied,
    distribution: distribution.slice(1),
    byPerson: [...byPerson.entries()].map(([assigneeId, entry]) => ({ assigneeId, count: entry.count, average: entry.sum / entry.count })).sort((a, b) => b.count - a.count),
    byTeam: [...byTeam.entries()].map(([teamId, entry]) => ({ teamId, count: entry.count, average: entry.sum / entry.count })).sort((a, b) => b.count - a.count),
    comments: rated.filter((ticket) => ticket.ratingComment.trim()).sort((a, b) => (b.ratedAt ?? "").localeCompare(a.ratedAt ?? "")).slice(0, 8)
      .map((ticket) => ({ id: ticket.id, title: ticket.title, rating: ticket.rating!, comment: ticket.ratingComment, ratedAt: ticket.ratedAt!, client: isClientRating(ticket) })),
  };
}

// ---------- Link de avaliação para o cliente ----------

/** Código aleatório do link (24 caracteres, sem como adivinhar). */
export function newSurveyToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isSurveyToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{24}$/.test(value);

/** O cliente pode avaliar pelo link: chamado resolvido e ainda sem nota. */
export function surveyState(ticket: { status: string; rating: number | null }) {
  if (ticket.rating !== null) return "done" as const;
  if (ticket.status !== "resolved") return "pending" as const;
  return "open" as const;
}

/** Endereço completo do link de avaliação. */
export const surveyUrl = (origin: string, token: string) => `${origin.replace(/\/$/, "")}/avaliar/${token}`;

export const stars = (rating: number) => "★".repeat(rating) + "☆".repeat(5 - rating);
