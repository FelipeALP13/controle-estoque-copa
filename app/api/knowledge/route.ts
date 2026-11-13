import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, kbArticles, teams, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { MAX_KB_BODY, MAX_KB_TITLE, parseTags } from "../../knowledge";
import { readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("knowledge request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem a base de conhecimento. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const cleanTitle = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_KB_TITLE);
const cleanBody = (value: unknown) => String(value ?? "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, MAX_KB_BODY);

async function optionalId(db: Db, table: typeof clients | typeof teams | typeof tickets, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  return row ? row.id : undefined;
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    const [articles, clientRows, teamRows] = await Promise.all([
      db.select().from(kbArticles).orderBy(desc(kbArticles.updatedAt), desc(kbArticles.id)),
      db.select({ id: clients.id, name: clients.name, active: clients.active }).from(clients).orderBy(asc(clients.name)),
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
    ]);
    const isAdmin = member.role === "admin";
    return json({
      articles: articles.map((article) => ({ ...article, canDelete: isAdmin || article.createdById === member.id })),
      clients: clientRows,
      teams: teamRows,
      me: { id: member.id, canEdit: member.role !== "viewer", isAdmin },
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
    if (!member.active || member.role === "viewer") return json({ error: "Seu perfil pode apenas consultar a base." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "saveArticle") {
      const articleId = Number(body.articleId) || 0;
      const title = cleanTitle(body.title);
      const text = cleanBody(body.body);
      if (!title) return json({ error: "Dê um título que descreva o problema." }, 400);
      if (text.length < 10) return json({ error: "Escreva a solução (pelo menos uma frase)." }, 400);
      const clientId = await optionalId(db, clients, body.clientId);
      const teamId = await optionalId(db, teams, body.teamId);
      const ticketId = await optionalId(db, tickets, body.ticketId);
      if (clientId === undefined) return json({ error: "Escolha um cliente válido." }, 400);
      if (teamId === undefined) return json({ error: "Escolha um time válido." }, 400);
      if (ticketId === undefined) return json({ error: "Chamado não encontrado." }, 400);
      const [duplicate] = await db.select({ id: kbArticles.id }).from(kbArticles).where(sql`lower(${kbArticles.title}) = lower(${title})`).limit(1);
      if (duplicate && duplicate.id !== articleId) return json({ error: "Já existe um artigo com esse título. Abra-o e complemente." }, 409);
      const values = { title, body: text, clientId, teamId, tags: parseTags(body.tags).join(", "), updatedByName: member.name, updatedAt: now };
      if (articleId) {
        const [article] = await db.update(kbArticles).set(values).where(eq(kbArticles.id, articleId)).returning();
        if (!article) return json({ error: "Artigo não encontrado." }, 404);
        return json({ article });
      }
      const [article] = await db.insert(kbArticles).values({ ...values, ticketId, createdById: member.id, createdByName: member.name, createdAt: now }).returning();
      return json({ article }, 201);
    }

    if (action === "deleteArticle") {
      const articleId = Number(body.articleId);
      const [article] = await db.select().from(kbArticles).where(eq(kbArticles.id, articleId)).limit(1);
      if (!article) return json({ error: "Artigo não encontrado." }, 404);
      if (member.role !== "admin" && article.createdById !== member.id) return json({ error: "Só quem escreveu o artigo ou um administrador pode excluir." }, 403);
      await db.delete(kbArticles).where(eq(kbArticles.id, articleId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "kb_article_deleted", targetType: "kb_article", targetId: articleId, details: article.title }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
