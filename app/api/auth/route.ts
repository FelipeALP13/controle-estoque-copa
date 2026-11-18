import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { loginChallenges, loginPlaces, members, notifications } from "../../../db/schema";
import { sealSecret, openSecret } from "../../secret-key";
import { deviceLabel } from "../../session-policy";
import { isNewPlace, loginPlace, looksLikeRecoveryCode, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../../totp";
import { APP_NAME } from "../../brand";
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
  hashToken,
  createSecureToken,
  listSessions,
  normalizeUsername,
  passwordPolicyError,
  rateLimitKey,
  recordRateLimitFailure,
  verifyPassword,
} from "../../auth-session";
import { clientIp, hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";

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

type Db = ReturnType<typeof getDb>;
type Member = typeof members.$inferSelect;
const CHALLENGE_MINUTES = 5;
const MAX_CODE_ATTEMPTS = 5;

/** Aviso de segurança no sino: para a pessoa e para os administradores (sem repetir). */
async function securityAlert(db: Db, memberId: number | null, body: string, now: string) {
  const admins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)));
  const targets = [...new Set([...(memberId ? [memberId] : []), ...admins.map((admin) => admin.id)])];
  if (targets.length) await db.insert(notifications).values(targets.map((id) => ({ memberId: id, kind: "security_alert" as const, actorName: "Portal", body: body.slice(0, 140), createdAt: now }))).catch((error) => console.error("security alert failed", error));
}

/** País e cidade do acesso (a Cloudflare informa; no computador local fica "desconhecido"). */
function whereFrom(request: Request) {
  const cf = (request as unknown as { cf?: { country?: string; city?: string } }).cf;
  return { country: cf?.country ?? request.headers.get("cf-ipcountry"), city: cf?.city ?? null };
}

/** Senha (e código, se houver) conferidos: abre a sessão, registra e avisa se é um lugar novo. */
async function finishLogin(db: Db, request: Request, member: Member, limitKey: string, how: string) {
  await clearRateLimit(limitKey, db);
  await createSession(member.id, db);
  const now = new Date().toISOString();
  await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "login", targetType: "session", targetId: member.id, details: how });
  try {
    const { country, city } = whereFrom(request);
    const place = loginPlace(country, city, deviceLabel(request.headers.get("user-agent")));
    const known = (await db.select({ place: loginPlaces.place }).from(loginPlaces).where(eq(loginPlaces.memberId, member.id))).map((row) => row.place);
    await db.insert(loginPlaces).values({ memberId: member.id, place, firstSeenAt: now, lastSeenAt: now }).onConflictDoUpdate({ target: [loginPlaces.memberId, loginPlaces.place], set: { lastSeenAt: now } });
    if (isNewPlace(known, place)) {
      await securityAlert(db, member.id, `Acesso de um lugar novo: ${member.name} entrou de ${place}. Se não foi essa pessoa, troque a senha e encerre as sessões.`, now);
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "login_new_place", targetType: "session", targetId: member.id, details: place }).catch((error) => console.error("audit log failed", error));
    }
  } catch (error) {
    console.error("login place check failed", error);
  }
  return Response.json({ member: publicMember(member) });
}

