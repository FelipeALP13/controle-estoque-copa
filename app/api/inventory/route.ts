import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { items, movements, openBatches } from "../../../db/schema";

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

function roundDays(value: number) {
  return Math.round(value * 10) / 10;
}

export async function GET() {
  try {
    const db = getDb();
    const [itemRows, movementRows, batchRows] = await Promise.all([
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
          createdByName: movements.createdByName,
          createdAt: movements.createdAt,
        })
        .from(movements)
        .innerJoin(items, eq(movements.itemId, items.id))
        .orderBy(desc(movements.createdAt), desc(movements.id))
        .limit(80),
      db.select().from(openBatches).orderBy(desc(openBatches.openedAt)).limit(800),
    ]);

    const now = Date.now();
    const enrichedItems = itemRows.map((item) => {
      const batches = batchRows.filter((batch) => batch.itemId === item.id);
      const completed = batches
        .filter((batch) => batch.closedAt && batch.closedReason === "consumed" && batch.quantity > 0)
        .slice(0, 8);
      const unitDurations = completed.map((batch) => {
        const elapsedDays = Math.max(1, (new Date(batch.closedAt!).getTime() - new Date(batch.openedAt).getTime()) / 86400000);
        return elapsedDays / batch.quantity;
      });
      const averageDurationDays = unitDurations.length
        ? unitDurations.reduce((sum, duration) => sum + duration, 0) / unitDurations.length
        : null;
      const active = batches.filter((batch) => !batch.closedAt && batch.remainingQty > 0);
      const inferredActiveAt = active.length
        ? active.reduce((oldest, batch) => new Date(batch.openedAt).getTime() < new Date(oldest).getTime() ? batch.openedAt : oldest, active[0].openedAt)
        : item.openedQty > 0 ? item.lastOpenedAt : null;
      const activeDays = inferredActiveAt ? Math.max(0, (now - new Date(inferredActiveAt).getTime()) / 86400000) : null;
      const monthlyRecommendation = averageDurationDays ? Math.max(1, Math.ceil(30 / averageDurationDays)) : null;
      const totalQty = item.unopenedQty + item.openedQty;

      return {
        ...item,
        analytics: {
          averageDurationDays: averageDurationDays ? roundDays(averageDurationDays) : null,
          lastDurationDays: unitDurations.length ? roundDays(unitDurations[0]) : null,
          completedCycles: completed.length,
          activeDays: activeDays === null ? null : roundDays(activeDays),
          monthlyRecommendation,
          estimatedCoverageDays: averageDurationDays ? roundDays(averageDurationDays * totalQty) : null,
        },
      };
    });

    return Response.json({ items: enrichedItems, movements: movementRows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();
    const user = await getChatGPTUser();

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

      const timestamp = new Date().toISOString();
      let unopenedQty = current.unopenedQty;
      let openedQty = current.openedQty;
      let lastOpenedAt = current.lastOpenedAt;
      let movementQuantity = quantity;

      if (type === "adjust") {
        unopenedQty = Math.max(0, number(body.unopenedQty));
        openedQty = Math.max(0, number(body.openedQty));
        movementQuantity = unopenedQty + openedQty - current.unopenedQty - current.openedQty;

        if (openedQty > current.openedQty) {
          const difference = openedQty - current.openedQty;
          await db.insert(openBatches).values({ itemId, quantity: difference, remainingQty: difference, openedAt: timestamp });
          lastOpenedAt = timestamp;
        } else if (openedQty < current.openedQty) {
          let toRemove = current.openedQty - openedQty;
          const activeBatches = await db.select().from(openBatches)
            .where(and(eq(openBatches.itemId, itemId), isNull(openBatches.closedAt)))
            .orderBy(desc(openBatches.openedAt), desc(openBatches.id));
          for (const batch of activeBatches) {
            if (toRemove <= 0) break;
            const removed = Math.min(toRemove, batch.remainingQty);
            const remainingQty = batch.remainingQty - removed;
            await db.update(openBatches).set({
              remainingQty,
              closedAt: remainingQty <= 0 ? timestamp : null,
              closedReason: remainingQty <= 0 ? "adjusted" : null,
            }).where(eq(openBatches.id, batch.id));
            toRemove -= removed;
          }
        }
      } else {
        if (!(quantity > 0)) return Response.json({ error: "A quantidade deve ser maior que zero." }, { status: 400 });
        if (type === "purchase") unopenedQty += quantity;
        if (type === "open") {
          if (quantity > unopenedQty) return Response.json({ error: `Só existem ${unopenedQty} ${current.unit} fechados.` }, { status: 400 });
          unopenedQty -= quantity;
          openedQty += quantity;
          lastOpenedAt = timestamp;
          await db.insert(openBatches).values({ itemId, quantity, remainingQty: quantity, openedAt: timestamp });
        }
        if (type === "consume") {
          if (quantity > openedQty) return Response.json({ error: `Só existem ${openedQty} ${current.unit} abertos. Registre a abertura antes do consumo.` }, { status: 400 });

          let activeBatches = await db.select().from(openBatches)
            .where(and(eq(openBatches.itemId, itemId), isNull(openBatches.closedAt)))
            .orderBy(asc(openBatches.openedAt), asc(openBatches.id));
          const trackedQty = activeBatches.reduce((sum, batch) => sum + batch.remainingQty, 0);
          const untrackedQty = Math.max(0, current.openedQty - trackedQty);
          if (untrackedQty > 0) {
            await db.insert(openBatches).values({
              itemId,
              quantity: untrackedQty,
              remainingQty: untrackedQty,
              openedAt: current.lastOpenedAt || timestamp,
            });
            activeBatches = await db.select().from(openBatches)
              .where(and(eq(openBatches.itemId, itemId), isNull(openBatches.closedAt)))
              .orderBy(asc(openBatches.openedAt), asc(openBatches.id));
          }

          let toConsume = quantity;
          for (const batch of activeBatches) {
            if (toConsume <= 0) break;
            const consumed = Math.min(toConsume, batch.remainingQty);
            const remainingQty = batch.remainingQty - consumed;
            await db.update(openBatches).set({
              remainingQty,
              closedAt: remainingQty <= 0 ? timestamp : null,
              closedReason: remainingQty <= 0 ? "consumed" : null,
            }).where(eq(openBatches.id, batch.id));
            toConsume -= consumed;
          }
          openedQty -= quantity;
        }
      }

      await db.batch([
        db.update(items).set({ unopenedQty, openedQty, lastOpenedAt, updatedAt: timestamp }).where(eq(items.id, itemId)),
        db.insert(movements).values({
          itemId,
          type,
          quantity: movementQuantity,
          note,
          createdByUserId: user?.userId ?? null,
          createdByName: user?.displayName ?? "Equipe",
        }),
      ]);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
