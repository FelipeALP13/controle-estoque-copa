// Chave de criptografia dos segredos: fica no armazenamento de arquivos (R2), separada do banco.
// Uma cópia ou vazamento só do banco não revela os tokens. A rota de imagens só serve "media/...",
// então este arquivo não pode ser baixado pelo site.
// Na hospedagem própria a chave é um segredo do Worker (ENCRYPTION_KEY), criado pelo scripts/cloudflare.mjs.
import { env } from "cloudflare:workers";
import { importKey, newRawKey, open, seal } from "./secret-box";
import { fileStore } from "./file-store";

const KEY_PATH = "secrets/encryption-key-v1";
let cached: Promise<CryptoKey> | null = null;

async function loadKey() {
  const fromSecret = (env as unknown as { ENCRYPTION_KEY?: string }).ENCRYPTION_KEY;
  if (fromSecret) return importKey(fromSecret);
  const store = fileStore("O armazenamento de arquivos não está disponível para guardar a chave de criptografia.");
  const existing = await store.get(KEY_PATH);
  if (existing) return importKey(await existing.text());
  // Primeira vez: cria, grava e lê de volta (se duas criações correrem juntas, todas usam a que ficou gravada).
  await store.put(KEY_PATH, newRawKey(), "text/plain");
  const saved = await store.get(KEY_PATH);
  if (!saved) throw new Error("Não foi possível guardar a chave de criptografia.");
  return importKey(await saved.text());
}

export function secretKey() {
  if (!cached) cached = loadKey().catch((error) => { cached = null; throw error; });
  return cached;
}

/** Criptografa um segredo para gravar no banco. */
export async function sealSecret(plain: string) {
  return seal(await secretKey(), plain);
}

/** Abre um segredo lido do banco (valores antigos sem criptografia voltam como estão). */
export async function openSecret(stored: string) {
  return open(await secretKey(), stored);
}
