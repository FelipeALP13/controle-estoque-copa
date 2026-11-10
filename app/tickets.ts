export const ticketTypes = ["bug", "question", "improvement", "access", "other"] as const;
export type TicketType = (typeof ticketTypes)[number];
export const ticketTypeLabels: Record<TicketType, string> = { bug: "Bug", question: "Dúvida", improvement: "Melhoria", access: "Acesso", other: "Outro" };

export const ticketUrgencies = ["critical", "high", "normal", "low"] as const;
export type TicketUrgency = (typeof ticketUrgencies)[number];
export const ticketUrgencyLabels: Record<TicketUrgency, string> = { critical: "Crítica", high: "Alta", normal: "Normal", low: "Baixa" };

export const ticketStatuses = ["open", "in_progress", "waiting", "resolved", "canceled"] as const;
export type TicketStatus = (typeof ticketStatuses)[number];
export const ticketStatusLabels: Record<TicketStatus, string> = { open: "Aberto", in_progress: "Em atendimento", waiting: "Aguardando", resolved: "Resolvido", canceled: "Cancelado" };

/** Prazo de primeira resposta, em horas, por urgência. */
export const firstResponseHours: Record<TicketUrgency, number> = { critical: 2, high: 8, normal: 24, low: 72 };

export const isTicketType = (value: unknown): value is TicketType => typeof value === "string" && (ticketTypes as readonly string[]).includes(value);
export const isTicketUrgency = (value: unknown): value is TicketUrgency => typeof value === "string" && (ticketUrgencies as readonly string[]).includes(value);
export const isTicketStatus = (value: unknown): value is TicketStatus => typeof value === "string" && (ticketStatuses as readonly string[]).includes(value);

export function ticketCode(id: number) {
  return `CH-${id}`;
}

export function isActiveTicket(status: TicketStatus) {
  return status === "open" || status === "in_progress" || status === "waiting";
}

/** O banco guarda datas como ISO ou no formato do SQLite (UTC, sem fuso). */
export function parseStoredDate(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

export type SlaState = "ok" | "warning" | "breached" | "met" | "late";

/**
 * Situação do prazo de primeira resposta.
 * Sem resposta: ok, warning (último quarto do prazo) ou breached. Com resposta: met (no prazo) ou late.
 */
export function slaStatus(ticket: { createdAt: string; firstResponseAt: string | null; urgency: TicketUrgency }, now = new Date()) {
  const created = parseStoredDate(ticket.createdAt).getTime();
  const limitMinutes = firstResponseHours[ticket.urgency] * 60;
  const due = created + limitMinutes * 60000;
  if (ticket.firstResponseAt) {
    const answered = parseStoredDate(ticket.firstResponseAt).getTime();
    return { state: (answered <= due ? "met" : "late") as SlaState, minutesLeft: 0 };
  }
  const minutesLeft = Math.round((due - now.getTime()) / 60000);
  const state: SlaState = minutesLeft < 0 ? "breached" : minutesLeft <= limitMinutes / 4 ? "warning" : "ok";
  return { state, minutesLeft };
}

export function formatMinutes(total: number) {
  const minutes = Math.abs(Math.round(total));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** Atende o chamado quem é do time de destino, ou administrador. Sem time, qualquer membro que edita. */
export function canHandleTicket(viewer: { isAdmin: boolean; canEdit: boolean; teamIds: readonly number[] }, teamId: number | null) {
  if (viewer.isAdmin) return true;
  if (!viewer.canEdit) return false;
  return teamId === null || viewer.teamIds.includes(teamId);
}

/** Quem abriu pode cancelar um chamado ativo ou reabrir um resolvido. */
export function requesterCanSetStatus(from: TicketStatus, to: TicketStatus) {
  return (to === "canceled" && isActiveTicket(from)) || (to === "open" && from === "resolved");
}

export type TicketEventKind = "comment" | "created" | "status" | "assignee" | "urgency" | "team" | "task";

export function describeTicketEvent(kind: TicketEventKind, body: string) {
  if (kind === "created") return "abriu o chamado";
  if (kind === "status") return `mudou o status para ${isTicketStatus(body) ? ticketStatusLabels[body] : body}`;
  if (kind === "assignee") return body ? `atribuiu a ${body}` : "removeu o responsável";
  if (kind === "urgency") return `mudou a urgência para ${isTicketUrgency(body) ? ticketUrgencyLabels[body] : body}`;
  if (kind === "team") return body ? `encaminhou para o time ${body}` : "removeu o time";
  if (kind === "task") return `criou a tarefa ${body} a partir deste chamado`;
  return body;
}

const statusOrder: Record<TicketStatus, number> = { open: 0, in_progress: 1, waiting: 2, resolved: 3, canceled: 4 };
const urgencyOrder: Record<TicketUrgency, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Fila: ativos primeiro, depois por urgência e pelo mais antigo. */
export function compareTickets(a: { status: TicketStatus; urgency: TicketUrgency; createdAt: string }, b: typeof a) {
  const activeA = isActiveTicket(a.status) ? 0 : 1;
  const activeB = isActiveTicket(b.status) ? 0 : 1;
  if (activeA !== activeB) return activeA - activeB;
  if (activeA === 1) return parseStoredDate(b.createdAt).getTime() - parseStoredDate(a.createdAt).getTime() || statusOrder[a.status] - statusOrder[b.status];
  return urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || parseStoredDate(a.createdAt).getTime() - parseStoredDate(b.createdAt).getTime();
}
