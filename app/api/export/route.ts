import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { items } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { calculateReorderPoint, suggestedPurchaseQuantity } from "../../inventory-policy";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return Response.json({ error: "Faça login para baixar a lista de reposição." }, { status: 401 });

    const type = new URL(request.url).searchParams.get("type");
    if (type !== "restock") return Response.json({ error: "Somente a lista de reposição pode ser exportada." }, { status: 400 });

    const rows = (await db.select().from(items).orderBy(asc(items.name)))
      .filter((item) => item.unopenedQty + item.openedQty <= calculateReorderPoint(item))
      .map((item) => {
        const available = item.unopenedQty + item.openedQty;
        const reorderPoint = calculateReorderPoint(item);
        const suggested = suggestedPurchaseQuantity({ available, reorderPoint });
        return [item.name, item.category, available, item.unit, item.minimumQty, item.safetyStock, suggested, item.supplier, item.leadTimeDays];
      });

    const content = csv([
      ["Item", "Categoria", "Saldo atual", "Unidade", "Estoque mínimo", "Estoque de segurança", "Quantidade sugerida para comprar", "Fornecedor", "Prazo de entrega (dias)"],
      ...rows,
    ]);

    return new Response(content, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lista-reposicao-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("restock export failed", error);
    return Response.json({ error: "Não foi possível gerar a lista de reposição agora." }, { status: 500 });
  }
}
