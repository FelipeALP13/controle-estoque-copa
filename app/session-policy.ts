// Regras da sessão de login (puras, sem banco, usadas pelo servidor e pelos testes).

const DAY = 86400000;
/** Cada uso empurra o vencimento para daqui a 30 dias... */
export const SESSION_DAYS = 30;
/** ...mas sem uso por 7 dias a sessão cai (computador esquecido logado). */
export const IDLE_DAYS = 7;
/** ...e nenhuma sessão passa de 90 dias: depois disso, entrar de novo com a senha. */
export const MAX_DAYS = 90;
/** Para não gravar no banco a cada clique: renova no máximo a cada 15 minutos. */
export const TOUCH_EVERY_MS = 15 * 60000;

export type SessionTimes = { createdAt: string; expiresAt: string; lastSeenAt: string | null };

/** SQLite grava CURRENT_TIMESTAMP como "2026-11-12 14:00:00" (UTC, sem o "Z"). */
export function parseStamp(value: string | null | undefined) {
  if (!value) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

export function newSessionExpiry(now: number) {
  return new Date(now + SESSION_DAYS * DAY).toISOString();
}

/**
 * Decide o que fazer com uma sessão agora: se ainda vale e se é hora de renovar.
 * `expiresAt` novo = 30 dias a partir de agora, limitado a 90 dias desde a criação.
 */
export function checkSession(session: SessionTimes, now: number): { valid: false } | { valid: true; renew: false } | { valid: true; renew: true; expiresAt: string } {
  const created = parseStamp(session.createdAt);
  const expires = parseStamp(session.expiresAt);
  const lastSeen = parseStamp(session.lastSeenAt ?? session.createdAt);
  if (!(expires > now)) return { valid: false };
  if (Number.isFinite(lastSeen) && now - lastSeen > IDLE_DAYS * DAY) return { valid: false };
  if (Number.isFinite(created) && now - created > MAX_DAYS * DAY) return { valid: false };
  if (Number.isFinite(lastSeen) && now - lastSeen < TOUCH_EVERY_MS) return { valid: true, renew: false };
  const cap = Number.isFinite(created) ? created + MAX_DAYS * DAY : Infinity;
  return { valid: true, renew: true, expiresAt: new Date(Math.min(now + SESSION_DAYS * DAY, cap)).toISOString() };
}

/** Nome curto do aparelho a partir do navegador: "Chrome no Windows", "Safari no iPhone"... */
export function deviceLabel(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const system = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  if (browser && system) return `${browser} no ${system}`;
  return browser || system || "Navegador desconhecido";
}
