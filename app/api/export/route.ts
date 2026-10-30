import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, items, members, movements, openBatches } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

function canViewHistory(member: typeof members.$inferSelect) {
  if (member.role === "admin") return true;
  try {
    const permissions = JSON.parse(member.permissions || "{}") as Record<string, unknown>;
    return permissions.viewHistory !== false;
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return Response.json({ error: "Faça login para exportar os dados." }, { status: 401 });
    const type = new URL(request.url).searchParams.get("type") || "stock";
    let content = "";
    let filename = "estoque.csv";
    let contentType = "text/csv; charset=utf-8";

    if (type === "stock") {
      const rows = await db.select().from(items).orderBy(asc(items.name));
      content = csv([["Item", "Categoria", "Unidade", "Fechado", "Aberto", "Total", "Mínimo", "Última abertura"], ...rows.map((item) => [item.name, item.category, item.unit, item.unopenedQty, item.openedQty, item.unopenedQty + item.openedQty, item.minimumQty, item.lastOpenedAt])]);
    } else if (type === "movements") {
      if (!canViewHistory(member)) return Response.json({ error: "Você não tem permissão para exportar o histórico." }, { status: 403 });
      const rows = await db.select({ item: items.name, unit: items.unit, type: movements.type, quantity: movements.quantity, note: movements.note, responsible: movements.createdByName, date: movements.createdAt }).from(movements).innerJoin(items, eq(movements.itemId, items.id)).orderBy(desc(movements.createdAt), desc(movements.id));
      content = csv([["Item", "Tipo", "Quantidade", "Unidade", "Responsável", "Observação", "Data"], ...rows.map((row) => [row.item, row.type, row.quantity, row.unit, row.responsible, row.note, row.date])]);
      filename = "historico-estoque.csv";
    } else if (type === "members") {
      if (member.role !== "admin") return Response.json({ error: "Somente administradores podem exportar usuários." }, { status: 403 });
      const rows = await db.select({ name: members.name, username: members.username, email: members.email, role: members.role, active: members.active, createdAt: members.createdAt }).from(members).orderBy(asc(members.name));
      content = csv([["Nome", "Usuário", "E-mail", "Perfil", "Ativo", "Cadastro"], ...rows.map((row) => [row.name, row.username, row.email, row.role, row.active ? "Sim" : "Não", row.createdAt])]);
      filename = "usuarios.csv";
    } else if (type === "audit") {
      if (member.role !== "admin") return Response.json({ error: "Somente administradores podem exportar a auditoria." }, { status: 403 });
      const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
      content = csv([["Responsável", "Ação", "Tipo", "Alvo", "Detalhes", "Data"], ...rows.map((row) => [row.actorName, row.action, row.targetType, row.targetId, row.details, row.createdAt])]);
      filename = "auditoria.csv";
    } else if (type === "backup") {
      if (member.role !== "admin") return Response.json({ error: "Somente administradores podem gerar o backup." }, { status: 403 });
      const [stockRows, movementRows, batchRows, memberRows, auditRows] = await Promise.all([
        db.select().from(items),
        db.select().from(movements),
        db.select().from(openBatches),
        db.select({ id: members.id, userId: members.userId, name: members.name, email: members.email, username: members.username, role: members.role, permissions: members.permissions, active: members.active, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, createdAt: members.createdAt }).from(members),
        db.select().from(auditLogs),
      ]);
      content = JSON.stringify({ generatedAt: new Date().toISOString(), items: stockRows, movements: movementRows, openBatches: batchRows, members: memberRows, auditLogs: auditRows }, null, 2);
      filename = `backup-estoque-${new Date().toISOString().slice(0, 10)}.json`;
      contentType = "application/json; charset=utf-8";
    } else {
      return Response.json({ error: "Exportação inválida." }, { status: 400 });
    }

    return new Response(content, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename=\"${filename}\"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("export failed", error);
    return Response.json({ error: "Não foi possível gerar a exportação agora." }, { status: 500 });
  }
}
