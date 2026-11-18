import { and, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrationKeys, kbArticles, members, notifications, teamMembers, ticketEvents, tickets } from "../../../../db/schema";
import { readJsonBody } from "../../../api-input";
import { ticketCode } from "../../../tickets";
import { allowedArticles, bearerKey, clip, externalTicketDescription, hashIntegrationKey, MAX_ARTICLE_CHARS, parseExternalTicket, searchForAgent } from "../../../integration-tools";

/**
 * API do Portal para o agente N1 do AtendeChat (servidor para servidor, com chave de integração).
 * GET  ?q=...                         → artigos da base liberados para o N1 (etiqueta da chave)
 * POST { action: "createTicket", ...} → chamado na fila do time da chave, sem responsável
 * Não usa o login do Portal: a chave vai no cabeçalho "Authorization: Bearer pk_ac_...".
 */

type Db = ReturnType<typeof getDb>;
type Key = typeof integrationKeys.$inferSelect;

/** Chamados que a integração pode abrir por hora (proteção contra um robô em laço). */
const MAX_TICKETS_PER_HOUR = 60;
const ACTOR = "N1 · AtendeChat";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("atendechat integration failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table")) return json({ error: "O Portal ainda não tem a integração. Publique novamente para aplicar a migração." }, 503);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** Chave válida e não revogada; marca o último uso (no máximo uma vez por minuto). */
async function authenticate(db: Db, request: Request): Promise<Key | null> {
  const key = bearerKey(request.headers.get("Authorization"));
  if (!key) return null;
  const hash = await hashIntegrationKey(key);
  const [row] = await db.select().from(integrationKeys).where(and(eq(integrationKeys.keyHash, hash), eq(integrationKeys.kind, "atendechat"), isNull(integrationKeys.revokedAt))).limit(1);
  if (!row) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - Date.parse(row.lastUsedAt) > 60000) {
    await db.update(integrationKeys).set({ lastUsedAt: now.toISOString() }).where(eq(integrationKeys.id, row.id)).catch(() => undefined);
  }
  return row;
}

const unauthorized = () => json({ error: "Chave de integração inválida ou revogada." }, 401);

export async function GET(request: Request) {
  try {
    const db = getDb();
    const key = await authenticate(db, request);
    if (!key) return unauthorized();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    if (query.trim().length < 2) return json({ error: "Informe o que buscar (q)." }, 400);
    const rows = await db.select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body, tags: kbArticles.tags, updatedAt: kbArticles.updatedAt }).from(kbArticles);
    const visible = allowedArticles(rows.map((row) => ({ ...row, client: "" })), key.kbTag);
    const found = searchForAgent(visible, query);
    return json({
      articles: found.map((article) => ({ id: article.id, title: article.title, body: clip(article.body, MAX_ARTICLE_CHARS), tags: article.tags, updatedAt: article.updatedAt })),
      searched: visible.length,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const db = getDb();
    const key = await authenticate(db, request);
    if (!key) return unauthorized();
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (body.action !== "createTicket") return json({ error: "Ação desconhecida." }, 400);

    const { ticket: input, error } = parseExternalTicket(body);
    if (!input) return json({ error }, 400);
    const externalKey = `AC-${input.externalId}`;

    // O mesmo atendimento não abre dois chamados enquanto o primeiro estiver aberto.
    const [existing] = await db.select({ id: tickets.id }).from(tickets)
      .where(and(eq(tickets.source, "atendechat"), eq(tickets.externalKey, externalKey), notInArray(tickets.status, ["resolved", "canceled"]))).limit(1);
    if (existing) return json({ ticket: { id: existing.id, code: ticketCode(existing.id) }, duplicate: true });

    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const [recent] = await db.select({ count: sql<number>`count(*)` }).from(tickets).where(and(eq(tickets.source, "atendechat"), gt(tickets.createdAt, hourAgo)));
    if (Number(recent?.count ?? 0) >= MAX_TICKETS_PER_HOUR) return json({ error: "Limite de chamados por hora atingido. Tente mais tarde." }, 429);

    const now = new Date().toISOString();
    const [created] = await db.insert(tickets).values({
      title: input.title, description: externalTicketDescription(input), type: "question", urgency: input.urgency, status: "open",
      client: input.company, teamId: key.teamId, requesterId: null, requesterName: ACTOR,
      source: "atendechat", externalKey, externalUrl: input.conversationUrl, createdAt: now, updatedAt: now,
    }).returning({ id: tickets.id });
    await db.insert(ticketEvents).values({ ticketId: created.id, kind: "created", body: `Aberto pelo agente N1 (atendimento ${input.externalId})`, actorId: null, actorName: ACTOR, createdAt: now });

    // Aviso para o time da chave: o chamado cai na fila, sem responsável.
    if (key.teamId) {
      try {
        const people = await db.select({ id: members.id }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.teamId, key.teamId), eq(members.active, true)));
        if (people.length) await db.insert(notifications).values(people.map((person) => ({ memberId: person.id, kind: "ticket_new" as const, ticketId: created.id, body: `${ticketCode(created.id)} · ${input.title}`.slice(0, 140), actorName: ACTOR, createdAt: now })));
      } catch (notifyError) {
        console.error("atendechat ticket notification failed", notifyError);
      }
    }
    return json({ ticket: { id: created.id, code: ticketCode(created.id) } }, 201);
  } catch (error) {
    return failure(error);
  }
}
