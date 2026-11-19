// Atualização ao vivo: toda alteração bem-sucedida numa API anota um "número de versão" no banco;
// as telas abertas consultam /api/live a cada poucos segundos e recarregam quando o número muda.
// Uma linha só (app_settings "live_version"): leve para o banco e sem dado nenhum além de um horário.

const KEY = "live_version";
/** Rotas que mudam o tempo todo e já se atualizam sozinhas (ou que não mudam dados de tela). */
const IGNORED = ["/api/chat", "/api/notifications", "/api/push", "/api/link-preview", "/api/auth", "/api/live", "/api/gifs", "/api/media", "/api/activity"];

export function isLiveRequest(url: URL) {
  return url.pathname === "/api/live";
}

/** Responde /api/live com a versão atual (sem passar pelo resto do Portal). */
export async function liveResponse(env: Cloudflare.Env) {
  let version = "0";
  try {
    const row = await env.DB?.prepare("select value from app_settings where key = ?").bind(KEY).first<{ value: string }>();
    version = row?.value ?? "0";
  } catch { /* sem banco: fica na versão 0 e as telas simplesmente não recarregam */ }
  return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
}

/** Depois de uma alteração bem-sucedida, anota a nova versão (sem atrasar a resposta). */
export function bumpLiveVersion(request: Request, response: Response, env: Cloudflare.Env, ctx: ExecutionContext) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  if (response.status >= 400) return;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/") || IGNORED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return;
  const db = env.DB;
  if (!db) return;
  const now = new Date().toISOString();
  ctx.waitUntil(db.prepare("insert into app_settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at")
    .bind(KEY, String(Date.now()), now).run().catch((error: unknown) => console.error("live version failed", error)));
}
