// Daily assíncrona: cada pessoa responde "ontem / hoje / bloqueios" uma vez por dia; o time vê tudo junto.
// Bloqueio novo avisa os líderes dos times da pessoa (ou os administradores, se não houver líder).
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, notifications, standups, teamMembers } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;
const MAX_STANDUP_TEXT = 600;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const clean = (value: unknown) => String(value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_STANDUP_TEXT);

async function leadsOf(db: Db, memberId: number) {
  const teams = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, memberId));
  const leads = teams.length ? await db.selectDistinct({ id: teamMembers.memberId }).from(teamMembers).where(and(inArray(teamMembers.teamId, teams.map((row) => row.teamId)), eq(teamMembers.isLead, true))) : [];
  const ids = leads.map((row) => row.id).filter((id) => id !== memberId);
  if (ids.length) return ids;
  const admins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true), ne(members.id, memberId)));
  return admins.map((row) => row.id);
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const day = todayInSaoPaulo();
    const entries = await db.select({ memberId: standups.memberId, yesterday: standups.yesterday, today: standups.today, blockers: standups.blockers, updatedAt: standups.updatedAt, name: members.name })
      .from(standups).innerJoin(members, eq(members.id, standups.memberId)).where(eq(standups.day, day)).orderBy(desc(standups.updatedAt));
    const team = await db.select({ id: members.id, name: members.name, role: members.role }).from(members).where(eq(members.active, true));
    // Para preencher "ontem": o que a pessoa disse que faria na última daily.
    const [previous] = await db.select({ today: standups.today, day: standups.day }).from(standups).where(and(eq(standups.memberId, member.id), lt(standups.day, day))).orderBy(desc(standups.day)).limit(1);
    return json({
      day,
      canWrite: member.role !== "viewer",
      mine: entries.find((entry) => entry.memberId === member.id) ?? null,
      previousPlan: previous?.today ?? "",
      entries,
      missing: team.filter((person) => person.role !== "viewer" && !entries.some((entry) => entry.memberId === person.id)).map((person) => ({ id: person.id, name: person.name })),
    });
  } catch (error) {
    console.error("standups request failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return json({ error: "O banco ainda não tem a daily. Publique novamente para aplicar as migrações." }, 500);
    return json({ error: "Não foi possível carregar a daily agora." }, 500);
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
    if (body.action !== "save") return json({ error: "Ação desconhecida." }, 400);
    const entry = { yesterday: clean(body.yesterday), today: clean(body.today), blockers: clean(body.blockers) };
    if (!entry.today) return json({ error: "Conte o que você vai fazer hoje." }, 400);
    const day = todayInSaoPaulo();
    const now = new Date().toISOString();
    const [before] = await db.select({ blockers: standups.blockers }).from(standups).where(and(eq(standups.memberId, member.id), eq(standups.day, day))).limit(1);
    await db.insert(standups).values({ memberId: member.id, day, ...entry, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [standups.memberId, standups.day], set: { ...entry, updatedAt: now } });
    // Bloqueio novo (ou mudado): avisa quem pode ajudar a destravar.
    if (entry.blockers && entry.blockers !== (before?.blockers ?? "")) {
      const ids = await leadsOf(db, member.id);
      if (ids.length) await db.insert(notifications).values(ids.map((memberId) => ({ memberId, kind: "standup_blocker" as const, actorName: member.name, body: `${member.name} está com um bloqueio: ${entry.blockers.slice(0, 200)}`, createdAt: now }))).catch((error) => console.error("standup notify failed", error));
    }
    return json({ ok: true });
  } catch (error) {
    console.error("standups request failed", error);
    return json({ error: "Não foi possível salvar a daily agora." }, 500);
  }
}
