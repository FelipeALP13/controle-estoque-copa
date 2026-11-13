import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, tasks, taskTimers, timeEntries } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, taskCode } from "../../tasks";
import { entryDateError, formatHours, MAX_ENTRY_NOTE, MAX_HOURS_PER_DAY, parseEntryHours } from "../../time-entries";
import { readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("time entries request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem o apontamento de horas. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const isoDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/** Recalcula o total da demanda: horas anteriores + soma dos lançamentos. */
function recomputeTask(db: Db, taskId: number) {
  return db.update(tasks).set({
    workedHours: sql`case when ${tasks.baseHours} is null and not exists (select 1 from "time_entries" "e" where "e"."task_id" = ${taskId}) then null
      else round(coalesce(${tasks.baseHours}, 0) + coalesce((select sum("e"."hours") from "time_entries" "e" where "e"."task_id" = ${taskId}), 0), 2) end`,
  }).where(eq(tasks.id, taskId));
}

/** Grava um lançamento (respeitando o limite do dia) e recalcula o total da demanda. Devolve o erro ou o resultado. */
async function logHours(db: Db, input: { taskId: number; personId: number; workDate: string; hours: number; note: string; createdById: number }, stopTimer = false) {
  const [task] = await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  if (!task) return { error: "Demanda não encontrada.", status: 404 } as const;
  const [person] = await db.select({ id: members.id, name: members.name, active: members.active }).from(members).where(eq(members.id, input.personId)).limit(1);
  if (!person || !person.active) return { error: "Escolha uma pessoa ativa.", status: 400 } as const;
  const [day] = await db.select({ total: sql<number>`coalesce(sum(${timeEntries.hours}), 0)` }).from(timeEntries).where(and(eq(timeEntries.memberId, person.id), eq(timeEntries.workDate, input.workDate)));
  const already = Number(day?.total ?? 0);
  if (already + input.hours > MAX_HOURS_PER_DAY) return { error: `${person.name} já tem ${formatHours(already)} lançadas neste dia. O limite é ${MAX_HOURS_PER_DAY} h por dia.`, status: 400 } as const;
  // Lançamento, novo total (e, no cronômetro, a parada) na mesma transação.
  const insert = db.insert(timeEntries).values({ taskId: input.taskId, memberId: person.id, memberName: person.name, workDate: input.workDate, hours: input.hours, note: input.note, createdById: input.createdById, createdAt: new Date().toISOString() }).returning();
  const [inserted] = stopTimer
    ? await db.batch([insert, recomputeTask(db, input.taskId), db.delete(taskTimers).where(eq(taskTimers.memberId, input.personId))])
    : await db.batch([insert, recomputeTask(db, input.taskId)]);
  const [updated] = await db.select({ workedHours: tasks.workedHours, baseHours: tasks.baseHours }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  return { entry: inserted[0], task: updated, message: `${formatHours(input.hours)} lançadas em ${taskCode(input.taskId)}.` } as const;
}

/** Cronômetro rodando da pessoa (null se nenhum; null também se a migração ainda não foi aplicada). */
async function myTimer(db: Db, memberId: number) {
  try {
    const [row] = await db.select({ taskId: taskTimers.taskId, startedAt: taskTimers.startedAt, title: tasks.title }).from(taskTimers).innerJoin(tasks, eq(taskTimers.taskId, tasks.id)).where(eq(taskTimers.memberId, memberId)).limit(1);
    return row ?? null;
  } catch (error) {
    console.error("timer load failed", error);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);

    const params = new URL(request.url).searchParams;
    if (params.has("timer")) return json({ timer: await myTimer(db, member.id) });
    const taskId = Number(params.get("taskId"));
    const from = isoDate(params.get("from"));
    const to = isoDate(params.get("to"));
    const filters = [];
    if (taskId) filters.push(eq(timeEntries.taskId, taskId));
    if (from) filters.push(gte(timeEntries.workDate, from));
    if (to) filters.push(lte(timeEntries.workDate, to));
    if (!taskId && (!from || !to)) return json({ error: "Informe a demanda ou o período." }, 400);

    const rows = await db.select().from(timeEntries).where(and(...filters)).orderBy(asc(timeEntries.workDate), asc(timeEntries.id));
    const isAdmin = member.role === "admin";
    return json({
      entries: rows.map((entry) => ({
        id: entry.id, taskId: entry.taskId, memberId: entry.memberId, memberName: entry.memberName, workDate: entry.workDate, hours: entry.hours, note: entry.note, createdAt: entry.createdAt,
        canDelete: isAdmin || entry.memberId === member.id || entry.createdById === member.id,
      })),
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
    const isAdmin = member.role === "admin";

    const body = await readJsonBody(request);

    if (body instanceof Response) return body;
    const action = String(body.action ?? "");

    if (action === "addEntry") {
      const taskId = Number(body.taskId);
      const hours = parseEntryHours(body.hours);
      const workDate = String(body.workDate ?? "");
      const note = cleanMultiline(body.note, MAX_ENTRY_NOTE);
      const personId = body.memberId === undefined || body.memberId === null || body.memberId === "" ? member.id : Number(body.memberId);
      if (hours === null) return json({ error: `Informe as horas: por exemplo 1,5 ou 1:30 (até ${MAX_HOURS_PER_DAY} h).` }, 400);
      const dateError = entryDateError(workDate, todayInSaoPaulo());
      if (dateError) return json({ error: dateError }, 400);
      if (personId !== member.id && !isAdmin) return json({ error: "Você só pode lançar as suas próprias horas." }, 403);
      const result = await logHours(db, { taskId, personId, workDate, hours, note, createdById: member.id });
      if ("error" in result) return json({ error: result.error }, result.status);
      return json({ entry: { ...result.entry, canDelete: true }, task: result.task, message: result.message }, 201);
    }

    // Cronômetro: um por pessoa. Ao parar, vira um lançamento de hoje (horas conferidas pela pessoa).
    if (action === "startTimer") {
      const taskId = Number(body.taskId);
      const [task] = taskId ? await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, taskId)).limit(1) : [];
      if (!task) return json({ error: "Demanda não encontrada." }, 404);
      const running = await myTimer(db, member.id);
      if (running && running.taskId !== taskId) return json({ error: `Você já tem um cronômetro rodando em ${taskCode(running.taskId)}. Pare ele antes de começar outro.`, timer: running }, 409);
      if (running) return json({ timer: running });
      await db.insert(taskTimers).values({ memberId: member.id, taskId, startedAt: new Date().toISOString() }).onConflictDoNothing();
      return json({ timer: await myTimer(db, member.id) }, 201);
    }

    if (action === "stopTimer") {
      const running = await myTimer(db, member.id);
      if (!running) return json({ error: "Nenhum cronômetro rodando." }, 404);
      const hours = parseEntryHours(body.hours);
      if (hours === null) return json({ error: `Confira as horas: por exemplo 1,5 ou 1:30 (até ${MAX_HOURS_PER_DAY} h).` }, 400);
      const result = await logHours(db, { taskId: running.taskId, personId: member.id, workDate: todayInSaoPaulo(), hours, note: cleanMultiline(body.note, MAX_ENTRY_NOTE), createdById: member.id }, true);
      if ("error" in result) return json({ error: result.error }, result.status);
      return json({ entry: { ...result.entry, canDelete: true }, task: result.task, message: result.message, timer: null });
    }

    if (action === "discardTimer") {
      await db.delete(taskTimers).where(eq(taskTimers.memberId, member.id));
      return json({ timer: null });
    }

    if (action === "deleteEntry") {
      const entryId = Number(body.entryId);
      const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
      if (!entry) return json({ error: "Lançamento não encontrado." }, 404);
      if (!isAdmin && entry.memberId !== member.id && entry.createdById !== member.id) return json({ error: "Você só pode excluir os seus lançamentos." }, 403);
      await db.batch([db.delete(timeEntries).where(eq(timeEntries.id, entryId)), recomputeTask(db, entry.taskId)]);
      const [updated] = await db.select({ workedHours: tasks.workedHours, baseHours: tasks.baseHours }).from(tasks).where(eq(tasks.id, entry.taskId)).limit(1);
      return json({ ok: true, task: updated });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
