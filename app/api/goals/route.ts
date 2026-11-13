import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { goals, goalUpdates, members, notifications, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { parseGoalNumber } from "../../review-tools";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("goals request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as metas. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** Times que a pessoa lidera e quem está neles: define quem ela pode ver e gerenciar. */
async function scopeOf(db: Db, memberId: number, isAdmin: boolean) {
  const memberships = await db.select({ memberId: teamMembers.memberId, teamId: teamMembers.teamId, isLead: teamMembers.isLead }).from(teamMembers);
  const ledTeams = isAdmin ? null : new Set(memberships.filter((row) => row.memberId === memberId && row.isLead).map((row) => row.teamId));
  const canManageTeam = (teamId: number | null) => isAdmin || (teamId !== null && Boolean(ledTeams?.has(teamId)));
  const canManagePerson = (personId: number | null) => isAdmin || (personId !== null && memberships.some((row) => row.memberId === personId && ledTeams?.has(row.teamId)));
  // Meta individual: a própria pessoa, os líderes dos times dela e administradores.
  const canSeePerson = (personId: number | null) => personId === memberId || canManagePerson(personId);
  return { memberships, ledTeams, canManageTeam, canManagePerson, canSeePerson };
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const year = Number(new URL(request.url).searchParams.get("year")) || Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 4));
    const scope = await scopeOf(db, member.id, isAdmin);
    const [rows, teamRows, people] = await Promise.all([
      db.select().from(goals).where(eq(goals.year, year)).orderBy(asc(goals.scope), asc(goals.title)),
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
    ]);
    const visible = rows.filter((goal) => goal.scope === "team" || scope.canSeePerson(goal.memberId));
    const history = visible.length ? await db.select().from(goalUpdates).where(inArray(goalUpdates.goalId, visible.map((goal) => goal.id))).orderBy(desc(goalUpdates.at)) : [];
    return json({
      year,
      goals: visible.map((goal) => ({ ...goal, canManage: goal.scope === "team" ? scope.canManageTeam(goal.teamId) : scope.canManagePerson(goal.memberId), updates: history.filter((update) => update.goalId === goal.id).slice(0, 12) })),
      teams: teamRows,
      // Quem a pessoa pode receber meta: administradores, todos; líderes, quem está nos times que lideram.
      people: people.filter((person) => scope.canManagePerson(person.id) || person.id === member.id),
      me: { id: member.id, isAdmin, ledTeamIds: isAdmin ? teamRows.map((team) => team.id) : [...(scope.ledTeams ?? [])], canManageSomeone: isAdmin || Boolean(scope.ledTeams?.size) },
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
    const isAdmin = member.role === "admin";
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const scope = await scopeOf(db, member.id, isAdmin);
    const allowed = (goal: { scope: string; teamId: number | null; memberId: number | null }) => goal.scope === "team" ? scope.canManageTeam(goal.teamId) : scope.canManagePerson(goal.memberId);
    const denied = () => json({ error: "Só os líderes do time e administradores definem e atualizam estas metas." }, 403);

    if (action === "saveGoal") {
      const goalId = Number(body.goalId) || 0;
      const year = Number(body.year);
      const kind: "person" | "team" | null = body.scope === "person" ? "person" : body.scope === "team" ? "team" : null;
      const teamId = kind === "team" ? Number(body.teamId) || null : null;
      const memberId = kind === "person" ? Number(body.memberId) || null : null;
      const title = cleanTitle(body.title).slice(0, 120);
      const target = parseGoalNumber(body.target);
      const startValue = parseGoalNumber(body.startValue) ?? 0;
      if (!kind) return json({ error: "Escolha se a meta é do time ou individual." }, 400);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ error: "Ano inválido." }, 400);
      if (!title) return json({ error: "Descreva a meta." }, 400);
      if (target === null) return json({ error: "Informe o valor-alvo em número." }, 400);
      if (kind === "team" && !teamId) return json({ error: "Escolha o time." }, 400);
      if (kind === "person" && !memberId) return json({ error: "Escolha a pessoa." }, 400);
      if (!allowed({ scope: kind, teamId, memberId })) return denied();
      const values = { year, scope: kind, teamId, memberId, title, description: cleanMultiline(body.description, 1000), unit: cleanTitle(body.unit).slice(0, 20), direction: body.direction === "down" ? "down" as const : "up" as const, startValue, target, updatedAt: now };
      if (goalId) {
        const [current] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
        if (!current) return json({ error: "Meta não encontrada." }, 404);
        if (!allowed(current)) return denied();
        await db.update(goals).set(values).where(eq(goals.id, goalId));
        return json({ ok: true });
      }
      const [goal] = await db.insert(goals).values({ ...values, current: startValue, createdByName: member.name, createdAt: now }).returning({ id: goals.id });
      return json({ id: goal.id }, 201);
    }

    const [goal] = await db.select().from(goals).where(eq(goals.id, Number(body.goalId))).limit(1);
    if (!goal) return json({ error: "Meta não encontrada." }, 404);
    if (!allowed(goal)) return denied();

    if (action === "updateProgress") {
      const value = parseGoalNumber(body.value);
      if (value === null) return json({ error: "Informe o valor atual em número." }, 400);
      const note = cleanMultiline(body.note, 300);
      await db.batch([
        db.update(goals).set({ current: value, updatedAt: now }).where(eq(goals.id, goal.id)),
        db.insert(goalUpdates).values({ goalId: goal.id, value, note, byName: member.name, at: now }),
      ]);
      // Meta individual atualizada pelo líder: a pessoa fica sabendo.
      if (goal.scope === "person" && goal.memberId && goal.memberId !== member.id) {
        await db.insert(notifications).values({ memberId: goal.memberId, kind: "goal_update", actorName: member.name, body: `${goal.title}: agora ${value}${goal.unit ? ` ${goal.unit}` : ""} (meta ${goal.target})`.slice(0, 140), createdAt: now }).catch((error) => console.error("goal notification failed", error));
      }
      return json({ ok: true });
    }

    if (action === "deleteGoal") {
      await db.delete(goals).where(and(eq(goals.id, goal.id)));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
