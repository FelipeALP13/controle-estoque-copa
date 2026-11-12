// Chave de criptografia dos segredos: fica no armazenamento de arquivos (R2), separada do banco.
// Uma cópia ou vazamento só do banco não revela os tokens. A rota de imagens só serve "media/...",
// então este arquivo não pode ser baixado pelo site.
import { env } from "cloudflare:workers";
import { importKey, newRawKey, open, seal } from "./secret-box";

const KEY_PATH = "secrets/encryption-key-v1";
let cached: Promise<CryptoKey> | null = null;

function bucket() {
  const value = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!value) throw new Error("O armazenamento de arquivos não está disponível para guardar a chave de criptografia.");
  return value;
}

async function loadKey() {
  const store = bucket();
  const existing = await store.get(KEY_PATH);
  if (existing) return importKey(await existing.text());
  // Primeira vez: cria, grava e lê de volta (se duas criações correrem juntas, todas usam a que ficou gravada).
  await store.put(KEY_PATH, newRawKey(), { httpMetadata: { contentType: "text/plain" } });
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
