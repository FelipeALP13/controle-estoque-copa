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

export type RatedTicket = { id: number; title: string; assigneeId: number | null; rating: number | null; ratingComment: string; ratedAt: string | null };

/** Resumo do período [from, to] (pelo dia da avaliação): média, % de satisfeitos (4 e 5), distribuição e comentários. */
export function satisfactionSummary(tickets: readonly RatedTicket[], from: string, to: string) {
  const rated = tickets.filter((ticket) => ticket.rating !== null && ticket.ratedAt && localDay(ticket.ratedAt) >= from && localDay(ticket.ratedAt) <= to);
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
  return {
    total,
    average,
    satisfied,
    distribution: distribution.slice(1),
    byPerson: [...byPerson.entries()].map(([assigneeId, entry]) => ({ assigneeId, count: entry.count, average: entry.sum / entry.count })).sort((a, b) => b.count - a.count),
    comments: rated.filter((ticket) => ticket.ratingComment.trim()).sort((a, b) => (b.ratedAt ?? "").localeCompare(a.ratedAt ?? "")).slice(0, 8)
      .map((ticket) => ({ id: ticket.id, title: ticket.title, rating: ticket.rating!, comment: ticket.ratingComment, ratedAt: ticket.ratedAt! })),
  };
}

export const stars = (rating: number) => "★".repeat(rating) + "☆".repeat(5 - rating);
