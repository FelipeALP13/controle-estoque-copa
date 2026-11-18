// Verificação em duas etapas (TOTP, RFC 6238): o mesmo padrão do Google Authenticator, Microsoft Authenticator e afins.
// Puro Web Crypto: roda no Worker e nos testes do Node.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODE_COUNT = 8;

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Chave inválida.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

/** Segredo novo (160 bits, em base32), como os aplicativos esperam. */
export function newTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** Código HOTP de n dígitos para o contador (HMAC-SHA1). */
export async function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS) {
  const message = new Uint8Array(8);
  let rest = counter;
  for (let index = 7; index >= 0; index -= 1) { message[index] = rest & 255; rest = Math.floor(rest / 256); }
  const key = await crypto.subtle.importKey("raw", secret.slice().buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = mac[mac.length - 1] & 15;
  const binary = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Código válido agora (aceita um passo antes e um depois, pela diferença de relógio). Devolve o passo usado ou null. */
export async function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), window = 1) {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const step = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (let delta = -window; delta <= window; delta += 1) {
    if (await hotp(secret, step + delta) === digits) return step + delta;
  }
  return null;
}

/** Endereço "otpauth://" que o aplicativo lê pelo QR code. */
export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Códigos de recuperação ("ABCD-2345"), para quando a pessoa perde o celular. Cada um vale uma vez. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const text = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    return `${text.slice(0, 4)}-${text.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const looksLikeRecoveryCode = (value: string) => normalizeRecoveryCode(value).length === 8 && !/^\d+$/.test(normalizeRecoveryCode(value));

// ---------- Alerta de acesso de um lugar novo ----------

/** "Lugar" de um acesso: país (e cidade, se houver) + navegador/sistema. */
export function loginPlace(country: string | null | undefined, city: string | null | undefined, device: string) {
  const where = [city?.trim(), country?.trim()].filter(Boolean).join(", ") || "local desconhecido";
  return `${where} · ${device || "aparelho desconhecido"}`.slice(0, 120);
}

/** Avisa quando a pessoa já tinha acessos registrados e este lugar é novo (o primeiro acesso nunca avisa). */
export const isNewPlace = (known: readonly string[], place: string) => known.length > 0 && !known.includes(place);
