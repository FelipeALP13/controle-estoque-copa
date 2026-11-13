// Rotinas automáticas: busca no Jira, aviso de chamados atrasados e lembretes da agenda.
// Rodam enquanto alguém da equipe está com o Portal aberto (junto com a busca no Jira).
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { getDb } from "../db";
import { agendaAttendees, agendaEvents, agendaReminders, celebrationAlerts, members, notifications, teamMembers, tickets } from "../db/schema";
import { celebrationText, upcomingCelebrations } from "./team-tools";
import { monitorJob } from "./system-monitor";
import { dueStages, isoToLocal, occurrences, reminderKey, reminderText, START_GRACE_MS } from "./agenda";
import { syncDue } from "./jira-sync";
import { recurringTasksJob } from "./task-recurrence-job";
import { isTicketLate, ticketCode } from "./tickets";

type Db = ReturnType<typeof getDb>;

/**
 * Chamados que passaram do prazo (resposta ou solução): avisa no sino os líderes do time
 * e quem está atribuído (sem líder, os administradores). Cada chamado é avisado uma vez só.
 */
export async function lateTicketsAlert(db: Db, now: Date) {
  const active = await db.select().from(tickets).where(and(inArray(tickets.status, ["open", "in_progress", "waiting"]), isNull(tickets.lateAlertedAt))).limit(200);
  const late = active.filter((ticket) => isTicketLate(ticket, now)).slice(0, 50);
  if (!late.length) return { alerted: 0 };
  const stamp = now.toISOString();
  const [leads, admins] = await Promise.all([
    db.select({ teamId: teamMembers.teamId, memberId: teamMembers.memberId }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.isLead, true), eq(members.active, true))),
    db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true))),
  ]);
  let alerted = 0;
  for (const ticket of late) {
    // Reserva o aviso deste chamado (se outra rodada já reservou, pula).
    const claimed = await db.update(tickets).set({ lateAlertedAt: stamp }).where(and(eq(tickets.id, ticket.id), isNull(tickets.lateAlertedAt))).returning({ id: tickets.id });
    if (!claimed.length) continue;
    alerted += 1;
    const recipients = [...new Set([...leads.filter((lead) => lead.teamId === ticket.teamId).map((lead) => lead.memberId), ...(ticket.assigneeId ? [ticket.assigneeId] : [])])];
    const targets = recipients.length ? recipients : admins.map((admin) => admin.id);
    if (!targets.length) continue;
    try {
      await db.insert(notifications).values(targets.map((memberId) => ({ memberId, kind: "ticket_late" as const, ticketId: ticket.id, body: `${ticketCode(ticket.id)} · ${ticket.title}`.slice(0, 140), actorName: "Portal", createdAt: stamp })));
    } catch (error) {
      console.error("late notification failed", error);
    }
  }
  return { alerted };
}

/**
 * Lembretes da agenda que já deveriam ter saído: vira aviso no sino (com som na tela) para o dono
 * e os convidados. Cada pessoa recebe cada aviso ("antes" e "na hora") uma vez só.
 * Com `onlyMemberId`, entrega só os da pessoa (chamado pela tela, para o aviso sair na hora exata).
 */
export async function agendaRemindersJob(db: Db, now: Date, onlyMemberId?: number) {
  const nowMs = now.getTime();
  // Compromissos de até 2 h atrás até 1 dia à frente (cobre o maior aviso antecipado).
  const from = new Date(nowMs - START_GRACE_MS).toISOString();
  const to = new Date(nowMs + 24 * 3600000).toISOString();
  // Os que começam no intervalo e os que se repetem (já começaram e ainda não terminaram a série).
  const events = await db.select().from(agendaEvents)
    .where(and(eq(agendaEvents.done, false), isNotNull(agendaEvents.remindBefore), or(
      and(gte(agendaEvents.startsAt, from), lte(agendaEvents.startsAt, to)),
      and(ne(agendaEvents.repeat, ""), lte(agendaEvents.startsAt, to), or(isNull(agendaEvents.repeatUntil), gte(agendaEvents.repeatUntil, isoToLocal(from).day))),
    )))
    .limit(500);
  const due = events.flatMap((event) => occurrences(event, Date.parse(from), Date.parse(to))
    .map((start) => ({ event, occurrence: event.repeat ? start : null, stages: dueStages({ startsAt: start, remindBefore: event.remindBefore }, nowMs) })))
    .filter((entry) => entry.stages.length);
  if (!due.length) return { reminded: 0 };
  const attendees = await db.select().from(agendaAttendees).where(inArray(agendaAttendees.eventId, due.map((entry) => entry.event.id)));
  const stamp = now.toISOString();
  let reminded = 0;
  for (const { event, occurrence, stages } of due) {
    const people = [...new Set([event.ownerId, ...attendees.filter((row) => row.eventId === event.id).map((row) => row.memberId)])]
      .filter((memberId) => onlyMemberId === undefined || memberId === onlyMemberId);
    for (const memberId of people) {
      for (const stage of stages) {
        // Reserva o aviso (pessoa + compromisso + momento): se já saiu, não repete.
        const claimed = await db.insert(agendaReminders).values({ eventId: event.id, memberId, stage: reminderKey(stage, occurrence), sentAt: stamp }).onConflictDoNothing().returning({ eventId: agendaReminders.eventId });
        if (!claimed.length) continue;
        reminded += 1;
        await db.insert(notifications).values({ memberId, kind: "agenda_reminder", eventId: event.id, body: reminderText(event.title, stage, event.remindBefore).slice(0, 140), actorName: "Agenda", createdAt: stamp });
      }
    }
  }
  return { reminded };
}

