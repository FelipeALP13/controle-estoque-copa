import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, members, projectPeople, projects, tasks } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { isProjectFarol, isProjectPhase, projectCode } from "../../projects";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, cleanTitle, isTaskStatus, MAX_DESCRIPTION_LENGTH, parseDueDate } from "../../tasks";
import { readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("projects request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as tabelas de projetos. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

async function activePeople(db: Db, value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return undefined;
  if (!ids.length) return [] as number[];
  const rows = await db.select({ id: members.id }).from(members).where(and(inArray(members.id, ids), eq(members.active, true)));
  return rows.length === ids.length ? ids : undefined;
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const [projectRows, peopleRows, taskRows, memberRows, clientRows] = await Promise.all([
      db.select().from(projects).orderBy(asc(projects.name)),
      db.select().from(projectPeople),
      db.select({ id: tasks.id, title: tasks.title, status: tasks.status, projectId: tasks.projectId, dueDate: tasks.dueDate, clientId: tasks.clientId }).from(tasks),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
      db.select({ id: clients.id, name: clients.name, active: clients.active }).from(clients).orderBy(asc(clients.name)),
    ]);
    return json({
      projects: projectRows.map((project) => ({
        ...project,
        people: peopleRows.filter((row) => row.projectId === project.id).map((row) => row.memberId),
        tasks: taskRows.filter((task) => task.projectId === project.id).map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.dueDate })),
      })),
      // Demandas sem projeto, para ligar a um projeto.
      unlinked: taskRows.filter((task) => task.projectId === null && task.status !== "done" && task.status !== "canceled").map((task) => ({ id: task.id, title: task.title, status: task.status, clientId: task.clientId })),
      members: memberRows,
      clients: clientRows,
      me: { id: member.id, canEdit: member.role !== "viewer", isAdmin: member.role === "admin" },
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
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar os projetos." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "saveProject") {
      const projectId = Number(body.projectId) || 0;
      const [current] = projectId ? await db.select().from(projects).where(eq(projects.id, projectId)).limit(1) : [];
      if (projectId && !current) return json({ error: "Projeto não encontrado." }, 404);
      const pick = <T,>(key: string, fallback: T) => (key in body ? body[key] : fallback);

      const name = cleanTitle(pick("name", current?.name ?? ""));
      const status = pick("status", current?.status ?? "todo");
      const farol = pick("farol", current?.farol ?? "blue");
      const phase = pick("phase", current?.phase ?? "planning");
      const startDate = parseDueDate(pick("startDate", current?.startDate ?? null));
      const clientIdRaw = pick("clientId", current?.clientId ?? null);
      const clientId = clientIdRaw === null || clientIdRaw === "" ? null : Number(clientIdRaw);
      if (!name) return json({ error: "Informe o nome do projeto." }, 400);
      if (!isTaskStatus(status)) return json({ error: "Status inválido." }, 400);
      if (!isProjectFarol(farol)) return json({ error: "Farol inválido." }, 400);
      if (!isProjectPhase(phase)) return json({ error: "Fase inválida." }, 400);
      if (startDate === undefined) return json({ error: "Informe uma data de início válida." }, 400);
      if (clientId !== null) {
        const [client] = Number.isInteger(clientId) ? await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1) : [];
        if (!client) return json({ error: "Escolha um cliente/projeto válido." }, 400);
      }
      const people = "people" in body ? await activePeople(db, body.people) : null;
      if (people === undefined) return json({ error: "Escolha responsáveis ativos." }, 400);

      const values = {
        name,
        description: cleanMultiline(pick("description", current?.description ?? ""), MAX_DESCRIPTION_LENGTH),
        clientId,
        status,
        farol,
        phase,
        deadlineLabel: cleanTitle(pick("deadlineLabel", current?.deadlineLabel ?? "")).slice(0, 60),
        startDate,
        endForecast: cleanTitle(pick("endForecast", current?.endForecast ?? "")).slice(0, 60),
        notes: cleanMultiline(pick("notes", current?.notes ?? ""), MAX_DESCRIPTION_LENGTH),
        updatedAt: now,
      };
      const [project] = projectId
        ? await db.update(projects).set(values).where(eq(projects.id, projectId)).returning()
        : await db.insert(projects).values({ ...values, createdAt: now }).returning();
      if (people) {
        await db.delete(projectPeople).where(eq(projectPeople.projectId, project.id));
        if (people.length) await db.insert(projectPeople).values(people.map((memberId) => ({ projectId: project.id, memberId })));
      }
      return json({ project }, projectId ? 200 : 201);
    }

    if (action === "linkTasks" || action === "unlinkTask") {
      const projectId = Number(body.projectId);
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) return json({ error: "Projeto não encontrado." }, 404);
      if (action === "unlinkTask") {
        await db.update(tasks).set({ projectId: null, updatedAt: now }).where(and(eq(tasks.id, Number(body.taskId)), eq(tasks.projectId, projectId)));
        return json({ ok: true });
      }
      const ids = Array.isArray(body.taskIds) ? [...new Set(body.taskIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0).slice(0, 100) : [];
      if (!ids.length) return json({ error: "Escolha ao menos uma demanda." }, 400);
      // Só liga demandas que ainda não estão em outro projeto.
      await db.update(tasks).set({ projectId, updatedAt: now }).where(and(inArray(tasks.id, ids), isNull(tasks.projectId)));
      return json({ ok: true });
    }

    if (action === "deleteProject") {
      if (member.role !== "admin") return json({ error: "Somente administradores podem excluir projetos." }, 403);
      const [deleted] = await db.delete(projects).where(eq(projects.id, Number(body.projectId))).returning();
      if (!deleted) return json({ error: "Projeto não encontrado." }, 404);
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "project_deleted", targetType: "project", targetId: deleted.id, details: `${projectCode(deleted.id)} ${deleted.name}` }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
