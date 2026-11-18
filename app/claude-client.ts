// Chamada à API do Claude (Messages) pelo servidor do Portal. A chave fica criptografada no banco.
// Feito com fetch direto: o Portal é publicado pelo Sites e não dá para instalar o SDK por aqui.
import { inArray } from "drizzle-orm";
import type { getDb } from "../db";
import { appSettings } from "../db/schema";
import { openSecret } from "./secret-key";
import { API_VERSION, DEFAULT_AI_MODEL, isAiModel, messagesBody, readAiResponse, type AiModel, type AiOutcome } from "./ai-assist";

type Db = ReturnType<typeof getDb>;
export const AI_KEY = "anthropic_api_key";
export const AI_MODEL = "anthropic_model";
/** Só no computador de desenvolvimento: endereço de um servidor falso, para testar sem gastar créditos. */
export const AI_TEST_URL = "anthropic_test_url";
const API_URL = "https://api.anthropic.com/v1/messages";

export async function aiSettings(db: Db) {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [AI_KEY, AI_MODEL, AI_TEST_URL]));
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? "";
  const model = value(AI_MODEL);
  const testUrl = import.meta.env?.DEV && /^http:\/\/127\.0\.0\.1:\d+\//.test(value(AI_TEST_URL)) ? value(AI_TEST_URL) : "";
  return { sealedKey: value(AI_KEY), model: (isAiModel(model) ? model : DEFAULT_AI_MODEL) as AiModel, testUrl };
}

/** Pede ao Claude e devolve o texto (ou o erro em português). */
export async function askClaude(db: Db, request: { system: string; user: string }, effort: "low" | "medium" = "low"): Promise<AiOutcome> {
  const settings = await aiSettings(db);
  if (!settings.sealedKey) return { ok: false, error: "A IA ainda não foi configurada. Um administrador coloca a chave da Anthropic em Administração." };
  let key: string;
  try { key = await openSecret(settings.sealedKey); } catch { return { ok: false, error: "Não foi possível abrir a chave da IA. Cadastre-a de novo em Administração." }; }
  try {
    const response = await fetch(settings.testUrl || API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": API_VERSION },
      body: JSON.stringify(messagesBody(settings.model, request, effort)),
      signal: AbortSignal.timeout(90000),
    });
    return readAiResponse(response.status, await response.json().catch(() => null));
  } catch {
    return { ok: false, error: "A IA demorou demais para responder. Tente de novo." };
  }
}