/**
 * Aniversário e tempo de casa de hoje: um aviso no sino para toda a equipe (cada comemoração uma vez por ano).
 * Só a partir das 7h, para não chegar de madrugada.
 */
export async function celebrationsJob(db: Db, now: Date) {
  const local = isoToLocal(now.toISOString());
  if (local.time < "07:00") return { sent: 0 };
  const people = await db.select({ id: members.id, name: members.name, birthday: members.birthday, startedOn: members.startedOn }).from(members).where(eq(members.active, true));
  const today = upcomingCelebrations(people, local.day, 0);
  if (!today.length) return { sent: 0 };
  const stamp = now.toISOString();
  let sent = 0;
  for (const entry of today) {
    // Reserva a comemoração (pessoa + tipo + ano): se outra rodada já reservou, pula.
    const claimed = await db.insert(celebrationAlerts).values({ key: `${entry.kind}:${entry.memberId}:${entry.date.slice(0, 4)}`, sentAt: stamp }).onConflictDoNothing().returning({ key: celebrationAlerts.key });
    if (!claimed.length) continue;
    sent += 1;
    const everyone = people.map((person) => ({ memberId: person.id, kind: "celebration" as const, actorName: "Portal", createdAt: stamp, body: (person.id === entry.memberId ? (entry.kind === "birthday" ? `Feliz aniversário, ${entry.name.split(/\s+/)[0]}! 🎂 A equipe toda foi avisada.` : `Parabéns pelos ${entry.years} ${entry.years === 1 ? "ano" : "anos"} de casa, ${entry.name.split(/\s+/)[0]}! 🎉`) : celebrationText(entry)).slice(0, 140) }));
    for (let index = 0; index < everyone.length; index += 20) await db.insert(notifications).values(everyone.slice(index, index + 20));
  }
  return { sent };
}

/** Uma rodada completa. Cada parte é independente: o erro de uma não impede as outras. */
export async function runJobs(db: Db, options: { now?: Date; includeJira?: boolean } = {}) {
  const now = options.now ?? new Date();
  const result: { jira: { name: string; created: number; updated: number; comments: number; error: string | null }[]; late: unknown; agenda: unknown; recurring: unknown; celebrations: unknown; monitor: unknown; errors: string[] } = { jira: [], late: null, agenda: null, recurring: null, celebrations: null, monitor: null, errors: [] };
  if (options.includeJira !== false) {
    try {
      result.jira = (await syncDue(db, false, now)).map((entry) => ({ name: entry.name, created: entry.created, updated: entry.updated, comments: entry.comments, error: entry.error }));
    } catch (error) {
      result.errors.push(`Jira: ${error instanceof Error ? error.message : "erro"}`);
    }
  }
  try { result.late = await lateTicketsAlert(db, now); } catch (error) { result.errors.push(`Atrasos: ${error instanceof Error ? error.message : "erro"}`); }
  try { result.agenda = await agendaRemindersJob(db, now); } catch (error) { result.errors.push(`Agenda: ${error instanceof Error ? error.message : "erro"}`); }
  try { result.recurring = await recurringTasksJob(db, isoToLocal(now.toISOString()).day); } catch (error) { result.errors.push(`Repetições: ${error instanceof Error ? error.message : "erro"}`); }
  try { result.celebrations = await celebrationsJob(db, now); } catch (error) { result.errors.push(`Comemorações: ${error instanceof Error ? error.message : "erro"}`); }
  try { result.monitor = await monitorJob(db, now); } catch (error) { result.errors.push(`Monitor: ${error instanceof Error ? error.message : "erro"}`); }
  return result;
}
