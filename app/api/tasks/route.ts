import { and, asc, desc, eq, min, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, notifications, taskEvents, tasks } from "../../../db/schema";
import { commentRecipients, findMentions, snippet, statusRecipients, type NotificationKind } from "../../notifications";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, cleanTitle, isClosedStatus, isTaskPriority, isTaskStatus, MAX_COMMENT_LENGTH, MAX_DESCRIPTION_LENGTH, parseDueDate, sortOrderBetween, taskCode, taskStatusLabels, type TaskEventKind, type TaskStatus } from "../../tasks";

type Db = ReturnType<typeof getDb>;

const canEdit = (member: SessionMember) => member.active && member.role !== "viewer";
const isAdmin = (member: SessionMember) => member.role === "admin";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("tasks request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem as tabelas de tarefas. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

async function activeAssignee(db: Db, value: unknown) {
  if (value === null || value === undefined || value === "") return { id: null, name: "" };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [member] = await db.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.id, id), eq(members.active, true))).limit(1);
  return member ?? undefined;
}

type NewNotification = { memberId: number; kind: NotificationKind; taskId: number; body: string };

/** Avisos não podem derrubar a operação principal (ex.: migração ainda não aplicada). */
async function notify(db: Db, actorName: string, createdAt: string, rows: NewNotification[]) {
  if (!rows.length) return;
  try {
    await db.insert(notifications).values(rows.map((row) => ({ ...row, actorName, createdAt })));
  } catch (error) {
    console.error("notification insert failed", error);
  }
}

