import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { handoffReads, handoffs, members, notifications, supportTeams, supportWeeks, teams, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline } from "../../tasks";
import { handoffWeeks, MAX_HANDOFF } from "../../team-tools";
import { isSupportTeamName, matchScheduleNames } from "../../ticket-routing";
import { snippet } from "../../notifications";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("handoffs request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a passagem de plantão. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function parseNames(value: string) {
  try { const list = JSON.parse(value) as unknown; return Array.isArray(list) ? list.map(String) : []; } catch { return []; }
}

/** Semana que passa o plantão e a que recebe, com o nome e as pessoas de cada equipe. */
async function schedule(db: Db) {
  const [weekRows, teamRows] = await Promise.all([
    db.select({ id: supportWeeks.id, start: supportWeeks.startDate, end: supportWeeks.endDate, teamId: supportWeeks.teamId }).from(supportWeeks),
    db.select().from(supportTeams),
  ]);
  const { from, to } = handoffWeeks(weekRows, todayInSaoPaulo());
  const describe = (week: typeof from) => {
    if (!week) return null;
    const team = teamRows.find((entry) => entry.id === week.teamId);
    return { weekId: week.id, start: week.start, end: week.end, teamName: team?.name ?? "Equipe", color: team?.color ?? "purple", members: parseNames(team?.members ?? "[]") };
  };
  return { from: describe(from), to: describe(to) };
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);

    const [weeks, rows, teamRows] = await Promise.all([
      schedule(db),
      db.select().from(handoffs).orderBy(desc(handoffs.createdAt), desc(handoffs.id)).limit(6),
      db.select({ id: teams.id, name: teams.name }).from(teams),
    ]);
    const reads = rows.length ? await db.select({ handoffId: handoffReads.handoffId, memberId: handoffReads.memberId, name: members.name, readAt: handoffReads.readAt }).from(handoffReads).innerJoin(members, eq(handoffReads.memberId, members.id)).where(inArray(handoffReads.handoffId, rows.map((row) => row.id))) : [];
    // Chamados do Suporte ainda em aberto, para ajudar a escrever a passagem.
    const supportIds = teamRows.filter((team) => isSupportTeamName(team.name)).map((team) => team.id);
    const open = supportIds.length ? await db.select({ id: tickets.id, title: tickets.title, status: tickets.status, urgency: tickets.urgency, client: tickets.client, assigneeId: tickets.assigneeId }).from(tickets).where(and(inArray(tickets.teamId, supportIds), inArray(tickets.status, ["open", "in_progress", "waiting"]))).orderBy(desc(tickets.createdAt)).limit(40) : [];
    const names = open.length ? await db.select({ id: members.id, name: members.name }).from(members) : [];

    return json({
      ...weeks,
      handoffs: rows.map((row) => ({
        id: row.id, teamName: row.teamName, body: row.body, createdByName: row.createdByName, createdAt: row.createdAt,
        canDelete: member.role === "admin" || row.createdById === member.id,
        readBy: reads.filter((read) => read.handoffId === row.id && read.memberId !== row.createdById).map((read) => read.name),
        readByMe: row.createdById === member.id || reads.some((read) => read.handoffId === row.id && read.memberId === member.id),
      })),
      openTickets: open.map((ticket) => ({ ...ticket, assigneeName: names.find((person) => person.id === ticket.assigneeId)?.name ?? null })),
      me: { id: member.id, canWrite: member.role !== "viewer" },
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
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "markRead") {
      const handoffId = Number(body.handoffId);
      const [row] = handoffId ? await db.select({ id: handoffs.id }).from(handoffs).where(eq(handoffs.id, handoffId)).limit(1) : [];
      if (!row) return json({ error: "Passagem não encontrada." }, 404);
      await db.insert(handoffReads).values({ handoffId, memberId: member.id, readAt: now }).onConflictDoNothing();
      return json({ ok: true });
    }

    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);

    if (action === "createHandoff") {
      const text = cleanMultiline(body.body, MAX_HANDOFF);
      if (!text) return json({ error: "Escreva o que fica para a próxima equipe." }, 400);
      const { from, to } = await schedule(db);
      const [row] = await db.insert(handoffs).values({ weekId: from?.weekId ?? null, teamName: from?.teamName ?? "", body: text, createdById: member.id, createdByName: member.name, createdAt: now }).returning();
      await db.insert(handoffReads).values({ handoffId: row.id, memberId: member.id, readAt: now }).onConflictDoNothing();
      // Avisa no sino quem está na equipe da próxima semana (nomes da escala ligados às pessoas do Portal).
      let notified = 0;
      if (to) {
        const people = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true));
        const targets = matchScheduleNames(to.members, people).filter((person) => person.id !== member.id);
        if (targets.length) {
          try {
            await db.insert(notifications).values(targets.map((person) => ({ memberId: person.id, kind: "handoff" as const, actorName: member.name, body: snippet(text), createdAt: now })));
            notified = targets.length;
          } catch (error) {
            console.error("handoff notification failed", error);
          }
        }
      }
      return json({ id: row.id, notified, toTeam: to?.teamName ?? null }, 201);
    }

    if (action === "deleteHandoff") {
      const [row] = await db.select().from(handoffs).where(eq(handoffs.id, Number(body.handoffId))).limit(1);
      if (!row) return json({ error: "Passagem não encontrada." }, 404);
      if (member.role !== "admin" && row.createdById !== member.id) return json({ error: "Só quem escreveu ou um administrador pode excluir." }, 403);
      await db.delete(handoffs).where(eq(handoffs.id, row.id));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
