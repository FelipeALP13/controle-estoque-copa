import { and, asc, desc, eq, inArray, min, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, members, notifications, projects, taskChecklistItems, taskEvents, taskLegacyCodes, taskPeople, tasks, taskTemplates, teamMembers, teams, timeEntries } from "../../../db/schema";
import { cleanItem, MAX_CHECKLIST_ITEMS, parseItems } from "../../checklists";
import { totalHours } from "../../time-entries";
import { commentRecipients, findMentions, snippet, type NotificationKind } from "../../notifications";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, cleanTitle, isClosedStatus, isTaskPriority, isTaskStatus, MAX_COMMENT_LENGTH, MAX_DESCRIPTION_LENGTH, parseDueDate, sortOrderBetween, taskCategories, taskCode, taskStatusLabels, type TaskEventKind, type TaskStatus } from "../../tasks";
import { readJsonBody } from "../../api-input";
import { removeAttachmentsOf } from "../../attachments-store";
import { sprints, taskDependencies, taskRecurrences } from "../../../db/schema";
import { openBlockers, releasedBy, wouldCreateCycle } from "../../team-tools";

/** Do que a demanda depende e o que depende dela (vazio se a migração ainda não foi aplicada). */
async function loadDependencies(db: Db, taskId: number) {
  try {
    const [blockedBy, blocking] = await Promise.all([
      db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(taskDependencies).innerJoin(tasks, eq(taskDependencies.blockedById, tasks.id)).where(eq(taskDependencies.taskId, taskId)).orderBy(asc(tasks.id)),
      db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(taskDependencies).innerJoin(tasks, eq(taskDependencies.taskId, tasks.id)).where(eq(taskDependencies.blockedById, taskId)).orderBy(asc(tasks.id)),
    ]);
    return { blockedBy, blocking };
  } catch (error) {
    console.error("dependencies load failed", error);
    return { blockedBy: [], blocking: [] };
  }
}
import { addDays, DUE_OPTIONS, runOnOrAfter, validRecurrence } from "../../task-recurrence";

/** Repetição da demanda (null se não repete; vazio se a migração ainda não foi aplicada). */
async function loadRecurrence(db: Db, taskId: number) {
  try {
    const [row] = await db.select().from(taskRecurrences).where(eq(taskRecurrences.sourceTaskId, taskId)).limit(1);
    return row ? { frequency: row.frequency, day: row.day, dueDays: row.dueDays, nextOn: row.nextOn, active: row.active, lastTaskId: row.lastTaskId } : null;
  } catch (error) {
    console.error("recurrence load failed", error);
    return null;
  }
}

type Db = ReturnType<typeof getDb>;

const canEdit = (member: SessionMember) => member.active && member.role !== "viewer";
const isAdmin = (member: SessionMember) => member.role === "admin";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("tasks request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as tabelas de demandas. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

type NewNotification = { memberId: number; kind: NotificationKind; taskId: number; body: string };

/** Avisos não podem derrubar a operação principal (ex.: migração ainda não aplicada). */
async function notify(db: Db, actorId: number, actorName: string, createdAt: string, rows: NewNotification[]) {
  const unique = new Map<number, NewNotification>();
  for (const row of rows) if (row.memberId !== actorId && !unique.has(row.memberId)) unique.set(row.memberId, row);
  if (!unique.size) return;
  try {
    await db.insert(notifications).values([...unique.values()].map((row) => ({ ...row, actorName, createdAt })));
  } catch (error) {
    console.error("notification insert failed", error);
  }
}

async function existingTeam(db: Db, value: unknown) {
  if (value === null || value === undefined || value === "") return { id: null, name: "" };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, id)).limit(1);
  return team ?? undefined;
}

async function existingClient(db: Db, value: unknown) {
  if (value === null || value === undefined || value === "") return { id: null, name: "" };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, id)).limit(1);
  return client ?? undefined;
}

