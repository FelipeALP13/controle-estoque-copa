// Chamado novo do Suporte vai sozinho para alguém da equipe de plantão na semana (rodízio por carga).
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { getDb } from "../db";
import { absences, members, notifications, supportTeams, supportWeeks, teams, ticketEvents, tickets } from "../db/schema";
import { isSupportTeamName, matchScheduleNames, pickAssignee } from "./ticket-routing";
import { ticketCode } from "./tickets";

type Db = ReturnType<typeof getDb>;

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Atribui o chamado se for do Suporte e estiver sem responsável. Devolve o id escolhido (ou null). */
export async function autoAssignTicket(db: Db, ticketId: number) {
  try {
    const [ticket] = await db.select({ id: tickets.id, title: tickets.title, teamId: tickets.teamId, assigneeId: tickets.assigneeId, status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    if (!ticket || ticket.assigneeId || !ticket.teamId || ticket.status === "resolved" || ticket.status === "canceled") return null;
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, ticket.teamId)).limit(1);
    if (!team || !isSupportTeamName(team.name)) return null;

    const today = todayInSaoPaulo();
    const [week] = await db.select({ teamId: supportWeeks.teamId }).from(supportWeeks).where(and(lte(supportWeeks.startDate, today), gte(supportWeeks.endDate, today))).limit(1);
    if (!week) return null;
    const [onCall] = await db.select({ members: supportTeams.members }).from(supportTeams).where(eq(supportTeams.id, week.teamId)).limit(1);
    let names: string[] = [];
    try { names = JSON.parse(onCall?.members ?? "[]") as string[]; } catch { names = []; }
    const people = await db.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.active, true)));
    const candidates = matchScheduleNames(names, people.filter((person) => person.id > 0));
    if (!candidates.length) return null;

    const ids = candidates.map((person) => person.id);
    const [openRows, awayRows] = await Promise.all([
      db.select({ assigneeId: tickets.assigneeId }).from(tickets).where(and(inArray(tickets.assigneeId, ids), inArray(tickets.status, ["open", "in_progress", "waiting"]))),
      db.select({ memberId: absences.memberId }).from(absences).where(and(inArray(absences.memberId, ids), lte(absences.startDate, today), gte(absences.endDate, today))),
    ]);
    const chosen = pickAssignee(candidates.map((person) => ({ id: person.id, open: openRows.filter((row) => row.assigneeId === person.id).length, away: awayRows.some((row) => row.memberId === person.id) })));
    if (!chosen) return null;

    // Só atribui se continuar sem responsável (alguém pode ter assumido no meio tempo).
    const now = new Date().toISOString();
    const updated = await db.update(tickets).set({ assigneeId: chosen, updatedAt: now }).where(and(eq(tickets.id, ticket.id), isNull(tickets.assigneeId))).returning({ id: tickets.id });
    if (!updated.length) return null;
    const name = candidates.find((person) => person.id === chosen)?.name ?? "";
    await db.insert(ticketEvents).values({ ticketId: ticket.id, kind: "assignee", body: name, actorId: null, actorName: "Escala do Suporte", createdAt: now });
    await db.insert(notifications).values({ memberId: chosen, kind: "ticket_assigned", ticketId: ticket.id, body: `${ticketCode(ticket.id)} · ${ticket.title}`.slice(0, 140), actorName: "Escala do Suporte", createdAt: now });
    return chosen;
  } catch (error) {
    console.error("auto assign failed", ticketId, error);
    return null;
  }
}
