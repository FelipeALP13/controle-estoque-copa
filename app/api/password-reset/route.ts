import { env } from "cloudflare:workers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, passwordResetTokens, sessions } from "../../../db/schema";
import { createSecureToken, hashPassword, hashToken, validatePassword } from "../../auth-session";

const RESET_MINUTES = 30;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

async function sendResetEmail(to: string, name: string, resetUrl: string) {
  const runtime = env as unknown as { RESEND_API_KEY?: string; PASSWORD_RESET_FROM_EMAIL?: string };
  if (!runtime.RESEND_API_KEY || !runtime.PASSWORD_RESET_FROM_EMAIL) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: runtime.PASSWORD_RESET_FROM_EMAIL,
      to: [to],
      subject: "Redefinição de senha — Estoque da Firma",
      html: `<div style="font-family:Arial,sans-serif;color:#26332b;line-height:1.55"><h2 style="color:#1f6940">Redefinição de senha</h2><p>Olá, ${escapeHtml(name)}.</p><p>Recebemos uma solicitação para alterar sua senha no Estoque da Firma.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#1f6940;color:#fff;text-decoration:none;font-weight:700">Criar nova senha</a></p><p style="font-size:12px;color:#718078">O link expira em ${RESET_MINUTES} minutos. Se você não fez esta solicitação, ignore este e-mail.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error("O serviço de e-mail recusou o envio. Verifique a chave e o remetente configurados.");
  return true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "request");
    const db = getDb();

    if (action === "confirm") {
      const token = String(body.token ?? "");
      const password = String(body.password ?? "");
      if (!token || !validatePassword(password)) return Response.json({ error: "O link ou a nova senha são inválidos. Use pelo menos 6 caracteres." }, { status: 400 });
      const tokenHash = await hashToken(token);
      const [record] = await db
        .select({ resetId: passwordResetTokens.id, memberId: members.id })
        .from(passwordResetTokens)
        .innerJoin(members, eq(passwordResetTokens.memberId, members.id))
        .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date().toISOString())))
        .limit(1);
      if (!record) return Response.json({ error: "Este link expirou ou já foi utilizado. Solicite um novo." }, { status: 400 });
      const credentials = await hashPassword(password);
      const now = new Date().toISOString();
      await db.batch([
        db.update(members).set({ passwordHash: credentials.hash, passwordSalt: credentials.salt }).where(eq(members.id, record.memberId)),
        db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, record.resetId)),
        db.delete(sessions).where(eq(sessions.memberId, record.memberId)),
      ]);
      return Response.json({ ok: true, message: "Senha alterada. Você já pode entrar com a nova senha." });
    }

    const email = String(body.email ?? "").trim().toLocaleLowerCase("pt-BR");
    if (!email.includes("@")) return Response.json({ error: "Informe um e-mail válido." }, { status: 400 });
    const [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
    const genericMessage = "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.";
    if (!member?.active) return Response.json({ ok: true, message: genericMessage });

    const token = createSecureToken();
    const expiresAt = new Date(Date.now() + RESET_MINUTES * 60000).toISOString();
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.memberId, member.id));
    await db.insert(passwordResetTokens).values({ memberId: member.id, tokenHash: await hashToken(token), expiresAt });
    const origin = new URL(request.url).origin;
    const resetUrl = `${origin}/redefinir-senha?token=${encodeURIComponent(token)}`;
    const sent = await sendResetEmail(member.email, member.name, resetUrl);
    if (!sent) {
      const hostname = new URL(request.url).hostname;
      if (hostname === "127.0.0.1" || hostname === "localhost") {
        return Response.json({ ok: true, message: "Modo local: use o link abaixo para testar a redefinição.", previewUrl: resetUrl });
      }
      return Response.json({ error: "O envio de e-mail ainda não foi configurado pelo administrador." }, { status: 503 });
    }
    return Response.json({ ok: true, message: genericMessage });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível redefinir a senha." }, { status: 500 });
  }
}
