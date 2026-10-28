import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { items, members, movements, openBatches } from "../../../db/schema";

type MovementType = "purchase" | "open" | "consume" | "adjust";
type MemberRole = "admin" | "member" | "viewer";

async function getOrCreateMember(db: ReturnType<typeof getDb>) {
  const user = await getChatGPTUser();
  if (!user) {
    const host = (await headers()).get("host") ?? "";
    if (host.startsWith("127.0.0.1") || host.startsWith("localhost")) {
      return { userId: "local-preview", name: "Equipe local", email: "local@preview", role: "admin" as MemberRole, active: true, avatarIcon: "👤", avatarKey: null };
    }
    throw new Error("AUTH_REQUIRED");
  }
  const email = user.email.trim().toLowerCase();

  const [existing] = await db.select().from(members).where(eq(members.userId, user.userId)).limit(1);
  if (existing) {
    if (existing.email !== email) {
      await db.update(members).set({ email }).where(eq(members.id, existing.id));
    }
    return { ...existing, email };
  }

  const [invited] = await db.select().from(members).where(eq(members.email, email)).limit(1);
  if (invited) {
    const [claimed] = await db.update(members).set({ userId: user.userId, email }).where(eq(members.id, invited.id)).returning();
    return claimed;
  }

  const anyMember = await db.select({ id: members.id }).from(members).limit(1);
  const [created] = await db.insert(members).values({
    userId: user.userId,
    name: user.displayName,
    email,
    role: anyMember.length ? "member" : "admin",
  }).returning();
  return created;
}

function canManage(role: MemberRole) {
  return role === "admin";
}

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

function suggestedIcon(name: string, current: string) {
  if (current && current !== "📦") return current;
  const normalized = name.toLocaleLowerCase("pt-BR");
  if (normalized.includes("café") || normalized.includes("cafe")) return "☕";
  if (normalized.includes("biscoito") || normalized.includes("bolacha")) return "🍪";
  if (normalized.includes("açúcar") || normalized.includes("acucar")) return "🍬";
  if (normalized.includes("leite")) return "🥛";
  if (normalized.includes("chá") || normalized.includes("cha")) return "🍵";
  if (normalized.includes("suco")) return "🧃";
  if (normalized.includes("papel")) return "🧻";
  if (normalized.includes("sabão") || normalized.includes("detergente")) return "🧼";
  return current || "📦";
}

