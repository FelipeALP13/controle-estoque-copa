// Criptografia de segredos guardados no banco (chave do Jira, link do Teams) com AES-GCM.
// Puro Web Crypto: roda no Worker e nos testes do Node. A chave vem de fora (ver secret-key.ts).

const PREFIX = "v1:";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Gera uma chave nova de 256 bits, em base64 (para guardar fora do banco). */
export function newRawKey() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export async function importKey(rawBase64: string) {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = fromBase64(rawBase64.trim()); } catch { throw new Error("Chave de criptografia inválida."); }
  if (raw.length !== 32) throw new Error("Chave de criptografia inválida.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Valor já criptografado por esta rotina? */
export const isSealed = (value: string | null | undefined) => typeof value === "string" && value.startsWith(PREFIX);

/** Texto → "v1:<iv>:<dados>". Cada chamada usa um IV novo, então o mesmo texto gera resultados diferentes. */
export async function seal(key: CryptoKey, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `${PREFIX}${toBase64(iv)}:${toBase64(data)}`;
}

/**
 * "v1:..." → texto. Valor antigo (sem o prefixo, de antes da criptografia) volta como está,
 * para quem já tinha a conta conectada continuar funcionando até ser regravado.
 */
export async function open(key: CryptoKey, sealed: string) {
  if (!isSealed(sealed)) return sealed;
  const [ivText, dataText] = sealed.slice(PREFIX.length).split(":");
  if (!ivText || !dataText) throw new Error("Segredo guardado está corrompido.");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivText) }, key, fromBase64(dataText));
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Não foi possível abrir o segredo guardado (a chave de criptografia mudou?). Cadastre-o de novo.");
  }
}

/** SHA-256 em hexadecimal (para guardar só o "resumo" da chave do agendador). */
export async function sha256Hex(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (não revela onde dois textos diferem). */
export function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
