// Marca da empresa (white label): leitura pública (o login precisa) e alteração só por administradores.
import { getDb } from "../../../db";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { writeAudit } from "../../audit";
import { fileStore, fileStoreOrNull } from "../../file-store";
import { loadBrand, saveBrand } from "../../brand-store";
import { DEFAULT_BRAND, brandInputError, brandLogoUrl, parseBrand, type Brand } from "../../brand-theme";

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, { extension: string; valid: (b: Uint8Array) => boolean }> = {
  "image/png": { extension: "png", valid: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/jpeg": { extension: "jpg", valid: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/webp": { extension: "webp", valid: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const publicBrand = (brand: Brand) => ({ name: brand.name, shortName: brand.shortName, tagline: brand.tagline, color: brand.color, logoUrl: brandLogoUrl(brand), updatedAt: brand.updatedAt });

export async function GET(request: Request) {
  const brand = await loadBrand();
  if (new URL(request.url).searchParams.get("logo") !== "1") return json({ brand: publicBrand(brand) });
  // Só o logo configurado (nunca outro arquivo do armazenamento).
  if (!brand.logoKey) return new Response(null, { status: 404 });
  const object = await fileStoreOrNull()?.get(brand.logoKey);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.contentType ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // O endereço muda quando o logo muda (?v=...), então pode ficar em cache.
      "Cache-Control": "public, max-age=86400",
    },
  });
}

async function removeFile(key: string | null) {
  if (key) await fileStoreOrNull()?.delete(key).catch((error) => console.error("brand logo delete failed", error));
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Só administradores mudam a marca do Portal." }, 403);
    const current = await loadBrand(db);
    const audit = (action: string, details: string) => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action, targetType: "brand", details }).catch((error) => console.error("audit log failed", error));

    // Enviar logo (formulário com o arquivo).
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES + 64 * 1024) return json({ error: "O logo pode ter até 1 MB." }, 413);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Escolha uma imagem." }, 400);
      const type = LOGO_TYPES[file.type];
      if (!type) return json({ error: "Use um logo em PNG, JPG ou WebP." }, 400);
      if (file.size > MAX_LOGO_BYTES) return json({ error: "O logo pode ter até 1 MB." }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!type.valid(bytes)) return json({ error: "O conteúdo do arquivo não é uma imagem válida." }, 400);
      const key = `media/brand/${crypto.randomUUID()}.${type.extension}`;
      await fileStore().put(key, bytes, file.type);
      const saved = await saveBrand(db, { ...current, logoKey: key });
      await removeFile(current.logoKey);
      await audit("brand_logo_updated", "Novo logo");
      return json({ brand: publicBrand(saved) });
    }

    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (body.action === "removeLogo") {
      const saved = await saveBrand(db, { ...current, logoKey: null });
      await removeFile(current.logoKey);
      await audit("brand_logo_updated", "Logo removido (volta ao ícone padrão)");
      return json({ brand: publicBrand(saved) });
    }
    if (body.action === "reset") {
      const saved = await saveBrand(db, { ...DEFAULT_BRAND, logoKey: null });
      await removeFile(current.logoKey);
      await audit("brand_updated", "Marca restaurada para o padrão");
      return json({ brand: publicBrand(saved) });
    }
    if (body.action === "save") {
      const problem = brandInputError(body);
      if (problem) return json({ error: problem }, 400);
      const next = parseBrand(JSON.stringify({ ...current, name: body.name, shortName: body.shortName || body.name, tagline: body.tagline, color: body.color }));
      const saved = await saveBrand(db, next);
      const changes = [current.name !== saved.name && `nome "${saved.name}"`, current.shortName !== saved.shortName && `nome curto "${saved.shortName}"`, current.tagline !== saved.tagline && "frase", current.color !== saved.color && `cor ${saved.color}`].filter(Boolean).join(", ");
      await audit("brand_updated", changes || "Sem mudanças");
      return json({ brand: publicBrand(saved) });
    }
    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("brand request failed", error);
    return json({ error: "Não foi possível salvar a marca agora." }, 500);
  }
}
