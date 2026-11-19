import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { absences, members, notifications, teamMembers } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { absenceKindLabels, absenceRangeError, describeAbsence, isAbsenceKind, MAX_NOTE, rangesOverlap } from "../../absences";
import { readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("absences request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as ausências. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDays(isoDate: string, days: number) {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** Quem a pessoa pode registrar: ela mesma; o líder, os integrantes dos times que lidera; o administrador, todos. */
async function manageableIds(db: Db, member: SessionMember): Promise<"all" | number[]> {
  if (member.role === "admin") return "all";
  if (member.role === "viewer") return [];
  try {
    const led = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(and(eq(teamMembers.memberId, member.id), eq(teamMembers.isLead, true)));
    if (!led.length) return [member.id];
    const rows = await db.selectDistinct({ memberId: teamMembers.memberId }).from(teamMembers).where(inArray(teamMembers.teamId, led.map((row) => row.teamId)));
    return [...new Set([member.id, ...rows.map((row) => row.memberId)])];
  } catch {
    return [member.id];
  }
}

const canManage = (allowed: "all" | number[], memberId: number) => allowed === "all" || allowed.includes(memberId);

/** Aprova o pedido de alguém: administrador, ou líder de um time da pessoa (ninguém aprova o próprio pedido, exceto administrador). */
const canDecide = (member: SessionMember, allowed: "all" | number[], memberId: number) => member.role === "admin" || (memberId !== member.id && canManage(allowed, memberId));

/** Quem recebe o pedido: líderes dos times da pessoa e administradores (menos a própria pessoa). */
async function approversOf(db: Db, memberId: number) {
  const teams = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, memberId));
  const leads = teams.length ? await db.selectDistinct({ id: teamMembers.memberId }).from(teamMembers).where(and(inArray(teamMembers.teamId, teams.map((row) => row.teamId)), eq(teamMembers.isLead, true))) : [];
  const admins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)));
  return [...new Set([...leads.map((row) => row.id), ...admins.map((row) => row.id)])].filter((id) => id !== memberId);
}

async function notify(db: Db, memberIds: number[], kind: "absence_request" | "absence_decision", actorName: string, body: string) {
  if (!memberIds.length) return;
  const createdAt = new Date().toISOString();
  for (let index = 0; index < memberIds.length; index += 20) {
    await db.insert(notifications).values(memberIds.slice(index, index + 20).map((memberId) => ({ memberId, kind, actorName, body: body.slice(0, 300), createdAt })));
  }
}

