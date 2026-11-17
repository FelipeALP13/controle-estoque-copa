// Avisos da Copa: estoque baixo (sino e canal do chat) e pedidos novos para quem cuida das compras.
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings, chatChannels, chatMessages, chatTopics, members, notifications } from "../db/schema";
import { COPA_ALERTS_KEY, lowStockText, parseCopaAlerts, STOCK_TOPIC_TITLE, type CopaAlerts } from "./copa-tools";

type Db = ReturnType<typeof getDb>;

export async function loadCopaAlerts(db: Db): Promise<CopaAlerts> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, COPA_ALERTS_KEY)).limit(1);
    return parseCopaAlerts(row?.value ?? "{}");
  } catch {
    return { memberIds: [], channelId: null };
  }
}

export async function saveCopaAlerts(db: Db, alerts: CopaAlerts) {
  const value = JSON.stringify(alerts);
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: COPA_ALERTS_KEY, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}

/** Quem cuida das compras: as pessoas escolhidas (ativas) ou, sem escolha, os administradores. */
export async function buyerIds(db: Db, alerts: CopaAlerts) {
  if (alerts.memberIds.length) {
    const rows = await db.select({ id: members.id }).from(members).where(and(inArray(members.id, alerts.memberIds), eq(members.active, true)));
    if (rows.length) return rows.map((row) => row.id);
  }
  const admins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)));
  return admins.map((row) => row.id);
}

/** Mensagem automática no canal escolhido, num assunto próprio ("Estoque da Copa"). */
async function postToChannel(db: Db, channelId: number, text: string, now: string) {
  const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
  if (!channel || channel.kind !== "channel" || channel.archived) return false;
  let [topic] = await db.select().from(chatTopics).where(and(eq(chatTopics.channelId, channel.id), eq(chatTopics.title, STOCK_TOPIC_TITLE))).limit(1);
  if (!topic) [topic] = await db.insert(chatTopics).values({ channelId: channel.id, title: STOCK_TOPIC_TITLE, createdByName: "Copa", createdAt: now }).returning();
  await db.insert(chatMessages).values({ channelId: channel.id, topicId: topic.id, memberId: null, authorName: "Copa", body: text, createdAt: now });
  await db.batch([
    db.update(chatChannels).set({ lastMessageAt: now }).where(eq(chatChannels.id, channel.id)),
    db.update(chatTopics).set({ lastMessageAt: now, resolved: false }).where(eq(chatTopics.id, topic.id)),
  ]);
  return true;
}

/** Avisa no sino quem cuida das compras (menos quem fez o lançamento) e publica no canal, se houver. */
export async function alertLowStock(db: Db, entries: readonly { item: { name: string; unit: string; minimumQty: number }; available: number }[], actor: { id: number; name: string }) {
  if (!entries.length) return;
  try {
    const now = new Date().toISOString();
    const alerts = await loadCopaAlerts(db);
    const recipients = (await buyerIds(db, alerts)).filter((id) => id !== actor.id);
    const texts = entries.map((entry) => lowStockText(entry.item, entry.available));
    const rows = recipients.flatMap((memberId) => texts.map((text) => ({ memberId, kind: "stock_low" as const, actorName: actor.name, body: text.slice(0, 140), createdAt: now })));
    for (let index = 0; index < rows.length; index += 20) await db.insert(notifications).values(rows.slice(index, index + 20));
    if (alerts.channelId) {
      const body = texts.length === 1 ? `**Estoque baixo:** ${texts[0]} Registrado por ${actor.name}.` : `**Estoque baixo** (registrado por ${actor.name}):\n${texts.map((text) => `- ${text}`).join("\n")}`;
      await postToChannel(db, alerts.channelId, body, now);
    }
  } catch (error) {
    console.error("low stock alert failed", error);
  }
}

/** Aviso no sino para quem cuida das compras (pedido novo) ou para pessoas específicas (decisão). */
export async function notifyCopa(db: Db, memberIds: readonly number[], actorName: string, body: string) {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return;
  try {
    const now = new Date().toISOString();
    for (let index = 0; index < ids.length; index += 20) await db.insert(notifications).values(ids.slice(index, index + 20).map((memberId) => ({ memberId, kind: "copa_request" as const, actorName, body: body.slice(0, 140), createdAt: now })));
  } catch (error) {
    console.error("copa notification failed", error);
  }
}
