import { env } from "cloudflare:workers";
import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { createSession, getSessionMember, hashPassword, normalizeUsername, passwordPolicyError, verifyPassword } from "../../auth-session";
import { getDb } from "../../../db";
import { inventoryLocks, items, members, movements, openBatches, sessions } from "../../../db/schema";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";

type MovementType = "purchase" | "open" | "consume" | "adjust";
type MemberRole = "admin" | "member" | "viewer";
type MemberPermissions = {
  manageItems: boolean;
  registerPurchases: boolean;
  openItems: boolean;
  consumeItems: boolean;
  adjustStock: boolean;
  viewPlanning: boolean;
  viewHistory: boolean;
};

const allPermissions: MemberPermissions = {
  manageItems: true,
  registerPurchases: true,
  openItems: true,
  consumeItems: true,
  adjustStock: true,
  viewPlanning: true,
  viewHistory: true,
};

const memberPermissions: MemberPermissions = {
  manageItems: false,
  registerPurchases: true,
  openItems: true,
  consumeItems: true,
  adjustStock: false,
  viewPlanning: true,
  viewHistory: true,
};

const viewerPermissions: MemberPermissions = {
  manageItems: false,
  registerPurchases: false,
  openItems: false,
  consumeItems: false,
  adjustStock: false,
  viewPlanning: true,
  viewHistory: true,
};

function resolvePermissions(role: MemberRole, value: unknown): MemberPermissions {
  if (role === "admin") return allPermissions;
  const fallback = role === "viewer" ? viewerPermissions : memberPermissions;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    parsed = {};
  }
  return Object.fromEntries(Object.entries(fallback).map(([key, defaultValue]) => [key, typeof parsed[key] === "boolean" ? parsed[key] : defaultValue])) as MemberPermissions;
}

function permissionJson(role: MemberRole, value: unknown) {
  return JSON.stringify(resolvePermissions(role, value));
}

function hasPermission(member: { role: MemberRole; permissions?: string }, permission: keyof MemberPermissions) {
  return resolvePermissions(member.role, member.permissions)[permission];
}

async function requireMember(db: ReturnType<typeof getDb>) {
  const member = await getSessionMember(db);
  if (!member) throw new Error("AUTH_REQUIRED");
  return member;
}

function canManage(role: MemberRole) {
  return role === "admin";
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro inesperado";
  if (message.includes("no such table")) {
    return "O banco de dados ainda não foi preparado. Publique novamente para aplicar as tabelas.";
  }
  return "Não foi possível concluir esta operação agora.";
}

async function removeMedia(key: string | null | undefined) {
  if (!key?.startsWith("media/")) return;
  try {
    const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
    await bucket?.delete(key);
  } catch (error) {
    console.error("media cleanup failed", error);
  }
}

