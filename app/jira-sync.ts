// Sincronização Jira → Portal. Roda no servidor, chamada pela API (/api/jira).
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { jiraConnections, jiraProjects, clients, members, notifications, teamMembers, teams, ticketEvents, tickets } from "../db/schema";
import { basicAuth, buildJql, JIRA_FIELDS, jiraErrorMessage, MAX_PAGES_PER_SYNC, minutesSince, nextStatus, PAGE_SIZE, parseIssue, SYNC_INTERVAL_MS, type JiraIssueData } from "./jira";

type Db = ReturnType<typeof getDb>;
type Connection = typeof jiraConnections.$inferSelect;
export type SyncResult = { connectionId: number; name: string; created: number; updated: number; comments: number; error: string | null; skipped?: boolean; more?: boolean };

const LOCK_MS = 90 * 1000;
/** Itens por busca: o banco limita as consultas por requisição. Se houver mais, a próxima continua. */
const MAX_ISSUES_PER_SYNC = 40;

/** Chamada à API do Jira com a chave da conta. */
export async function jiraFetch(connection: Pick<Connection, "baseUrl" | "email" | "apiToken">, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: basicAuth(connection.email, connection.apiToken), Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Não foi possível falar com o Jira (fora do ar, sem internet ou endereço errado). A próxima busca tenta de novo.");
  }
  const text = await response.text();
  if (!response.ok) throw new Error(jiraErrorMessage(response.status, text));
  return text ? JSON.parse(text) as unknown : null;
}

async function supportTeamId(db: Db, connection: Connection) {
  if (connection.teamId) return connection.teamId;
  const [team] = await db.select({ id: teams.id }).from(teams).where(sql`lower(${teams.name}) = 'suporte'`).limit(1);
  return team?.id ?? null;
}

async function teamMemberIds(db: Db, teamId: number | null) {
  if (!teamId) return [];
  const rows = await db.select({ id: members.id }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.teamId, teamId), eq(members.active, true)));
  return rows.map((row) => row.id);
}

async function notify(db: Db, ticketId: number, kind: "ticket_new" | "ticket_comment" | "ticket_status", memberIds: number[], body: string, actorName: string) {
  if (!memberIds.length) return;
  try {
    await db.insert(notifications).values([...new Set(memberIds)].map((memberId) => ({ memberId, kind, ticketId, body: body.slice(0, 140), actorName, createdAt: new Date().toISOString() })));
  } catch (error) {
    console.error("jira notification failed", error);
  }
}

/** Grava (cria ou atualiza) um item do Jira como chamado. */
async function upsertIssue(db: Db, connection: Connection, issue: JiraIssueData, clientName: string, teamId: number | null) {
  // Procura pela conta e chave; se a conta foi removida e cadastrada de novo, reconhece pelo link do Jira.
  const [current] = await db.select().from(tickets)
    .where(or(and(eq(tickets.jiraConnectionId, connection.id), eq(tickets.externalKey, issue.key)), and(isNull(tickets.jiraConnectionId), eq(tickets.externalUrl, issue.url))))
    .limit(1);
  if (current && current.jiraConnectionId === null) await db.update(tickets).set({ jiraConnectionId: connection.id }).where(eq(tickets.id, current.id));
  const actorName = `${issue.reporter} (Jira)`;
  let created = 0;
  let updated = 0;
  let ticketId: number;
  let assigneeId: number | null = null;

  if (!current) {
    const [ticket] = await db.insert(tickets).values({
      title: issue.title, description: issue.description, type: issue.type, urgency: issue.urgency, status: issue.status,
      client: clientName.slice(0, 80), teamId, requesterId: null, requesterName: actorName,
      firstResponseAt: issue.firstResponse, resolvedAt: issue.resolved, createdAt: issue.created, updatedAt: issue.updated,
      source: "jira", jiraConnectionId: connection.id, externalKey: issue.key, externalUrl: issue.url,
      externalStatus: issue.statusName, externalCategory: issue.category, externalUpdatedAt: issue.updated,
    }).returning({ id: tickets.id });
    ticketId = ticket.id;
    created = 1;
    await db.insert(ticketEvents).values({ ticketId, kind: "created", body: `Trazido do Jira (${issue.key})`, actorId: null, actorName, createdAt: issue.created, externalId: `created:${issue.key}` }).onConflictDoNothing();
    if (issue.status !== "resolved") await notify(db, ticketId, "ticket_new", await teamMemberIds(db, teamId), `${issue.key} · ${issue.title}`, actorName);
  } else {
    ticketId = current.id;
    assigneeId = current.assigneeId;
    if (current.externalUpdatedAt !== issue.updated || current.title !== issue.title) {
      const status = nextStatus(current.status, current.externalCategory, issue);
      await db.update(tickets).set({
        title: issue.title, description: issue.description, type: issue.type, urgency: issue.urgency, status,
        client: clientName.slice(0, 80) || current.client,
        firstResponseAt: current.firstResponseAt ?? issue.firstResponse,
        resolvedAt: status === "resolved" ? current.resolvedAt ?? issue.resolved : null,
        externalStatus: issue.statusName, externalCategory: issue.category, externalUpdatedAt: issue.updated, externalUrl: issue.url,
        updatedAt: new Date().toISOString(),
      }).where(eq(tickets.id, ticketId));
      if (status !== current.status) {
        await db.insert(ticketEvents).values({ ticketId, kind: "status", body: status, actorId: null, actorName: `Jira (${issue.statusName})`, createdAt: issue.updated });
        if (current.assigneeId) await notify(db, ticketId, "ticket_status", [current.assigneeId], `${issue.key}: ${issue.statusName}`, "Jira");
      }
      updated = 1;
    }
  }

  // Comentários novos do Jira (cada um entra uma vez só).
  let comments = 0;
  if (issue.comments.length) {
    const existing = new Set((await db.select({ externalId: ticketEvents.externalId }).from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId))).map((row) => row.externalId));
    const fresh = issue.comments.filter((comment) => !existing.has(`comment:${comment.id}`));
    for (const comment of fresh) {
      await db.insert(ticketEvents).values({ ticketId, kind: "comment", body: comment.body.slice(0, 4000) || "(comentário sem texto)", actorId: null, actorName: `${comment.author} (Jira)`, createdAt: comment.created, externalId: `comment:${comment.id}` }).onConflictDoNothing();
      comments += 1;
    }
    if (fresh.length && !created && assigneeId) await notify(db, ticketId, "ticket_comment", [assigneeId], `${issue.key}: ${fresh.at(-1)!.body}`, `${fresh.at(-1)!.author} (Jira)`);
  }
  return { created, updated, comments };
}

