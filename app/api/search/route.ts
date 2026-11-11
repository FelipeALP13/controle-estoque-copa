import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, kbArticles, members, projects, taskLegacyCodes, tasks, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { projectCode } from "../../projects";
import { rankSearch, type SearchEntry } from "../../search";
import { taskCode, taskStatusLabels, type TaskStatus } from "../../tasks";
import { ticketCode, ticketStatusLabels } from "../../tickets";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Lê uma tabela opcional; se a migração ainda não existe no banco, segue sem ela. */
async function optional<T>(load: () => Promise<T[]>) {
  try { return await load(); } catch { return [] as T[]; }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const query = String(new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
    if (query.length < 2) return json({ results: [] });

    // Só os campos usados na busca: títulos, códigos e nomes (sem textos longos de comentários).
    const [taskRows, codeRows, clientRows, ticketRows, articleRows, projectRows, people] = await Promise.all([
      optional(() => db.select({ id: tasks.id, title: tasks.title, status: tasks.status, clientId: tasks.clientId, origin: tasks.origin, updatedAt: tasks.updatedAt }).from(tasks)),
      optional(() => db.select().from(taskLegacyCodes)),
      optional(() => db.select({ id: clients.id, name: clients.name }).from(clients)),
      optional(() => db.select({ id: tickets.id, title: tickets.title, status: tickets.status, client: tickets.client, requesterName: tickets.requesterName, externalKey: tickets.externalKey, updatedAt: tickets.updatedAt }).from(tickets)),
      optional(() => db.select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body, tags: kbArticles.tags, updatedAt: kbArticles.updatedAt }).from(kbArticles)),
      optional(() => db.select({ id: projects.id, name: projects.name, status: projects.status, clientId: projects.clientId, updatedAt: projects.updatedAt }).from(projects)),
      optional(() => db.select({ id: members.id, name: members.name, jobTitle: members.jobTitle, email: members.email }).from(members).where(eq(members.active, true))),
    ]);
    const clientName = new Map(clientRows.map((row) => [row.id, row.name]));
    const legacy = new Map<number, string[]>();
    for (const row of codeRows) legacy.set(row.taskId, [...(legacy.get(row.taskId) ?? []), row.code]);

    const entries: SearchEntry[] = [
      ...taskRows.map((task) => ({
        kind: "task" as const, id: task.id, title: task.title,
        subtitle: [taskStatusLabels[task.status], task.clientId ? clientName.get(task.clientId) : ""].filter(Boolean).join(" · "),
        codes: [taskCode(task.id), ...(legacy.get(task.id) ?? [])], extra: task.origin, closed: task.status === "done" || task.status === "canceled", updatedAt: task.updatedAt,
      })),
      ...ticketRows.map((ticket) => ({
        kind: "ticket" as const, id: ticket.id, title: ticket.title,
        subtitle: [ticketStatusLabels[ticket.status], ticket.client, `por ${ticket.requesterName}`].filter(Boolean).join(" · "),
        codes: [ticketCode(ticket.id), ...(ticket.externalKey ? [ticket.externalKey] : [])], closed: ticket.status === "resolved" || ticket.status === "canceled", updatedAt: ticket.updatedAt,
      })),
      ...articleRows.map((article) => ({ kind: "article" as const, id: article.id, title: article.title, subtitle: article.tags ? `#${article.tags.split(", ").join(" #")}` : "Base de conhecimento", codes: [], extra: article.body.slice(0, 3000), updatedAt: article.updatedAt })),
      ...projectRows.map((project) => ({
        kind: "project" as const, id: project.id, title: project.name,
        subtitle: [taskStatusLabels[project.status as TaskStatus] ?? project.status, project.clientId ? clientName.get(project.clientId) : ""].filter(Boolean).join(" · "),
        codes: [projectCode(project.id)], closed: project.status === "done" || project.status === "canceled", updatedAt: project.updatedAt,
      })),
      ...people.map((person) => ({ kind: "person" as const, id: person.id, title: person.name, subtitle: person.jobTitle || person.email, codes: [] })),
    ];
    // O texto longo (artigos, origem) só serve para achar; não volta na resposta.
    return json({ results: rankSearch(entries, query, 6).map((hit) => ({ ...hit, extra: undefined })) });
  } catch (error) {
    console.error("search failed", error);
    return json({ error: "Não foi possível buscar agora." }, 500);
  }
}
