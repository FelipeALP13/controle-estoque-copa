import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";

const allowedImages: Record<string, { extension: string; valid: (bytes: Uint8Array) => boolean }> = {
  "image/png": { extension: "png", valid: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { extension: "jpg", valid: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { extension: "gif", valid: (b) => String.fromCharCode(...b.slice(0, 4)) === "GIF8" },
  "image/webp": { extension: "webp", valid: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

async function hasAccess() {
  const member = await getSessionMember(getDb());
  return Boolean(member?.active);
}

function getBucket() {
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) throw new Error("O armazenamento de imagens ainda não está disponível.");
  return bucket;
}

export async function GET(request: Request) {
  if (!(await hasAccess())) return Response.json({ error: "Faça login para visualizar esta imagem." }, { status: 401 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key.startsWith("media/") || key.includes("..")) return Response.json({ error: "Imagem inválida." }, { status: 400 });
  const object = await getBucket().get(key);
  if (!object) return Response.json({ error: "Imagem não encontrada." }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "ETag": object.httpEtag,
    },
  });
}

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  if (!(await hasAccess())) return Response.json({ error: "Faça login para enviar imagens." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const kind = form.get("kind") === "profile" ? "profiles" : "items";
  if (!(file instanceof File)) return Response.json({ error: "Selecione uma imagem." }, { status: 400 });
  const imageType = allowedImages[file.type];
  if (!imageType) return Response.json({ error: "Use uma imagem PNG, JPG, GIF ou WebP." }, { status: 400 });
  if (file.size > 3 * 1024 * 1024) return Response.json({ error: "A imagem deve ter no máximo 3 MB." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!imageType.valid(bytes)) return Response.json({ error: "O conteúdo do arquivo não corresponde a uma imagem válida." }, { status: 400 });
  const key = `media/${kind}/${crypto.randomUUID()}.${imageType.extension}`;
  await getBucket().put(key, bytes, { httpMetadata: { contentType: file.type } });
  return Response.json({ imageKey: key, imageUrl: `/api/media?key=${encodeURIComponent(key)}` }, { status: 201 });
}