async function topSortOrder(db: Db, status: TaskStatus) {
  const [row] = await db.select({ value: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.status, status));
  return sortOrderBetween(null, row?.value ?? null);
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);

    const taskId = Number(new URL(request.url).searchParams.get("taskId"));
    if (taskId) {
      const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).orderBy(asc(taskEvents.createdAt), asc(taskEvents.id));
      return json({
        events: events.map((event) => ({ id: event.id, kind: event.kind, body: event.body, actorId: event.actorId, actorName: event.actorName, createdAt: event.createdAt, canDelete: event.kind === "comment" && (event.actorId === member.id || isAdmin(member)) })),
      });
    }

    const [taskRows, memberRows] = await Promise.all([
      db.select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        assigneeId: tasks.assigneeId,
        dueDate: tasks.dueDate,
        sortOrder: tasks.sortOrder,
        createdByName: tasks.createdByName,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Nomes explícitos: dentro da subconsulta, "id" sozinho seria o id do evento.
        commentCount: sql<number>`(select count(*) from "task_events" "te" where "te"."task_id" = "tasks"."id" and "te"."kind" = 'comment')`,
      }).from(tasks).orderBy(asc(tasks.sortOrder), desc(tasks.id)),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
    ]);

    return json({ tasks: taskRows, members: memberRows, me: { id: member.id, canEdit: canEdit(member), isAdmin: isAdmin(member) } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!canEdit(member)) return json({ error: "Seu perfil pode apenas visualizar as tarefas." }, 403);

    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const actor = { actorId: member.id, actorName: member.name };
    const now = new Date().toISOString();

    if (action === "createTask") {
      const title = cleanTitle(body.title);
      const status = isTaskStatus(body.status) ? body.status : "todo";
      const priority = isTaskPriority(body.priority) ? body.priority : 0;
      const dueDate = parseDueDate(body.dueDate);
      const assignee = await activeAssignee(db, body.assigneeId);
      if (!title) return json({ error: "Dê um título para a tarefa." }, 400);
      if (dueDate === undefined) return json({ error: "Informe um prazo válido." }, 400);
      if (assignee === undefined) return json({ error: "Escolha um responsável ativo." }, 400);
      const [task] = await db.insert(tasks).values({
        title,
        description: cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH),
        status,
        priority,
        assigneeId: assignee.id,
        dueDate,
        sortOrder: await topSortOrder(db, status),
        createdById: member.id,
        createdByName: member.name,
        completedAt: status === "done" ? now : null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await db.insert(taskEvents).values({ taskId: task.id, kind: "created", ...actor, createdAt: now });
      if (assignee.id && assignee.id !== member.id) await notify(db, member.name, now, [{ memberId: assignee.id, kind: "task_assigned", taskId: task.id, body: "" }]);
      return json({ task }, 201);
    }

    if (action === "updateTask") {
      const taskId = Number(body.taskId);
      const [current] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!current) return json({ error: "Tarefa não encontrada." }, 404);

      const changes: Partial<typeof tasks.$inferInsert> = {};
      const events: { kind: TaskEventKind; body: string }[] = [];

      if ("title" in body) {
        const title = cleanTitle(body.title);
        if (!title) return json({ error: "O título não pode ficar vazio." }, 400);
        if (title !== current.title) { changes.title = title; events.push({ kind: "title", body: title }); }
      }
      if ("description" in body) {
        const description = cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH);
        if (description !== current.description) changes.description = description;
      }
      if ("status" in body) {
        if (!isTaskStatus(body.status)) return json({ error: "Status inválido." }, 400);
        if (body.status !== current.status) {
          changes.status = body.status;
          changes.completedAt = body.status === "done" ? now : null;
          events.push({ kind: "status", body: body.status });
          if (!("sortOrder" in body)) changes.sortOrder = await topSortOrder(db, body.status);
        }
      }
      if ("sortOrder" in body) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isFinite(sortOrder)) return json({ error: "Posição inválida." }, 400);
        changes.sortOrder = sortOrder;
      }
      if ("priority" in body) {
        if (!isTaskPriority(body.priority)) return json({ error: "Prioridade inválida." }, 400);
        if (body.priority !== current.priority) { changes.priority = body.priority; events.push({ kind: "priority", body: String(body.priority) }); }
      }
      if ("assigneeId" in body) {
        const assignee = await activeAssignee(db, body.assigneeId);
        if (assignee === undefined) return json({ error: "Escolha um responsável ativo." }, 400);
        if (assignee.id !== current.assigneeId) { changes.assigneeId = assignee.id; events.push({ kind: "assignee", body: assignee.name }); }
      }
      if ("dueDate" in body) {
        const dueDate = parseDueDate(body.dueDate);
        if (dueDate === undefined) return json({ error: "Informe um prazo válido." }, 400);
        if (dueDate !== current.dueDate) { changes.dueDate = dueDate; events.push({ kind: "due_date", body: dueDate ?? "" }); }
      }

      if (Object.keys(changes).length === 0) return json({ task: current });
      const [task] = await db.update(tasks).set({ ...changes, updatedAt: now }).where(eq(tasks.id, taskId)).returning();
      if (events.length) await db.insert(taskEvents).values(events.map((event) => ({ taskId, ...event, ...actor, createdAt: now })));

      const alerts: NewNotification[] = [];
      if (changes.assigneeId && changes.assigneeId !== member.id) alerts.push({ memberId: changes.assigneeId, kind: "task_assigned", taskId, body: "" });
      if (changes.status) {
        // Quem acabou de receber a tarefa já ganhou o aviso de atribuição.
        for (const id of statusRecipients(member.id, task.assigneeId, current.createdById)) {
          if (id !== changes.assigneeId) alerts.push({ memberId: id, kind: "task_status", taskId, body: taskStatusLabels[task.status] });
        }
      }
      await notify(db, member.name, now, alerts);
      return json({ task, closed: isClosedStatus(task.status) });
    }

    if (action === "addComment") {
      const taskId = Number(body.taskId);
      const text = cleanMultiline(body.body, MAX_COMMENT_LENGTH);
      if (!text) return json({ error: "Escreva o comentário antes de enviar." }, 400);
      const [task] = await db.select({ id: tasks.id, assigneeId: tasks.assigneeId, createdById: tasks.createdById }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task) return json({ error: "Tarefa não encontrada." }, 404);
      const [participants, people] = await Promise.all([
        db.selectDistinct({ id: taskEvents.actorId }).from(taskEvents).where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.kind, "comment"))),
        db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)),
      ]);
      const [event] = await db.insert(taskEvents).values({ taskId, kind: "comment", body: text, ...actor, createdAt: now }).returning();
      await db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, taskId));
      const recipients = commentRecipients({
        actorId: member.id,
        assigneeId: task.assigneeId,
        creatorId: task.createdById,
        participantIds: participants.map((row) => row.id).filter((id): id is number => id !== null),
        mentionedIds: findMentions(text, people),
      });
      const activeIds = new Set(people.map((person) => person.id));
      await notify(db, member.name, now, [...recipients].filter(([id]) => activeIds.has(id)).map(([memberId, kind]) => ({ memberId, kind, taskId, body: snippet(text) })));
      return json({ event }, 201);
    }

    if (action === "deleteComment") {
      const eventId = Number(body.eventId);
      const [event] = await db.select().from(taskEvents).where(eq(taskEvents.id, eventId)).limit(1);
      if (!event || event.kind !== "comment") return json({ error: "Comentário não encontrado." }, 404);
      if (event.actorId !== member.id && !isAdmin(member)) return json({ error: "Você só pode excluir os seus comentários." }, 403);
      await db.delete(taskEvents).where(eq(taskEvents.id, eventId));
      return json({ ok: true });
    }

    if (action === "deleteTask") {
      if (!isAdmin(member)) return json({ error: "Somente administradores podem excluir tarefas." }, 403);
      const taskId = Number(body.taskId);
      const [deleted] = await db.delete(tasks).where(eq(tasks.id, taskId)).returning();
      if (!deleted) return json({ error: "Tarefa não encontrada." }, 404);
      try {
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "task_deleted", targetType: "task", targetId: deleted.id, details: `${taskCode(deleted.id)} ${deleted.title}` });
      } catch (error) {
        console.error("audit log failed", error);
      }
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
