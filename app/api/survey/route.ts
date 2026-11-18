import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { notifications, ticketEvents, tickets } from "../../../db/schema";
import { checkRateLimit, rateLimitKey, recordRateLimitFailure } from "../../auth-session";
import { clientIp, hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { isRating, isSurveyToken, MAX_RATING_COMMENT, RATING_LABELS, stars, surveyState } from "../../ticket-rating";
import { cleanMultiline } from "../../tasks";
import { ticketCode } from "../../tickets";

/**
 * Pesquisa de satisfação do cliente (pública, sem login): o código do link identifica o chamado.
 * Mostra só o número e o título; nada interno (comentários, equipe, prazos) sai por aqui.
 */
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

async function findTicket(token: string) {
  const db = getDb();
  const [ticket] = await db.select({ id: tickets.id, title: tickets.title, status: tickets.status, rating: tickets.rating, assigneeId: tickets.assigneeId })
    .from(tickets).where(eq(tickets.surveyToken, token)).limit(1);
  return ticket ?? null;
}

/** Limita tentativas por IP (evita varrer códigos). */
async function limited(request: Request) {
  const key = await rateLimitKey("survey", "link", clientIp(request));
  const state = await checkRateLimit(key);
  return { key, blocked: state.blocked };
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    const limit = await limited(request);
    if (limit.blocked) return json({ error: "Muitas tentativas. Tente de novo em alguns minutos." }, 429);
    if (!isSurveyToken(token)) return json({ error: "Link de avaliação inválido." }, 404);
    const ticket = await findTicket(token);
    if (!ticket) {
      await recordRateLimitFailure(limit.key, { maxAttempts: 20, windowMinutes: 15, blockMinutes: 15 });
      return json({ error: "Link de avaliação inválido ou expirado." }, 404);
    }
    return json({ code: ticketCode(ticket.id), title: ticket.title, state: surveyState(ticket), rating: ticket.rating });
  } catch (error) {
    console.error("survey load failed", error);
    return json({ error: "Não foi possível abrir a avaliação agora." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const limit = await limited(request);
    if (limit.blocked) return json({ error: "Muitas tentativas. Tente de novo em alguns minutos." }, 429);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (!isSurveyToken(body.token)) return json({ error: "Link de avaliação inválido." }, 404);
    if (!isRating(body.rating)) return json({ error: "Escolha uma nota de 1 a 5 estrelas." }, 400);
    const ticket = await findTicket(body.token);
    if (!ticket) {
      await recordRateLimitFailure(limit.key, { maxAttempts: 20, windowMinutes: 15, blockMinutes: 15 });
      return json({ error: "Link de avaliação inválido ou expirado." }, 404);
    }
    const state = surveyState(ticket);
    if (state === "done") return json({ error: "Este atendimento já foi avaliado. Obrigado!" }, 409);
    if (state === "pending") return json({ error: "Este atendimento ainda está em andamento. A avaliação abre quando ele for concluído." }, 409);

    const db = getDb();
    const rating = Number(body.rating);
    const comment = cleanMultiline(body.comment, MAX_RATING_COMMENT);
    const now = new Date().toISOString();
    // Só grava se ainda não tiver nota (dois envios ao mesmo tempo não sobrescrevem).
    const saved = await db.update(tickets).set({ rating, ratingComment: comment, ratedAt: now, ratedBy: "client" })
      .where(and(eq(tickets.id, ticket.id), isNull(tickets.rating), eq(tickets.status, "resolved"))).returning({ id: tickets.id });
    if (!saved.length) return json({ error: "Este atendimento já foi avaliado. Obrigado!" }, 409);
    await db.insert(ticketEvents).values({ ticketId: ticket.id, kind: "comment", body: `O cliente avaliou o atendimento: ${stars(rating)} (${RATING_LABELS[rating]})${comment ? ` · “${comment}”` : ""}`, actorId: null, actorName: "Cliente", createdAt: now });
    if (ticket.assigneeId) {
      await db.insert(notifications).values({ memberId: ticket.assigneeId, kind: "ticket_comment", ticketId: ticket.id, actorName: "Cliente", body: `Avaliação do cliente: ${stars(rating)}`, createdAt: now }).catch((error) => console.error("survey notification failed", error));
    }
    return json({ ok: true });
  } catch (error) {
    console.error("survey answer failed", error);
    return json({ error: "Não foi possível enviar a avaliação agora." }, 500);
  }
}
