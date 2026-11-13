export type NotificationKind = "task_assigned" | "task_comment" | "task_mention" | "task_status" | "ticket_new" | "ticket_assigned" | "ticket_comment" | "ticket_mention" | "ticket_status" | "ticket_late" | "agenda_reminder" | "agenda_invite" | "ticket_rate" | "task_unblocked" | "handoff" | "celebration" | "system_down" | "system_up" | "onboarding";

type Person = { id: number; name: string };

const isWordChar = (char: string | undefined) => Boolean(char && /[\p{L}\p{N}_]/u.test(char));

type MentionSpan = { start: number; end: number; member: Person };

/** Encontra "@Nome Completo" no texto, preferindo o nome mais longo quando um começa com outro. */
function mentionSpans(text: string, people: readonly Person[]): MentionSpan[] {
  const lower = text.toLocaleLowerCase("pt-BR");
  const sorted = [...people].filter((person) => person.name.trim()).sort((a, b) => b.name.length - a.name.length);
  const taken: boolean[] = [];
  const spans: MentionSpan[] = [];
  for (const person of sorted) {
    const needle = `@${person.name.trim().toLocaleLowerCase("pt-BR")}`;
    let from = 0;
    while (from <= lower.length) {
      const start = lower.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      from = end;
      if (isWordChar(lower[end]) || isWordChar(lower[start - 1])) continue;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let index = start; index < end; index += 1) taken[index] = true;
      spans.push({ start, end, member: person });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function findMentions(text: string, people: readonly Person[]) {
  return [...new Set(mentionSpans(text, people).map((span) => span.member.id))];
}

/** Divide o texto em trechos comuns e menções, para destacar na tela. */
export function splitMentions(text: string, people: readonly Person[]) {
  const parts: { text: string; mention: boolean }[] = [];
  let cursor = 0;
  for (const span of mentionSpans(text, people)) {
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), mention: false });
    parts.push({ text: text.slice(span.start, span.end), mention: true });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mention: false });
  return parts;
}

const present = (id: number | null | undefined): id is number => typeof id === "number" && id > 0;

/**
 * Quem recebe aviso de um comentário: mencionados recebem "menção";
 * responsável, autor da tarefa e quem já comentou recebem "comentário". Nunca quem comentou agora.
 */
export function commentRecipients(input: { actorId: number; assigneeId: number | null; creatorId: number | null; participantIds: readonly number[]; mentionedIds: readonly number[] }) {
  const recipients = new Map<number, NotificationKind>();
  for (const id of input.mentionedIds) if (present(id) && id !== input.actorId) recipients.set(id, "task_mention");
  for (const id of [input.assigneeId, input.creatorId, ...input.participantIds]) {
    if (present(id) && id !== input.actorId && !recipients.has(id)) recipients.set(id, "task_comment");
  }
  return recipients;
}

/** Quem recebe aviso de mudança de status: responsável e autor, menos quem mudou. */
export function statusRecipients(actorId: number, assigneeId: number | null, creatorId: number | null) {
  return [...new Set([assigneeId, creatorId].filter((id): id is number => present(id) && id !== actorId))];
}

export function notificationText(kind: NotificationKind, actorName: string, body: string) {
  if (kind === "task_assigned") return `${actorName} atribuiu uma demanda a você`;
  if (kind === "ticket_assigned") return `${actorName} atribuiu um chamado a você`;
  if (kind === "ticket_new") return `${actorName} abriu um chamado para o seu time`;
  if (kind === "task_mention" || kind === "ticket_mention") return `${actorName} mencionou você`;
  if (kind === "task_status" || kind === "ticket_status") return `${actorName} mudou o status para ${body}`;
  if (kind === "ticket_late") return `Chamado fora do prazo: ${body}`;
  if (kind === "agenda_reminder") return body;
  if (kind === "agenda_invite") return `${actorName} convidou você para um compromisso`;
  if (kind === "task_unblocked") return `Demanda liberada: ${body} foi concluída`;
  if (kind === "handoff") return `${actorName} deixou a passagem de plantão para a sua equipe`;
  if (kind === "celebration") return body;
  if (kind === "system_down") return `Fora do ar: ${body}`;
  if (kind === "system_up") return `Voltou ao ar: ${body}`;
  if (kind === "onboarding") return body;
  if (kind === "ticket_rate") return `${actorName} resolveu o seu chamado. Como foi o atendimento?`;
  return `${actorName} comentou`;
}

/** Converte o tipo de aviso de comentário de tarefa para o equivalente de chamado. */
export function asTicketKind(kind: NotificationKind): NotificationKind {
  return kind === "task_mention" ? "ticket_mention" : kind === "task_comment" ? "ticket_comment" : kind;
}

export function snippet(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
