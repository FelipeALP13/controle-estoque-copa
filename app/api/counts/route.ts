import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { taskPeople, tasks, teamMembers, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { isTicketLate } from "../../tickets";

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Contadores do menu lateral: minhas demandas em aberto e a fila de chamados do meu time. */
export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return Response.json({ error: "Entre com seu usuário e senha." }, { status: 401 });
    const today = todayInSaoPaulo();
    const closed = ["done", "canceled"] as const;
    const mine = db.select({ id: taskPeople.taskId }).from(taskPeople).where(eq(taskPeople.memberId, member.id));
    const [openTasks, overdueTasks, teamRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(inArray(tasks.id, mine), notInArray(tasks.status, [...closed]))),
      db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(inArray(tasks.id, mine), notInArray(tasks.status, [...closed]), lt(tasks.dueDate, today))),
      db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, member.id)),
    ]);
    // Fila: chamados ativos dos meus times (ou, sem time, os atribuídos a mim).
    const teamIds = teamRows.map((row) => row.teamId);
    const active = ["open", "in_progress", "waiting"] as const;
    const queue = await db.select({ createdAt: tickets.createdAt, firstResponseAt: tickets.firstResponseAt, resolvedAt: tickets.resolvedAt, status: tickets.status, urgency: tickets.urgency, assigneeId: tickets.assigneeId })
      .from(tickets)
      .where(and(inArray(tickets.status, [...active]), teamIds.length ? inArray(tickets.teamId, teamIds) : eq(tickets.assigneeId, member.id)));
    const now = new Date();
    return Response.json({
      tasks: Number(openTasks[0]?.count ?? 0),
      tasksOverdue: Number(overdueTasks[0]?.count ?? 0),
      tickets: queue.length,
      ticketsLate: queue.filter((ticket) => isTicketLate(ticket, now)).length,
      ticketsUnassigned: queue.filter((ticket) => ticket.assigneeId === null).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("counts failed", error);
    return Response.json({ tasks: 0, tasksOverdue: 0, tickets: 0, ticketsLate: 0, ticketsUnassigned: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
}
