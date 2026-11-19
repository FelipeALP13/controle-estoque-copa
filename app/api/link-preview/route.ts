// Prévia de links do chat: o servidor busca a página (só endereços públicos) e devolve título, descrição e imagem.
// A imagem também passa pelo servidor (?image=...), para o site do link não receber o endereço de quem está lendo.
import { getDb } from "../../../db";
import { getSessionMember } from "../../auth-session";
import { isSafePublicUrl, parsePreview } from "../../link-preview";

const TIMEOUT_MS = 5000;
const MAX_HTML = 512 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; PortalDaEquipe-LinkPreview/1.0)";

function json(body: unknown, status = 200, maxAge = 0) {
  return Response.json(body, { status, headers: { "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "no-store" } });
}

/** Busca seguindo no máximo 3 redirecionamentos, conferindo cada destino. */
async function safeFetch(start: string, accept: string) {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafePublicUrl(url)) return null;
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      url = new URL(location, url).toString();
      continue;
    }
    return response.ok ? { response, url } : null;
  }
  return null;
}

/** Lê o corpo até `limit` bytes (páginas enormes não travam o servidor). */
async function readLimited(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.min(chunk.byteLength, out.length - offset));
    out.set(part, offset);
    offset += part.byteLength;
    if (offset >= out.length) break;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const member = await getSessionMember(getDb());
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const params = new URL(request.url).searchParams;

    const imageUrl = params.get("image");
    if (imageUrl) {
      const result = await safeFetch(imageUrl, "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8").catch(() => null);
      const type = result?.response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!result || !/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) return new Response(null, { status: 404 });
      const body = await readLimited(result.response, MAX_IMAGE + 1);
      if (body.byteLength > MAX_IMAGE) return new Response(null, { status: 413 });
      return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }

    const target = params.get("url") ?? "";
    if (!isSafePublicUrl(target)) return json({ preview: null }, 200, 3600);
    const result = await safeFetch(target, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5").catch(() => null);
    const type = result?.response.headers.get("content-type") ?? "";
    if (!result || !/text\/html|application\/xhtml/i.test(type)) return json({ preview: null }, 200, 3600);
    const bytes = await readLimited(result.response, MAX_HTML);
    const charset = type.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
    let html: string;
    try { html = new TextDecoder(charset || "utf-8").decode(bytes); } catch { html = new TextDecoder("utf-8").decode(bytes); }
    const preview = parsePreview(html, result.url);
    return json({ preview: preview ? { ...preview, url: target, image: preview.image ? `/api/link-preview?image=${encodeURIComponent(preview.image)}` : null } : null }, 200, 86400);
  } catch (error) {
    console.error("link preview failed", error);
    return json({ preview: null });
  }
}
