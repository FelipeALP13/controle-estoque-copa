import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { writeAudit } from "../../audit";
import { openSecret, sealSecret } from "../../secret-key";
import { mapGiphy } from "../../social-tools";

const KEY = "giphy_api_key";
const GIPHY = "https://api.giphy.com/v1/gifs";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function apiKey(db: ReturnType<typeof getDb>) {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  if (!row?.value) return null;
  try { return await openSecret(row.value); } catch { return null; }
}

/** Busca de GIFs (Giphy). Sem a chave configurada por um administrador, só avisa que falta configurar. */
export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const key = await apiKey(db);
    if (!key) return json({ configured: false, results: [], canConfigure: member.role === "admin" });
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 50);
    const url = query
      ? `${GIPHY}/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=24&rating=pg-13&lang=pt`
      : `${GIPHY}/trending?api_key=${encodeURIComponent(key)}&limit=24&rating=pg-13`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return json({ configured: true, results: [], error: response.status === 401 || response.status === 403 ? "A chave do Giphy foi recusada. Peça a um administrador para conferir." : "O Giphy não respondeu agora. Tente de novo." }, 502);
    return json({ configured: true, results: mapGiphy(await response.json()), canConfigure: member.role === "admin" });
  } catch (error) {
    console.error("gifs request failed", error);
    return json({ configured: true, results: [], error: "Não foi possível buscar GIFs agora." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores configuram a busca de GIFs." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    if (body.action !== "saveKey") return json({ error: "Ação desconhecida." }, 400);
    const key = String(body.key ?? "").trim();
    const now = new Date().toISOString();
    if (!key) {
      await db.delete(appSettings).where(eq(appSettings.key, KEY));
    } else {
      if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return json({ error: "Essa não parece uma chave do Giphy (só letras e números)." }, 400);
      const sealed = await sealSecret(key);
      await db.insert(appSettings).values({ key: KEY, value: sealed, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value: sealed, updatedAt: now } });
    }
    await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "giphy_key_saved", targetType: "settings", details: key ? "chave salva" : "chave removida" }).catch((error) => console.error("audit log failed", error));
    return json({ ok: true });
  } catch (error) {
    console.error("gifs settings failed", error);
    return json({ error: "Não foi possível salvar a chave agora." }, 500);
  }
}
