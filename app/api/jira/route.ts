import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, jiraConnections, jiraProjects, teams, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { normalizeJiraUrl } from "../../jira";
import { jiraFetch, syncConnection, syncDue } from "../../jira-sync";
import { sealSecret } from "../../secret-key";
import { runJobs } from "../../jobs";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("jira request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a integração com o Jira. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** Só no ambiente de desenvolvimento (nunca no site publicado) aceita um Jira simulado em 127.0.0.1. */
const isLocal = (request: Request) => Boolean(import.meta.env?.DEV) && ["127.0.0.1", "localhost"].includes(new URL(request.url).hostname);

async function loadProjects(db: Db, connection: typeof jiraConnections.$inferSelect) {
  const found: { key: string; name: string }[] = [];
  for (let startAt = 0; startAt < 300; startAt += 100) {
    const page = await jiraFetch(connection, `/rest/api/3/project/search?maxResults=100&startAt=${startAt}&orderBy=key`) as { values?: { key: string; name: string }[]; isLast?: boolean };
    found.push(...(page?.values ?? []).map((project) => ({ key: project.key, name: project.name })));
    if (page?.isLast !== false) break;
  }
  const existing = new Set((await db.select({ key: jiraProjects.projectKey }).from(jiraProjects).where(eq(jiraProjects.connectionId, connection.id))).map((row) => row.key));
  for (const project of found) {
    if (existing.has(project.key)) await db.update(jiraProjects).set({ projectName: project.name }).where(and(eq(jiraProjects.connectionId, connection.id), eq(jiraProjects.projectKey, project.key)));
    else await db.insert(jiraProjects).values({ connectionId: connection.id, projectKey: project.key, projectName: project.name, enabled: false });
  }
  return found.length;
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores configuram o Jira." }, 403);
    const [connections, projects, clientRows, teamRows] = await Promise.all([
      db.select().from(jiraConnections).orderBy(asc(jiraConnections.name)),
      db.select().from(jiraProjects).orderBy(asc(jiraProjects.projectKey)),
      db.select({ id: clients.id, name: clients.name, active: clients.active }).from(clients).orderBy(asc(clients.name)),
      db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
    ]);
    return json({
      // A chave de API nunca sai do servidor.
      connections: connections.map((connection) => ({
        id: connection.id, name: connection.name, baseUrl: connection.baseUrl, email: connection.email, active: connection.active, teamId: connection.teamId,
        lastSyncAt: connection.lastSyncAt, cursorAt: connection.cursorAt, lastError: connection.lastError, createdAt: connection.createdAt,
        hasToken: Boolean(connection.apiToken),
      })),
      projects,
      clients: clientRows,
      teams: teamRows,
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
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const isAdmin = member.role === "admin";

    // Busca automática: qualquer pessoa logada dispara, no máximo a cada 2 minutos por conta.
    if (action === "sync") {
      const force = body.force === true && isAdmin;
      let results;
      try {
        results = await syncDue(db, force);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("no such table") || message.includes("no such column")) return json({ results: [], changed: false, more: false });
        throw error;
      }
      // Com o Portal aberto também saem os avisos (estoque baixo e atrasos), caso o agendador não esteja rodando.
      try { await runJobs(db, { includeJira: false }); } catch (error) { console.error("alerts during sync failed", error); }
      return json({
        // Detalhes de erro do Jira só para administradores.
        results: isAdmin ? results : results.map((result) => ({ ...result, error: result.error ? "erro" : null })),
        changed: results.some((result) => result.created || result.updated || result.comments),
        more: results.some((result) => result.more),
      });
    }

    if (!isAdmin) return json({ error: "Somente administradores configuram o Jira." }, 403);

    if (action === "saveConnection") {
      const connectionId = Number(body.connectionId) || 0;
      const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      const baseUrl = normalizeJiraUrl(String(body.baseUrl ?? ""), isLocal(request));
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
      const token = String(body.apiToken ?? "").trim();
      const teamId = Number(body.teamId) || null;
      if (!name) return json({ error: "Dê um nome para a conta (ex.: Jira Dr. Hoje)." }, 400);
      if (!baseUrl) return json({ error: "Informe o endereço do Jira no formato https://suaempresa.atlassian.net." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Informe o e-mail do usuário do Jira dono da chave." }, 400);
      const [current] = connectionId ? await db.select().from(jiraConnections).where(eq(jiraConnections.id, connectionId)).limit(1) : [];
      if (connectionId && !current) return json({ error: "Conta não encontrada." }, 404);
      // A chave nova chega em texto; a já guardada está criptografada (jiraFetch abre as duas).
      const apiToken = token || current?.apiToken || "";
      if (!apiToken) return json({ error: "Cole a chave de API (gerada em id.atlassian.com → Segurança → Tokens de API)." }, 400);
      if (teamId && !(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1)).length) return json({ error: "Escolha um time válido." }, 400);

      // Testa a conexão antes de salvar.
      let who: { displayName?: string; emailAddress?: string } | null;
      try {
        who = await jiraFetch({ baseUrl, email, apiToken }, "/rest/api/3/myself") as { displayName?: string; emailAddress?: string } | null;
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Não foi possível conectar ao Jira." }, 400);
      }
      let sealedToken: string;
      try {
        sealedToken = token ? await sealSecret(token) : apiToken;
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Não foi possível proteger a chave." }, 500);
      }
      const values = { name, baseUrl, email, apiToken: sealedToken, teamId, active: body.active !== false };
      // Mudou de endereço: recomeça a busca do zero nessa conta.
      const reset = current && current.baseUrl !== baseUrl ? { cursorAt: null } : {};
      const [saved] = current
        ? await db.update(jiraConnections).set({ ...values, ...reset, lastError: null }).where(eq(jiraConnections.id, current.id)).returning()
        : await db.insert(jiraConnections).values({ ...values, createdAt: new Date().toISOString() }).returning();
      let projectCount = 0;
      try { projectCount = await loadProjects(db, saved); } catch (error) { console.error("jira projects load failed", error); }
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: current ? "jira_connection_updated" : "jira_connection_created", targetType: "jira_connection", targetId: saved.id, details: `${name} (${baseUrl})` }).catch((error) => console.error("audit log failed", error));
      return json({ connectionId: saved.id, user: who?.displayName ?? email, projects: projectCount }, current ? 200 : 201);
    }

    const connectionId = Number(body.connectionId);
    const [connection] = connectionId ? await db.select().from(jiraConnections).where(eq(jiraConnections.id, connectionId)).limit(1) : [];
    if (!connection) return json({ error: "Conta do Jira não encontrada." }, 404);

    if (action === "loadProjects") {
      try {
        return json({ projects: await loadProjects(db, connection) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Não foi possível listar os projetos." }, 400);
      }
    }

    if (action === "saveProject") {
      const projectKey = String(body.projectKey ?? "");
      const clientId = Number(body.clientId) || null;
      if (clientId && !(await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1)).length) return json({ error: "Escolha um cliente válido." }, 400);
      const [saved] = await db.update(jiraProjects).set({ enabled: body.enabled === true, clientId })
        .where(and(eq(jiraProjects.connectionId, connection.id), eq(jiraProjects.projectKey, projectKey))).returning();
      if (!saved) return json({ error: "Projeto não encontrado nesta conta." }, 404);
      return json({ project: saved });
    }

    if (action === "syncNow") {
      const result = await syncConnection(db, connection);
      return json({ result });
    }

    if (action === "deleteConnection") {
      const [{ count } = { count: 0 }] = await db.select({ count: tickets.id }).from(tickets).where(eq(tickets.jiraConnectionId, connection.id)).limit(1);
      await db.delete(jiraConnections).where(eq(jiraConnections.id, connection.id));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "jira_connection_deleted", targetType: "jira_connection", targetId: connection.id, details: connection.name }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true, keptTickets: Boolean(count) });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
