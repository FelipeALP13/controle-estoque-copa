import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { maintenanceRequests, maintenanceUpdates, members, notifications } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline } from "../../tasks";
import { hasPermission } from "../../member-permissions";
import { snippet } from "../../notifications";
import { canChangeStatus, isActiveMaintenance, isMaintenanceCategory, isMaintenancePriority, isMaintenanceStatus, maintenanceCategory, maintenanceStatusLabels, MAX_MAINTENANCE_LOCATION, MAX_MAINTENANCE_TEXT, MAX_MAINTENANCE_TITLE, sortMaintenance } from "../../maintenance-tools";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("maintenance request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a manutenção. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const isHandler = (member: Pick<SessionMember, "role" | "permissions">) => member.role === "admin" || hasPermission(member, "manageOffice");

/** Quem cuida da manutenção: administradores e quem tem a permissão. */
async function handlers(db: Db) {
  const rows = await db.select({ id: members.id, name: members.name, role: members.role, permissions: members.permissions, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true));
  return rows.filter((row) => isHandler(row));
}

async function notify(db: Db, rows: { memberId: number; body: string }[], actorName: string, skip: number, now: string) {
  const unique = new Map<number, string>();
  for (const row of rows) if (row.memberId !== skip && !unique.has(row.memberId)) unique.set(row.memberId, row.body);
  if (!unique.size) return;
  await db.insert(notifications).values([...unique.entries()].map(([memberId, body]) => ({ memberId, kind: "maintenance" as const, actorName, body: body.slice(0, 140), createdAt: now }))).catch((error) => console.error("maintenance notification failed", error));
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await db.select().from(maintenanceRequests)
      .where(or(inArray(maintenanceRequests.status, ["open", "in_progress", "waiting"]), gte(maintenanceRequests.updatedAt, since)))
      .orderBy(desc(maintenanceRequests.createdAt)).limit(500);
    const ids = rows.map((row) => row.id);
    const [updates, team, people] = await Promise.all([
      ids.length ? db.select().from(maintenanceUpdates).where(inArray(maintenanceUpdates.requestId, ids)).orderBy(maintenanceUpdates.at) : Promise.resolve([]),
      handlers(db),
      db.select({ id: members.id, name: members.name }).from(members),
    ]);
    const handler = isHandler(member);
    return json({
      requests: sortMaintenance(rows).map((row) => ({
        ...row,
        assigneeName: row.assigneeId ? people.find((person) => person.id === row.assigneeId)?.name ?? "Pessoa removida" : null,
        updates: updates.filter((update) => update.requestId === row.id),
        mine: row.createdById === member.id,
      })),
      handlers: team.map((person) => ({ id: person.id, name: person.name, avatarIcon: person.avatarIcon, avatarKey: person.avatarKey })),
      me: { id: member.id, handler, canCreate: member.role !== "viewer" },
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
    const handler = isHandler(member);

    if (action === "create") {
      const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_MAINTENANCE_TITLE);
      if (title.length < 3) return json({ error: "Diga em poucas palavras o problema (ex.: ar-condicionado pingando)." }, 400);
      const category = isMaintenanceCategory(body.category) ? body.category : "other";
      const priority = isMaintenancePriority(body.priority) ? body.priority : "normal";
      const [created] = await db.insert(maintenanceRequests).values({
        title, description: cleanMultiline(body.description, MAX_MAINTENANCE_TEXT), location: String(body.location ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_MAINTENANCE_LOCATION),
        category, priority, createdById: member.id, createdByName: member.name, createdAt: now, updatedAt: now,
      }).returning();
      const team = await handlers(db);
      const icon = maintenanceCategory(category).emoji;
      await notify(db, team.map((person) => ({ memberId: person.id, body: `${priority === "urgent" ? "URGENTE · " : ""}${icon} ${title}${created.location ? ` (${created.location})` : ""}` })), member.name, member.id, now);
      return json({ request: created }, 201);
    }

    const [current] = await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, Number(body.requestId))).limit(1);
    if (!current) return json({ error: "Pedido não encontrado." }, 404);
    const isCreator = current.createdById === member.id;

    if (action === "comment") {
      if (!handler && !isCreator) return json({ error: "Só quem abriu e quem cuida da manutenção comentam no pedido." }, 403);
      const text = cleanMultiline(body.body, MAX_MAINTENANCE_TEXT);
      if (!text) return json({ error: "Escreva o comentário." }, 400);
      await db.insert(maintenanceUpdates).values({ requestId: current.id, body: text, byName: member.name, at: now });
      await db.update(maintenanceRequests).set({ updatedAt: now }).where(eq(maintenanceRequests.id, current.id));
      const targets = [current.createdById, current.assigneeId].filter((id): id is number => Boolean(id));
      await notify(db, targets.map((id) => ({ memberId: id, body: `Comentou em “${current.title}”: ${snippet(text, 80)}` })), member.name, member.id, now);
      return json({ ok: true });
    }

    if (action === "setStatus") {
      if (!isMaintenanceStatus(body.status)) return json({ error: "Situação inválida." }, 400);
      const to = body.status;
      if (to === current.status) return json({ ok: true });
      if (!canChangeStatus({ handler, isCreator, from: current.status, to })) return json({ error: "Só quem cuida da manutenção muda a situação (quem abriu pode cancelar ou reabrir)." }, 403);
      const note = cleanMultiline(body.note, MAX_MAINTENANCE_TEXT);
      await db.update(maintenanceRequests).set({ status: to, updatedAt: now, resolvedAt: to === "done" ? now : isActiveMaintenance(to) ? null : current.resolvedAt }).where(eq(maintenanceRequests.id, current.id));
      await db.insert(maintenanceUpdates).values({ requestId: current.id, body: `${maintenanceStatusLabels[to]}${note ? ` — ${note}` : ""}`, byName: member.name, at: now });
      const targets = to === "open" ? (await handlers(db)).map((person) => person.id) : [current.createdById, current.assigneeId].filter((id): id is number => Boolean(id));
      await notify(db, targets.map((id) => ({ memberId: id, body: `“${current.title}”: ${maintenanceStatusLabels[to].toLowerCase()}${note ? ` — ${snippet(note, 60)}` : ""}` })), member.name, member.id, now);
      return json({ ok: true });
    }

    if (action === "assign") {
      if (!handler) return json({ error: "Só quem cuida da manutenção atribui pedidos." }, 403);
      const assigneeId = Number(body.assigneeId) || null;
      if (assigneeId && !(await handlers(db)).some((person) => person.id === assigneeId)) return json({ error: "Escolha alguém que cuida da manutenção." }, 400);
      await db.update(maintenanceRequests).set({ assigneeId, updatedAt: now, ...(assigneeId && current.status === "open" ? { status: "in_progress" as const } : {}) }).where(eq(maintenanceRequests.id, current.id));
      const [assignee] = assigneeId ? await db.select({ name: members.name }).from(members).where(eq(members.id, assigneeId)).limit(1) : [];
      await db.insert(maintenanceUpdates).values({ requestId: current.id, body: assignee ? `Responsável: ${assignee.name}` : "Sem responsável", byName: member.name, at: now });
      if (assigneeId) await notify(db, [{ memberId: assigneeId, body: `Ficou com você: “${current.title}”` }], member.name, member.id, now);
      return json({ ok: true });
    }

    if (action === "delete") {
      if (member.role !== "admin" && !(isCreator && current.status === "open" && !current.assigneeId)) return json({ error: "Só administradores apagam (quem abriu pode apagar enquanto ninguém pegou)." }, 403);
      await db.delete(maintenanceRequests).where(and(eq(maintenanceRequests.id, current.id)));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
