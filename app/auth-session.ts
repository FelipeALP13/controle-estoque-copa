import { and, eq, gt, isNotNull, lt, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { authRateLimits, members, passwordResetTokens, sessions } from "../db/schema";
import { normalizeUsername } from "./auth-policy";

export { normalizeUsername, passwordPolicyError, validatePassword } from "./auth-policy";

const SESSION_COOKIE = "estoque_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 210_000;

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
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(new Uint8Array(bits)), salt };
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
    .select({ member: members })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  return row?.member ?? null;
}

export async function createSession(memberId: number, db = getDb()) {
  const token = randomHex(32);
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ memberId, tokenHash, expiresAt: expiresAt.toISOString() });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
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
    db.delete(passwordResetTokens).where(or(lt(passwordResetTokens.expiresAt, now), isNotNull(passwordResetTokens.usedAt))),
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