async function safeAudit(db: ReturnType<typeof getDb>, entry: Parameters<typeof writeAudit>[1]) {
  try { await writeAudit(db, entry); } catch (error) { console.error("audit log failed", error); }
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
    const currentMember = await requireMember(db);
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
        ? db.select({ id: members.id, userId: members.userId, name: members.name, email: members.email, username: members.username, role: members.role, permissions: members.permissions, active: members.active, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, createdAt: members.createdAt }).from(members).orderBy(members.name)
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

    const visibleMembers = memberRows.map((member) => ({ ...member, permissions: resolvePermissions(member.role, member.permissions) }));
    const currentPermissions = resolvePermissions(currentMember.role, currentMember.permissions);

    return Response.json({
      items: enrichedItems,
      movements: currentPermissions.viewHistory ? movementRows : [],
      currentUser: { userId: currentMember.userId, name: currentMember.name, email: currentMember.email, username: currentMember.username, role: currentMember.role, permissions: currentPermissions, active: currentMember.active, avatarIcon: currentMember.avatarIcon, avatarKey: currentMember.avatarKey },
      members: visibleMembers,
    });
  } catch (error) {
    console.error("inventory load failed", error);
    const message = error instanceof Error ? error.message : "";
    return Response.json(message === "AUTH_REQUIRED" ? { error: "Entre com seu usuário e senha para acessar o sistema.", signInPath: "/" } : { error: errorMessage(error) }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = getDb();
    const currentMember = await requireMember(db);
    if (!currentMember.active) return Response.json({ error: "Seu acesso ao sistema está desativado." }, { status: 403 });

    if (action === "updateProfile") {
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? currentMember.email).trim().toLocaleLowerCase("pt-BR");
      const username = normalizeUsername(String(body.username ?? currentMember.username ?? ""));
      const password = String(body.password ?? "");
      const currentPassword = String(body.currentPassword ?? "");
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      if (!name) return Response.json({ error: "Informe seu nome." }, { status: 400 });
      if (!email.includes("@")) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      if (username.length < 3) return Response.json({ error: "O usuário precisa ter pelo menos 3 caracteres." }, { status: 400 });
      const passwordError = password ? passwordPolicyError(password) : null;
      if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
      if (password && (!currentMember.passwordHash || !currentMember.passwordSalt || !(await verifyPassword(currentPassword, currentMember.passwordHash, currentMember.passwordSalt)))) return Response.json({ error: "A senha atual está incorreta." }, { status: 400 });
      const [duplicateUsername] = await db.select({ userId: members.userId }).from(members).where(eq(members.username, username)).limit(1);
      if (duplicateUsername && duplicateUsername.userId !== currentMember.userId) return Response.json({ error: "Este nome de usuário já está em uso." }, { status: 409 });
      const [duplicateEmail] = await db.select({ userId: members.userId }).from(members).where(eq(members.email, email)).limit(1);
      if (duplicateEmail && duplicateEmail.userId !== currentMember.userId) return Response.json({ error: "Este e-mail já pertence a outro usuário." }, { status: 409 });
      const credentials = password ? await hashPassword(password) : null;
      const [updated] = await db.update(members).set({ name, email, username, avatarIcon, avatarKey, ...(credentials ? { passwordHash: credentials.hash, passwordSalt: credentials.salt } : {}) }).where(eq(members.userId, currentMember.userId)).returning();
      if (credentials) {
        await db.delete(sessions).where(eq(sessions.memberId, currentMember.id));
        await createSession(currentMember.id, db);
      }
      if (currentMember.avatarKey && currentMember.avatarKey !== avatarKey) await removeMedia(currentMember.avatarKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: name, action: credentials ? "profile_and_password_updated" : "profile_updated", targetType: "member", targetId: currentMember.id });
      return Response.json({ member: updated });
    }

    if (action === "updateMemberRole") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem alterar permissões." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      const role = String(body.role ?? "") as MemberRole;
      if (!targetUserId || !["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Permissão inválida." }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Para evitar bloqueio acidental, você não pode alterar sua própria permissão." }, { status: 400 });
      const [updated] = await db.update(members).set({ role, permissions: permissionJson(role, {}) }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "member_role_updated", targetType: "member", targetId: updated.id, details: `Perfil alterado para ${role}` });
      return Response.json({ member: updated });
    }

    if (action === "addMember") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem adicionar membros." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const username = normalizeUsername(String(body.username ?? ""));
      const password = String(body.password ?? "");
      const role = String(body.role ?? "member") as MemberRole;
      if (!name) return Response.json({ error: "Informe o nome do membro." }, { status: 400 });
      if (!email.includes("@")) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      if (username.length < 3) return Response.json({ error: "O usuário precisa ter pelo menos 3 caracteres." }, { status: 400 });
      const passwordError = passwordPolicyError(password);
      if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
      if (!["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Permissão inválida." }, { status: 400 });
      const existing = await db.select({ id: members.id }).from(members).where(eq(members.username, username)).limit(1);
      if (existing.length) return Response.json({ error: "Este nome de usuário já está em uso." }, { status: 409 });
      const emailExisting = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
      if (emailExisting.length) return Response.json({ error: "Este e-mail já pertence a outro usuário." }, { status: 409 });
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      const permissions = permissionJson(role, body.permissions);
      const credentials = await hashPassword(password);
      const [member] = await db.insert(members).values({ userId: `member:${crypto.randomUUID()}`, name, email, username, passwordHash: credentials.hash, passwordSalt: credentials.salt, role, permissions, active: true, avatarIcon, avatarKey }).returning();
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "member_created", targetType: "member", targetId: member.id, details: `Usuário ${username} criado como ${role}` });
      return Response.json({ member }, { status: 201 });
    }

    if (action === "updateMember") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem editar membros." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const username = normalizeUsername(String(body.username ?? ""));
      const password = String(body.password ?? "");
      const role = String(body.role ?? "member") as MemberRole;
      const avatarIcon = String(body.avatarIcon ?? "👤").trim().slice(0, 8) || "👤";
      const avatarKey = body.avatarKey ? String(body.avatarKey) : null;
      const permissions = permissionJson(role, body.permissions);
      if (!targetUserId || !name || !email.includes("@") || username.length < 3 || !["admin", "member", "viewer"].includes(role)) return Response.json({ error: "Dados do membro inválidos." }, { status: 400 });
      const passwordError = password ? passwordPolicyError(password) : null;
      if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Edite seus dados em Meu perfil." }, { status: 400 });
      const [target] = await db.select().from(members).where(eq(members.userId, targetUserId)).limit(1);
      if (!target) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      const duplicate = await db.select({ userId: members.userId }).from(members).where(eq(members.username, username)).limit(1);
      if (duplicate.length && duplicate[0].userId !== targetUserId) return Response.json({ error: "Este nome de usuário já está em uso." }, { status: 409 });
      const duplicateEmail = await db.select({ userId: members.userId }).from(members).where(eq(members.email, email)).limit(1);
      if (duplicateEmail.length && duplicateEmail[0].userId !== targetUserId) return Response.json({ error: "Este e-mail já pertence a outro usuário." }, { status: 409 });
      const credentials = password ? await hashPassword(password) : null;
      const [updated] = await db.update(members).set({ name, email, username, role, permissions, active: body.active !== false, avatarIcon, avatarKey, ...(credentials ? { passwordHash: credentials.hash, passwordSalt: credentials.salt } : {}) }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      if (credentials || !updated.active) await db.delete(sessions).where(eq(sessions.memberId, updated.id));
      if (target.avatarKey && target.avatarKey !== avatarKey) await removeMedia(target.avatarKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: credentials ? "member_updated_and_password_reset" : "member_updated", targetType: "member", targetId: updated.id, details: `Usuário ${username} atualizado` });
      return Response.json({ member: updated });
    }

    if (action === "updateMemberActive") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem alterar o acesso." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      if (!targetUserId) return Response.json({ error: "Usuário inválido." }, { status: 400 });
      if (targetUserId === currentMember.userId) return Response.json({ error: "Para evitar bloqueio acidental, você não pode desativar seu próprio acesso." }, { status: 400 });
      const [updated] = await db.update(members).set({ active: body.active === true }).where(eq(members.userId, targetUserId)).returning();
      if (!updated) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      if (!updated.active) await db.delete(sessions).where(eq(sessions.memberId, updated.id));
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: updated.active ? "member_activated" : "member_deactivated", targetType: "member", targetId: updated.id, details: updated.name });
      return Response.json({ member: updated });
    }

    if (action === "deleteMember") {
      if (!canManage(currentMember.role)) return Response.json({ error: "Somente administradores podem excluir membros." }, { status: 403 });
      const targetUserId = String(body.userId ?? "");
      if (!targetUserId || targetUserId === currentMember.userId) return Response.json({ error: "Você não pode excluir sua própria conta." }, { status: 400 });
      const [target] = await db.select().from(members).where(eq(members.userId, targetUserId)).limit(1);
      if (!target) return Response.json({ error: "Usuário não encontrado." }, { status: 404 });
      if (target.role === "admin" && target.active) {
        const activeAdmins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)));
        if (activeAdmins.length <= 1) return Response.json({ error: "O sistema precisa manter pelo menos um administrador ativo." }, { status: 400 });
      }
      await db.delete(members).where(eq(members.id, target.id));
      await removeMedia(target.avatarKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "member_deleted", targetType: "member", targetId: target.id, details: `${target.name} (${target.username || target.email})` });
      return Response.json({ ok: true });
    }

    if (action === "addItem") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para cadastrar itens." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!name) return Response.json({ error: "Informe o nome do item." }, { status: 400 });
      const [item] = await db.insert(items).values({ name, category, unit, minimumQty, icon, imageKey }).returning();
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "item_created", targetType: "item", targetId: item.id, details: item.name });
      return Response.json({ item }, { status: 201 });
    }

    if (action === "seed") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para carregar a lista inicial." }, { status: 403 });
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
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "initial_items_created", targetType: "item", details: `${created.length} itens adicionados` });
      return Response.json({ items: created }, { status: 201 });
    }

    if (action === "updateItem") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para editar itens." }, { status: 403 });
      const itemId = number(body.itemId);
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!itemId || !name) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [previous] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
      if (!previous) return Response.json({ error: "Item não encontrado." }, { status: 404 });
      const [item] = await db.update(items).set({ name, category, unit, minimumQty, icon, imageKey, updatedAt: new Date().toISOString() }).where(eq(items.id, itemId)).returning();
      if (previous.imageKey && previous.imageKey !== imageKey) await removeMedia(previous.imageKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "item_updated", targetType: "item", targetId: item.id, details: item.name });
      return Response.json({ item });
    }

    if (action === "deleteItem") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para excluir itens." }, { status: 403 });
      const itemId = number(body.itemId);
      if (!itemId) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [deleted] = await db.delete(items).where(eq(items.id, itemId)).returning();
      if (!deleted) return Response.json({ error: "Item não encontrado." }, { status: 404 });
      await removeMedia(deleted.imageKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "item_deleted", targetType: "item", targetId: deleted.id, details: deleted.name });
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
      const permissionByType: Record<MovementType, keyof MemberPermissions> = {
        purchase: "registerPurchases",
        open: "openItems",
        consume: "consumeItems",
        adjust: "adjustStock",
      };
      if (!hasPermission(currentMember, permissionByType[type])) return Response.json({ error: "Você não tem permissão para registrar esta movimentação." }, { status: 403 });

      const lockToken = crypto.randomUUID();
      await db.delete(inventoryLocks).where(and(eq(inventoryLocks.itemId, itemId), lt(inventoryLocks.acquiredAt, new Date(Date.now() - 30000).toISOString())));
      try {
        await db.insert(inventoryLocks).values({ itemId, ownerToken: lockToken, acquiredAt: new Date().toISOString() });
      } catch {
        return Response.json({ error: "Este item está sendo atualizado por outra pessoa. Tente novamente em alguns segundos." }, { status: 409 });
      }

      try {
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
        await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: `stock_${type}`, targetType: "item", targetId: itemId, details: `${movementQuantity} ${current.unit}` });
        return Response.json({ ok: true });
      } finally {
        await db.delete(inventoryLocks).where(and(eq(inventoryLocks.itemId, itemId), eq(inventoryLocks.ownerToken, lockToken)));
      }
    }

    return Response.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    console.error("inventory mutation failed", error);
    const message = error instanceof Error ? error.message : "";
    return Response.json(message === "AUTH_REQUIRED" ? { error: "Entre com seu usuário e senha para acessar o sistema.", signInPath: "/" } : { error: errorMessage(error) }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
