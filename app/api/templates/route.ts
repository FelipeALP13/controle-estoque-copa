import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { taskTemplates, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { exampleTemplates, parseItems } from "../../checklists";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, cleanTitle, isTaskPriority, MAX_DESCRIPTION_LENGTH, taskCategories } from "../../tasks";
import { readJsonBody } from "../../api-input";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("templates request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem os modelos. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const toClient = (row: typeof taskTemplates.$inferSelect) => ({ ...row, items: parseItems(row.items) });

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const rows = await db.select().from(taskTemplates).orderBy(asc(taskTemplates.name));
    return json({ templates: rows.map(toClient), canManage: member.role === "admin" });
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
    if (member.role !== "admin") return json({ error: "Somente administradores mantêm os modelos." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "saveTemplate") {
      const templateId = Number(body.templateId) || 0;
      const name = cleanTitle(body.name).slice(0, 60);
      const items = parseItems(body.items);
      const category = String(body.category ?? "").trim();
      const teamId = Number(body.teamId) || null;
      if (!name) return json({ error: "Dê um nome ao modelo." }, 400);
      if (!items.length) return json({ error: "Escreva pelo menos um passo (um por linha)." }, 400);
      if (category && !(taskCategories as readonly string[]).includes(category)) return json({ error: "Escolha uma categoria da lista." }, 400);
      if (teamId && !(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1)).length) return json({ error: "Escolha um time válido." }, 400);
      const values = {
        name, title: cleanTitle(body.title).slice(0, 160), description: cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH),
        category, teamId, priority: isTaskPriority(body.priority) ? body.priority : 0, items: JSON.stringify(items), updatedAt: now,
      };
      const [saved] = templateId
        ? await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, templateId)).returning()
        : await db.insert(taskTemplates).values({ ...values, createdByName: member.name, createdAt: now }).returning();
      if (!saved) return json({ error: "Modelo não encontrado." }, 404);
      return json({ template: toClient(saved) }, templateId ? 200 : 201);
    }

    if (action === "deleteTemplate") {
      const [deleted] = await db.delete(taskTemplates).where(eq(taskTemplates.id, Number(body.templateId))).returning({ id: taskTemplates.id });
      if (!deleted) return json({ error: "Modelo não encontrado." }, 404);
      return json({ ok: true });
    }

    if (action === "createExamples") {
      // Só cria os exemplos que ainda não existem (pelo nome).
      const existing = new Set((await db.select({ name: taskTemplates.name }).from(taskTemplates)).map((row) => row.name.toLowerCase()));
      const fresh = exampleTemplates.filter((template) => !existing.has(template.name.toLowerCase()));
      const categories = taskCategories as readonly string[];
      for (const template of fresh) {
        await db.insert(taskTemplates).values({
          name: template.name, title: template.title, description: template.description, category: categories.includes(template.category) ? template.category : "",
          priority: template.priority, items: JSON.stringify(template.items), createdByName: member.name, createdAt: now, updatedAt: now,
        });
      }
      return json({ created: fresh.length });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
