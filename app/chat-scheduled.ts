// Mensagens agendadas do chat: saem na hora marcada, em nome de quem escreveu.
// Rodam junto com as rotinas do Portal (enquanto alguém está com o Portal aberto) e a cada leitura do chat.
import { and, eq, isNull, lte } from "drizzle-orm";
import type { getDb } from "../db";
import { chatChannels, chatMessages, chatScheduled, chatTopicReads, chatTopics, members, notifications } from "../db/schema";
import { findMentions, snippet } from "./notifications";
import { dmMembers } from "./social-tools";

type Db = ReturnType<typeof getDb>;

export const MAX_SCHEDULE_DAYS = 60;
/** Por pessoa, para não virar fila infinita. */
export const MAX_SCHEDULED_PER_MEMBER = 30;

/** Hora válida para agendar: pelo menos 1 minuto à frente e até 60 dias. */
export function scheduleError(at: unknown, now: Date) {
  const time = typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return "Escolha quando enviar.";
  if (time < now.getTime() + 60000) return "Escolha um horário pelo menos 1 minuto à frente.";
  if (time > now.getTime() + MAX_SCHEDULE_DAYS * 86400000) return `Dá para agendar até ${MAX_SCHEDULE_DAYS} dias à frente.`;
  return null;
}

/** Envia as mensagens que já passaram da hora (no máximo 20 por rodada). Cada uma sai uma vez só. */
export async function deliverScheduled(db: Db, now = new Date()) {
  const stamp = now.toISOString();
  const due = await db.select().from(chatScheduled).where(and(isNull(chatScheduled.sentAt), lte(chatScheduled.sendAt, stamp))).limit(20);
  let sent = 0;
  for (const item of due) {
    // Reserva (se outra rodada já pegou, pula).
    const claimed = await db.update(chatScheduled).set({ sentAt: stamp }).where(and(eq(chatScheduled.id, item.id), isNull(chatScheduled.sentAt))).returning({ id: chatScheduled.id });
    if (!claimed.length) continue;
    try {
      const [[author], [channel]] = await Promise.all([
        db.select({ id: members.id, name: members.name, active: members.active }).from(members).where(eq(members.id, item.memberId)).limit(1),
        db.select().from(chatChannels).where(eq(chatChannels.id, item.channelId)).limit(1),
      ]);
      const allowed = channel && author?.active && !channel.archived && (channel.kind === "channel" || dmMembers(channel.dmKey).includes(author.id));
      if (!allowed) { await db.update(chatScheduled).set({ error: "A conversa não está mais disponível." }).where(eq(chatScheduled.id, item.id)); continue; }
      let topicId = item.topicId;
      if (!topicId) {
        const [topic] = await db.select({ id: chatTopics.id }).from(chatTopics).where(eq(chatTopics.channelId, channel.id)).orderBy(chatTopics.id).limit(1);
        topicId = topic?.id ?? (await db.insert(chatTopics).values({ channelId: channel.id, title: "Conversa", createdByName: "Portal", createdAt: stamp }).returning({ id: chatTopics.id }))[0].id;
      }
      const [message] = await db.insert(chatMessages).values({ channelId: channel.id, topicId, memberId: author.id, authorName: author.name, body: item.body, attachments: "[]", createdAt: stamp }).returning({ id: chatMessages.id });
      await db.batch([
        db.update(chatChannels).set({ lastMessageAt: stamp }).where(eq(chatChannels.id, channel.id)),
        db.update(chatTopics).set({ lastMessageAt: stamp }).where(eq(chatTopics.id, topicId)),
        db.insert(chatTopicReads).values({ topicId, memberId: author.id, lastReadId: message.id }).onConflictDoUpdate({ target: [chatTopicReads.topicId, chatTopicReads.memberId], set: { lastReadId: message.id } }),
        db.update(chatScheduled).set({ messageId: message.id, topicId }).where(eq(chatScheduled.id, item.id)),
      ]);
      sent += 1;
      const people = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true));
      const audience = channel.kind === "dm" ? dmMembers(channel.dmKey) : people.map((person) => person.id);
      const mentioned = findMentions(item.body, people).filter((id) => id !== author.id && audience.includes(id));
      if (mentioned.length) {
        const where = channel.kind === "dm" ? "na conversa direta" : `em #${channel.name}`;
        await db.insert(notifications).values(mentioned.map((id) => ({ memberId: id, kind: "chat_mention" as const, actorName: author.name, body: `${where}: ${snippet(item.body, 100)}`.slice(0, 140), createdAt: stamp }))).catch((error) => console.error("scheduled mention failed", error));
      }
    } catch (error) {
      console.error("scheduled message failed", error);
      await db.update(chatScheduled).set({ error: "Não foi possível enviar." }).where(eq(chatScheduled.id, item.id)).catch(() => undefined);
    }
  }
  return { sent };
}
