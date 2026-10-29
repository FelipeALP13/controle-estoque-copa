import { eq, isNotNull } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { members } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  createSession,
  destroySession,
  getSessionMember,
  hashPassword,
  normalizeUsername,
  validatePassword,
  verifyPassword,
} from "../../auth-session";

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
  const host = (await headers()).get("host") ?? "";
  if (host.startsWith("127.0.0.1") || host.startsWith("localhost")) return true;
  return Boolean(await getChatGPTUser());
}

export async function GET() {
  const db = getDb();
  const [credentialed] = await db.select({ id: members.id }).from(members).where(isNotNull(members.passwordHash)).limit(1);
  const member = await getSessionMember(db);
  return Response.json({ setupRequired: !credentialed, authenticated: Boolean(member?.active), member: member?.active ? publicMember(member) : null });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "login");
    const db = getDb();

    if (action === "logout") {
      await destroySession(db);
      return Response.json({ ok: true });
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
      if (!validatePassword(password)) return Response.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });

      const { hash, salt } = await hashPassword(password);
      const [existingAdmin] = await db.select().from(members).where(eq(members.role, "admin")).limit(1);
      const [member] = existingAdmin
        ? await db.update(members).set({ name, email, username, passwordHash: hash, passwordSalt: salt, active: true }).where(eq(members.id, existingAdmin.id)).returning()
        : await db.insert(members).values({ userId: `admin:${crypto.randomUUID()}`, name, email, username, passwordHash: hash, passwordSalt: salt, role: "admin", permissions: "{}", active: true }).returning();
      await createSession(member.id, db);
      return Response.json({ member: publicMember(member) }, { status: 201 });
    }

    const username = normalizeUsername(String(body.username ?? ""));
    const password = String(body.password ?? "");
    if (!username || !password) return Response.json({ error: "Informe o usuário e a senha." }, { status: 400 });
    const [member] = await db.select().from(members).where(eq(members.username, username)).limit(1);
    if (!member?.passwordHash || !member.passwordSalt || !(await verifyPassword(password, member.passwordHash, member.passwordSalt))) {
      return Response.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
    }
    if (!member.active) return Response.json({ error: "Este acesso está desativado. Fale com um administrador." }, { status: 403 });
    await createSession(member.id, db);
    return Response.json({ member: publicMember(member) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível concluir o acesso." }, { status: 500 });
  }
}
