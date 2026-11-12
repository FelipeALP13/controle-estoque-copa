import { getDb } from "../../../db";
import { getSettings, runJobs, SETTINGS } from "../../jobs";
import { sameText, sha256Hex } from "../../secret-box";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Chamado pelo agendador externo (GitHub Actions) a cada 10 minutos.
 * Protegido por uma chave própria (Authorization: Bearer ...); o banco guarda só o resumo (hash) dela.
 */
export async function POST(request: Request) {
  try {
    const db = getDb();
    const header = request.headers.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const settings = await getSettings(db);
    const expected = settings.get(SETTINGS.cronKeyHash);
    if (!expected) return json({ error: "Agendador ainda não configurado no Portal." }, 503);
    if (!key || key.length > 200 || !sameText(await sha256Hex(key), expected)) return json({ error: "Chave do agendador inválida." }, 401);
    const result = await runJobs(db, { recordRun: true });
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("cron failed", error);
    return json({ error: "Falha ao rodar as rotinas." }, 500);
  }
}

export async function GET() {
  return json({ error: "Use POST com a chave do agendador." }, 405);
}
