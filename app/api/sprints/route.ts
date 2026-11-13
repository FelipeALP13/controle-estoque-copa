import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { absences, members, sprints, taskEvents, taskPeople, tasks, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle, taskCode } from "../../tasks";
import { sprintRangeError } from "../../office-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("sprints request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem os sprints. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const me = { id: member.id, canEdit: member.role !== "viewer", isAdmin: member.role === "admin" };

    const sprintId = Number(new URL(request.url).searchParams.get("sprintId"));
    if (sprintId) {
      const [sprint] = await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1);
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      const [taskRows, roster, away, memberRows, backlog] = await Promise.all([
        db.select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, estimatedHours: tasks.estimatedHours, workedHours: tasks.workedHours, completedOn: tasks.completedOn, dueDate: tasks.dueDate, teamId: tasks.teamId }).from(tasks).where(eq(tasks.sprintId, sprintId)).orderBy(asc(tasks.sortOrder)),
        sprint.teamId ? db.select({ memberId: teamMembers.memberId }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.teamId, sprint.teamId), eq(members.active, true))) : Promise.resolve([]),
        db.select({ memberId: absences.memberId, startDate: absences.startDate, endDate: absences.endDate }).from(absences).where(and(lte(absences.startDate, sprint.endDate), gte(absences.endDate, sprint.startDate))),
        db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
        // Candidatas a entrar: em aberto, sem sprint (do time do sprint ou sem time).
        db.select({ id: tasks.id, title: tasks.title, status: tasks.status, estimatedHours: tasks.estimatedHours, teamId: tasks.teamId }).from(tasks).where(and(isNull(tasks.sprintId), notInArray(tasks.status, ["done", "canceled"]))).orderBy(asc(tasks.sortOrder)).limit(500),
      ]);
      const people = taskRows.length ? await db.select().from(taskPeople).where(inArray(taskPeople.taskId, taskRows.map((task) => task.id))) : [];
      return json({
        sprint,
        tasks: taskRows.map((task) => ({ ...task, owners: people.filter((row) => row.taskId === task.id && row.role === "owner").map((row) => row.memberId) })),
        memberIds: roster.map((row) => row.memberId),
        absences: away,
        members: memberRows,
        backlog: backlog.filter((task) => !sprint.teamId || task.teamId === null || task.teamId === sprint.teamId),
        me,
      });
    }

    const [rows, teamRows, counts] = await Promise.all([
      db.select().from(sprints).orderBy(desc(sprints.startDate), desc(sprints.id)).limit(60),
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
      db.select({ sprintId: tasks.sprintId, total: sql<number>`count(*)`, done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`, estimate: sql<number>`coalesce(sum(${tasks.estimatedHours}), 0)` }).from(tasks).where(sql`${tasks.sprintId} is not null`).groupBy(tasks.sprintId),
    ]);
    return json({
      sprints: rows.map((sprint) => { const count = counts.find((row) => row.sprintId === sprint.id); return { ...sprint, total: Number(count?.total ?? 0), done: Number(count?.done ?? 0), estimate: Number(count?.estimate ?? 0) }; }),
      teams: teamRows,
      me,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const actor = { actorId: member.id, actorName: member.name };

    if (action === "saveSprint") {
      const sprintId = Number(body.sprintId) || 0;
      const name = cleanTitle(body.name).slice(0, 80);
      const rangeError = sprintRangeError(body.startDate, body.endDate);
      const teamId = Number(body.teamId) || null;
      const hoursPerDay = Number(String(body.hoursPerDay ?? 6).replace(",", "."));
      if (!name) return json({ error: "Dê um nome ao sprint (ex.: Sprint 12)." }, 400);
      if (rangeError) return json({ error: rangeError }, 400);
      if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 12) return json({ error: "Horas por dia de cada pessoa: entre 1 e 12." }, 400);
      if (teamId && !(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1)).length) return json({ error: "Escolha um time válido." }, 400);
      const values = { name, teamId, startDate: body.startDate as string, endDate: body.endDate as string, goal: cleanMultiline(body.goal, 1000), hoursPerDay: Math.round(hoursPerDay * 10) / 10 };
      const [sprint] = sprintId
        ? await db.update(sprints).set(values).where(eq(sprints.id, sprintId)).returning()
        : await db.insert(sprints).values({ ...values, createdByName: member.name, createdAt: now }).returning();
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      return json({ sprint }, sprintId ? 200 : 201);
    }

    const sprintId = Number(body.sprintId);
    const [sprint] = sprintId ? await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1) : [];

    if (action === "startSprint") {
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      if (sprint.status !== "planned") return json({ error: "Este sprint já começou." }, 400);
      await db.update(sprints).set({ status: "active" }).where(eq(sprints.id, sprintId));
      return json({ ok: true });
    }

    // Encerrar: o que não terminou vai para outro sprint ou volta para a lista geral.
    if (action === "closeSprint") {
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      if (sprint.status === "closed") return json({ error: "Este sprint já foi encerrado." }, 400);
      const moveTo = Number(body.moveTo) || null;
      if (moveTo) {
        const [target] = await db.select({ id: sprints.id, status: sprints.status }).from(sprints).where(eq(sprints.id, moveTo)).limit(1);
        if (!target || target.status === "closed" || target.id === sprintId) return json({ error: "Escolha um sprint em aberto para receber as demandas." }, 400);
      }
      const moved = await db.update(tasks).set({ sprintId: moveTo, updatedAt: now }).where(and(eq(tasks.sprintId, sprintId), notInArray(tasks.status, ["done", "canceled"]))).returning({ id: tasks.id });
      await db.update(sprints).set({ status: "closed", closedAt: now }).where(eq(sprints.id, sprintId));
      return json({ moved: moved.length });
    }

    if (action === "deleteSprint") {
      if (member.role !== "admin") return json({ error: "Somente administradores excluem sprints." }, 403);
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      await db.update(tasks).set({ sprintId: null }).where(eq(tasks.sprintId, sprintId));
      await db.delete(sprints).where(eq(sprints.id, sprintId));
      return json({ ok: true });
    }

    if (action === "addTasks") {
      if (!sprint) return json({ error: "Sprint não encontrado." }, 404);
      if (sprint.status === "closed") return json({ error: "O sprint já foi encerrado." }, 400);
      const ids = Array.isArray(body.taskIds) ? [...new Set(body.taskIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100) : [];
      if (!ids.length) return json({ error: "Escolha as demandas." }, 400);
      const updated = await db.update(tasks).set({ sprintId, updatedAt: now }).where(inArray(tasks.id, ids)).returning({ id: tasks.id });
      if (updated.length) await db.insert(taskEvents).values(updated.map((task) => ({ taskId: task.id, kind: "comment" as const, body: `Entrou no ${sprint.name}.`, ...actor, createdAt: now })));
      return json({ added: updated.length });
    }

    if (action === "removeTask") {
      const taskId = Number(body.taskId);
      const [task] = await db.select({ id: tasks.id, sprintId: tasks.sprintId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task?.sprintId) return json({ error: "A demanda não está em um sprint." }, 400);
      await db.update(tasks).set({ sprintId: null, updatedAt: now }).where(eq(tasks.id, taskId));
      await db.insert(taskEvents).values({ taskId, kind: "comment", body: `Saiu do sprint (${taskCode(taskId)} voltou para a lista geral).`, ...actor, createdAt: now });
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
