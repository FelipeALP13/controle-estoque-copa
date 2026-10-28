import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { items, movements } from "../../../db/schema";

type MovementType = "purchase" | "open" | "consume" | "adjust";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado";
  if (message.includes("no such table")) {
    return "O banco de dados ainda não foi preparado. Publique novamente para aplicar as tabelas.";
  }
  return message;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET() {
  try {
    const db = getDb();
    const [itemRows, movementRows] = await Promise.all([
      db.select().from(items).orderBy(items.name),
      db
        .select({
          id: movements.id,
          itemId: movements.itemId,
          itemName: items.name,
          unit: items.unit,
          type: movements.type,
          quantity: movements.quantity,
          note: movements.note,
          createdAt: movements.createdAt,
        })
        .from(movements)
        .innerJoin(items, eq(movements.itemId, items.id))
        .orderBy(desc(movements.createdAt), desc(movements.id))
        .limit(80),
    ]);
    return Response.json({ items: itemRows, movements: movementRows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();

    if (action === "addItem") {
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      if (!name) return Response.json({ error: "Informe o nome do item." }, { status: 400 });
      const [item] = await db.insert(items).values({ name, category, unit, minimumQty }).returning();
      return Response.json({ item }, { status: 201 });
    }

    if (action === "seed") {
      const existing = await db.select({ id: items.id }).from(items).limit(1);
      if (existing.length) return Response.json({ error: "A lista já possui itens." }, { status: 409 });
      const now = Date.now();
      const created = await db.insert(items).values([
        { name: "Café", category: "Bebidas", unit: "pacote", unopenedQty: 4, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now).toISOString() },
        { name: "Açúcar", category: "Mercearia", unit: "pacote", unopenedQty: 2, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now - 3 * 86400000).toISOString() },
        { name: "Biscoito", category: "Lanches", unit: "pacote", unopenedQty: 6, openedQty: 0, minimumQty: 3 },
        { name: "Leite", category: "Bebidas", unit: "caixa", unopenedQty: 1, openedQty: 1, minimumQty: 4, lastOpenedAt: new Date(now - 86400000).toISOString() },
        { name: "Chá", category: "Bebidas", unit: "caixa", unopenedQty: 2, openedQty: 0, minimumQty: 1 },
      ]).returning();
      return Response.json({ items: created }, { status: 201 });
    }

    if (action === "updateItem") {
      const itemId = number(body.itemId);
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      if (!itemId || !name) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [item] = await db.update(items).set({ name, category, unit, minimumQty, updatedAt: new Date().toISOString() }).where(eq(items.id, itemId)).returning();
      return Response.json({ item });
    }

    if (action === "movement") {
      const itemId = number(body.itemId);
      const type = String(body.type ?? "") as MovementType;
      const quantity = number(body.quantity);
      const note = String(body.note ?? "").trim();
      if (!itemId || !["purchase", "open", "consume", "adjust"].includes(type)) {
        return Response.json({ error: "Movimentação inválida." }, { status: 400 });
      }

      const [current] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
      if (!current) return Response.json({ error: "Item não encontrado." }, { status: 404 });

      let unopenedQty = current.unopenedQty;
      let openedQty = current.openedQty;
      let lastOpenedAt = current.lastOpenedAt;
      let movementQuantity = quantity;

      if (type === "adjust") {
        unopenedQty = Math.max(0, number(body.unopenedQty));
        openedQty = Math.max(0, number(body.openedQty));
        movementQuantity = unopenedQty + openedQty - current.unopenedQty - current.openedQty;
      } else {
        if (!(quantity > 0)) return Response.json({ error: "A quantidade deve ser maior que zero." }, { status: 400 });
        if (type === "purchase") unopenedQty += quantity;
        if (type === "open") {
          if (quantity > unopenedQty) return Response.json({ error: `Só existem ${unopenedQty} ${current.unit} fechados.` }, { status: 400 });
          unopenedQty -= quantity;
          openedQty += quantity;
          lastOpenedAt = new Date().toISOString();
        }
        if (type === "consume") {
          if (quantity > openedQty) return Response.json({ error: `Só existem ${openedQty} ${current.unit} abertos. Registre a abertura antes do consumo.` }, { status: 400 });
          openedQty -= quantity;
        }
      }

      await db.batch([
        db.update(items).set({ unopenedQty, openedQty, lastOpenedAt, updatedAt: new Date().toISOString() }).where(eq(items.id, itemId)),
        db.insert(movements).values({ itemId, type, quantity: movementQuantity, note }),
      ]);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
