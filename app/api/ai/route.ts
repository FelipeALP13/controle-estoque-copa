import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings, kbArticles, teamMembers, ticketEvents, tickets, ticketSummaries } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { checkRateLimit, rateLimitKey, recordRateLimitFailure } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { sealSecret } from "../../secret-key";
import { canHandleTicket, ticketCode, ticketStatusLabels, ticketUrgencyLabels } from "../../tickets";
import { relatedArticles, similarTickets } from "../../knowledge";
import { AI_CALLS_PER_HOUR, AI_MODELS, isAiModel, replyRequest, resolutionOf, summaryRequest, SUMMARY_MIN_EVENTS, type AiTicket } from "../../ai-assist";
import { AI_KEY, AI_MODEL, AI_TEST_URL, aiSettings, askClaude } from "../../claude-client";

/** Assistente de chamados (Claude): resumo e sugestão de resposta. A chave é configurada por administradores. */
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const keyTail = (key: string) => `••••${key.slice(-4)}`;

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const settings = await aiSettings(db);
    const [tail] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, `${AI_KEY}_tail`)).limit(1);
    return json({ configured: Boolean(settings.sealedKey), model: settings.model, models: AI_MODELS, ...(member.role === "admin" ? { keyTail: tail?.value ?? null, testUrl: settings.testUrl || null, dev: Boolean(import.meta.env?.DEV) } : {}) });
  } catch (error) {
    console.error("ai settings failed", error);
    return json({ error: "Não foi possível carregar a configuração da IA." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const save = (key: string, value: string) => db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });

    // Configuração (só administradores).
    if (action === "saveKey" || action === "removeKey" || action === "saveModel" || action === "setTestUrl") {
      if (member.role !== "admin") return json({ error: "Só administradores configuram a IA." }, 403);
      if (action === "saveKey") {
        const key = String(body.key ?? "").trim();
        if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return json({ error: "Isso não parece uma chave da Anthropic (começa com sk-ant-)." }, 400);
        await save(AI_KEY, await sealSecret(key));
        await save(`${AI_KEY}_tail`, keyTail(key));
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "ai_key_saved", targetType: "setting", targetId: null, details: keyTail(key) }).catch((error) => console.error("audit log failed", error));
        return json({ ok: true, keyTail: keyTail(key) });
      }
      if (action === "removeKey") {
        await db.delete(appSettings).where(inArray(appSettings.key, [AI_KEY, `${AI_KEY}_tail`]));
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "ai_key_saved", targetType: "setting", targetId: null, details: "chave removida" }).catch((error) => console.error("audit log failed", error));
        return json({ ok: true });
      }
      if (action === "saveModel") {
        if (!isAiModel(body.model)) return json({ error: "Modelo inválido." }, 400);
        await save(AI_MODEL, body.model);
        return json({ ok: true });
      }
      // Servidor falso de teste: só no computador de desenvolvimento e só em 127.0.0.1.
      if (!import.meta.env?.DEV) return json({ error: "Disponível só no ambiente de desenvolvimento." }, 403);
      const url = String(body.url ?? "");
      if (url && !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return json({ error: "Só endereços http://127.0.0.1:porta/." }, 400);
      if (url) await save(AI_TEST_URL, url); else await db.delete(appSettings).where(eq(appSettings.key, AI_TEST_URL));
      return json({ ok: true });
    }

    if (action !== "summary" && action !== "reply") return json({ error: "Ação desconhecida." }, 400);
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, Number(body.ticketId))).limit(1);
    if (!ticket) return json({ error: "Chamado não encontrado." }, 404);
    const teamIds = (await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, member.id))).map((row) => row.teamId);
    const viewer = { isAdmin: member.role === "admin", canEdit: true, teamIds };
    if (!canHandleTicket(viewer, ticket.teamId) && ticket.requesterId !== member.id && ticket.assigneeId !== member.id) return json({ error: "Só quem atende ou abriu o chamado usa o assistente nele." }, 403);
    if (action === "reply" && !canHandleTicket(viewer, ticket.teamId) && ticket.assigneeId !== member.id) return json({ error: "A sugestão de resposta é para quem atende o chamado." }, 403);

    const events = await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticket.id)).orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
    const aiTicket: AiTicket = { code: ticketCode(ticket.id), title: ticket.title, description: ticket.description, client: ticket.client, status: ticketStatusLabels[ticket.status], urgency: ticketUrgencyLabels[ticket.urgency], requesterName: ticket.requesterName, createdAt: ticket.createdAt };
    const aiEvents = events.map((event) => ({ kind: event.kind, actorName: event.actorName, body: event.body, createdAt: event.createdAt }));

    // Resumo guardado: só refaz se o chamado mudou (ou se pedirem de novo). Não gasta créditos à toa.
    if (action === "summary") {
      if (events.length < SUMMARY_MIN_EVENTS && body.force !== true) return json({ error: `O resumo serve para chamados longos (a partir de ${SUMMARY_MIN_EVENTS} registros).` }, 400);
      const [cached] = await db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, ticket.id)).limit(1);
      if (cached && cached.basedOn === events.length && body.force !== true) return json({ text: cached.summary, cached: true, createdAt: cached.createdAt });
    }

    // Limite por pessoa por hora (protege os créditos da conta).
    const limitKey = await rateLimitKey("ai", String(member.id), "any");
    if ((await checkRateLimit(limitKey, db)).blocked) return json({ error: `Você usou o assistente muitas vezes na última hora (limite de ${AI_CALLS_PER_HOUR}). Tente mais tarde.` }, 429);
    await recordRateLimitFailure(limitKey, { maxAttempts: AI_CALLS_PER_HOUR, windowMinutes: 60, blockMinutes: 30 }, db);

    if (action === "summary") {
      const result = await askClaude(db, summaryRequest(aiTicket, aiEvents), "low");
      if (!result.ok) return json({ error: result.error }, 502);
      await db.insert(ticketSummaries).values({ ticketId: ticket.id, summary: result.text, basedOn: events.length, createdAt: now })
        .onConflictDoUpdate({ target: ticketSummaries.ticketId, set: { summary: result.text, basedOn: events.length, createdAt: now } });
      return json({ text: result.text, cached: false, createdAt: now });
    }

    // Sugestão: artigos parecidos da base e chamados parecidos já resolvidos (com o que resolveu).
    const query = `${ticket.title} ${ticket.client} ${ticket.description}`.slice(0, 600);
    const [articles, solvedRows] = await Promise.all([
      db.select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body, tags: kbArticles.tags, updatedAt: kbArticles.updatedAt }).from(kbArticles).then((rows) => rows.map((row) => ({ ...row, client: "" }))),
      db.select({ id: tickets.id, title: tickets.title, description: tickets.description, client: tickets.client, status: tickets.status, resolvedAt: tickets.resolvedAt, createdAt: tickets.createdAt, requesterId: tickets.requesterId }).from(tickets).where(eq(tickets.status, "resolved")).orderBy(desc(tickets.resolvedAt)).limit(800),
    ]);
    const related = relatedArticles(articles, query, 3);
    const similar = similarTickets(solvedRows, query, ticket.id, 3);
    const similarEvents = similar.length ? await db.select({ ticketId: ticketEvents.ticketId, kind: ticketEvents.kind, actorId: ticketEvents.actorId, body: ticketEvents.body }).from(ticketEvents).where(and(inArray(ticketEvents.ticketId, similar.map((row) => row.id)), eq(ticketEvents.kind, "comment"))) : [];
    const solved = similar.map((row) => ({ code: ticketCode(row.id), title: row.title, resolution: resolutionOf(similarEvents.filter((event) => event.ticketId === row.id), row.requesterId) }));
    const result = await askClaude(db, replyRequest(aiTicket, aiEvents, related.map((article) => ({ title: article.title, body: article.body })), solved), "medium");
    if (!result.ok) return json({ error: result.error }, 502);
    return json({ text: result.text, sources: { articles: related.map((article) => ({ id: article.id, title: article.title })), tickets: similar.map((row) => ({ id: row.id, code: ticketCode(row.id), title: row.title })) } });
  } catch (error) {
    console.error("ai request failed", error);
    return json({ error: "Não foi possível usar o assistente agora." }, 500);
  }
}