/** Confere um código do aplicativo ou um código de recuperação (que é gasto). */
async function checkSecondFactor(db: Db, member: Member, code: string) {
  if (!member.totpSecret || !member.totpEnabledAt) return false;
  if (looksLikeRecoveryCode(code)) {
    const hash = await hashToken(`recovery:${normalizeRecoveryCode(code)}`);
    let list: string[] = [];
    try { list = JSON.parse(member.totpRecovery) as string[]; } catch { list = []; }
    if (!list.includes(hash)) return false;
    await db.update(members).set({ totpRecovery: JSON.stringify(list.filter((item) => item !== hash)) }).where(eq(members.id, member.id));
    return true;
  }
  const step = await verifyTotp(await openSecret(member.totpSecret), code);
  // Cada código vale uma vez: um passo igual ou anterior ao último aceito é recusado (evita reaproveitar um código visto).
  if (step === null || (member.totpLastStep !== null && step <= member.totpLastStep)) return false;
  const claimed = await db.update(members).set({ totpLastStep: step }).where(and(eq(members.id, member.id), or(isNull(members.totpLastStep), lt(members.totpLastStep, step)))).returning({ id: members.id });
  return claimed.length > 0;
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "login");
    const db = getDb();
    await cleanupAuthData(db);

    if (action === "logout") {
      const member = await getSessionMember(db);
      await destroySession(db);
      if (member) await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "logout", targetType: "session", targetId: member.id });
      return Response.json({ ok: true });
    }

    // Segunda etapa do login: o código do aplicativo (ou de recuperação) depois da senha certa.
    if (action === "login2fa") {
      const token = String(body.challenge ?? "");
      const code = String(body.code ?? "").trim();
      const now = new Date().toISOString();
      await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, now));
      const [challenge] = token ? await db.select().from(loginChallenges).where(eq(loginChallenges.tokenHash, await hashToken(token))).limit(1) : [];
      if (!challenge) return Response.json({ error: "O tempo para digitar o código acabou. Entre com a senha de novo.", restart: true }, { status: 401 });
      const [member] = await db.select().from(members).where(eq(members.id, challenge.memberId)).limit(1);
      if (!member?.active) return Response.json({ error: "Este acesso está desativado.", restart: true }, { status: 403 });
      // Limite por pessoa (não só por tela de código): no máximo 10 códigos errados a cada 15 minutos.
      const codeLimitKey = await rateLimitKey("totp", String(member.id), "any");
      if ((await checkRateLimit(codeLimitKey, db)).blocked) {
        await db.delete(loginChallenges).where(eq(loginChallenges.id, challenge.id));
        return Response.json({ error: "Muitos códigos errados. Aguarde 15 minutos e entre de novo.", restart: true }, { status: 429 });
      }
      if (await checkSecondFactor(db, member, code)) {
        await db.delete(loginChallenges).where(eq(loginChallenges.id, challenge.id));
        return finishLogin(db, request, member, await rateLimitKey("login", member.username ?? "", clientIp(request)), "senha + código");
      }
      await recordRateLimitFailure(codeLimitKey, { maxAttempts: 10, windowMinutes: 15, blockMinutes: 15 }, db);
      const attempts = challenge.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await db.delete(loginChallenges).where(eq(loginChallenges.id, challenge.id));
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "login_blocked", targetType: "session", targetId: member.id, details: `Código errado ${attempts} vezes · IP ${clientIp(request)}` }).catch((error) => console.error("audit log failed", error));
        await securityAlert(db, member.id, `Senha certa e código errado ${attempts} vezes para ${member.name} (IP ${clientIp(request)}). Se não foi essa pessoa, troque a senha.`, now);
        return Response.json({ error: "Código errado muitas vezes. Entre com a senha de novo.", restart: true }, { status: 429 });
      }
      await db.update(loginChallenges).set({ attempts }).where(eq(loginChallenges.id, challenge.id));
      return Response.json({ error: `Código incorreto. Confira no aplicativo (tentativa ${attempts} de ${MAX_CODE_ATTEMPTS}).` }, { status: 401 });
    }

    // Verificação em duas etapas da própria pessoa (e o "zerar" do administrador para quem perdeu o celular).
    if (action === "totpStatus" || action === "totpSetup" || action === "totpEnable" || action === "totpDisable" || action === "totpReset") {
      const member = await getSessionMember(db);
      if (!member?.active) return Response.json({ error: "Entre com seu usuário e senha para acessar o sistema." }, { status: 401 });
      const now = new Date().toISOString();
      if (action === "totpStatus") {
        let left = 0;
        try { left = (JSON.parse(member.totpRecovery) as string[]).length; } catch { left = 0; }
        return Response.json({ enabled: Boolean(member.totpEnabledAt), enabledAt: member.totpEnabledAt, recoveryLeft: left });
      }
      if (action === "totpSetup") {
        if (member.totpEnabledAt) return Response.json({ error: "A verificação já está ligada. Desligue antes para trocar de aparelho." }, { status: 409 });
        const secret = newTotpSecret();
        await db.update(members).set({ totpSecret: await sealSecret(secret) }).where(eq(members.id, member.id));
        return Response.json({ secret, uri: otpauthUri(secret, member.username ?? member.email, APP_NAME) });
      }
      if (action === "totpEnable") {
        if (member.totpEnabledAt) return Response.json({ error: "A verificação já está ligada." }, { status: 409 });
        if (!member.totpSecret) return Response.json({ error: "Comece de novo: gere o QR code." }, { status: 400 });
        if ((await verifyTotp(await openSecret(member.totpSecret), String(body.code ?? ""))) === null) return Response.json({ error: "Código incorreto. Confira se o relógio do celular está certo e digite o código que aparece agora." }, { status: 400 });
        const codes = newRecoveryCodes();
        const hashes = await Promise.all(codes.map((code) => hashToken(`recovery:${normalizeRecoveryCode(code)}`)));
        await db.update(members).set({ totpEnabledAt: now, totpRecovery: JSON.stringify(hashes), totpLastStep: null }).where(eq(members.id, member.id));
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "totp_enabled", targetType: "member", targetId: member.id }).catch((error) => console.error("audit log failed", error));
        // Única vez em que os códigos de recuperação saem do servidor.
        return Response.json({ ok: true, recoveryCodes: codes });
      }
      if (action === "totpDisable") {
        if (!member.totpEnabledAt) return Response.json({ ok: true });
        if (!(await checkSecondFactor(db, member, String(body.code ?? "").trim()))) return Response.json({ error: "Para desligar, digite um código do aplicativo (ou um código de recuperação)." }, { status: 400 });
        await db.update(members).set({ totpSecret: null, totpEnabledAt: null, totpRecovery: "[]", totpLastStep: null }).where(eq(members.id, member.id));
        await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "totp_disabled", targetType: "member", targetId: member.id }).catch((error) => console.error("audit log failed", error));
        return Response.json({ ok: true });
      }
      // totpReset: administrador desliga para outra pessoa (perdeu o celular e os códigos).
      if (member.role !== "admin") return Response.json({ error: "Somente administradores." }, { status: 403 });
      const targetId = Number(body.memberId);
      const [target] = Number.isInteger(targetId) && targetId > 0 ? await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, targetId)).limit(1) : [];
      if (!target) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
      await db.update(members).set({ totpSecret: null, totpEnabledAt: null, totpRecovery: "[]", totpLastStep: null }).where(eq(members.id, target.id));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "totp_reset_by_admin", targetType: "member", targetId: target.id, details: target.name }).catch((error) => console.error("audit log failed", error));
      await securityAlert(db, target.id, `${member.name} desligou a verificação em duas etapas de ${target.name}. Ligue de novo no seu perfil.`, now);
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
    // Também por conta, de qualquer IP: quem troca de IP para tentar a mesma conta esbarra aqui.
    const accountKey = await rateLimitKey("login-account", username, "any");
    const accountLimit = await checkRateLimit(accountKey, db);
    if (accountLimit.blocked) return Response.json({ error: "Muitas tentativas nesta conta. Aguarde alguns minutos e tente novamente." }, { status: 429, headers: { "Retry-After": String(accountLimit.retryAfterSeconds) } });
    const limit = await checkRateLimit(limitKey, db);
    if (limit.blocked) return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
    const [member] = await db.select().from(members).where(eq(members.username, username)).limit(1);
    // Usuário inexistente também calcula um hash: o tempo de resposta não revela quem existe.
    const valid = member?.passwordHash && member.passwordSalt
      ? await verifyPassword(password, member.passwordHash, member.passwordSalt)
      : (await verifyPassword(password, "0".repeat(64), "usuario-inexistente"), false);
    if (!member || !valid) {
      const failure = await recordRateLimitFailure(limitKey, { maxAttempts: 5, windowMinutes: 15, blockMinutes: 15 }, db);
      await recordRateLimitFailure(accountKey, { maxAttempts: 30, windowMinutes: 60, blockMinutes: 15 }, db);
      // Registra a tentativa (usuário digitado e IP), nunca a senha.
      await writeAudit(db, { actorUserId: member?.userId ?? null, actorName: member?.name ?? `Usuário “${username.slice(0, 40)}”`, action: failure.blocked ? "login_blocked" : "login_failed", targetType: "session", targetId: member?.id ?? null, details: `IP ${clientIp(request)}${member ? "" : " · usuário inexistente"}` }).catch((error) => console.error("audit log failed", error));
      if (failure.blocked) {
        await securityAlert(db, member?.id ?? null, `Muitas senhas erradas para o usuário “${username.slice(0, 40)}” (IP ${clientIp(request)}). O acesso foi bloqueado por 15 minutos.`, new Date().toISOString());
        return Response.json({ error: "Muitas tentativas. O acesso foi bloqueado por 15 minutos." }, { status: 429, headers: { "Retry-After": String(failure.retryAfterSeconds) } });
      }
      return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
    }
    if (!member.active) return Response.json({ error: "Este acesso está desativado. Fale com um administrador." }, { status: 403 });
    await clearRateLimit(accountKey, db);
    // Com a verificação em duas etapas ligada, a senha certa só libera a tela do código (vale 5 minutos).
    if (member.totpEnabledAt && member.totpSecret) {
      const token = createSecureToken();
      const now = Date.now();
      await db.insert(loginChallenges).values({ memberId: member.id, tokenHash: await hashToken(token), expiresAt: new Date(now + CHALLENGE_MINUTES * 60000).toISOString(), createdAt: new Date(now).toISOString() });
      return Response.json({ twoFactor: true, challenge: token });
    }
    return finishLogin(db, request, member, limitKey, "senha");
  } catch (error) {
    console.error("authentication failed", error);
    return Response.json({ error: "Não foi possível concluir o acesso agora." }, { status: 500 });
  }
}
