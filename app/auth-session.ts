import { and, eq, gt, lt, ne } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getDb } from "../db";
import { authRateLimits, members, sessions } from "../db/schema";
import { normalizeUsername } from "./auth-policy";
import { checkSession, deviceLabel, IDLE_DAYS, newSessionExpiry } from "./session-policy";

export { normalizeUsername, passwordPolicyError, validatePassword } from "./auth-policy";

const SESSION_COOKIE = "estoque_session";
// Cloudflare Workers caps each Web Crypto PBKDF2 operation at 100,000
// iterations. Chaining stages preserves the intended 210,000-iteration cost.
const PASSWORD_ITERATION_STAGES = [100_000, 100_000, 10_000] as const;

export type SessionMember = typeof members.$inferSelect;

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(length: number) {
  return toHex(crypto.getRandomValues(new Uint8Array(length)));
}

export async function hashToken(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export function createSecureToken() {
  return randomHex(32);
}

export async function hashPassword(password: string, salt = randomHex(16)) {
  const encoder = new TextEncoder();
  let material: BufferSource = encoder.encode(password);
  for (let stage = 0; stage < PASSWORD_ITERATION_STAGES.length; stage += 1) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    material = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`${salt}:${stage}`), iterations: PASSWORD_ITERATION_STAGES[stage] },
      key,
      256,
    );
  }
  return { hash: toHex(new Uint8Array(material as ArrayBuffer)), salt };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string) {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < hash.length; index += 1) {
    difference |= hash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

export async function getSessionMember(db = getDb()): Promise<SessionMember | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const [row] = await db
    .select({ member: members, session: { id: sessions.id, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt, device: sessions.device } })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  const state = checkSession(row.session, Date.now());
  if (!state.valid) {
    // Parada por muito tempo (ou velha demais): apaga e pede a senha de novo.
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (state.renew) {
    // Em uso: empurra o vencimento (no banco e no cookie do navegador).
    // Sessões de antes da lista de aparelhos ganham o nome do aparelho no primeiro uso.
    let device = row.session.device;
    if (!device) { try { device = deviceLabel((await headers()).get("user-agent")); } catch { /* sem cabeçalhos */ } }
    await db.update(sessions).set({ lastSeenAt: now, expiresAt: state.expiresAt, device }).where(eq(sessions.id, row.session.id));
    try {
      (await cookies()).set(SESSION_COOKIE, token, cookieOptions(new Date(state.expiresAt)));
    } catch {
      // Páginas (não APIs) não podem gravar cookie: o banco já foi renovado e a próxima API atualiza o cookie.
    }
  }
  return row.member;
}

function cookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires };
}

/** Id da sessão deste navegador (para marcar "este aparelho" e encerrar as outras). */
export async function currentSessionId(db = getDb()) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, await hashToken(token))).limit(1);
  return row?.id ?? null;
}

/** Sessões abertas da pessoa (sem o token), mais recente primeiro. */
export async function listSessions(memberId: number, db = getDb()) {
  const now = new Date().toISOString();
  const currentId = await currentSessionId(db);
  const rows = await db.select({ id: sessions.id, device: sessions.device, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt }).from(sessions).where(and(eq(sessions.memberId, memberId), gt(sessions.expiresAt, now)));
  return rows
    .filter((row) => checkSession(row, Date.now()).valid)
    .map((row) => ({ id: row.id, device: row.device || "Aparelho não identificado", createdAt: row.createdAt, lastSeenAt: row.lastSeenAt ?? row.createdAt, current: row.id === currentId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Encerra as sessões da pessoa: todas menos esta (`keepCurrent`) ou todas mesmo. */
export async function endSessions(memberId: number, keepCurrent: boolean, db = getDb()) {
  const currentId = await currentSessionId(db);
  const keep = keepCurrent ? currentId : null;
  const removed = await db.delete(sessions).where(keep ? and(eq(sessions.memberId, memberId), ne(sessions.id, keep)) : eq(sessions.memberId, memberId)).returning({ id: sessions.id });
  // Só limpa o cookie deste navegador se a sessão dele foi uma das encerradas.
  if (currentId && !keep && removed.some((row) => row.id === currentId)) (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return removed.length;
}

export async function createSession(memberId: number, db = getDb()) {
  const token = randomHex(32);
  const tokenHash = await hashToken(token);
  const expiresAt = newSessionExpiry(Date.now());
  let device = "";
  try { device = deviceLabel((await headers()).get("user-agent")); } catch { /* sem cabeçalhos: fica sem nome */ }
  await db.insert(sessions).values({ memberId, tokenHash, expiresAt, lastSeenAt: new Date().toISOString(), device });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(new Date(expiresAt)));
}

export async function destroySession(db = getDb()) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, await hashToken(token)));
  cookieStore.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function cleanupAuthData(db = getDb()) {
  const now = new Date().toISOString();
  const staleRateLimit = new Date(Date.now() - 2 * 86400000).toISOString();
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, now)),
    // Paradas há mais de 7 dias também não valem mais.
    db.delete(sessions).where(lt(sessions.lastSeenAt, new Date(Date.now() - IDLE_DAYS * 86400000).toISOString())),
    db.delete(authRateLimits).where(lt(authRateLimits.updatedAt, staleRateLimit)),
  ]);
}

export async function rateLimitKey(scope: string, identifier: string, ip: string) {
  return hashToken(`${scope}:${normalizeUsername(identifier)}:${ip}`);
}

export async function checkRateLimit(key: string, db = getDb()) {
  const [row] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)).limit(1);
  const blockedUntil = row?.blockedUntil ? new Date(row.blockedUntil).getTime() : 0;
  if (blockedUntil > Date.now()) return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)) };
  return { blocked: false, retryAfterSeconds: 0 };
}

export async function recordRateLimitFailure(key: string, options: { maxAttempts: number; windowMinutes: number; blockMinutes: number }, db = getDb()) {
  const now = new Date();
  const [current] = await db.select().from(authRateLimits).where(eq(authRateLimits.key, key)).limit(1);
  const windowExpired = !current || new Date(current.windowStartedAt).getTime() < now.getTime() - options.windowMinutes * 60000;
  const attempts = windowExpired ? 1 : current.attempts + 1;
  const blockedUntil = attempts >= options.maxAttempts ? new Date(now.getTime() + options.blockMinutes * 60000).toISOString() : null;
  const values = { attempts, windowStartedAt: windowExpired ? now.toISOString() : current!.windowStartedAt, blockedUntil, updatedAt: now.toISOString() };
  if (current) await db.update(authRateLimits).set(values).where(eq(authRateLimits.key, key));
  else await db.insert(authRateLimits).values({ key, ...values });
  return { blocked: Boolean(blockedUntil), retryAfterSeconds: blockedUntil ? options.blockMinutes * 60 : 0 };
}

export async function clearRateLimit(key: string, db = getDb()) {
  await db.delete(authRateLimits).where(eq(authRateLimits.key, key));
}
