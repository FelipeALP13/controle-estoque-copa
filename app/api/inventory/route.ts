import { env } from "cloudflare:workers";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { createSession, getSessionMember, hashPassword, normalizeUsername, passwordPolicyError, verifyPassword } from "../../auth-session";
import { getDb } from "../../../db";
import { inventoryLocks, items, members, movements, openBatches, projectPeople, sessions, supportTeams, supportWeeks, taskPeople, tickets } from "../../../db/schema";
import { writeAudit } from "../../audit";
import { movementOccursBeforeOpening, parseMovementDate } from "../../movement-policy";
import { hasTrustedOrigin } from "../../request-security";
import { hasPermission, resolvePermissions, type MemberPermissions, type MemberRole } from "../../member-permissions";
import { findOverlappingWeek, generateRotation, isIsoDate, isSupportTeamColor, normalizeTeamMembers, parseTeamMembers, weekRangeError } from "../../support-schedule";

type MovementType = "purchase" | "open" | "consume" | "adjust";

type Db = ReturnType<typeof getDb>;

async function loadSchedule(db: Db) {
  try {
    const [teamRows, weekRows] = await Promise.all([
      db.select().from(supportTeams).orderBy(asc(supportTeams.id)),
      db.select().from(supportWeeks).orderBy(asc(supportWeeks.startDate), asc(supportWeeks.id)),
    ]);
    return {
      teams: teamRows.map((team) => ({ id: team.id, name: team.name, color: isSupportTeamColor(team.color) ? team.color : "purple", members: parseTeamMembers(team.members) })),
      weeks: weekRows.map((week) => ({ id: week.id, start: week.startDate, end: week.endDate, teamId: week.teamId, note: week.note })),
    };
  } catch (error) {
    // Sem a migração aplicada o restante do sistema continua funcionando.
    console.error("schedule load failed", error);
    return { teams: [], weeks: [] };
  }
}

/** Quantas demandas, projetos e chamados ligam a pessoa (vazio se as tabelas ainda não existem). */
async function historyOf(db: Db, memberId: number) {
  const count = async (query: Promise<{ value: number }[]>) => { try { return (await query)[0]?.value ?? 0; } catch { return 0; } };
  const [demands, projectsCount, ticketsCount] = await Promise.all([
    count(db.select({ value: sql<number>`count(distinct ${taskPeople.taskId})` }).from(taskPeople).where(eq(taskPeople.memberId, memberId))),
    count(db.select({ value: sql<number>`count(*)` }).from(projectPeople).where(eq(projectPeople.memberId, memberId))),
    count(db.select({ value: sql<number>`count(*)` }).from(tickets).where(sql`${tickets.requesterId} = ${memberId} or ${tickets.assigneeId} = ${memberId}`)),
  ]);
  return { demands, projects: projectsCount, tickets: ticketsCount, total: demands + projectsCount + ticketsCount };
}

async function scheduleWeekRows(db: Db) {
  const rows = await db.select({ id: supportWeeks.id, start: supportWeeks.startDate, end: supportWeeks.endDate }).from(supportWeeks);
  return rows;
}

function dateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function permissionJson(role: MemberRole, value: unknown) {
  return JSON.stringify(resolvePermissions(role, value));
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
    const [itemRows, movementRows, batchRows, memberRows, schedule] = await Promise.all([
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
      loadSchedule(db),
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
      schedule,
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
      // Quem tem histórico não pode ser excluído: a exclusão apagaria os vínculos com demandas, projetos e chamados.
      const history = await historyOf(db, target.id);
      if (history.total) {
        const parts = [history.demands && `${history.demands} demanda${history.demands > 1 ? "s" : ""}`, history.projects && `${history.projects} projeto${history.projects > 1 ? "s" : ""}`, history.tickets && `${history.tickets} chamado${history.tickets > 1 ? "s" : ""}`].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " e $1");
        return Response.json({ error: `${target.name} tem ${parts} no histórico. Para não apagar esses registros, desative o acesso em vez de excluir.` }, { status: 409 });
      }
      await db.delete(members).where(eq(members.id, target.id));
      await removeMedia(target.avatarKey);
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "member_deleted", targetType: "member", targetId: target.id, details: `${target.name} (${target.username || target.email})` });
      return Response.json({ ok: true });
    }

    if (["saveSupportTeam", "deleteSupportTeam", "saveSupportWeek", "deleteSupportWeek", "generateSupportWeeks"].includes(action) && !hasPermission(currentMember, "manageSchedule")) {
      return Response.json({ error: "Você não tem permissão para editar a escala." }, { status: 403 });
    }

    if (action === "saveSupportTeam") {
      const teamId = number(body.teamId);
      const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const color = String(body.color ?? "purple");
      const teamMembers = normalizeTeamMembers(Array.isArray(body.members) ? body.members : []);
      if (!name) return Response.json({ error: "Informe o nome da equipe." }, { status: 400 });
      if (!isSupportTeamColor(color)) return Response.json({ error: "Escolha uma cor válida para a equipe." }, { status: 400 });
      if (teamMembers.length === 0) return Response.json({ error: "Adicione pelo menos um integrante à equipe." }, { status: 400 });
      if (teamMembers.length > 20) return Response.json({ error: "Uma equipe pode ter no máximo 20 integrantes." }, { status: 400 });
      const values = { name, color, members: JSON.stringify(teamMembers) };
      const [team] = teamId
        ? await db.update(supportTeams).set(values).where(eq(supportTeams.id, teamId)).returning()
        : await db.insert(supportTeams).values(values).returning();
      if (!team) return Response.json({ error: "Equipe não encontrada." }, { status: 404 });
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: teamId ? "support_team_updated" : "support_team_created", targetType: "support_team", targetId: team.id, details: `${name}: ${teamMembers.join(", ")}` });
      return Response.json({ team }, { status: teamId ? 200 : 201 });
    }

    if (action === "deleteSupportTeam") {
      const teamId = number(body.teamId);
      if (!teamId) return Response.json({ error: "Equipe inválida." }, { status: 400 });
      const [inUse] = await db.select({ id: supportWeeks.id }).from(supportWeeks).where(eq(supportWeeks.teamId, teamId)).limit(1);
      if (inUse) return Response.json({ error: "Esta equipe ainda tem semanas na escala. Exclua ou troque a equipe dessas semanas antes." }, { status: 409 });
      const [deleted] = await db.delete(supportTeams).where(eq(supportTeams.id, teamId)).returning();
      if (!deleted) return Response.json({ error: "Equipe não encontrada." }, { status: 404 });
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "support_team_deleted", targetType: "support_team", targetId: deleted.id, details: deleted.name });
      return Response.json({ ok: true });
    }

    if (action === "saveSupportWeek") {
      const weekId = number(body.weekId);
      const start = String(body.start ?? "");
      const end = String(body.end ?? "");
      const teamId = number(body.teamId);
      const note = String(body.note ?? "").trim().slice(0, 140);
      const rangeError = weekRangeError(start, end);
      if (rangeError) return Response.json({ error: rangeError }, { status: 400 });
      const [team] = await db.select({ id: supportTeams.id, name: supportTeams.name }).from(supportTeams).where(eq(supportTeams.id, teamId)).limit(1);
      if (!team) return Response.json({ error: "Escolha uma equipe válida." }, { status: 400 });
      const conflict = findOverlappingWeek(await scheduleWeekRows(db), { start, end }, weekId || undefined);
      if (conflict) return Response.json({ error: `Este período conflita com a semana de ${dateLabel(conflict.start)} a ${dateLabel(conflict.end)}.` }, { status: 409 });
      const values = { startDate: start, endDate: end, teamId, note };
      const [week] = weekId
        ? await db.update(supportWeeks).set(values).where(eq(supportWeeks.id, weekId)).returning()
        : await db.insert(supportWeeks).values(values).returning();
      if (!week) return Response.json({ error: "Semana não encontrada." }, { status: 404 });
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: weekId ? "support_week_updated" : "support_week_created", targetType: "support_week", targetId: week.id, details: `${dateLabel(start)} a ${dateLabel(end)} · ${team.name}` });
      return Response.json({ week }, { status: weekId ? 200 : 201 });
    }

    if (action === "deleteSupportWeek") {
      const weekId = number(body.weekId);
      if (!weekId) return Response.json({ error: "Semana inválida." }, { status: 400 });
      const [deleted] = await db.delete(supportWeeks).where(eq(supportWeeks.id, weekId)).returning();
      if (!deleted) return Response.json({ error: "Semana não encontrada." }, { status: 404 });
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "support_week_deleted", targetType: "support_week", targetId: deleted.id, details: `${dateLabel(deleted.startDate)} a ${dateLabel(deleted.endDate)}` });
      return Response.json({ ok: true });
    }

    if (action === "generateSupportWeeks") {
      const start = String(body.start ?? "");
      const count = Math.round(number(body.count));
      const daysPerWeek = Math.round(number(body.daysPerWeek, 5));
      const teamIds = Array.isArray(body.teamIds) ? body.teamIds.map((value) => number(value)).filter((value) => value > 0) : [];
      if (!isIsoDate(start)) return Response.json({ error: "Informe a data da primeira semana." }, { status: 400 });
      if (count < 1 || count > 52) return Response.json({ error: "Gere entre 1 e 52 semanas por vez." }, { status: 400 });
      if (daysPerWeek < 1 || daysPerWeek > 7) return Response.json({ error: "Cada semana deve ter de 1 a 7 dias." }, { status: 400 });
      if (teamIds.length === 0) return Response.json({ error: "Escolha pelo menos uma equipe para o rodízio." }, { status: 400 });
      const existingTeams = await db.select({ id: supportTeams.id }).from(supportTeams);
      if (teamIds.some((teamId) => !existingTeams.some((team) => team.id === teamId))) return Response.json({ error: "Uma das equipes escolhidas não existe mais." }, { status: 400 });
      const planned = generateRotation(start, count, teamIds, daysPerWeek);
      const existingWeeks = await scheduleWeekRows(db);
      for (const week of planned) {
        const conflict = findOverlappingWeek(existingWeeks, week);
        if (conflict) return Response.json({ error: `A semana de ${dateLabel(week.start)} conflita com a já cadastrada de ${dateLabel(conflict.start)} a ${dateLabel(conflict.end)}. Escolha outra data inicial ou exclua a semana existente.` }, { status: 409 });
      }
      await db.insert(supportWeeks).values(planned.map((week) => ({ startDate: week.start, endDate: week.end, teamId: week.teamId })));
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "support_weeks_generated", targetType: "support_week", details: `${planned.length} semanas a partir de ${dateLabel(start)}` });
      return Response.json({ created: planned.length }, { status: 201 });
    }

    if (action === "addItem") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para cadastrar itens." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      const category = String(body.category ?? "Outros").trim() || "Outros";
      const unit = String(body.unit ?? "un.").trim() || "un.";
      const minimumQty = Math.max(0, number(body.minimumQty, 1));
      const scanCode = String(body.scanCode ?? "").trim() || null;
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!name) return Response.json({ error: "Informe o nome do item." }, { status: 400 });
      const [item] = await db.insert(items).values({ name, category, unit, minimumQty, scanCode, icon, imageKey }).returning();
      await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: "item_created", targetType: "item", targetId: item.id, details: item.name });
      return Response.json({ item }, { status: 201 });
    }

    if (action === "seed") {
      if (!hasPermission(currentMember, "manageItems")) return Response.json({ error: "Você não tem permissão para carregar a lista inicial." }, { status: 403 });
      const existing = await db.select({ id: items.id }).from(items).limit(1);
      if (existing.length) return Response.json({ error: "A lista já possui itens." }, { status: 409 });
      const now = Date.now();
      const created = await db.insert(items).values([
        { name: "Café", category: "Café e chá", unit: "pacote", icon: "☕", unopenedQty: 4, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now).toISOString() },
        { name: "Açúcar", category: "Açúcar e adoçantes", unit: "pacote", icon: "🍬", unopenedQty: 2, openedQty: 1, minimumQty: 2, lastOpenedAt: new Date(now - 3 * 86400000).toISOString() },
        { name: "Biscoito", category: "Biscoitos e snacks", unit: "pacote", icon: "🍪", unopenedQty: 6, openedQty: 0, minimumQty: 3 },
        { name: "Leite", category: "Laticínios", unit: "caixa", icon: "🥛", unopenedQty: 1, openedQty: 1, minimumQty: 4, lastOpenedAt: new Date(now - 86400000).toISOString() },
        { name: "Chá", category: "Café e chá", unit: "caixa", icon: "🍵", unopenedQty: 2, openedQty: 0, minimumQty: 1 },
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
      const scanCode = String(body.scanCode ?? "").trim() || null;
      const icon = String(body.icon ?? "📦").trim().slice(0, 8) || "📦";
      const imageKey = body.imageKey ? String(body.imageKey) : null;
      if (!itemId || !name) return Response.json({ error: "Item inválido." }, { status: 400 });
      const [previous] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
      if (!previous) return Response.json({ error: "Item não encontrado." }, { status: 404 });
      const [item] = await db.update(items).set({ name, category, unit, minimumQty, scanCode, icon, imageKey, updatedAt: new Date().toISOString() }).where(eq(items.id, itemId)).returning();
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
      let retroactiveOccurredAt: string | null = null;
      if (body.occurredAt) {
        const movementDate = parseMovementDate(body.occurredAt);
        if (movementDate.error) return Response.json({ error: movementDate.error }, { status: 400 });
        retroactiveOccurredAt = movementDate.iso;
      }

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
        const movementTimestamp = retroactiveOccurredAt || timestamp;
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
          await db.insert(openBatches).values({ itemId, quantity: difference, remainingQty: difference, openedAt: movementTimestamp });
          if (!lastOpenedAt || new Date(movementTimestamp).getTime() >= new Date(lastOpenedAt).getTime()) lastOpenedAt = movementTimestamp;
        } else if (openedQty < current.openedQty) {
          let toRemove = current.openedQty - openedQty;
          const activeBatches = await db.select().from(openBatches)
            .where(and(eq(openBatches.itemId, itemId), isNull(openBatches.closedAt)))
            .orderBy(desc(openBatches.openedAt), desc(openBatches.id));
          let toValidate = toRemove;
          for (const batch of activeBatches) {
            if (toValidate <= 0) break;
            if (movementOccursBeforeOpening(movementTimestamp, batch.openedAt)) return Response.json({ error: "O ajuste não pode ocorrer antes da abertura do produto." }, { status: 400 });
            toValidate -= Math.min(toValidate, batch.remainingQty);
          }
          if (toValidate > 0 && current.lastOpenedAt && movementOccursBeforeOpening(movementTimestamp, current.lastOpenedAt)) return Response.json({ error: "O ajuste não pode ocorrer antes da abertura do produto." }, { status: 400 });
          for (const batch of activeBatches) {
            if (toRemove <= 0) break;
            const removed = Math.min(toRemove, batch.remainingQty);
            const remainingQty = batch.remainingQty - removed;
            await db.update(openBatches).set({
              remainingQty,
              closedAt: remainingQty <= 0 ? movementTimestamp : null,
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
          if (!lastOpenedAt || new Date(movementTimestamp).getTime() >= new Date(lastOpenedAt).getTime()) lastOpenedAt = movementTimestamp;
          await db.insert(openBatches).values({ itemId, quantity, remainingQty: quantity, openedAt: movementTimestamp });
        }
        if (type === "consume") {
          if (quantity > openedQty) return Response.json({ error: `Só existem ${openedQty} ${current.unit} abertos. Registre a abertura antes do consumo.` }, { status: 400 });

          let activeBatches = await db.select().from(openBatches)
            .where(and(eq(openBatches.itemId, itemId), isNull(openBatches.closedAt)))
            .orderBy(asc(openBatches.openedAt), asc(openBatches.id));
          const trackedQty = activeBatches.reduce((sum, batch) => sum + batch.remainingQty, 0);
          const untrackedQty = Math.max(0, current.openedQty - trackedQty);
          const untrackedOpenedAt = current.lastOpenedAt || timestamp;
          const consumptionCandidates = activeBatches.map((batch) => ({ openedAt: batch.openedAt, remainingQty: batch.remainingQty }));
          if (untrackedQty > 0) consumptionCandidates.push({ openedAt: untrackedOpenedAt, remainingQty: untrackedQty });
          consumptionCandidates.sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
          let toValidate = quantity;
          for (const batch of consumptionCandidates) {
            if (toValidate <= 0) break;
            if (movementOccursBeforeOpening(movementTimestamp, batch.openedAt)) return Response.json({ error: "O consumo não pode ocorrer antes da abertura do produto." }, { status: 400 });
            toValidate -= Math.min(toValidate, batch.remainingQty);
          }
          if (untrackedQty > 0) {
            await db.insert(openBatches).values({
              itemId,
              quantity: untrackedQty,
              remainingQty: untrackedQty,
              openedAt: untrackedOpenedAt,
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
              closedAt: remainingQty <= 0 ? movementTimestamp : null,
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
            createdAt: movementTimestamp,
          }),
        ]);
        await safeAudit(db, { actorUserId: currentMember.userId, actorName: currentMember.name, action: `stock_${type}`, targetType: "item", targetId: itemId, details: `${movementQuantity} ${current.unit}${retroactiveOccurredAt ? ` · movimentação em ${retroactiveOccurredAt}` : ""}` });
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
