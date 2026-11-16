import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { goalItems, goals, goalUpdates, members, notifications, tasks, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { parseGoalItems, parseGoalNumber, syncGoalItems } from "../../review-tools";
import { refreshGoalPercents } from "../../goal-sync";
import { taskCode } from "../../tasks";

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
  // Marcar itens do checklist: quem gerencia, a própria pessoa (meta individual) e quem é do time (meta do time).
  const canCheck = (goal: { scope: string; teamId: number | null; memberId: number | null }) => goal.scope === "team"
    ? canManageTeam(goal.teamId) || memberships.some((row) => row.memberId === memberId && row.teamId === goal.teamId)
    : canManagePerson(goal.memberId) || goal.memberId === memberId;
  return { memberships, ledTeams, canManageTeam, canManagePerson, canSeePerson, canCheck };
}

/** Recalcula a % da meta pelo checklist e grava. */
async function refreshChecklist(db: Db, goalId: number, now: string) {
  return (await refreshGoalPercents(db, [goalId], now)).get(goalId) ?? 0;
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
    const items = visible.some((goal) => goal.mode === "checklist") ? await db.select({ id: goalItems.id, goalId: goalItems.goalId, text: goalItems.text, done: goalItems.done, doneByName: goalItems.doneByName, doneAt: goalItems.doneAt, taskId: goalItems.taskId, taskTitle: tasks.title, taskStatus: tasks.status }).from(goalItems).leftJoin(tasks, eq(tasks.id, goalItems.taskId)).where(inArray(goalItems.goalId, visible.filter((goal) => goal.mode === "checklist").map((goal) => goal.id))).orderBy(asc(goalItems.sortOrder), asc(goalItems.id)) : [];
    return json({
      year,
      goals: visible.map((goal) => ({ ...goal, canManage: goal.scope === "team" ? scope.canManageTeam(goal.teamId) : scope.canManagePerson(goal.memberId), canCheck: member.role !== "viewer" && scope.canCheck(goal), items: items.filter((item) => item.goalId === goal.id).map((item) => ({ id: item.id, text: item.text, done: item.done, doneByName: item.doneByName, doneAt: item.doneAt, task: item.taskId ? { id: item.taskId, code: taskCode(item.taskId), title: item.taskTitle ?? "", status: item.taskStatus ?? "" } : null })), updates: history.filter((update) => update.goalId === goal.id).slice(0, 12) })),
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
      const mode = body.mode === "checklist" ? "checklist" as const : "number" as const;
      const itemTexts = mode === "checklist" ? parseGoalItems(body.items) : [];
      const target = mode === "checklist" ? 100 : parseGoalNumber(body.target);
      const startValue = mode === "checklist" ? 0 : parseGoalNumber(body.startValue) ?? 0;
      if (!kind) return json({ error: "Escolha se a meta é do time ou individual." }, 400);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ error: "Ano inválido." }, 400);
      if (!title) return json({ error: "Descreva a meta." }, 400);
      if (target === null) return json({ error: "Informe o valor-alvo em número." }, 400);
      if (mode === "checklist" && !itemTexts.length) return json({ error: "Escreva pelo menos um item do checklist." }, 400);
      if (kind === "team" && !teamId) return json({ error: "Escolha o time." }, 400);
      if (kind === "person" && !memberId) return json({ error: "Escolha a pessoa." }, 400);
      if (!allowed({ scope: kind, teamId, memberId })) return denied();
      const values = { year, scope: kind, teamId, memberId, title, description: cleanMultiline(body.description, 1000), unit: mode === "checklist" ? "%" : cleanTitle(body.unit).slice(0, 20), direction: mode === "checklist" ? "up" as const : body.direction === "down" ? "down" as const : "up" as const, startValue, target, mode, updatedAt: now };
      if (goalId) {
        const [current] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
        if (!current) return json({ error: "Meta não encontrada." }, 404);
        if (!allowed(current)) return denied();
        await db.update(goals).set(values).where(eq(goals.id, goalId));
        if (mode === "checklist") {
          const existing = await db.select({ id: goalItems.id, text: goalItems.text }).from(goalItems).where(eq(goalItems.goalId, goalId));
          const sync = syncGoalItems(existing, itemTexts);
          if (sync.remove.length) await db.delete(goalItems).where(and(eq(goalItems.goalId, goalId), inArray(goalItems.id, sync.remove)));
          for (const item of sync.keep) await db.update(goalItems).set({ sortOrder: item.sortOrder }).where(eq(goalItems.id, item.id));
          if (sync.add.length) await db.insert(goalItems).values(sync.add.map((item) => ({ goalId, text: item.text, sortOrder: item.sortOrder })));
          await refreshChecklist(db, goalId, now);
        } else if (current.mode === "checklist") {
          // Deixou de ser checklist: os itens saem e o valor volta a ser digitado.
          await db.delete(goalItems).where(eq(goalItems.goalId, goalId));
        }
        return json({ ok: true });
      }
      const [goal] = await db.insert(goals).values({ ...values, current: startValue, createdByName: member.name, createdAt: now }).returning({ id: goals.id });
      if (itemTexts.length) await db.insert(goalItems).values(itemTexts.map((text, index) => ({ goalId: goal.id, text, sortOrder: index })));
      return json({ id: goal.id }, 201);
    }

    const [goal] = await db.select().from(goals).where(eq(goals.id, Number(body.goalId))).limit(1);
    if (!goal) return json({ error: "Meta não encontrada." }, 404);

    // Marcar/desmarcar um item: a % da meta sobe ou desce sozinha.
    if (action === "toggleItem") {
      if (!scope.canSeePerson(goal.memberId) && goal.scope === "person") return json({ error: "Meta não encontrada." }, 404);
      if (!scope.canCheck(goal)) return json({ error: "Só quem é da meta (a pessoa ou o time), os líderes e administradores marcam os itens." }, 403);
      const [item] = await db.select().from(goalItems).where(and(eq(goalItems.id, Number(body.itemId)), eq(goalItems.goalId, goal.id))).limit(1);
      if (!item) return json({ error: "Item não encontrado." }, 404);
      if (item.taskId) return json({ error: `Este item é marcado sozinho quando a demanda ${taskCode(item.taskId)} for concluída.` }, 400);
      const done = body.done === true;
      if (item.done === done) return json({ ok: true, percent: goal.current });
      await db.update(goalItems).set({ done, doneByName: done ? member.name : null, doneAt: done ? now : null }).where(eq(goalItems.id, item.id));
      const percent = await refreshChecklist(db, goal.id, now);
      await db.insert(goalUpdates).values({ goalId: goal.id, value: percent, note: `${done ? "Concluiu" : "Reabriu"}: ${item.text}`.slice(0, 300), byName: member.name, at: now });
      if (goal.scope === "person" && goal.memberId && goal.memberId !== member.id) {
        await db.insert(notifications).values({ memberId: goal.memberId, kind: "goal_update", actorName: member.name, body: `${goal.title}: ${done ? "concluiu" : "reabriu"} “${item.text}” (${percent}%)`.slice(0, 140), createdAt: now }).catch((error) => console.error("goal notification failed", error));
      }
      return json({ ok: true, percent });
    }

    if (!allowed(goal)) return denied();

    // Ligar um item do checklist a uma demanda (ou desligar com taskId nulo).
    if (action === "linkItemTask") {
      const [item] = await db.select().from(goalItems).where(and(eq(goalItems.id, Number(body.itemId)), eq(goalItems.goalId, goal.id))).limit(1);
      if (!item) return json({ error: "Item não encontrado." }, 404);
      const taskId = body.taskId === null || body.taskId === "" ? null : Number(body.taskId);
      if (taskId === null) {
        await db.update(goalItems).set({ taskId: null }).where(eq(goalItems.id, item.id));
        return json({ ok: true });
      }
      const [task] = Number.isInteger(taskId) ? await db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(eq(tasks.id, taskId)).limit(1) : [];
      if (!task) return json({ error: "Demanda não encontrada." }, 404);
      // Já concluída: o item fica marcado agora; aberta: o item volta a aberto e espera a demanda.
      const done = task.status === "done";
      await db.update(goalItems).set({ taskId: task.id, done, doneByName: done ? member.name : null, doneAt: done ? now : null }).where(eq(goalItems.id, item.id));
      const percent = await refreshChecklist(db, goal.id, now);
      if (done !== item.done) await db.insert(goalUpdates).values({ goalId: goal.id, value: percent, note: `${done ? "Concluiu" : "Reabriu"} pela demanda ${taskCode(task.id)}: ${item.text}`.slice(0, 300), byName: member.name, at: now });
      return json({ ok: true, percent });
    }

    if (action === "updateProgress") {
      if (goal.mode === "checklist") return json({ error: "Esta meta é medida pelo checklist: marque os itens concluídos." }, 400);
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
