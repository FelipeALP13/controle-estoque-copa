import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { announcementReads, announcements, members, teamMembers } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { isNoticeActive, MAX_NOTICE_BODY, MAX_NOTICE_TITLE, sortNotices } from "../../knowledge";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("announcements request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem o mural. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Publicam no mural: administradores e quem lidera algum time. */
async function canPost(db: Db, member: SessionMember) {
  if (member.role === "admin") return true;
  if (member.role === "viewer" || !member.active) return false;
  try {
    const [lead] = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(and(eq(teamMembers.memberId, member.id), eq(teamMembers.isLead, true))).limit(1);
    return Boolean(lead);
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    const today = todayInSaoPaulo();
    const rows = (await db.select().from(announcements)).filter((row) => isNoticeActive(row, today));
    const ids = rows.map((row) => row.id);
    const [reads, people, poster] = await Promise.all([
      ids.length ? db.select().from(announcementReads).where(inArray(announcementReads.announcementId, ids)) : Promise.resolve([]),
      db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)),
      canPost(db, member),
    ]);
    const isAdmin = member.role === "admin";
    return json({
      notices: sortNotices(rows).map((row) => {
        const readers = new Set(reads.filter((read) => read.announcementId === row.id).map((read) => read.memberId));
        // Quem publicou e os administradores veem quem ainda não leu.
        const manager = isAdmin || row.createdById === member.id;
        const audience = people.filter((person) => person.id !== row.createdById);
        return {
          id: row.id, title: row.title, body: row.body, important: row.important, expiresOn: row.expiresOn,
          createdByName: row.createdByName, createdAt: row.createdAt,
          readByMe: readers.has(member.id) || row.createdById === member.id,
          readCount: audience.filter((person) => readers.has(person.id)).length,
          audience: audience.length,
          pending: manager ? audience.filter((person) => !readers.has(person.id)).map((person) => person.name).sort((a, b) => a.localeCompare(b, "pt-BR")) : null,
          canDelete: manager,
        };
      }),
      me: { id: member.id, canPost: poster },
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
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "markRead") {
      const noticeId = Number(body.noticeId);
      const [notice] = await db.select({ id: announcements.id }).from(announcements).where(eq(announcements.id, noticeId)).limit(1);
      if (!notice) return json({ error: "Aviso não encontrado." }, 404);
      await db.insert(announcementReads).values({ announcementId: noticeId, memberId: member.id, readAt: now }).onConflictDoNothing();
      return json({ ok: true });
    }

    if (action === "createNotice") {
      if (!(await canPost(db, member))) return json({ error: "Só administradores e líderes de time publicam no mural." }, 403);
      const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTICE_TITLE);
      const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_NOTICE_BODY);
      const expiresOn = body.expiresOn ? String(body.expiresOn) : null;
      if (!title) return json({ error: "Dê um título ao aviso." }, 400);
      if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || expiresOn < todayInSaoPaulo())) return json({ error: "A data de validade precisa ser hoje ou depois." }, 400);
      const [notice] = await db.insert(announcements).values({ title, body: text, important: body.important === true, expiresOn, createdById: member.id, createdByName: member.name, createdAt: now }).returning();
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "announcement_created", targetType: "announcement", targetId: notice.id, details: title }).catch((error) => console.error("audit log failed", error));
      return json({ notice }, 201);
    }

    if (action === "deleteNotice") {
      const noticeId = Number(body.noticeId);
      const [notice] = await db.select().from(announcements).where(eq(announcements.id, noticeId)).limit(1);
      if (!notice) return json({ error: "Aviso não encontrado." }, 404);
      if (member.role !== "admin" && notice.createdById !== member.id) return json({ error: "Só quem publicou ou um administrador pode tirar o aviso." }, 403);
      await db.delete(announcements).where(eq(announcements.id, noticeId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "announcement_deleted", targetType: "announcement", targetId: noticeId, details: notice.title }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