async function existingProject(db: Db, value: unknown) {
  if (value === null || value === undefined || value === "") return { id: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  return project ?? undefined;
}

/** Lista de IDs de pessoas ativas, sem repetir e na ordem recebida. Inválido → undefined. */
async function activePeople(db: Db, value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return undefined;
  if (!ids.length) return [] as { id: number; name: string }[];
  const rows = await db.select({ id: members.id, name: members.name }).from(members).where(and(inArray(members.id, ids), eq(members.active, true)));
  if (rows.length !== ids.length) return undefined;
  return ids.map((id) => rows.find((row) => row.id === id)!);
}

function parseHoursField(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number <= 100000 ? Math.round(number * 100) / 100 : undefined;
}

function cleanCategory(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return (taskCategories as readonly string[]).includes(text) ? text : undefined;
}

async function topSortOrder(db: Db, status: TaskStatus) {
  const [row] = await db.select({ value: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.status, status));
  return sortOrderBetween(null, row?.value ?? null);
}

async function setPeople(db: Db, taskId: number, owners: number[], support: number[]) {
  await db.delete(taskPeople).where(eq(taskPeople.taskId, taskId));
  const rows = [...owners.map((memberId) => ({ taskId, memberId, role: "owner" as const })), ...support.filter((id) => !owners.includes(id)).map((memberId) => ({ taskId, memberId, role: "support" as const }))];
  if (rows.length) await db.insert(taskPeople).values(rows);
}

/** Quem acompanha a demanda: responsáveis, suporte e quem criou. */
async function followers(db: Db, taskId: number, createdById: number | null) {
  const rows = await db.select({ memberId: taskPeople.memberId }).from(taskPeople).where(eq(taskPeople.taskId, taskId));
  return [...new Set([...rows.map((row) => row.memberId), ...(createdById ? [createdById] : [])])];
}

/** Demandas que ficaram livres porque `finishedId` foi concluída: avisa quem acompanha cada uma. */
async function notifyReleased(db: Db, member: SessionMember, finishedId: number, now: string) {
  try {
    const edges = await db.select({ taskId: taskDependencies.taskId, blockedById: taskDependencies.blockedById }).from(taskDependencies);
    const related = [...new Set(edges.flatMap((edge) => [edge.taskId, edge.blockedById]))];
    if (!related.includes(finishedId)) return;
    const rows = await db.select({ id: tasks.id, status: tasks.status, createdById: tasks.createdById }).from(tasks).where(inArray(tasks.id, related));
    const released = releasedBy(edges, finishedId, new Map(rows.map((row) => [row.id, row.status])));
    for (const taskId of released) {
      const createdById = rows.find((row) => row.id === taskId)?.createdById ?? null;
      await notify(db, member.id, member.name, now, (await followers(db, taskId, createdById)).map((memberId) => ({ memberId, kind: "task_unblocked" as const, taskId, body: taskCode(finishedId) })));
    }
  } catch (error) {
    console.error("release notification failed", error);
  }
}

/** Passos da demanda; vazio se a migração dos checklists ainda não foi aplicada. */
async function loadChecklist(db: Db, taskId: number) {
  try {
    return await db.select({ id: taskChecklistItems.id, text: taskChecklistItems.text, done: taskChecklistItems.done, doneByName: taskChecklistItems.doneByName, doneAt: taskChecklistItems.doneAt, sortOrder: taskChecklistItems.sortOrder })
      .from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.id));
  } catch (error) {
    console.error("checklist load failed", error);
    return [];
  }
}

/** Passo do checklist + a demanda dele (para conferir que existe). */
async function checklistItem(db: Db, itemId: number) {
  const [item] = await db.select().from(taskChecklistItems).where(eq(taskChecklistItems.id, itemId)).limit(1);
  return item ?? null;
}

