import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db";
import { members, sessions } from "../db/schema";

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

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, "");
}

export function validatePassword(value: string) {
  return value.length >= 6;
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
