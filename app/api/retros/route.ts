import { and, asc, desc, eq, inArray, min } from "drizzle-orm";
import { getDb } from "../../../db";
import { retroItems, retros, retroVotes, sprints, taskEvents, tasks, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle, sortOrderBetween } from "../../tasks";
import { isRetroKind, MAX_RETRO_TEXT, sortRetroItems } from "../../office-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("retros request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as retrospectivas. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const me = { id: member.id, canEdit: member.role !== "viewer", isAdmin: member.role === "admin" };

    const retroId = Number(new URL(request.url).searchParams.get("retroId"));
    if (retroId) {
      const [retro] = await db.select().from(retros).where(eq(retros.id, retroId)).limit(1);
      if (!retro) return json({ error: "Retrospectiva não encontrada." }, 404);
      const items = await db.select().from(retroItems).where(eq(retroItems.retroId, retroId)).orderBy(asc(retroItems.id));
      const votes = items.length ? await db.select().from(retroVotes).where(inArray(retroVotes.itemId, items.map((item) => item.id))) : [];
      return json({
        retro: { ...retro, createdById: undefined, canManage: me.isAdmin || retro.createdById === member.id },
        // Em retrospectiva anônima, ninguém (nem administrador) vê quem escreveu: só "meu" para poder apagar.
        items: sortRetroItems(items.map((item) => ({
          id: item.id, kind: item.kind, text: item.text, taskId: item.taskId, createdAt: item.createdAt,
          authorName: retro.anonymous ? "" : item.authorName,
          mine: item.authorId === member.id,
          votes: votes.filter((vote) => vote.itemId === item.id).length,
          votedByMe: votes.some((vote) => vote.itemId === item.id && vote.memberId === member.id),
        }))),
        me,
      });
    }

    const [rows, teamRows, sprintRows, counts] = await Promise.all([
      db.select().from(retros).orderBy(desc(retros.createdAt), desc(retros.id)).limit(40),
      db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
      db.select({ id: sprints.id, name: sprints.name, status: sprints.status }).from(sprints).orderBy(desc(sprints.startDate)).limit(30),
      db.select({ retroId: retroItems.retroId, kind: retroItems.kind }).from(retroItems),
    ]);
    return json({
      retros: rows.map((retro) => ({ id: retro.id, title: retro.title, teamId: retro.teamId, sprintId: retro.sprintId, anonymous: retro.anonymous, status: retro.status, createdByName: retro.createdByName, createdAt: retro.createdAt, items: counts.filter((row) => row.retroId === retro.id).length, actions: counts.filter((row) => row.retroId === retro.id && row.kind === "action").length })),
      teams: teamRows,
      sprints: sprintRows,
      me,
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
    const isAdmin = member.role === "admin";

    if (action === "createRetro") {
      const title = cleanTitle(body.title).slice(0, 100);
      if (!title) return json({ error: "Dê um título (ex.: Retrospectiva do Sprint 12)." }, 400);
      const teamId = Number(body.teamId) || null;
      const sprintId = Number(body.sprintId) || null;
      if (teamId && !(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1)).length) return json({ error: "Escolha um time válido." }, 400);
      if (sprintId && !(await db.select({ id: sprints.id }).from(sprints).where(eq(sprints.id, sprintId)).limit(1)).length) return json({ error: "Escolha um sprint válido." }, 400);
      const [retro] = await db.insert(retros).values({ title, teamId, sprintId, anonymous: body.anonymous !== false, createdById: member.id, createdByName: member.name, createdAt: now }).returning({ id: retros.id });
      return json({ id: retro.id }, 201);
    }

    const itemId = Number(body.itemId);
    const [item] = itemId ? await db.select().from(retroItems).where(eq(retroItems.id, itemId)).limit(1) : [];
    const retroId = Number(body.retroId) || item?.retroId || 0;
    const [retro] = retroId ? await db.select().from(retros).where(eq(retros.id, retroId)).limit(1) : [];
    if (!retro) return json({ error: "Retrospectiva não encontrada." }, 404);
    const canManage = isAdmin || retro.createdById === member.id;

    if (action === "addItem") {
      if (retro.status === "closed") return json({ error: "A retrospectiva já foi encerrada." }, 400);
      if (!isRetroKind(body.kind)) return json({ error: "Escolha a coluna." }, 400);
      const text = cleanMultiline(body.text, MAX_RETRO_TEXT);
      if (!text) return json({ error: "Escreva o item." }, 400);
      await db.insert(retroItems).values({ retroId, kind: body.kind, text, authorId: member.id, authorName: member.name, createdAt: now });
      return json({ ok: true }, 201);
    }

    if (action === "deleteItem") {
      if (!item) return json({ error: "Item não encontrado." }, 404);
      if (item.authorId !== member.id && !canManage) return json({ error: "Você só apaga o que escreveu." }, 403);
      await db.delete(retroItems).where(eq(retroItems.id, item.id));
      return json({ ok: true });
    }

    if (action === "vote") {
      if (!item) return json({ error: "Item não encontrado." }, 404);
      if (retro.status === "closed") return json({ error: "A retrospectiva já foi encerrada." }, 400);
      if (body.on === false) await db.delete(retroVotes).where(and(eq(retroVotes.itemId, item.id), eq(retroVotes.memberId, member.id)));
      else await db.insert(retroVotes).values({ itemId: item.id, memberId: member.id }).onConflictDoNothing();
      return json({ ok: true });
    }

    // Ação da retrospectiva vira demanda (no time da retrospectiva).
    if (action === "itemToTask") {
      if (!item) return json({ error: "Item não encontrado." }, 404);
      if (item.taskId) return json({ error: "Este item já virou demanda." }, 409);
      const [top] = await db.select({ value: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.status, "todo"));
      const [task] = await db.insert(tasks).values({
        title: cleanTitle(item.text.split("\n")[0]).slice(0, 160) || "Ação da retrospectiva",
        description: `${item.text}\n\nOrigem: ${retro.title}.`,
        status: "todo", teamId: retro.teamId, category: "Melhoria", origin: "Retrospectiva",
        openedOn: now.slice(0, 10), sortOrder: sortOrderBetween(null, top?.value ?? null),
        createdById: member.id, createdByName: member.name, createdAt: now, updatedAt: now,
      }).returning({ id: tasks.id });
      await db.insert(taskEvents).values({ taskId: task.id, kind: "created", actorId: member.id, actorName: member.name, createdAt: now });
      await db.update(retroItems).set({ taskId: task.id }).where(eq(retroItems.id, item.id));
      return json({ taskId: task.id }, 201);
    }

    if (action === "closeRetro" || action === "reopenRetro") {
      if (!canManage) return json({ error: "Só quem criou ou um administrador encerra a retrospectiva." }, 403);
      await db.update(retros).set(action === "closeRetro" ? { status: "closed", closedAt: now } : { status: "open", closedAt: null }).where(eq(retros.id, retroId));
      return json({ ok: true });
    }

    if (action === "deleteRetro") {
      if (!isAdmin) return json({ error: "Somente administradores excluem retrospectivas." }, 403);
      await db.delete(retros).where(eq(retros.id, retroId));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
