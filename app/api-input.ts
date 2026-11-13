// Porta de entrada dos dados enviados às APIs: o corpo precisa ser um objeto JSON de tamanho razoável,
// com "action" em texto quando vier. Assim, pedidos malformados recebem 400 com uma mensagem clara
// (em vez de erro 500), e cada ação continua conferindo os próprios campos.
import { z } from "zod";

export const DEFAULT_MAX_BYTES = 256 * 1024;

const envelope = z.object({
  action: z.string({ message: "Ação inválida." }).max(60, "Ação inválida.").optional(),
}).passthrough();

export type InputResult = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

/** Confere o texto recebido (regra pura, testável sem servidor). */
export function parseBody(text: string, maxBytes = DEFAULT_MAX_BYTES): InputResult {
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: "Os dados enviados são grandes demais." };
  let value: unknown;
  try {
    value = JSON.parse(text || "{}");
  } catch {
    return { ok: false, status: 400, error: "Os dados enviados não estão em um formato válido." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, status: 400, error: "Os dados enviados não estão em um formato válido." };
  const parsed = envelope.safeParse(value);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message || "Dados inválidos." };
  return { ok: true, body: parsed.data as Record<string, unknown> };
}

/** Lê o corpo da requisição. Devolve o objeto ou uma resposta de erro pronta para retornar. */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_MAX_BYTES): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return Response.json({ error: "Os dados enviados são grandes demais." }, { status: 413 });
  let text = "";
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: "Não foi possível ler os dados enviados." }, { status: 400 });
  }
  const result = parseBody(text, maxBytes);
  return result.ok ? result.body : Response.json({ error: result.error }, { status: result.status });
}

/**
 * Confere campos com um esquema zod. Devolve os dados já tipados ou a mensagem do primeiro problema.
 * Ex.: const input = check(schema, body); if (!input.ok) return json({ error: input.error }, 400);
 */
export function check<T extends z.ZodType>(schema: T, value: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message || "Dados inválidos." };
}

/** Peças comuns dos esquemas. */
export const fields = {
  id: (message = "Item inválido.") => z.coerce.number({ message }).int(message).positive(message),
  text: (max: number, message: string) => z.string({ message }).trim().max(max, message),
  requiredText: (max: number, message: string) => z.string({ message }).trim().min(1, message).max(max, message),
  day: (message = "Data inválida.") => z.string({ message }).regex(/^\d{4}-\d{2}-\d{2}$/, message),
};
