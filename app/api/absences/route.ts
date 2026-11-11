import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { absences, members, teamMembers } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { absenceKindLabels, absenceRangeError, isAbsenceKind, MAX_NOTE, rangesOverlap } from "../../absences";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("absences request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem as ausências. Publique novamente para aplicar as migrações." }, 500);
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
    return json({
      people,
      absences: rows.map((row) => ({ id: row.id, memberId: row.memberId, kind: row.kind, startDate: row.startDate, endDate: row.endDate, note: row.note, createdByName: row.createdByName, canDelete: canManage(allowed, row.memberId) || row.createdById === member.id })),
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
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const allowed = await manageableIds(db, member);

    if (action === "addAbsence") {
      const memberId = Number(body.memberId ?? member.id);
      const kind = body.kind;
      const startDate = String(body.startDate ?? "");
      const endDate = String(body.endDate ?? startDate);
      const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
      if (!isAbsenceKind(kind)) return json({ error: "Escolha o tipo de ausência." }, 400);
      const rangeError = absenceRangeError(startDate, endDate, todayInSaoPaulo());
      if (rangeError) return json({ error: rangeError }, 400);
      if (!canManage(allowed, memberId)) return json({ error: "Você só pode registrar as suas ausências (ou as do time que você lidera)." }, 403);
      const [person] = await db.select({ id: members.id, name: members.name, active: members.active }).from(members).where(eq(members.id, memberId)).limit(1);
      if (!person || !person.active) return json({ error: "Escolha uma pessoa ativa." }, 400);
      const existing = await db.select().from(absences).where(eq(absences.memberId, memberId));
      const clash = existing.find((row) => rangesOverlap(row, { startDate, endDate }));
      if (clash) return json({ error: `${person.name} já tem ${absenceKindLabels[clash.kind].toLowerCase()} registrada de ${clash.startDate.split("-").reverse().join("/")} a ${clash.endDate.split("-").reverse().join("/")}. Exclua ou ajuste aquela antes.` }, 409);
      const [created] = await db.insert(absences).values({ memberId, kind, startDate, endDate, note, createdById: member.id, createdByName: member.name, createdAt: new Date().toISOString() }).returning();
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "absence_created", targetType: "member", targetId: memberId, details: `${person.name}: ${absenceKindLabels[kind]} ${startDate} a ${endDate}` }).catch((error) => console.error("audit log failed", error));
      return json({ absence: created }, 201);
    }

    if (action === "deleteAbsence") {
      const absenceId = Number(body.absenceId);
      const [row] = await db.select().from(absences).where(eq(absences.id, absenceId)).limit(1);
      if (!row) return json({ error: "Ausência não encontrada." }, 404);
      if (!canManage(allowed, row.memberId) && row.createdById !== member.id) return json({ error: "Você não pode excluir esta ausência." }, 403);
      await db.delete(absences).where(eq(absences.id, absenceId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "absence_deleted", targetType: "member", targetId: row.memberId, details: `${absenceKindLabels[row.kind]} ${row.startDate} a ${row.endDate}` }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