/** Times e vínculos; vazio se a migração de times ainda não foi aplicada. */
async function loadTeams(db: Db, memberId: number) {
  try {
    const [teamRows, mine] = await Promise.all([
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
      db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, memberId)),
    ]);
    return { teams: teamRows, myTeamIds: mine.map((row) => row.teamId) };
  } catch (error) {
    console.error("teams load failed", error);
    return { teams: [], myTeamIds: [] };
  }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);

    const taskId = Number(new URL(request.url).searchParams.get("taskId"));
    if (taskId) {
      const [events, checklist, recurrence, dependencies] = await Promise.all([
        db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId)).orderBy(asc(taskEvents.createdAt), asc(taskEvents.id)),
        loadChecklist(db, taskId),
        loadRecurrence(db, taskId),
        loadDependencies(db, taskId),
      ]);
      return json({
        events: events.map((event) => ({ id: event.id, kind: event.kind, body: event.body, actorId: event.actorId, actorName: event.actorName, createdAt: event.createdAt, canDelete: event.kind === "comment" && (event.actorId === member.id || isAdmin(member)) })),
        checklist,
        recurrence,
        dependencies,
      });
    }

    const [taskRows, peopleRows, codeRows, memberRows, clientRows, projectRows] = await Promise.all([
      db.select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        teamId: tasks.teamId,
        clientId: tasks.clientId,
        projectId: tasks.projectId,
        sprintId: tasks.sprintId,
        category: tasks.category,
        openedOn: tasks.openedOn,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
        completedOn: tasks.completedOn,
        estimatedHours: tasks.estimatedHours,
        workedHours: tasks.workedHours,
        baseHours: tasks.baseHours,
        hoursFlag: tasks.hoursFlag,
        origin: tasks.origin,
        notes: tasks.notes,
        sortOrder: tasks.sortOrder,
        createdByName: tasks.createdByName,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Nomes explícitos: dentro da subconsulta, "id" sozinho seria o id do evento.
        commentCount: sql<number>`(select count(*) from "task_events" "te" where "te"."task_id" = "tasks"."id" and "te"."kind" = 'comment')`,
      }).from(tasks).orderBy(asc(tasks.sortOrder), desc(tasks.id)),
      db.select().from(taskPeople),
      db.select().from(taskLegacyCodes),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
      db.select({ id: clients.id, name: clients.name, active: clients.active }).from(clients).orderBy(asc(clients.name)),
      db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.name)),
    ]);

    const owners = new Map<number, number[]>();
    const support = new Map<number, number[]>();
    for (const row of peopleRows) {
      const target = row.role === "support" ? support : owners;
      target.set(row.taskId, [...(target.get(row.taskId) ?? []), row.memberId]);
    }
    const codes = new Map<number, string[]>();
    for (const row of codeRows) codes.set(row.taskId, [...(codes.get(row.taskId) ?? []), row.code]);

    const teamData = await loadTeams(db, member.id);
    // Progresso do checklist de cada demanda (vazio se a migração ainda não foi aplicada).
    const progress = new Map<number, { done: number; total: number }>();
    try {
      const rows = await db.select({ taskId: taskChecklistItems.taskId, total: sql<number>`count(*)`, done: sql<number>`sum(case when ${taskChecklistItems.done} then 1 else 0 end)` }).from(taskChecklistItems).groupBy(taskChecklistItems.taskId);
      for (const row of rows) progress.set(row.taskId, { done: Number(row.done), total: Number(row.total) });
    } catch (error) {
      console.error("checklist progress failed", error);
    }
    // Sprints em aberto (para escolher na demanda).
    let sprintRows: { id: number; name: string; status: string }[] = [];
    try {
      sprintRows = await db.select({ id: sprints.id, name: sprints.name, status: sprints.status }).from(sprints).where(sql`${sprints.status} != 'closed'`).orderBy(asc(sprints.startDate));
    } catch (error) {
      console.error("sprints load failed", error);
    }
    // Quantas pendências ainda seguram cada demanda.
    let blockers = new Map<number, number>();
    try {
      blockers = openBlockers(await db.select({ taskId: taskDependencies.taskId, blockedById: taskDependencies.blockedById }).from(taskDependencies), new Map(taskRows.map((task) => [task.id, task.status])));
    } catch (error) {
      console.error("dependencies count failed", error);
    }
    return json({
      tasks: taskRows.map((task) => ({ ...task, owners: owners.get(task.id) ?? [], support: support.get(task.id) ?? [], codes: (codes.get(task.id) ?? []).sort(), checklist: progress.get(task.id) ?? null, waitingOn: blockers.get(task.id) ?? 0 })),
      members: memberRows,
      teams: teamData.teams,
      clients: clientRows,
      projects: projectRows,
      categories: taskCategories,
      sprints: sprintRows,
      me: { id: member.id, canEdit: canEdit(member), isAdmin: isAdmin(member), teamIds: teamData.myTeamIds },
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
    if (!canEdit(member)) return json({ error: "Seu perfil pode apenas visualizar as demandas." }, 403);

    const body = await readJsonBody(request);

    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const actor = { actorId: member.id, actorName: member.name };
    const now = new Date().toISOString();
    const today = todayInSaoPaulo();

    if (action === "saveClient") {
      if (!isAdmin(member)) return json({ error: "Somente administradores mantêm a lista de clientes." }, 403);
      const clientId = Number(body.clientId) || 0;
      const name = cleanTitle(body.name).slice(0, 80);
      if (!name) return json({ error: "Informe o nome do cliente/projeto." }, 400);
      const [duplicate] = await db.select({ id: clients.id }).from(clients).where(sql`lower(${clients.name}) = lower(${name})`).limit(1);
      if (duplicate && duplicate.id !== clientId) return json({ error: "Já existe um cliente/projeto com esse nome." }, 409);
      const values = { name, active: body.active !== false };
      const [client] = clientId
        ? await db.update(clients).set(values).where(eq(clients.id, clientId)).returning()
        : await db.insert(clients).values(values).returning();
      if (!client) return json({ error: "Cliente/projeto não encontrado." }, 404);
      return json({ client }, clientId ? 200 : 201);
    }

    // Repetir a demanda: semanal ou mensal, com prazo opcional.
    if (action === "saveRecurrence" || action === "removeRecurrence") {
      const taskId = Number(body.taskId);
      const [source] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!source) return json({ error: "Demanda não encontrada." }, 404);
      if (action === "removeRecurrence") {
        await db.delete(taskRecurrences).where(eq(taskRecurrences.sourceTaskId, taskId));
        await db.insert(taskEvents).values({ taskId, kind: "comment", body: "Parou de repetir esta demanda.", ...actor, createdAt: now });
        return json({ recurrence: null });
      }
      if (!validRecurrence(body.frequency, body.day)) return json({ error: "Escolha a frequência e o dia." }, 400);
      const frequency = body.frequency;
      const day = Number(body.day);
      const dueDays = body.dueDays === null || body.dueDays === undefined || body.dueDays === "" ? null : Number(body.dueDays);
      if (!DUE_OPTIONS.some((option) => option.value === dueDays)) return json({ error: "Escolha o prazo das cópias." }, 400);
      // A primeira cópia sai na próxima data (a partir de amanhã: a demanda de hoje é a própria origem).
      const nextOn = runOnOrAfter(frequency, day, addDays(today, 1));
      const values = { frequency, day, dueDays, nextOn, active: true, updatedAt: now };
      await db.insert(taskRecurrences).values({ ...values, sourceTaskId: taskId, createdById: member.id, createdAt: now })
        .onConflictDoUpdate({ target: taskRecurrences.sourceTaskId, set: values });
      await db.insert(taskEvents).values({ taskId, kind: "comment", body: "Configurou a repetição desta demanda.", ...actor, createdAt: now });
      return json({ recurrence: await loadRecurrence(db, taskId) });
    }

    // Dependências: "esta só começa quando aquela terminar".
    if (action === "addDependency" || action === "removeDependency") {
      const taskId = Number(body.taskId);
      const blockedById = Number(body.blockedById);
      const found = taskId && blockedById ? await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, [taskId, blockedById])) : [];
      const task = found.find((row) => row.id === taskId);
      const blocker = found.find((row) => row.id === blockedById);
      if (!task || !blocker) return json({ error: "Demanda não encontrada." }, 404);
      if (action === "removeDependency") {
        const removed = await db.delete(taskDependencies).where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.blockedById, blockedById))).returning({ taskId: taskDependencies.taskId });
        if (removed.length) await db.insert(taskEvents).values({ taskId, kind: "comment", body: `Deixou de depender de ${taskCode(blockedById)}.`, ...actor, createdAt: now });
        return json({ dependencies: await loadDependencies(db, taskId) });
      }
      const edges = await db.select({ taskId: taskDependencies.taskId, blockedById: taskDependencies.blockedById }).from(taskDependencies);
      if (taskId === blockedById) return json({ error: "Uma demanda não pode depender dela mesma." }, 400);
      if (wouldCreateCycle(edges, taskId, blockedById)) return json({ error: `${taskCode(blockedById)} já depende (direta ou indiretamente) de ${taskCode(taskId)}. Isso travaria as duas.` }, 400);
      if (edges.filter((edge) => edge.taskId === taskId).length >= 20) return json({ error: "Limite de 20 dependências por demanda." }, 400);
      const inserted = await db.insert(taskDependencies).values({ taskId, blockedById, createdAt: now }).onConflictDoNothing().returning({ taskId: taskDependencies.taskId });
      if (inserted.length) await db.insert(taskEvents).values({ taskId, kind: "comment", body: `Passou a depender de ${taskCode(blockedById)} · ${blocker.title}.`, ...actor, createdAt: now });
      return json({ dependencies: await loadDependencies(db, taskId) });
    }

    if (action === "createTask") {
      const title = cleanTitle(body.title);
      const status = isTaskStatus(body.status) ? body.status : "todo";
      const priority = isTaskPriority(body.priority) ? body.priority : 0;
      const dates = { startDate: parseDueDate(body.startDate), dueDate: parseDueDate(body.dueDate) };
      const ownersList = await activePeople(db, body.owners ?? (body.assigneeId ? [body.assigneeId] : []));
      const supportList = await activePeople(db, body.support ?? []);
      const team = await existingTeam(db, body.teamId);
      const client = await existingClient(db, body.clientId);
      const project = await existingProject(db, body.projectId);
      const category = cleanCategory(body.category);
      const estimatedHours = parseHoursField(body.estimatedHours);
      if (!title) return json({ error: "Dê um título para a demanda." }, 400);
      if (dates.startDate === undefined || dates.dueDate === undefined) return json({ error: "Informe datas válidas." }, 400);
      if (ownersList === undefined || supportList === undefined) return json({ error: "Escolha responsáveis ativos." }, 400);
      if (team === undefined) return json({ error: "Escolha um time válido." }, 400);
      if (client === undefined) return json({ error: "Escolha um cliente/projeto válido." }, 400);
      if (project === undefined) return json({ error: "Escolha um projeto válido." }, 400);
      if (category === undefined) return json({ error: "Escolha uma categoria da lista." }, 400);
      if (estimatedHours === undefined) return json({ error: "Informe horas estimadas válidas." }, 400);
      const [task] = await db.insert(tasks).values({
        title,
        description: cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH),
        status,
        priority,
        assigneeId: ownersList[0]?.id ?? null,
        teamId: team.id,
        clientId: client.id,
        projectId: project.id,
        category,
        openedOn: today,
        startDate: dates.startDate,
        dueDate: dates.dueDate,
        completedOn: status === "done" ? today : null,
        estimatedHours,
        origin: cleanTitle(body.origin).slice(0, 300),
        notes: cleanMultiline(body.notes, MAX_DESCRIPTION_LENGTH),
        sortOrder: await topSortOrder(db, status),
        createdById: member.id,
        createdByName: member.name,
        completedAt: status === "done" ? now : null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await setPeople(db, task.id, ownersList.map((person) => person.id), supportList.map((person) => person.id));
      await db.insert(taskEvents).values({ taskId: task.id, kind: "created", ...actor, createdAt: now });
      // Checklist: passos digitados na criação ou os do modelo escolhido.
      let steps = parseItems(body.checklist);
      if (!steps.length && Number(body.templateId)) {
        try {
          const [template] = await db.select({ items: taskTemplates.items }).from(taskTemplates).where(eq(taskTemplates.id, Number(body.templateId))).limit(1);
          steps = parseItems(template?.items ?? "[]");
        } catch (error) {
          console.error("template load failed", error);
        }
      }
      if (steps.length) {
        for (let index = 0; index < steps.length; index += 20) {
          await db.insert(taskChecklistItems).values(steps.slice(index, index + 20).map((text, offset) => ({ taskId: task.id, text, sortOrder: index + offset + 1, createdAt: now })));
        }
      }
      await notify(db, member.id, member.name, now, [...ownersList, ...supportList].map((person) => ({ memberId: person.id, kind: "task_assigned" as const, taskId: task.id, body: "" })));
      return json({ task }, 201);
    }

    if (action === "updateTask") {
      const taskId = Number(body.taskId);
      const [current] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!current) return json({ error: "Demanda não encontrada." }, 404);

      const changes: Partial<typeof tasks.$inferInsert> = {};
      const events: { kind: TaskEventKind; body: string }[] = [];
      const alerts: NewNotification[] = [];

      if ("title" in body) {
        const title = cleanTitle(body.title);
        if (!title) return json({ error: "O título não pode ficar vazio." }, 400);
        if (title !== current.title) { changes.title = title; events.push({ kind: "title", body: title }); }
      }
      if ("description" in body) {
        const description = cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH);
        if (description !== current.description) changes.description = description;
      }
      if ("notes" in body) {
        const notes = cleanMultiline(body.notes, MAX_DESCRIPTION_LENGTH);
        if (notes !== current.notes) changes.notes = notes;
      }
      if ("origin" in body) {
        const origin = cleanTitle(body.origin).slice(0, 300);
        if (origin !== current.origin) changes.origin = origin;
      }
      if ("status" in body) {
        if (!isTaskStatus(body.status)) return json({ error: "Status inválido." }, 400);
        if (body.status !== current.status) {
          changes.status = body.status;
          changes.completedAt = body.status === "done" ? now : null;
          // Ao concluir, a data de conclusão é hoje (se ninguém informou outra); ao reabrir, some.
          changes.completedOn = body.status === "done" ? (current.completedOn ?? today) : null;
          events.push({ kind: "status", body: body.status });
          if (!("sortOrder" in body)) changes.sortOrder = await topSortOrder(db, body.status);
        }
      }
      if ("sortOrder" in body) {
        const sortOrder = Number(body.sortOrder);
        if (!Number.isFinite(sortOrder)) return json({ error: "Posição inválida." }, 400);
        changes.sortOrder = sortOrder;
      }
      if ("priority" in body) {
        if (!isTaskPriority(body.priority)) return json({ error: "Prioridade inválida." }, 400);
        if (body.priority !== current.priority) { changes.priority = body.priority; events.push({ kind: "priority", body: String(body.priority) }); }
      }
      if ("teamId" in body) {
        const team = await existingTeam(db, body.teamId);
        if (team === undefined) return json({ error: "Escolha um time válido." }, 400);
        if (team.id !== current.teamId) { changes.teamId = team.id; events.push({ kind: "team", body: team.name }); }
      }
      if ("clientId" in body) {
        const client = await existingClient(db, body.clientId);
        if (client === undefined) return json({ error: "Escolha um cliente/projeto válido." }, 400);
        if (client.id !== current.clientId) { changes.clientId = client.id; events.push({ kind: "client", body: client.name }); }
      }
      if ("projectId" in body) {
        const project = await existingProject(db, body.projectId);
        if (project === undefined) return json({ error: "Escolha um projeto válido." }, 400);
        if (project.id !== current.projectId) changes.projectId = project.id;
      }
      if ("sprintId" in body) {
        const sprintId = body.sprintId === null || body.sprintId === "" ? null : Number(body.sprintId);
        if (sprintId !== null) {
          const [sprint] = Number.isInteger(sprintId) ? await db.select({ id: sprints.id, status: sprints.status, name: sprints.name }).from(sprints).where(eq(sprints.id, sprintId)).limit(1) : [];
          if (!sprint || sprint.status === "closed") return json({ error: "Escolha um sprint em aberto." }, 400);
          if (sprintId !== current.sprintId) events.push({ kind: "comment", body: `Entrou no ${sprint.name}.` });
        }
        if (sprintId !== current.sprintId) changes.sprintId = sprintId;
      }
      if ("category" in body) {
        const category = cleanCategory(body.category);
        if (category === undefined) return json({ error: "Escolha uma categoria da lista." }, 400);
        if (category !== current.category) { changes.category = category; events.push({ kind: "category", body: category }); }
      }
      for (const [field, label] of [["startDate", "Data de Início"], ["dueDate", "Prazo"], ["completedOn", "Data de Conclusão"]] as const) {
        if (!(field in body)) continue;
        const value = parseDueDate(body[field]);
        if (value === undefined) return json({ error: `Informe uma ${label} válida.` }, 400);
        if (value !== current[field]) {
          changes[field] = value;
          if (field === "dueDate") events.push({ kind: "due_date", body: value ?? "" });
        }
      }
      // Horas trabalhadas não se digitam: são as horas anteriores (editáveis) + os lançamentos.
      for (const field of ["estimatedHours", "baseHours"] as const) {
        if (!(field in body)) continue;
        const value = parseHoursField(body[field]);
        if (value === undefined) return json({ error: "Informe horas válidas (número maior ou igual a zero)." }, 400);
        if (value !== current[field]) { changes[field] = value; changes.hoursFlag = false; }
      }
      if ("baseHours" in changes) {
        const [logged] = await db.select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${timeEntries.hours}), 0)` }).from(timeEntries).where(eq(timeEntries.taskId, taskId));
        changes.workedHours = totalHours(changes.baseHours ?? null, Number(logged?.count) ? [Number(logged.total)] : []);
      }

      let peopleChanged = false;
      if ("owners" in body || "support" in body) {
        const currentPeople = await db.select().from(taskPeople).where(eq(taskPeople.taskId, taskId));
        const ownersList = "owners" in body ? await activePeople(db, body.owners) : await activePeople(db, currentPeople.filter((row) => row.role === "owner").map((row) => row.memberId));
        const supportList = "support" in body ? await activePeople(db, body.support) : await activePeople(db, currentPeople.filter((row) => row.role === "support").map((row) => row.memberId));
        if (ownersList === undefined || supportList === undefined) return json({ error: "Escolha responsáveis ativos." }, 400);
        const before = new Set(currentPeople.map((row) => `${row.role}:${row.memberId}`));
        const after = new Set([...ownersList.map((person) => `owner:${person.id}`), ...supportList.filter((person) => !ownersList.some((owner) => owner.id === person.id)).map((person) => `support:${person.id}`)]);
        if (before.size !== after.size || [...after].some((key) => !before.has(key))) {
          peopleChanged = true;
          changes.assigneeId = ownersList[0]?.id ?? null;
          await setPeople(db, taskId, ownersList.map((person) => person.id), supportList.map((person) => person.id));
          events.push({ kind: "people", body: [...ownersList.map((person) => person.name), ...supportList.filter((person) => !ownersList.some((owner) => owner.id === person.id)).map((person) => `${person.name} (suporte)`)].join(", ") });
          const previous = new Set(currentPeople.map((row) => row.memberId));
          for (const person of [...ownersList, ...supportList]) if (!previous.has(person.id)) alerts.push({ memberId: person.id, kind: "task_assigned", taskId, body: "" });
        }
      }

      if (Object.keys(changes).length === 0 && !peopleChanged) return json({ task: current });
      const [task] = await db.update(tasks).set({ ...changes, updatedAt: now }).where(eq(tasks.id, taskId)).returning();
      if (events.length) await db.insert(taskEvents).values(events.map((event) => ({ taskId, ...event, ...actor, createdAt: now })));
      if (changes.status) {
        for (const id of await followers(db, taskId, current.createdById)) alerts.push({ memberId: id, kind: "task_status", taskId, body: taskStatusLabels[task.status] });
      }
      await notify(db, member.id, member.name, now, alerts);
      // Concluída: avisa quem esperava por ela (quando não sobra outra pendência).
      if (changes.status === "done") await notifyReleased(db, member, taskId, now);
      return json({ task, closed: isClosedStatus(task.status) });
    }

    if (action === "addChecklistItem") {
      const taskId = Number(body.taskId);
      const text = cleanItem(body.text);
      if (!text) return json({ error: "Escreva o passo." }, 400);
      const [task] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task) return json({ error: "Demanda não encontrada." }, 404);
      const [stats] = await db.select({ count: sql<number>`count(*)`, last: sql<number>`coalesce(max(${taskChecklistItems.sortOrder}), 0)` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId));
      if (Number(stats?.count ?? 0) >= MAX_CHECKLIST_ITEMS) return json({ error: `O checklist pode ter até ${MAX_CHECKLIST_ITEMS} passos.` }, 400);
      await db.insert(taskChecklistItems).values({ taskId, text, sortOrder: Number(stats?.last ?? 0) + 1, createdAt: now });
      await db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, taskId));
      return json({ checklist: await loadChecklist(db, taskId) }, 201);
    }

    if (action === "updateChecklistItem") {
      const item = await checklistItem(db, Number(body.itemId));
      if (!item) return json({ error: "Passo não encontrado." }, 404);
      const changes: Partial<typeof taskChecklistItems.$inferInsert> = {};
      if ("done" in body) {
        const done = body.done === true;
        changes.done = done;
        changes.doneByName = done ? member.name : null;
        changes.doneAt = done ? now : null;
      }
      if ("text" in body) {
        const text = cleanItem(body.text);
        if (!text) return json({ error: "O passo não pode ficar vazio." }, 400);
        changes.text = text;
      }
      if (Object.keys(changes).length) await db.update(taskChecklistItems).set(changes).where(eq(taskChecklistItems.id, item.id));
      if (body.move === "up" || body.move === "down") {
        // Troca com o vizinho e renumera a lista toda (1, 2, 3...) numa só operação.
        const order = (await loadChecklist(db, item.taskId)).map((entry) => entry.id);
        const index = order.indexOf(item.id);
        const target = body.move === "up" ? index - 1 : index + 1;
        if (index >= 0 && target >= 0 && target < order.length) {
          [order[index], order[target]] = [order[target], order[index]];
          await db.batch(order.map((id, position) => db.update(taskChecklistItems).set({ sortOrder: position + 1 }).where(eq(taskChecklistItems.id, id))) as unknown as Parameters<Db["batch"]>[0]);
        }
      }
      await db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, item.taskId));
      return json({ checklist: await loadChecklist(db, item.taskId) });
    }

    if (action === "deleteChecklistItem") {
      const item = await checklistItem(db, Number(body.itemId));
      if (!item) return json({ error: "Passo não encontrado." }, 404);
      await db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, item.id));
      await db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, item.taskId));
      return json({ checklist: await loadChecklist(db, item.taskId) });
    }

    if (action === "addComment") {
      const taskId = Number(body.taskId);
      const text = cleanMultiline(body.body, MAX_COMMENT_LENGTH);
      if (!text) return json({ error: "Escreva o comentário antes de enviar." }, 400);
      const [task] = await db.select({ id: tasks.id, assigneeId: tasks.assigneeId, createdById: tasks.createdById }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task) return json({ error: "Demanda não encontrada." }, 404);
      const [participants, people, involved] = await Promise.all([
        db.selectDistinct({ id: taskEvents.actorId }).from(taskEvents).where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.kind, "comment"))),
        db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)),
        db.select({ memberId: taskPeople.memberId }).from(taskPeople).where(eq(taskPeople.taskId, taskId)),
      ]);
      const [event] = await db.insert(taskEvents).values({ taskId, kind: "comment", body: text, ...actor, createdAt: now }).returning();
      await db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, taskId));
      const recipients = commentRecipients({
        actorId: member.id,
        assigneeId: task.assigneeId,
        creatorId: task.createdById,
        participantIds: [...involved.map((row) => row.memberId), ...participants.map((row) => row.id).filter((id): id is number => id !== null)],
        mentionedIds: findMentions(text, people),
      });
      const activeIds = new Set(people.map((person) => person.id));
      await notify(db, member.id, member.name, now, [...recipients].filter(([id]) => activeIds.has(id)).map(([memberId, kind]) => ({ memberId, kind, taskId, body: snippet(text) })));
      return json({ event }, 201);
    }

    if (action === "deleteComment") {
      const eventId = Number(body.eventId);
      const [event] = await db.select().from(taskEvents).where(eq(taskEvents.id, eventId)).limit(1);
      if (!event || event.kind !== "comment") return json({ error: "Comentário não encontrado." }, 404);
      if (event.actorId !== member.id && !isAdmin(member)) return json({ error: "Você só pode excluir os seus comentários." }, 403);
      await db.delete(taskEvents).where(eq(taskEvents.id, eventId));
      return json({ ok: true });
    }

    if (action === "deleteTask") {
      if (!isAdmin(member)) return json({ error: "Somente administradores podem excluir demandas." }, 403);
      const taskId = Number(body.taskId);
      const [deleted] = await db.delete(tasks).where(eq(tasks.id, taskId)).returning();
      if (!deleted) return json({ error: "Demanda não encontrada." }, 404);
      await removeAttachmentsOf(db, "task", deleted.id);
      try {
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "task_deleted", targetType: "task", targetId: deleted.id, details: `${taskCode(deleted.id)} ${deleted.title}` });
      } catch (error) {
        console.error("audit log failed", error);
      }
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