export async function GET() {
  try {
    const db = getDb();
    const currentMember = await getOrCreateMember(db);
    if (!currentMember.active) return Response.json({ error: "Seu acesso ao sistema está desativado. Fale com um administrador." }, { status: 403 });
    const [itemRows, movementRows, batchRows, memberRows] = await Promise.all([
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
      canManage(currentMember.role)
        ? db.select({ id: members.id, userId: members.userId, name: members.name, email: members.email, role: members.role, active: members.active, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, createdAt: members.createdAt }).from(members).orderBy(members.name)
        : Promise.resolve([]),
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
        icon: suggestedIcon(item.name, item.icon),
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

    const visibleMembers = currentMember.userId === "local-preview"
      ? [{ id: 0, ...currentMember, createdAt: new Date().toISOString() }, ...memberRows]
      : memberRows;

    return Response.json({
      items: enrichedItems,
      movements: movementRows,
      currentUser: { userId: currentMember.userId, name: currentMember.name, email: currentMember.email, role: currentMember.role, active: currentMember.active, avatarIcon: currentMember.avatarIcon, avatarKey: currentMember.avatarKey },
      members: visibleMembers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json(message === "AUTH_REQUIRED" ? { error: "Entre com sua conta para acessar o sistema.", signInPath: "/signin-with-chatgpt?return_to=%2F" } : { error: errorMessage(error) }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();
    const currentMember = await getOrCreateMember(db);
    if (!currentMember.active) return Response.json({ error: "Seu acesso ao sistema está desativado." }, { status: 403 });

    if (action === "updateProfile") {
      const name = String(body.name ?? "").trim();
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      if (!name) return Response.json({ error: "Informe seu nome." }, { status: 400 });
      if (currentMember.userId === "local-preview") return Response.json({ member: { ...currentMember, name, avatarIcon, avatarKey } });
      const [updated] = await db.update(members).set({ name, avatarIcon, avatarKey }).where(eq(members.userId, currentMember.userId)).returning();
      return Response.json({ member: updated });
    }

    if (currentMember.role === "viewer") return Response.json({ error: "Seu perfil permite somente visualizar o estoque." }, { status: 403 });

    if (action === "updateMemberRole") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem alterar permissões." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      const role = String(body.role ?? "") as MemberRole;
      if (!targetUserId || !["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Permissão inválida." }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Para evitar bloqueio acidental, você não pode alterar sua própria permissão." }, { status: 400 });
      const [updated] = await db.update(members).set({ role }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      return Response.json({ member: updated });
    }

    if (action === "addMember") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem adicionar membros." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "member") as MemberRole;
      if (!name) return Response.json({ error: "Informe o nome do membro." }, { status: 400 });
      if (!email.includes("@")) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      if (!["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Permissão inválida." }, { status: 400 });
      const existing = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
      if (existing.length) return Response.json({ error: "Já existe um membro cadastrado com este e-mail." }, { status: 409 });
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      const [member] = await db.insert(members).values({ userId: `pending:${email}`, name, email, role, active: true, avatarIcon, avatarKey }).returning();
      return Response.json({ member }, { status: 201 });
    }

    if (action === "updateMember") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem editar membros." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "member") as MemberRole;
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      if (!targetUserId || !name || !email.includes("@") || !["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Dados do membro inválidos." }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Edite seus dados em Meu perfil." }, { status: 400 });
      const duplicate = await db.select({ userId: members.userId }).from(members).where(eq(members.email, email)).limit(1);
      if (duplicate.length && duplicate[0].userId !== targetUserId) return Response.json({ error: "Este e-mail já pertence a outro membro." }, { status: 409 });
      const [updated] = await db.update(members).set({ name, email, role, active: body.active !== false, avatarIcon, avatarKey }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      return Response.json({ member: updated });
    }

    if (action === "updateMemberActive") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem alterar o acesso." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      if (!targetUserId) return Response.json({ error: "Usuário inválido." }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Para evitar bloqueio acidental, você não pode desativar seu próprio acesso." }, { status: 400 });
      const [updated] = await db.update(members).set({ active: body.active === true }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      return Response.json({ member: updated });
    }

    if (action === "addItem") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem cadastrar itens." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!name) return Response.json({ error: "Informe o nome do item." }, { status: 400 });
      const [item] = await db.insert(items).values({ name, category, unit, minimumQty, icon, imageKey }).returning();
      return Response.json({ item }, { status: 201 });
    }

    if (action === "seed") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem carregar a lista inicial." }, { status: 403 });
      const existing = await db.select({ id: items.id }).from(items).limit(1);
      if (existing.length) return Response.json({ error: "A lista já possui itens." }, { status: 409 });
      const now = Date.now();
      const created = await db.insert(items).values([
        { name: "Café", category: "Bebidas", unit: "pacote", icon: "☕", unopenedQty: 4, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now).toISOString() },
        { name: "Açúcar", category: "Mercearia", unit: "pacote", icon: "🍬", unopenedQty: 2, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now - 3 * 86400000).toISOString() },
        { name: "Biscoito", category: "Lanches", unit: "pacote", icon: "🍪", unopenedQty: 6, openedQty: 0, minimumQty: 3 },
        { name: "Leite", category: "Bebidas", unit: "caixa", icon: "🥛", unopenedQty: 1, openedQty: 1, minimumQty: 4, lastOpenedAt: new Date(now - 86400000).toISOString() },
        { name: "Chá", category: "Bebidas", unit: "caixa", icon: "🍵", unopenedQty: 2, openedQty: 0, minimumQty: 1 },
      ]).returning();
      return Response.json({ items: created }, { status: 201 });
    }

    if (action === "updateItem") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem editar itens." }, { status: 403 });
      const itemId = number(body.itemId);
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!itemId || !name) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [item] = await db.update(items).set({ name, category, unit, minimumQty, icon, imageKey, updatedAt: new Date().toISOString() }).where(eq(items.id, itemId)).returning();
      return Response.json({ item });
    }

    if (action === "deleteItem") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem excluir itens." }, { status: 403 });
      const itemId = number(body.itemId);
      if (!itemId) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [deleted] = await db.delete(items).where(eq(items.id, itemId)).returning();
      if (!deleted) return Response.json({ error: "Item não encontrado." }, { status: 404 });
      return Response.json({ item: deleted });
    }

    if (action === "movement") {
      const itemId = number(body.itemId);
      const type = String(body.type ?? "") as MovementType;
      const quantity = number(body.quantity);
      const note = String(body.note ?? "").trim();
      if (!itemId || !["purchase", "open", "consume", "adjust"].includes(type)) {
        return Response.json({ error: "Movimentação inválida." }, { status: 400 });
      }
      if (type === "adjust" && !canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem ajustar a contagem física." }, { status: 403 });

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
          createdByUserId: currentMember.userId,
          createdByName: currentMember.name,
        }),
      ]);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json(message === "AUTH_REQUIRED" ? { error: "Entre com sua conta para acessar o sistema.", signInPath: "/signin-with-chatgpt?return_to=%2F" } : { error: errorMessage(error) }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
