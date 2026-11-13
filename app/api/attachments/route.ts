import { env } from "cloudflare:workers";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { attachments, tasks, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { writeAudit } from "../../audit";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_ITEM, attachmentError, cleanFileName, contentDisposition, contentMatches, extensionOf } from "../../attachments";

type Db = ReturnType<typeof getDb>;
type OwnerType = "task" | "ticket";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bucket() {
  const value = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!value) throw new Error("O armazenamento de arquivos ainda não está disponível.");
  return value;
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("attachments request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem os anexos. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const ownerTypeOf = (value: unknown): OwnerType | null => (value === "task" || value === "ticket" ? value : null);

async function ownerExists(db: Db, type: OwnerType, id: number) {
  if (!Number.isInteger(id) || id <= 0) return false;
  const [row] = type === "task"
    ? await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).limit(1)
    : await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id)).limit(1);
  return Boolean(row);
}

const publicRow = (row: typeof attachments.$inferSelect) => ({ id: row.id, fileName: row.fileName, contentType: row.contentType, size: row.size, uploadedById: row.uploadedById, uploadedByName: row.uploadedByName, createdAt: row.createdAt, url: `/api/attachments?id=${row.id}` });

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const params = new URL(request.url).searchParams;

    // Baixar/abrir um arquivo.
    const id = Number(params.get("id"));
    if (id) {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
      if (!row) return json({ error: "Arquivo não encontrado." }, 404);
      const object = await bucket().get(row.storageKey);
      if (!object) return json({ error: "Arquivo não encontrado." }, 404);
      const type = ATTACHMENT_TYPES[extensionOf(row.fileName)];
      const inline = Boolean(type?.inline) && params.get("download") !== "1";
      return new Response(object.body, {
        headers: {
          "Content-Type": type?.mime ?? "application/octet-stream",
          "Content-Disposition": contentDisposition(row.fileName, inline),
          "X-Content-Type-Options": "nosniff",
          // Mesmo aberto no navegador, o arquivo não roda scripts nem acessa o Portal.
          "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const ownerType = ownerTypeOf(params.get("ownerType"));
    const ownerId = Number(params.get("ownerId"));
    if (!ownerType || !ownerId) return json({ error: "Informe a demanda ou o chamado." }, 400);
    const rows = await db.select().from(attachments).where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId))).orderBy(asc(attachments.createdAt), asc(attachments.id));
    return json({ attachments: rows.map(publicRow), canEdit: member.role !== "viewer", meId: member.id, isAdmin: member.role === "admin" });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);

    // Excluir: quem enviou ou um administrador.
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      if (Number(request.headers.get("content-length") ?? 0) > 4096) return json({ error: "Pedido inválido." }, 400);
      const body = await request.json().catch(() => null) as { action?: string; id?: unknown } | null;
      if (!body || body.action !== "delete") return json({ error: "Ação desconhecida." }, 400);
      const [row] = await db.select().from(attachments).where(eq(attachments.id, Number(body.id))).limit(1);
      if (!row) return json({ error: "Arquivo não encontrado." }, 404);
      if (row.uploadedById !== member.id && member.role !== "admin") return json({ error: "Só quem enviou ou um administrador pode excluir o arquivo." }, 403);
      await db.delete(attachments).where(eq(attachments.id, row.id));
      await bucket().delete(row.storageKey).catch((error) => console.error("attachment object delete failed", error));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "attachment_deleted", targetType: row.ownerType, targetId: row.ownerId, details: row.fileName }).catch(() => undefined);
      return json({ ok: true });
    }

    // Enviar um arquivo (formulário com ownerType, ownerId e file).
    if (Number(request.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES + 64 * 1024) return json({ error: `O arquivo passa de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` }, 413);
    const form = await request.formData();
    const ownerType = ownerTypeOf(form.get("ownerType"));
    const ownerId = Number(form.get("ownerId"));
    const file = form.get("file");
    if (!ownerType || !(await ownerExists(db, ownerType, ownerId))) return json({ error: "Demanda ou chamado não encontrado." }, 404);
    if (!(file instanceof File)) return json({ error: "Escolha um arquivo." }, 400);
    const fileName = cleanFileName(file.name);
    const problem = attachmentError(fileName, file.size);
    if (problem) return json({ error: problem }, 400);
    const [{ value: existing }] = await db.select({ value: count() }).from(attachments).where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId)));
    if (existing >= MAX_ATTACHMENTS_PER_ITEM) return json({ error: `Limite de ${MAX_ATTACHMENTS_PER_ITEM} arquivos por item.` }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = extensionOf(fileName);
    if (!contentMatches(extension, bytes)) return json({ error: "O conteúdo do arquivo não corresponde ao tipo indicado." }, 400);
    const storageKey = `attachments/${ownerType}/${ownerId}/${crypto.randomUUID()}.${extension}`;
    await bucket().put(storageKey, bytes, { httpMetadata: { contentType: ATTACHMENT_TYPES[extension].mime } });
    const [row] = await db.insert(attachments).values({ ownerType, ownerId, storageKey, fileName, contentType: ATTACHMENT_TYPES[extension].mime, size: bytes.length, uploadedById: member.id, uploadedByName: member.name }).returning();
    return json({ attachment: publicRow(row) }, 201);
  } catch (error) {
    return failure(error);
  }
}