const shortRange = (row: { startDate: string; endDate: string }) => row.startDate === row.endDate ? row.startDate.split("-").reverse().slice(0, 2).join("/") : `${row.startDate.split("-").reverse().slice(0, 2).join("/")} a ${row.endDate.split("-").reverse().slice(0, 2).join("/")}`;

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    // Do último mês em diante: o suficiente para telas e avisos.
    const rows = await db.select().from(absences).where(gte(absences.endDate, shiftDays(todayInSaoPaulo(), -31))).orderBy(asc(absences.startDate), asc(absences.id));
    const allowed = await manageableIds(db, member);
    const people = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true));
    const shape = (row: typeof rows[number]) => ({ id: row.id, memberId: row.memberId, kind: row.kind, startDate: row.startDate, endDate: row.endDate, note: row.note, createdByName: row.createdByName, canDelete: canManage(allowed, row.memberId) || row.createdById === member.id });
    return json({
      people,
      // Só as aprovadas contam como "fora" (escala, painel, calendário, responsáveis).
      absences: rows.filter((row) => row.status === "approved").map(shape),
      // Pedidos: os da própria pessoa e os que ela pode decidir.
      requests: rows.filter((row) => row.status !== "approved" && (row.memberId === member.id || row.createdById === member.id || canDecide(member, allowed, row.memberId)))
        .map((row) => ({ ...shape(row), status: row.status, decidedByName: row.decidedByName, decisionNote: row.decisionNote, canDecide: row.status === "pending" && canDecide(member, allowed, row.memberId) })),
      me: { id: member.id, manageable: allowed },
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
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active || member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const allowed = await manageableIds(db, member);
    const today = todayInSaoPaulo();

    if (action === "addAbsence") {
      const memberId = Number(body.memberId ?? member.id);
      const kind = body.kind;
      const startDate = String(body.startDate ?? "");
      const endDate = String(body.endDate ?? startDate);
      const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
      if (!isAbsenceKind(kind)) return json({ error: "Escolha o tipo de ausência." }, 400);
      const rangeError = absenceRangeError(startDate, endDate, today);
      if (rangeError) return json({ error: rangeError }, 400);
      if (!canManage(allowed, memberId)) return json({ error: "Você só pode registrar as suas ausências (ou as do time que você lidera)." }, 403);
      const [person] = await db.select({ id: members.id, name: members.name, active: members.active }).from(members).where(eq(members.id, memberId)).limit(1);
      if (!person || !person.active) return json({ error: "Escolha uma pessoa ativa." }, 400);
      const existing = await db.select().from(absences).where(and(eq(absences.memberId, memberId), ne(absences.status, "rejected")));
      const clash = existing.find((row) => rangesOverlap(row, { startDate, endDate }));
      if (clash) return json({ error: `${person.name} já tem ${absenceKindLabels[clash.kind].toLowerCase()} ${clash.status === "pending" ? "pedida" : "registrada"} de ${clash.startDate.split("-").reverse().join("/")} a ${clash.endDate.split("-").reverse().join("/")}. Exclua ou ajuste aquela antes.` }, 409);
      // Administrador, ou líder registrando para alguém do time: já vale. A própria pessoa: vira pedido para o líder aprovar.
      const approved = canDecide(member, allowed, memberId);
      const now = new Date().toISOString();
      const [created] = await db.insert(absences).values({ memberId, kind, startDate, endDate, note, createdById: member.id, createdByName: member.name, createdAt: now, status: approved ? "approved" : "pending", decidedByName: approved ? member.name : null, decidedAt: approved ? now : null }).returning();
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: approved ? "absence_created" : "absence_requested", targetType: "member", targetId: memberId, details: `${person.name}: ${absenceKindLabels[kind]} ${startDate} a ${endDate}` }).catch((error) => console.error("audit log failed", error));
      if (!approved) await notify(db, await approversOf(db, memberId), "absence_request", member.name, `${absenceKindLabels[kind].toLowerCase()} (${shortRange({ startDate, endDate })}). Aprove em Pessoas → Férias e ausências.`).catch((error) => console.error("absence notify failed", error));
      return json({ absence: created, pending: !approved }, 201);
    }

    if (action === "decideAbsence") {
      const absenceId = Number(body.absenceId);
      const approve = body.approve === true;
      const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
      const [row] = await db.select().from(absences).where(eq(absences.id, absenceId)).limit(1);
      if (!row) return json({ error: "Pedido não encontrado." }, 404);
      if (row.status !== "pending") return json({ error: "Este pedido já foi decidido." }, 409);
      if (!canDecide(member, allowed, row.memberId)) return json({ error: "Só o líder do time ou um administrador decide este pedido." }, 403);
      await db.update(absences).set({ status: approve ? "approved" : "rejected", decidedByName: member.name, decidedAt: new Date().toISOString(), decisionNote: note }).where(and(eq(absences.id, absenceId), eq(absences.status, "pending")));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: approve ? "absence_approved" : "absence_rejected", targetType: "member", targetId: row.memberId, details: `${absenceKindLabels[row.kind]} ${row.startDate} a ${row.endDate}` }).catch((error) => console.error("audit log failed", error));
      const text = `${member.name} ${approve ? "aprovou" : "recusou"} seu pedido: ${describeAbsence(row, today).toLowerCase()}${note ? `. "${note}"` : "."}`;
      await notify(db, [row.memberId, ...(row.createdById && row.createdById !== row.memberId ? [row.createdById] : [])], "absence_decision", member.name, text).catch((error) => console.error("absence notify failed", error));
      return json({ ok: true });
    }

    if (action === "deleteAbsence") {
      const absenceId = Number(body.absenceId);
      const [row] = await db.select().from(absences).where(eq(absences.id, absenceId)).limit(1);
      if (!row) return json({ error: "Ausência não encontrada." }, 404);
      if (!canManage(allowed, row.memberId) && row.createdById !== member.id) return json({ error: "Você não pode excluir esta ausência." }, 403);
      await db.delete(absences).where(eq(absences.id, absenceId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: row.status === "pending" ? "absence_request_canceled" : "absence_deleted", targetType: "member", targetId: row.memberId, details: `${absenceKindLabels[row.kind]} ${row.startDate} a ${row.endDate}` }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
