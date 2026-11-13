import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { cleanPhone, cleanText, isTeamColor, normalizeMembership } from "../../teams";
import { readJsonBody } from "../../api-input";
import { isBirthday, isStartDate } from "../../team-tools";

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("people request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as tabelas de times. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";

    const [people, teamRows, memberships] = await Promise.all([
      db.select({ id: members.id, name: members.name, email: members.email, role: members.role, active: members.active, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, jobTitle: members.jobTitle, phone: members.phone, birthday: members.birthday, startedOn: members.startedOn })
        .from(members).orderBy(asc(members.name)),
      db.select().from(teams).orderBy(asc(teams.name)),
      db.select().from(teamMembers),
    ]);

    return json({
      // Pessoas desativadas só aparecem para administradores.
      people: people.filter((person) => person.active || isAdmin),
      teams: teamRows.map((team) => ({ ...team, members: memberships.filter((row) => row.teamId === team.id).map((row) => ({ memberId: row.memberId, isLead: row.isLead })) })),
      me: { id: member.id, isAdmin },
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
    const isAdmin = member.role === "admin";
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const audit = (action: string, targetId: number, details: string) => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action, targetType: "team", targetId, details }).catch((error) => console.error("audit log failed", error));

    if (action === "updatePerson") {
      const personId = Number(body.memberId);
      if (personId !== member.id && !isAdmin) return json({ error: "Você só pode editar o seu próprio perfil." }, 403);
      const [person] = await db.select({ id: members.id }).from(members).where(eq(members.id, personId)).limit(1);
      if (!person) return json({ error: "Pessoa não encontrada." }, 404);
      const changes: Partial<typeof members.$inferInsert> = { jobTitle: cleanText(body.jobTitle, 60), phone: cleanPhone(body.phone) };
      // Aniversário (sem o ano) e data de entrada: opcionais; vazio apaga.
      if ("birthday" in body) {
        if (body.birthday === null || body.birthday === "") changes.birthday = null;
        else if (isBirthday(body.birthday)) changes.birthday = body.birthday;
        else return json({ error: "Informe o dia e o mês do aniversário." }, 400);
      }
      if ("startedOn" in body) {
        if (body.startedOn === null || body.startedOn === "") changes.startedOn = null;
        else if (isStartDate(body.startedOn, todayInSaoPaulo())) changes.startedOn = body.startedOn;
        else return json({ error: "Informe uma data de entrada válida (não pode ser no futuro)." }, 400);
      }
      await db.update(members).set(changes).where(eq(members.id, personId));

      // Só administradores mudam os times de alguém.
      if (isAdmin && Array.isArray(body.teamIds)) {
        const validTeams = new Set((await db.select({ id: teams.id }).from(teams)).map((team) => team.id));
        const wanted = new Set(body.teamIds.map(Number).filter((id) => validTeams.has(id)));
        const current = await db.select().from(teamMembers).where(eq(teamMembers.memberId, personId));
        const toRemove = current.filter((row) => !wanted.has(row.teamId));
        const toAdd = [...wanted].filter((teamId) => !current.some((row) => row.teamId === teamId));
        for (const row of toRemove) await db.delete(teamMembers).where(and(eq(teamMembers.teamId, row.teamId), eq(teamMembers.memberId, personId)));
        if (toAdd.length) await db.insert(teamMembers).values(toAdd.map((teamId) => ({ teamId, memberId: personId, isLead: false })));
      }
      return json({ ok: true });
    }

    if (!isAdmin) return json({ error: "Somente administradores podem gerenciar os times." }, 403);

    if (action === "saveTeam") {
      const teamId = Number(body.teamId) || 0;
      const name = cleanText(body.name, 40);
      const color = String(body.color ?? "blue");
      if (!name) return json({ error: "Informe o nome do time." }, 400);
      if (!isTeamColor(color)) return json({ error: "Escolha uma cor válida." }, 400);
      const activeIds = new Set((await db.select({ id: members.id }).from(members).where(eq(members.active, true))).map((row) => row.id));
      const membership = normalizeMembership(body.members, activeIds);
      const values = { name, color, description: cleanText(body.description, 200) };
      const [team] = teamId
        ? await db.update(teams).set(values).where(eq(teams.id, teamId)).returning()
        : await db.insert(teams).values(values).returning();
      if (!team) return json({ error: "Time não encontrado." }, 404);
      await db.delete(teamMembers).where(eq(teamMembers.teamId, team.id));
      if (membership.length) await db.insert(teamMembers).values(membership.map((row) => ({ teamId: team.id, ...row })));
      await audit(teamId ? "team_updated" : "team_created", team.id, `${name}: ${membership.length} integrantes`);
      return json({ team }, teamId ? 200 : 201);
    }

    if (action === "deleteTeam") {
      const teamId = Number(body.teamId);
      const [deleted] = await db.delete(teams).where(eq(teams.id, teamId)).returning();
      if (!deleted) return json({ error: "Time não encontrado." }, 404);
      await audit("team_deleted", deleted.id, deleted.name);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
