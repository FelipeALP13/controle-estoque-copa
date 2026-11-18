// Avisos no celular/computador mesmo com o Portal fechado (Web Push com chaves VAPID).
// O aviso vai SEM conteúdo: o aparelho acorda e busca o texto no Portal (/api/push?latest=1), já logado.
// Assim nenhum dado da equipe passa pelo serviço de push do Google/Apple/Microsoft.
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { getDb } from "../db";
import { appSettings, notifications, pushSubscriptions } from "../db/schema";
import { openSecret, sealSecret } from "./secret-key";

type Db = ReturnType<typeof getDb>;
const SETTING_KEY = "vapid_keys";
/** Avisos mais antigos que isto não vão para o celular (evita uma enxurrada depois de uma pausa). */
export const PUSH_MAX_AGE_MS = 10 * 60000;

export const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Só endereços dos serviços de push conhecidos (evita usar o Portal para chamar qualquer endereço). */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    return host === "fcm.googleapis.com" || host.endsWith(".push.apple.com") || host === "updates.push.services.mozilla.com" || host.endsWith(".notify.windows.com") || host === "push.services.mozilla.com";
  } catch {
    return false;
  }
}

type Keys = { publicKey: string; privateJwk: JsonWebKey };

/** Chaves VAPID do Portal: criadas na primeira vez e guardadas criptografadas no banco. */
export async function vapidKeys(db: Db): Promise<Keys> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  if (row?.value) return JSON.parse(await openSecret(row.value)) as Keys;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
  const keys: Keys = { publicKey: base64url(raw), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey };
  await db.insert(appSettings).values({ key: SETTING_KEY, value: await sealSecret(JSON.stringify(keys)), updatedAt: new Date().toISOString() }).onConflictDoNothing();
  // Se dois pedidos criaram ao mesmo tempo, vale a que ficou gravada.
  const [saved] = await db.select().from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  return JSON.parse(await openSecret(saved.value)) as Keys;
}

/** Cabeçalho "Authorization: vapid t=..., k=..." para o serviço de push do endereço. */
export async function vapidHeader(endpoint: string, keys: Keys, subject: string, nowMs = Date.now()) {
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64url(signature)}, k=${keys.publicKey}`;
}

/** Envia um "acorde" (sem conteúdo) para um aparelho. Devolve o status HTTP (0 = falha de rede). */
export async function sendWake(endpoint: string, keys: Keys, subject: string) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { Authorization: await vapidHeader(endpoint, keys, subject), TTL: "600", Urgency: "high", "Content-Length": "0" } });
    return response.status;
  } catch {
    return 0;
  }
}

/**
 * Manda para o celular os avisos novos do sino (dos últimos 10 minutos, ainda não enviados).
 * Cada aviso é marcado uma vez só; pessoas sem aparelho cadastrado só têm o aviso marcado.
 */
export async function flushPush(db: Db, origin: string, now = new Date()) {
  const devices = await db.select().from(pushSubscriptions).limit(500);
  if (!devices.length) return { sent: 0 };
  const since = new Date(now.getTime() - PUSH_MAX_AGE_MS).toISOString();
  const claimed = await db.update(notifications).set({ pushedAt: now.toISOString() })
    .where(and(isNull(notifications.pushedAt), gt(notifications.createdAt, since), inArray(notifications.memberId, [...new Set(devices.map((device) => device.memberId))])))
    .returning({ memberId: notifications.memberId });
  if (!claimed.length) return { sent: 0 };
  const keys = await vapidKeys(db);
  const people = new Set(claimed.map((row) => row.memberId));
  let sent = 0;
  for (const device of devices.filter((entry) => people.has(entry.memberId))) {
    const status = await sendWake(device.endpoint, keys, origin);
    if (status >= 200 && status < 300) { sent += 1; await db.update(pushSubscriptions).set({ lastOkAt: now.toISOString(), failCount: 0 }).where(eq(pushSubscriptions.id, device.id)); }
    // 404/410: o aparelho cancelou (desinstalou, limpou dados). Remove.
    else if (status === 404 || status === 410 || device.failCount >= 20) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
    else await db.update(pushSubscriptions).set({ failCount: device.failCount + 1 }).where(eq(pushSubscriptions.id, device.id));
  }
  return { sent };
}

