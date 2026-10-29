import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { getSessionMember } from "../../auth-session";

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
      "Cache-Control": "private, max-age=3600",
      "ETag": object.httpEtag,
    },
  });
}

export async function POST(request: Request) {
  if (!(await hasAccess())) return Response.json({ error: "Faça login para enviar imagens." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  const kind = form.get("kind") === "profile" ? "profiles" : "items";
  if (!(file instanceof File)) return Response.json({ error: "Selecione uma imagem." }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "O arquivo precisa ser uma imagem." }, { status: 400 });
  if (file.size > 3 * 1024 * 1024) return Response.json({ error: "A imagem deve ter no máximo 3 MB." }, { status: 400 });
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "img";
  const key = `media/${kind}/${crypto.randomUUID()}.${extension}`;
  await getBucket().put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return Response.json({ imageKey: key, imageUrl: `/api/media?key=${encodeURIComponent(key)}` }, { status: 201 });
}
