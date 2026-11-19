// Atividade de uma pessoa por dia no último ano (mapa de calor): demandas concluídas, chamados resolvidos e horas lançadas.
// Cada pessoa vê a própria; administradores veem a de qualquer pessoa.
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { taskPeople, tasks, tickets, timeEntries } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { activityRange } from "../../activity";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const asked = Number(new URL(request.url).searchParams.get("memberId")) || member.id;
    if (asked !== member.id && member.role !== "admin") return json({ error: "Só administradores veem a atividade de outras pessoas." }, 403);

    const { from, to } = activityRange(new Date());
    const days: Record<string, { tasks: number; tickets: number; hours: number }> = {};
    const day = (key: string) => (days[key] ??= { tasks: 0, tickets: 0, hours: 0 });

    // Demandas concluídas em que a pessoa é responsável (principal ou na lista de responsáveis).
    const mine = db.select({ id: taskPeople.taskId }).from(taskPeople).where(eq(taskPeople.memberId, asked));
    const done = await db.select({ on: tasks.completedOn }).from(tasks)
      .where(and(eq(tasks.status, "done"), isNotNull(tasks.completedOn), gte(tasks.completedOn, from), lte(tasks.completedOn, to), or(eq(tasks.assigneeId, asked), inArray(tasks.id, mine))));
    for (const row of done) if (row.on) day(row.on.slice(0, 10)).tasks += 1;

    // Chamados resolvidos por ela (dia em Brasília).
    const resolved = await db.select({ on: sql<string>`date(${tickets.resolvedAt}, '-3 hours')` }).from(tickets)
      .where(and(eq(tickets.assigneeId, asked), eq(tickets.status, "resolved"), isNotNull(tickets.resolvedAt), gte(tickets.resolvedAt, `${from}T03:00:00`)));
    for (const row of resolved) if (row.on && row.on <= to) day(row.on).tickets += 1;

    // Horas lançadas.
    const hours = await db.select({ on: timeEntries.workDate, total: sql<number>`sum(${timeEntries.hours})` }).from(timeEntries)
      .where(and(eq(timeEntries.memberId, asked), gte(timeEntries.workDate, from), lte(timeEntries.workDate, to))).groupBy(timeEntries.workDate);
    for (const row of hours) day(row.on).hours += Number(row.total) || 0;

    return json({ from, to, days });
  } catch (error) {
    console.error("activity request failed", error);
    return json({ error: "Não foi possível carregar a atividade agora." }, 500);
  }
}
