import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { notifications, pushSubscriptions } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { notificationText, type NotificationKind } from "../../notifications";
import { deviceLabel } from "../../session-policy";
import { isPushEndpoint, sendWake, vapidKeys, PUSH_MAX_AGE_MS } from "../../web-push";
import { loadBrand } from "../../brand-store";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const MAX_DEVICES = 10;

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    const params = new URL(request.url).searchParams;

    // O aparelho acordou com um aviso: busca o texto do mais recente (só quem está logado).
    if (params.get("latest")) {
      const APP_NAME = (await loadBrand(db)).name;
      if (!member?.active) return json({ title: APP_NAME, body: "Você tem avisos novos. Abra o Portal para ver.", url: "/painel" });
      const [latest] = await db.select().from(notifications).where(and(eq(notifications.memberId, member.id), isNull(notifications.readAt))).orderBy(desc(notifications.id)).limit(1);
      if (!latest || Date.now() - Date.parse(latest.createdAt) > PUSH_MAX_AGE_MS * 3) return json({ title: APP_NAME, body: "Avisos no celular ligados. ✓", url: "/painel", tag: "portal-test" });
      return json({ title: APP_NAME, body: notificationText(latest.kind as NotificationKind, latest.actorName, latest.body).slice(0, 180), url: "/painel", tag: `portal-${latest.id}` });
    }

    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const devices = await db.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, device: pushSubscriptions.device, createdAt: pushSubscriptions.createdAt, lastOkAt: pushSubscriptions.lastOkAt }).from(pushSubscriptions).where(eq(pushSubscriptions.memberId, member.id));
    return json({ publicKey: (await vapidKeys(db)).publicKey, devices: devices.map((device) => ({ ...device, endpoint: undefined, endpointEnd: device.endpoint.slice(-16) })) });
  } catch (error) {
    console.error("push status failed", error);
    return json({ error: "Os avisos no celular não estão disponíveis agora." }, 500);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const endpoint = body.endpoint;
    const now = new Date().toISOString();

    if (action === "subscribe") {
      if (!isPushEndpoint(endpoint)) return json({ error: "Este navegador usa um serviço de avisos que o Portal não reconhece." }, 400);
      const mine = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.memberId, member.id));
      if (mine.length >= MAX_DEVICES) return json({ error: `Você já tem ${MAX_DEVICES} aparelhos recebendo avisos. Desligue algum antes.` }, 400);
      const device = deviceLabel(request.headers.get("user-agent"));
      // O mesmo aparelho pode trocar de pessoa (login de outro usuário): fica com quem ligou por último.
      await db.insert(pushSubscriptions).values({ memberId: member.id, endpoint, device, createdAt: now }).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { memberId: member.id, device, failCount: 0 } });
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      if (typeof endpoint === "string") await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, member.id)));
      else if (Number(body.deviceId)) await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, Number(body.deviceId)), eq(pushSubscriptions.memberId, member.id)));
      return json({ ok: true });
    }

    // Teste: acorda os aparelhos da própria pessoa agora.
    if (action === "test") {
      const devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.memberId, member.id));
      if (!devices.length) return json({ error: "Nenhum aparelho seu está recebendo avisos ainda." }, 400);
      const keys = await vapidKeys(db);
      const results = await Promise.all(devices.map((device) => sendWake(device.endpoint, keys, new URL(request.url).origin)));
      return json({ sent: results.filter((status) => status >= 200 && status < 300).length, total: devices.length });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("push request failed", error);
    return json({ error: "Não foi possível concluir agora." }, 500);
  }
}
