import { eq, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { members } from "../../../db/schema";
import { writeAudit } from "../../audit";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  checkRateLimit,
  cleanupAuthData,
  clearRateLimit,
  createSession,
  destroySession,
  endSessions,
  getSessionMember,
  hashPassword,
  listSessions,
  normalizeUsername,
  passwordPolicyError,
  rateLimitKey,
  recordRateLimitFailure,
  verifyPassword,
} from "../../auth-session";
import { clientIp, hasTrustedOrigin } from "../../request-security";

function publicMember(member: typeof members.$inferSelect) {
  return {
    userId: member.userId,
    name: member.name,
    email: member.email,
    username: member.username,
    role: member.role,
    active: member.active,
  };
}

async function setupIsAllowed() {
  // Atalho só para o ambiente de desenvolvimento; no site publicado vale o login do proprietário.
  const host = (await headers()).get("host") ?? "";
  if (import.meta.env?.DEV && (host.startsWith("127.0.0.1") || host.startsWith("localhost"))) return true;
  return Boolean(await getChatGPTUser());
}

export async function GET() {
  try {
    const db = getDb();
    await cleanupAuthData(db);
    const [credentialed] = await db.select({ id: members.id }).from(members).where(isNotNull(members.passwordHash)).limit(1);
    const member = await getSessionMember(db);
    return Response.json({ setupRequired: !credentialed, authenticated: Boolean(member?.active), member: member?.active ? publicMember(member) : null });
  } catch (error) {
    console.error("auth status failed", error);
    return Response.json({ error: "Não foi possível verificar o acesso agora." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "login");
    const db = getDb();
    await cleanupAuthData(db);

    if (action === "logout") {
      const member = await getSessionMember(db);
      await destroySession(db);
      if (member) await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "logout", targetType: "session", targetId: member.id });
      return Response.json({ ok: true });
    }

    // Sessões abertas (aparelhos onde a pessoa está logada).
    if (action === "listSessions" || action === "endOtherSessions" || action === "endAllSessions" || action === "endMemberSessions") {
      const member = await getSessionMember(db);
      if (!member?.active) return Response.json({ error: "Entre com seu usuário e senha para acessar o sistema." }, { status: 401 });
      if (action === "listSessions") return Response.json({ sessions: await listSessions(member.id, db) });
      if (action === "endMemberSessions") {
        if (member.role !== "admin") return Response.json({ error: "Somente administradores." }, { status: 403 });
        const memberId = Number(body.memberId);
        const [target] = Number.isInteger(memberId) && memberId > 0 ? await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, memberId)).limit(1) : [];
        if (!target) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
        const ended = await endSessions(target.id, true, db);
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "sessions_ended_by_admin", targetType: "member", targetId: target.id, details: `${target.name}: ${ended}` }).catch((error) => console.error("audit log failed", error));
        return Response.json({ ended });
      }
      const keepCurrent = action === "endOtherSessions";
      const ended = await endSessions(member.id, keepCurrent, db);
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: keepCurrent ? "other_sessions_ended" : "all_sessions_ended", targetType: "session", targetId: member.id }).catch((error) => console.error("audit log failed", error));
      return Response.json({ ended, loggedOut: !keepCurrent });
    }

    if (action === "setup") {
      const [credentialed] = await db.select({ id: members.id }).from(members).where(isNotNull(members.passwordHash)).limit(1);
      if (credentialed) return Response.json({ error: "O administrador inicial já foi configurado." }, { status: 409 });
      if (!(await setupIsAllowed())) return Response.json({ error: "A configuração inicial precisa ser feita pelo proprietário do Site." }, { status: 403 });

      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLocaleLowerCase("pt-BR");
      const username = normalizeUsername(String(body.username ?? ""));
      const password = String(body.password ?? "");
      if (name.length < 2) return Response.json({ error: "Informe o nome do administrador." }, { status: 400 });
      if (!email.includes("@")) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
      if (username.length < 3) return Response.json({ error: "O usuário precisa ter pelo menos 3 caracteres." }, { status: 400 });
      const passwordError = passwordPolicyError(password);
      if (passwordError) return Response.json({ error: passwordError }, { status: 400 });

      const { hash, salt } = await hashPassword(password);
      const [existingAdmin] = await db.select().from(members).where(eq(members.role, "admin")).limit(1);
      const [emailOwner] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
      if (emailOwner && emailOwner.id !== existingAdmin?.id) return Response.json({ error: "Este e-mail já pertence a outro usuário." }, { status: 409 });
      const [member] = existingAdmin
        ? await db.update(members).set({ name, email, username, passwordHash: hash, passwordSalt: salt, active: true }).where(eq(members.id, existingAdmin.id)).returning()
        : await db.insert(members).values({ userId: `admin:${crypto.randomUUID()}`, name, email, username, passwordHash: hash, passwordSalt: salt, role: "admin", permissions: "{}", active: true }).returning();
      await createSession(member.id, db);
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "initial_admin_configured", targetType: "member", targetId: member.id });
      return Response.json({ member: publicMember(member) }, { status: 201 });
    }

    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");
    if (!username || !password) return Response.json({ error: "Informe o usuário e a senha." }, { status: 400 });
    const limitKey = await rateLimitKey("login", username, clientIp(request));
    const limit = await checkRateLimit(limitKey, db);
    if (limit.blocked) return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const [member] = await db.select().from(members).where(eq(members.username, username)).limit(1);
    // Usuário inexistente também calcula um hash: o tempo de resposta não revela quem existe.
    const valid = member?.passwordHash && member.passwordSalt
      ? await verifyPassword(password, member.passwordHash, member.passwordSalt)
      : (await verifyPassword(password, "0".repeat(64), "usuario-inexistente"), false);
    if (!member || !valid) {
      const failure = await recordRateLimitFailure(limitKey, { maxAttempts: 5, windowMinutes: 15, blockMinutes: 15 }, db);
      // Registra a tentativa (usuário digitado e IP), nunca a senha.
      await writeAudit(db, { actorUserId: member?.userId ?? null, actorName: member?.name ?? `Usuário “${username.slice(0, 40)}”`, action: failure.blocked ? "login_blocked" : "login_failed", targetType: "session", targetId: member?.id ?? null, details: `IP ${clientIp(request)}${member ? "" : " · usuário inexistente"}` }).catch((error) => console.error("audit log failed", error));
      if (failure.blocked) return Response.json({ error: "Muitas tentativas. O acesso foi bloqueado por 15 minutos." }, { status: 429, headers: { "Retry-After": String(failure.retryAfterSeconds) } });
      return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
    }
    if (!member.active) return Response.json({ error: "Este acesso está desativado. Fale com um administrador." }, { status: 403 });
    await clearRateLimit(limitKey, db);
    await createSession(member.id, db);
    await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "login", targetType: "session", targetId: member.id });
    return Response.json({ member: publicMember(member) });
  } catch (error) {
    console.error("authentication failed", error);
    return Response.json({ error: "Não foi possível concluir o acesso agora." }, { status: 500 });
  }
}
