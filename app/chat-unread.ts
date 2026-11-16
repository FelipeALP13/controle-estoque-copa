// Mensagens não lidas nas conversas (canais abertos e as conversas diretas da pessoa), para o contador do menu.
// A leitura é marcada por assunto.
import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { chatChannels, chatMessages, chatReminders, chatTopicReads, notifications } from "../db/schema";
import { snippet } from "./notifications";
import { dmMembers } from "./social-tools";

type Db = ReturnType<typeof getDb>;

export async function chatUnread(db: Db, memberId: number) {
  const channels = await db.select({ id: chatChannels.id, kind: chatChannels.kind, dmKey: chatChannels.dmKey }).from(chatChannels).where(eq(chatChannels.archived, false));
  const visible = channels.filter((channel) => channel.kind === "channel" || dmMembers(channel.dmKey).includes(memberId)).map((channel) => channel.id);
  if (!visible.length) return { total: 0, direct: 0 };
  const rows = await db.select({ channelId: chatMessages.channelId, count: sql<number>`count(*)` })
    .from(chatMessages)
    .leftJoin(chatTopicReads, and(eq(chatTopicReads.topicId, chatMessages.topicId), eq(chatTopicReads.memberId, memberId)))
    .where(and(inArray(chatMessages.channelId, visible), eq(chatMessages.deleted, false), or(sql`${chatMessages.memberId} is null`, ne(chatMessages.memberId, memberId)), gt(chatMessages.id, sql`coalesce(${chatTopicReads.lastReadId}, 0)`)))
    .groupBy(chatMessages.channelId);
  const directIds = new Set(channels.filter((channel) => channel.kind === "dm").map((channel) => channel.id));
  return {
    total: rows.reduce((sum, row) => sum + Number(row.count), 0),
    direct: rows.filter((row) => directIds.has(row.channelId)).reduce((sum, row) => sum + Number(row.count), 0),
  };
}

/** Lembretes de mensagem que venceram: viram aviso no sino (uma vez). Devolve quantos avisou. */
export async function fireChatReminders(db: Db, memberId: number, now: string) {
  const due = await db.select({ id: chatReminders.id, messageId: chatReminders.messageId }).from(chatReminders)
    .where(and(eq(chatReminders.memberId, memberId), isNull(chatReminders.firedAt), lte(chatReminders.remindAt, now))).limit(20);
  if (!due.length) return 0;
  // Marca antes de avisar: duas abas abertas não geram aviso repetido.
  const claimed = await db.update(chatReminders).set({ firedAt: now })
    .where(and(inArray(chatReminders.id, due.map((row) => row.id)), isNull(chatReminders.firedAt))).returning({ messageId: chatReminders.messageId });
  if (!claimed.length) return 0;
  const messages = await db.select({ id: chatMessages.id, authorName: chatMessages.authorName, body: chatMessages.body, deleted: chatMessages.deleted, kind: chatChannels.kind, name: chatChannels.name })
    .from(chatMessages).innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(inArray(chatMessages.id, claimed.map((row) => row.messageId)));
  const rows = messages.filter((message) => !message.deleted).map((message) => ({
    memberId, kind: "chat_reminder" as const, actorName: message.authorName,
    body: `${message.kind === "dm" ? "na conversa direta" : `em #${message.name}`}: ${snippet(message.body || "Imagem", 100)}`.slice(0, 140),
    createdAt: now,
  }));
  if (rows.length) await db.insert(notifications).values(rows);
  return rows.length;
}