/** Sincroniza uma conta. Usa uma trava no banco para duas abas não buscarem ao mesmo tempo. */
export async function syncConnection(db: Db, connection: Connection, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { connectionId: connection.id, name: connection.name, created: 0, updated: 0, comments: 0, error: null };
  const nowIso = now.toISOString();
  const locked = await db.update(jiraConnections).set({ lockUntil: new Date(now.getTime() + LOCK_MS).toISOString() })
    .where(and(eq(jiraConnections.id, connection.id), or(isNull(jiraConnections.lockUntil), lt(jiraConnections.lockUntil, nowIso))))
    .returning({ id: jiraConnections.id });
  if (!locked.length) return { ...result, skipped: true };

  try {
    const projectRows = await db.select({ key: jiraProjects.projectKey, name: jiraProjects.projectName, clientName: clients.name })
      .from(jiraProjects).leftJoin(clients, eq(jiraProjects.clientId, clients.id))
      .where(and(eq(jiraProjects.connectionId, connection.id), eq(jiraProjects.enabled, true)));
    if (!projectRows.length) {
      await db.update(jiraConnections).set({ lastSyncAt: nowIso, lastError: null, lockUntil: null }).where(eq(jiraConnections.id, connection.id));
      return result;
    }
    const clientOf = new Map(projectRows.map((row) => [row.key, row.clientName ?? row.name]));
    const teamId = await supportTeamId(db, connection);
    const jql = buildJql(projectRows.map((row) => row.key), minutesSince(connection.cursorAt, now));

    // A busca vem do mais antigo para o mais novo; se parar no meio (limite por vez),
    // o ponto salvo é o último item gravado e a próxima busca continua dali.
    let cursor = connection.cursorAt;
    let pageToken: string | undefined;
    let finished = false;
    let processed = 0;
    pages: for (let page = 0; page < MAX_PAGES_PER_SYNC; page += 1) {
      const data = await jiraFetch(connection, "/rest/api/3/search/jql", { method: "POST", body: JSON.stringify({ jql, fields: JIRA_FIELDS, maxResults: PAGE_SIZE, ...(pageToken ? { nextPageToken: pageToken } : {}) }) }) as { issues?: unknown[]; nextPageToken?: string; isLast?: boolean };
      const issues = data?.issues ?? [];
      for (let index = 0; index < issues.length; index += 1) {
        if (processed >= MAX_ISSUES_PER_SYNC) break pages;
        const issue = parseIssue(issues[index], connection.baseUrl);
        processed += 1;
        if (!issue) continue;
        const counts = await upsertIssue(db, connection, issue, clientOf.get(issue.projectKey) ?? issue.projectKey, teamId);
        result.created += counts.created;
        result.updated += counts.updated;
        result.comments += counts.comments;
        cursor = issue.updated;
      }
      pageToken = data?.nextPageToken;
      if (!pageToken || data?.isLast) { finished = true; break; }
    }
    result.more = !finished;
    await db.update(jiraConnections).set({ lastSyncAt: nowIso, cursorAt: finished ? nowIso : cursor, lastError: null, lockUntil: null }).where(eq(jiraConnections.id, connection.id));
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Falha ao buscar no Jira.";
    await db.update(jiraConnections).set({ lastSyncAt: nowIso, lastError: result.error.slice(0, 300), lockUntil: null }).where(eq(jiraConnections.id, connection.id));
  }
  return result;
}

/** Sincroniza as contas ativas que não buscaram nos últimos 2 minutos (ou todas, se `force`). */
export async function syncDue(db: Db, force = false, now = new Date()) {
  const rows = await db.select().from(jiraConnections).where(eq(jiraConnections.active, true));
  const due = rows.filter((row) => force || !row.lastSyncAt || now.getTime() - Date.parse(row.lastSyncAt) >= SYNC_INTERVAL_MS);
  const results: SyncResult[] = [];
  for (const connection of due) results.push(await syncConnection(db, connection, now));
  return results;
}
