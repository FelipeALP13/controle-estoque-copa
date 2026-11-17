import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrationKeys, kbArticles, teams } from "../../../../db/schema";
import { getSessionMember } from "../../../auth-session";
import { writeAudit } from "../../../audit";
import { hasTrustedOrigin } from "../../../request-security";
import { readJsonBody } from "../../../api-input";
import { allowedArticles, generateIntegrationKey, hashIntegrationKey, keyPrefix, normalizeKbTag } from "../../../integration-tools";

/** Chaves de integração (só administradores): criar, ajustar e revogar. A chave aparece uma vez só. */

const MAX_ACTIVE_KEYS = 10;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("integration keys request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem as integrações. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

async function admin() {
  const db = getDb();
  const member = await getSessionMember(db);
  if (!member) return { db, member: null, response: json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401) };
  if (!member.active || member.role !== "admin") return { db, member: null, response: json({ error: "Só administradores gerenciam integrações." }, 403) };
  return { db, member, response: null };
}

export async function GET() {
  try {
    const { db, member, response } = await admin();
    if (!member) return response!;
    const [keys, teamRows, articles] = await Promise.all([
      db.select().from(integrationKeys).orderBy(desc(integrationKeys.createdAt)),
      db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(teams.name),
      db.select({ id: kbArticles.id, title: kbArticles.title, body: kbArticles.body, tags: kbArticles.tags, updatedAt: kbArticles.updatedAt }).from(kbArticles),
    ]);
    return json({
      keys: keys.map((key) => ({
        id: key.id, name: key.name, prefix: key.keyPrefix, teamId: key.teamId, kbTag: key.kbTag,
        teamName: teamRows.find((team) => team.id === key.teamId)?.name ?? null,
        createdByName: key.createdByName, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt, revokedAt: key.revokedAt,
        // Quantos artigos o N1 consegue ler com esta etiqueta.
        articles: allowedArticles(articles.map((article) => ({ ...article, client: "" })), key.kbTag).length,
      })),
      teams: teamRows,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const { db, member, response } = await admin();
    if (!member) return response!;
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const audit = (actionName: string, targetId: number, details: string) =>
      writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: actionName, targetType: "integration_key", targetId, details }).catch((error) => console.error("audit log failed", error));

    const teamFor = async (value: unknown) => {
      const teamId = Number(value) || null;
      if (!teamId) return { teamId: null, error: null };
      const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
      return team ? { teamId: team.id, error: null } : { teamId: null, error: "Time não encontrado." };
    };

    if (action === "createKey") {
      const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!name) return json({ error: "Dê um nome para a chave (ex.: AtendeChat produção)." }, 400);
      const { teamId, error } = await teamFor(body.teamId);
      if (error) return json({ error }, 400);
      if (!teamId) return json({ error: "Escolha o time que recebe os chamados abertos pelo N1." }, 400);
      const active = (await db.select({ id: integrationKeys.id, revokedAt: integrationKeys.revokedAt }).from(integrationKeys)).filter((key) => !key.revokedAt);
      if (active.length >= MAX_ACTIVE_KEYS) return json({ error: `Já existem ${MAX_ACTIVE_KEYS} chaves ativas. Revogue alguma antes.` }, 409);
      const key = generateIntegrationKey();
      const [created] = await db.insert(integrationKeys).values({
        name, kind: "atendechat", keyHash: await hashIntegrationKey(key), keyPrefix: keyPrefix(key),
        teamId, kbTag: normalizeKbTag(body.kbTag), createdByName: member.name, createdAt: now,
      }).returning({ id: integrationKeys.id });
      await audit("integration_key_created", created.id, name);
      // Única vez em que a chave sai do servidor.
      return json({ id: created.id, key }, 201);
    }

    if (action === "updateKey") {
      const id = Number(body.id);
      const [current] = await db.select().from(integrationKeys).where(eq(integrationKeys.id, id)).limit(1);
      if (!current) return json({ error: "Chave não encontrada." }, 404);
      if (current.revokedAt) return json({ error: "Chave revogada não pode ser alterada." }, 409);
      const { teamId, error } = await teamFor(body.teamId);
      if (error) return json({ error }, 400);
      if (!teamId) return json({ error: "Escolha o time que recebe os chamados abertos pelo N1." }, 400);
      await db.update(integrationKeys).set({ teamId, kbTag: normalizeKbTag(body.kbTag) }).where(eq(integrationKeys.id, id));
      await audit("integration_key_updated", id, current.name);
      return json({ ok: true });
    }

    if (action === "revokeKey") {
      const id = Number(body.id);
      const [current] = await db.select().from(integrationKeys).where(eq(integrationKeys.id, id)).limit(1);
      if (!current) return json({ error: "Chave não encontrada." }, 404);
      if (!current.revokedAt) await db.update(integrationKeys).set({ revokedAt: now }).where(eq(integrationKeys.id, id));
      await audit("integration_key_revoked", id, current.name);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
