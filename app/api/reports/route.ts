import { asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../../../db";
import { items, movements } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasPermission } from "../../member-permissions";
import { buildReport, lastMonthKeys, normalizePeriod } from "../../reports";

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return Response.json({ error: "Entre com seu usuário e senha para acessar o sistema." }, { status: 401 });
    if (!member.active) return Response.json({ error: "Seu acesso ao sistema está desativado." }, { status: 403 });
    if (!hasPermission(member, "viewHistory")) return Response.json({ error: "Você não tem permissão para ver os relatórios." }, { status: 403 });

    const months = lastMonthKeys(new Date(), normalizePeriod(new URL(request.url).searchParams.get("months")));
    // Um dia de folga cobre a diferença entre UTC e o horário de Brasília;
    // o recorte exato por mês acontece em buildReport.
    const [firstYear, firstMonth] = months[0].split("-").map(Number);
    const since = new Date(Date.UTC(firstYear, firstMonth - 1, 1) - 86400000).toISOString().slice(0, 10);

    const [itemRows, movementRows] = await Promise.all([
      db.select({ id: items.id, name: items.name, unit: items.unit, icon: items.icon, imageKey: items.imageKey }).from(items).orderBy(asc(items.name)),
      db
        .select({ itemId: movements.itemId, type: movements.type, quantity: movements.quantity, createdAt: movements.createdAt, createdByName: movements.createdByName })
        .from(movements)
        .innerJoin(items, eq(movements.itemId, items.id))
        .where(gte(movements.createdAt, since))
        .orderBy(desc(movements.createdAt))
        .limit(20000),
    ]);

    return Response.json(buildReport(movementRows, itemRows, months), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("report load failed", error);
    return Response.json({ error: "Não foi possível gerar os relatórios agora." }, { status: 500 });
  }
}
