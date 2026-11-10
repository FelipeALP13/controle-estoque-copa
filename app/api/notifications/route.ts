import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, notInArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { notifications, tasks } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { addDays } from "../../support-schedule";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);

    const tomorrow = addDays(todayInSaoPaulo(), 1);
    const [items, [unread], due] = await Promise.all([
      db.select({
        id: notifications.id,
        kind: notifications.kind,
        taskId: notifications.taskId,
        taskTitle: tasks.title,
        actorName: notifications.actorName,
        body: notifications.body,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      }).from(notifications).leftJoin(tasks, eq(notifications.taskId, tasks.id))
        .where(eq(notifications.memberId, member.id))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(30),
      db.select({ value: count() }).from(notifications).where(and(eq(notifications.memberId, member.id), isNull(notifications.readAt))),
      db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate }).from(tasks)
        .where(and(eq(tasks.assigneeId, member.id), isNotNull(tasks.dueDate), lte(tasks.dueDate, tomorrow), notInArray(tasks.status, ["done", "canceled"])))
        .orderBy(asc(tasks.dueDate))
        .limit(10),
    ]);

    return json({ items, unread: unread?.value ?? 0, due });
  } catch (error) {
    // Sem a migração aplicada, o sininho fica vazio em vez de quebrar a página.
    console.error("notifications load failed", error);
    return json({ items: [], unread: 0, due: [], unavailable: true });
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);

    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const mine = and(eq(notifications.memberId, member.id), isNull(notifications.readAt));

    if (body.action === "markAllRead") {
      await db.update(notifications).set({ readAt: now }).where(mine);
      return json({ ok: true });
    }
    if (body.action === "markRead") {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 100) : [];
      if (ids.length) await db.update(notifications).set({ readAt: now }).where(and(mine, inArray(notifications.id, ids)));
      return json({ ok: true });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("notifications update failed", error);
    return json({ error: "Não foi possível atualizar os avisos agora." }, 500);
  }
}
