import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { absences, chatChannels, chatMessages, chatPresence, chatReactions, chatReminders, chatScheduled, chatTopicReads, chatTopics, members, notifications, polls, tasks, teamMembers, teams } from "../../../db/schema";
import { loadPolls } from "../../poll-store";
import { deliverScheduled, MAX_SCHEDULED_PER_MEMBER, scheduleError } from "../../chat-scheduled";
import { cleanPollOptions, MAX_POLL_QUESTION, pollClosesAt, pollError } from "../../wall-tools";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline } from "../../tasks";
import { findMentions, snippet } from "../../notifications";
import { channelSlug, dmKey, dmMembers, groupReactions, isReaction, isStatusKind, MAX_MESSAGE, ONLINE_MS, parseChatAttachments, personStatus, reminderError, statusUntil, TYPING_MS, untilText, type ChatAttachment } from "../../social-tools";
import { describeAbsence, isAbsenceKind } from "../../absences";
import { taskCode } from "../../tasks";

type Db = ReturnType<typeof getDb>;
type Channel = typeof chatChannels.$inferSelect;
type Topic = typeof chatTopics.$inferSelect;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("chat request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as conversas. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** Canais são de todos; a conversa direta, só das duas pessoas (nem administradores leem). */
const canSee = (channel: Channel, memberId: number) => channel.kind === "channel" || dmMembers(channel.dmKey).includes(memberId);

const PAGE = 60;
const MAX_PINS = 25;
/** Mesma mensagem repetida dentro deste tempo conta como clique duplo, não como mensagem nova. */
const DUPLICATE_WINDOW_MS = 8000;
/** Mensagens diretas seguidas, ainda não vistas, dentro deste tempo viram um aviso só no sino. */
const DM_NOTIFY_GROUP_MS = 10 * 60 * 1000;
/** Texto da busca para LIKE: sem curingas digitados pela pessoa. */
const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
const todayInSaoPaulo = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);

/** Texto sem as marcas de formatação (para prévias); spoiler não aparece. */
const plainText = (value: string) => value.replace(/\|\|[^|]*\|\|/g, "(spoiler)").replace(/```[\s\S]*?```/g, "(código)").replace(/[*_~`]/g, "").replace(/^>\s?/gm, "");

/** Marca a pessoa como vista agora (online nas conversas). */
async function touchPresence(db: Db, memberId: number, now = new Date().toISOString()) {
  await db.insert(chatPresence).values({ memberId, lastSeenAt: now }).onConflictDoUpdate({ target: chatPresence.memberId, set: { lastSeenAt: now } }).catch(() => undefined);
}

const parseAttachments = (value: string): ChatAttachment[] => { try { return parseChatAttachments(JSON.parse(value)); } catch { return []; } };
/** Anexo como a tela mostra: as fotos do Portal passam pela rota de mídia (precisa estar logado). */
const viewAttachment = (item: ChatAttachment) => item.kind === "upload"
  ? { url: `/api/media?key=${encodeURIComponent(item.key)}`, gif: item.key.endsWith(".gif"), width: 0, height: 0 }
  : { url: item.url, gif: true, width: item.width, height: item.height };
const previewText = (row: { body: string; attachments: string }) => {
  if (row.body) return snippet(plainText(row.body), 90);
  const files = parseAttachments(row.attachments);
  return files.some((file) => file.kind === "gif" || file.key.endsWith(".gif")) ? "GIF" : files.length ? "Imagem" : "";
};

async function messagesOf(db: Db, topicId: number, meId: number, before: number | null, isAdmin = false) {
  const rows = await db.select().from(chatMessages).where(before ? and(eq(chatMessages.topicId, topicId), lt(chatMessages.id, before)) : eq(chatMessages.topicId, topicId)).orderBy(desc(chatMessages.id)).limit(PAGE);
  rows.reverse();
  const ids = rows.map((row) => row.id);
  const replyIds = [...new Set(rows.map((row) => row.replyToId).filter((id): id is number => Boolean(id)))];
  const taskIds = [...new Set(rows.map((row) => row.taskId).filter((id): id is number => Boolean(id)))];
  const pollIds = [...new Set(rows.map((row) => row.pollId).filter((id): id is number => Boolean(id)))];
  const [reactions, replies, people, linked, reminders, pollViews] = await Promise.all([
    ids.length ? db.select().from(chatReactions).where(inArray(chatReactions.messageId, ids)) : Promise.resolve([]),
    replyIds.length ? db.select({ id: chatMessages.id, authorName: chatMessages.authorName, body: chatMessages.body, attachments: chatMessages.attachments, deleted: chatMessages.deleted }).from(chatMessages).where(inArray(chatMessages.id, replyIds)) : Promise.resolve([]),
    db.select({ id: members.id, name: members.name }).from(members),
    taskIds.length ? db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(inArray(tasks.id, taskIds)) : Promise.resolve([]),
    ids.length ? db.select({ messageId: chatReminders.messageId, remindAt: chatReminders.remindAt }).from(chatReminders).where(and(eq(chatReminders.memberId, meId), inArray(chatReminders.messageId, ids), sql`${chatReminders.firedAt} is null`)) : Promise.resolve([]),
    loadPolls(db, pollIds, meId, isAdmin).catch(() => []),
  ]);
  const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Alguém";
  return {
    messages: rows.map((row) => {
      const reply = row.replyToId ? replies.find((entry) => entry.id === row.replyToId) : null;
      return {
        id: row.id, memberId: row.memberId, authorName: row.authorName, createdAt: row.createdAt, editedAt: row.editedAt, deleted: row.deleted,
        body: row.deleted ? "" : row.body,
        attachments: row.deleted ? [] : parseAttachments(row.attachments).map(viewAttachment),
        replyToId: row.replyToId,
        poll: !row.deleted && row.pollId ? pollViews.find((poll) => poll.id === row.pollId) ?? null : null,
        pinned: !row.deleted && Boolean(row.pinnedAt),
        task: (() => { const task = row.taskId ? linked.find((entry) => entry.id === row.taskId) : null; return task ? { id: task.id, code: taskCode(task.id), title: task.title, done: task.status === "done" || task.status === "canceled" } : null; })(),
        ...(() => { const at = reminders.find((entry) => entry.messageId === row.id)?.remindAt ?? null; return { reminderAt: at, reminderLabel: at ? untilText(at, new Date()) : null }; })(),
        reply: reply ? { authorName: reply.authorName, body: reply.deleted ? "Mensagem apagada" : previewText(reply) } : null,
        reactions: row.deleted ? [] : groupReactions(reactions.filter((reaction) => reaction.messageId === row.id), meId, nameOf),
      };
    }),
    hasMore: rows.length === PAGE,
  };
}

/** Cada conversa (canal ou direta) guarda as mensagens numa linha única de "assunto", criada na primeira vez. */
async function channelTopic(db: Db, channel: Channel, now: string) {
  const [existing] = await db.select().from(chatTopics).where(eq(chatTopics.channelId, channel.id)).orderBy(chatTopics.id).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(chatTopics).values({ channelId: channel.id, title: "Conversa", createdByName: "Portal", createdAt: now }).returning();
  return created;
}

/** Resumo dos assuntos (prévia, quantidade, não lidas e quem participou) para as listas. */
async function topicSummaries(db: Db, topics: Topic[], meId: number) {
  if (!topics.length) return [];
  const ids = topics.map((topic) => topic.id);
  const [counts, unread, lastIds, authors] = await Promise.all([
    db.select({ topicId: chatMessages.topicId, count: sql<number>`count(*)` }).from(chatMessages).where(and(inArray(chatMessages.topicId, ids), eq(chatMessages.deleted, false))).groupBy(chatMessages.topicId),
    db.select({ topicId: chatMessages.topicId, count: sql<number>`count(*)` }).from(chatMessages)
      .leftJoin(chatTopicReads, and(eq(chatTopicReads.topicId, chatMessages.topicId), eq(chatTopicReads.memberId, meId)))
      .where(and(inArray(chatMessages.topicId, ids), eq(chatMessages.deleted, false), or(sql`${chatMessages.memberId} is null`, ne(chatMessages.memberId, meId)), gt(chatMessages.id, sql`coalesce(${chatTopicReads.lastReadId}, 0)`)))
      .groupBy(chatMessages.topicId),
    db.select({ id: sql<number>`max(${chatMessages.id})` }).from(chatMessages).where(and(inArray(chatMessages.topicId, ids), eq(chatMessages.deleted, false))).groupBy(chatMessages.topicId),
    db.selectDistinct({ topicId: chatMessages.topicId, memberId: chatMessages.memberId }).from(chatMessages).where(and(inArray(chatMessages.topicId, ids), eq(chatMessages.deleted, false))),
  ]);
  const lastRows = lastIds.length ? await db.select({ topicId: chatMessages.topicId, memberId: chatMessages.memberId, authorName: chatMessages.authorName, body: chatMessages.body, attachments: chatMessages.attachments, createdAt: chatMessages.createdAt }).from(chatMessages).where(inArray(chatMessages.id, lastIds.map((row) => Number(row.id)))) : [];
  return topics.map((topic) => {
    const last = lastRows.find((row) => row.topicId === topic.id);
    return {
      id: topic.id, channelId: topic.channelId, title: topic.title, resolved: topic.resolved, createdById: topic.createdById, createdByName: topic.createdByName, createdAt: topic.createdAt,
      lastMessageAt: topic.lastMessageAt ?? topic.createdAt,
      count: Number(counts.find((row) => row.topicId === topic.id)?.count ?? 0),
      unread: Number(unread.find((row) => row.topicId === topic.id)?.count ?? 0),
      participants: authors.filter((row) => row.topicId === topic.id && row.memberId).map((row) => row.memberId!).slice(0, 5),
      preview: last ? { authorName: last.memberId === meId ? "Você" : last.authorName.split(/\s+/)[0], text: previewText(last), at: last.createdAt } : null,
    };
  });
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const params = new URL(request.url).searchParams;
    const now = new Date();
    const stamp = now.toISOString();

    // Um assunto: últimas mensagens (ou as anteriores a "before"), quem está digitando, e marca como lido.
    const topicId = Number(params.get("topic"));
    if (topicId) {
      const [topic] = await db.select().from(chatTopics).where(eq(chatTopics.id, topicId)).limit(1);
      const [channel] = topic ? await db.select().from(chatChannels).where(eq(chatChannels.id, topic.channelId)).limit(1) : [];
      if (!topic || !channel) return json({ error: "Conversa não encontrada." }, 404);
      if (!canSee(channel, member.id)) return json({ error: "Esta conversa é privada." }, 403);
      const before = Number(params.get("before")) || null;
      // Mensagens agendadas que já passaram da hora saem agora (de qualquer pessoa).
      if (!before) await deliverScheduled(db, now).catch((error) => console.error("scheduled delivery failed", error));
      const result = await messagesOf(db, topic.id, member.id, before, member.role === "admin");
      const lastId = result.messages[result.messages.length - 1]?.id ?? 0;
      const [read] = await db.select({ lastReadId: chatTopicReads.lastReadId }).from(chatTopicReads).where(and(eq(chatTopicReads.topicId, topic.id), eq(chatTopicReads.memberId, member.id))).limit(1);
      if (!before && lastId) {
        await db.insert(chatTopicReads).values({ topicId: topic.id, memberId: member.id, lastReadId: lastId })
          .onConflictDoUpdate({ target: [chatTopicReads.topicId, chatTopicReads.memberId], set: { lastReadId: sql`max(${chatTopicReads.lastReadId}, ${lastId})` } });
        // Abriu a conversa direta: o aviso do sino dessa pessoa já foi visto.
        if (channel.kind === "dm") {
          const peers = [...new Set(result.messages.filter((message) => message.memberId !== member.id).map((message) => message.authorName))];
          if (peers.length) await db.update(notifications).set({ readAt: stamp }).where(and(eq(notifications.memberId, member.id), eq(notifications.kind, "chat_message"), isNull(notifications.readAt), inArray(notifications.actorName, peers))).catch((error) => console.error("chat notification read failed", error));
        }
      }
      await touchPresence(db, member.id, stamp);
      const typingSince = new Date(now.getTime() - TYPING_MS).toISOString();
      const typing = await db.select({ name: members.name }).from(chatPresence).innerJoin(members, eq(chatPresence.memberId, members.id))
        .where(and(eq(chatPresence.typingTopicId, topic.id), gt(chatPresence.typingAt, typingSince), ne(chatPresence.memberId, member.id)));
      return json({
        ...result,
        channel: await (async () => {
          if (channel.kind !== "dm") return { id: channel.id, kind: channel.kind, name: channel.name, description: channel.topic, archived: channel.archived, peerId: null, canManage: member.role === "admin" || channel.createdById === member.id };
          const peerId = dmMembers(channel.dmKey).find((id) => id !== member.id) ?? member.id;
          const [peer] = await db.select({ name: members.name }).from(members).where(eq(members.id, peerId)).limit(1);
          return { id: channel.id, kind: channel.kind, name: peer?.name ?? "Pessoa", description: "", archived: channel.archived, peerId, canManage: false };
        })(),
        lastReadId: read?.lastReadId ?? 0,
        // Conversa direta: até onde a outra pessoa leu (mostra "Vista" embaixo das suas mensagens).
        peerReadId: channel.kind === "dm" ? await (async () => {
          const peerId = dmMembers(channel.dmKey).find((id) => id !== member.id);
          if (!peerId) return null;
          const [peerRead] = await db.select({ lastReadId: chatTopicReads.lastReadId }).from(chatTopicReads).where(and(eq(chatTopicReads.topicId, topic.id), eq(chatTopicReads.memberId, peerId))).limit(1);
          return peerRead?.lastReadId ?? 0;
        })() : null,
        typing: typing.map((row) => row.name),
        scheduled: (await db.select({ id: chatScheduled.id, body: chatScheduled.body, sendAt: chatScheduled.sendAt }).from(chatScheduled)
          .where(and(eq(chatScheduled.memberId, member.id), eq(chatScheduled.channelId, channel.id), sql`${chatScheduled.sentAt} is null`)).orderBy(chatScheduled.sendAt).catch(() => [])),
        pinned: (await db.select({ id: chatMessages.id, authorName: chatMessages.authorName, body: chatMessages.body, attachments: chatMessages.attachments, pinnedAt: chatMessages.pinnedAt, pinnedByName: chatMessages.pinnedByName })
          .from(chatMessages).where(and(eq(chatMessages.topicId, topic.id), isNotNull(chatMessages.pinnedAt), eq(chatMessages.deleted, false))).orderBy(desc(chatMessages.pinnedAt)).limit(MAX_PINS))
          .map((row) => ({ id: row.id, authorName: row.authorName, text: previewText(row), pinnedAt: row.pinnedAt, pinnedByName: row.pinnedByName })),
      });
    }

    // Busca nas mensagens das conversas que a pessoa enxerga (canais e as conversas diretas dela).
    const search = (params.get("search") ?? "").trim().slice(0, 80);
    if (search) {
      if (search.length < 2) return json({ results: [] });
      const channels = (await db.select().from(chatChannels)).filter((channel) => canSee(channel, member.id));
      if (!channels.length) return json({ results: [] });
      const rows = await db.select({ id: chatMessages.id, channelId: chatMessages.channelId, topicId: chatMessages.topicId, memberId: chatMessages.memberId, authorName: chatMessages.authorName, body: chatMessages.body, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(and(inArray(chatMessages.channelId, channels.map((channel) => channel.id)), eq(chatMessages.deleted, false), sql`${chatMessages.body} like ${likeTerm(search)} escape '\\'`))
        .orderBy(desc(chatMessages.id)).limit(30);
      const peerIds = [...new Set(channels.filter((channel) => channel.kind === "dm").map((channel) => dmMembers(channel.dmKey).find((id) => id !== member.id) ?? member.id))];
      const peers = peerIds.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, peerIds)) : [];
      return json({
        results: rows.filter((row) => row.topicId).map((row) => {
          const channel = channels.find((entry) => entry.id === row.channelId)!;
          const peerId = channel.kind === "dm" ? dmMembers(channel.dmKey).find((id) => id !== member.id) ?? member.id : null;
          return { id: row.id, topicId: row.topicId, channelId: row.channelId, kind: channel.kind, where: channel.kind === "dm" ? peers.find((peer) => peer.id === peerId)?.name ?? "Conversa" : `#${channel.name}`, memberId: row.memberId, authorName: row.authorName, text: snippet(plainText(row.body), 160), createdAt: row.createdAt };
        }),
      });
    }

    // Abrir uma conversa: devolve onde ficam as mensagens dela.
    const channelId = Number(params.get("channel"));
    if (channelId) {
      const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, channelId)).limit(1);
      if (!channel) return json({ error: "Conversa não encontrada." }, 404);
      if (!canSee(channel, member.id)) return json({ error: "Esta conversa é privada." }, 403);
      return json({ topicId: (await channelTopic(db, channel, stamp)).id });
    }

    const [channels, people, presence, memberships] = await Promise.all([
      db.select().from(chatChannels).where(or(eq(chatChannels.kind, "channel"), sql`${chatChannels.dmKey} like ${`${member.id}:%`} or ${chatChannels.dmKey} like ${`%:${member.id}`}`)),
      db.select({ id: members.id, name: members.name, jobTitle: members.jobTitle, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, active: members.active }).from(members),
      db.select({ memberId: chatPresence.memberId, lastSeenAt: chatPresence.lastSeenAt, statusKind: chatPresence.statusKind, statusUntil: chatPresence.statusUntil }).from(chatPresence),
      db.select({ memberId: teamMembers.memberId, color: teams.color, name: teams.name }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)),
    ]);
    const today = todayInSaoPaulo(now);
    const away = await db.select({ memberId: absences.memberId, kind: absences.kind, startDate: absences.startDate, endDate: absences.endDate }).from(absences)
      .where(and(sql`${absences.startDate} <= ${today}`, sql`${absences.endDate} >= ${today}`)).catch(() => []);
    const statusOf = (id: number) => {
      const absence = away.find((row) => row.memberId === id && isAbsenceKind(row.kind));
      const own = presence.find((row) => row.memberId === id);
      const status = personStatus(own ? { kind: own.statusKind, until: own.statusUntil } : null, absence ? describeAbsence(absence, today) : null, now);
      return status ? { ...status, untilLabel: status.until ? untilText(status.until, now) : null } : null;
    };
    await touchPresence(db, member.id, stamp);
    await deliverScheduled(db, now).catch((error) => console.error("scheduled delivery failed", error));
    const visible = channels.filter((channel) => canSee(channel, member.id));
    const visibleIds = visible.map((channel) => channel.id);
    const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Pessoa";
    const onlineSince = new Date(now.getTime() - ONLINE_MS).toISOString();
    const peopleOut = people.filter((person) => person.active).map((person) => {
      const team = memberships.find((row) => row.memberId === person.id);
      return { id: person.id, name: person.name, jobTitle: person.jobTitle, avatarIcon: person.avatarIcon, avatarKey: person.avatarKey, teamColor: team?.color ?? null, teamName: team?.name ?? null, online: presence.some((row) => row.memberId === person.id && row.lastSeenAt > onlineSince), status: statusOf(person.id) };
    });
    const channelName = (channel: Channel) => channel.kind === "dm" ? nameOf(dmMembers(channel.dmKey).find((id) => id !== member.id) ?? member.id) : channel.name;

    // Lista de conversas com não lidas e a última mensagem.
    const topics = visibleIds.length ? await db.select().from(chatTopics).where(inArray(chatTopics.channelId, visibleIds)) : [];
    const summaries = await topicSummaries(db, topics, member.id);
    return json({
      channels: visible.map((channel) => {
        const own = summaries.filter((topic) => topic.channelId === channel.id);
        const latest = own.filter((topic) => topic.preview).sort((a, b) => b.preview!.at.localeCompare(a.preview!.at))[0];
        return {
          id: channel.id, kind: channel.kind, name: channelName(channel), topic: channel.topic, teamId: channel.teamId,
          peerId: channel.kind === "dm" ? dmMembers(channel.dmKey).find((id) => id !== member.id) ?? null : null,
          archived: channel.archived, lastMessageAt: channel.lastMessageAt, createdByName: channel.createdByName,
          canManage: channel.kind === "channel" && (member.role === "admin" || channel.createdById === member.id),
          unread: own.reduce((sum, topic) => sum + topic.unread, 0),
          topicId: own.length ? Math.min(...own.map((topic) => topic.id)) : null,
          preview: latest ? latest.preview : null,
        };
      }),
      people: peopleOut,
      me: { id: member.id, isAdmin: member.role === "admin", canCreateTasks: member.role !== "viewer", status: statusOf(member.id) },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    const channelFor = async (id: unknown) => {
      const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, Number(id))).limit(1);
      return channel && canSee(channel, member.id) ? channel : null;
    };
    const topicFor = async (id: unknown) => {
      const [topic] = await db.select().from(chatTopics).where(eq(chatTopics.id, Number(id))).limit(1);
      const channel = topic ? await channelFor(topic.channelId) : null;
      return topic && channel ? { topic, channel } : null;
    };

    /** Grava a mensagem no assunto e avisa quem foi mencionado. */
    async function post(topic: Topic, channel: Channel, text: string, attachments: ChatAttachment[], replyToId: number | null, skipDuplicates = true) {
      let reply = replyToId;
      if (reply) {
        const [target] = await db.select({ topicId: chatMessages.topicId }).from(chatMessages).where(eq(chatMessages.id, reply)).limit(1);
        if (target?.topicId !== topic.id) reply = null;
      }
      // Envio repetido (dois cliques, Enter duas vezes, internet lenta): a mesma mensagem da mesma pessoa,
      // na mesma conversa, em poucos segundos, não é gravada de novo.
      const attachmentsJson = JSON.stringify(attachments);
      const [last] = await db.select({ id: chatMessages.id, body: chatMessages.body, attachments: chatMessages.attachments, replyToId: chatMessages.replyToId, createdAt: chatMessages.createdAt })
        .from(chatMessages).where(and(eq(chatMessages.topicId, topic.id), eq(chatMessages.memberId, member!.id))).orderBy(desc(chatMessages.id)).limit(1);
      if (skipDuplicates && last && last.body === text && last.attachments === attachmentsJson && (last.replyToId ?? null) === reply && Date.parse(now) - Date.parse(last.createdAt) < DUPLICATE_WINDOW_MS) return last.id;
      const [message] = await db.insert(chatMessages).values({ channelId: channel.id, topicId: topic.id, memberId: member!.id, authorName: member!.name, body: text, attachments: JSON.stringify(attachments), replyToId: reply, createdAt: now }).returning({ id: chatMessages.id });
      await db.batch([
        db.update(chatChannels).set({ lastMessageAt: now }).where(eq(chatChannels.id, channel.id)),
        db.update(chatTopics).set({ lastMessageAt: now }).where(eq(chatTopics.id, topic.id)),
        db.insert(chatTopicReads).values({ topicId: topic.id, memberId: member!.id, lastReadId: message.id }).onConflictDoUpdate({ target: [chatTopicReads.topicId, chatTopicReads.memberId], set: { lastReadId: message.id } }),
        db.insert(chatPresence).values({ memberId: member!.id, lastSeenAt: now, typingTopicId: null, typingAt: null }).onConflictDoUpdate({ target: chatPresence.memberId, set: { lastSeenAt: now, typingTopicId: null, typingAt: null } }),
      ]);
      const people = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true));
      const allowed = channel.kind === "dm" ? dmMembers(channel.dmKey) : people.map((person) => person.id);
      const mentioned = findMentions(text, people).filter((id) => id !== member!.id && allowed.includes(id));
      if (mentioned.length) {
        const where = channel.kind === "dm" ? "na conversa direta" : `em #${channel.name}`;
        await db.insert(notifications).values(mentioned.map((id) => ({ memberId: id, kind: "chat_mention" as const, actorName: member!.name, body: `${where}: ${snippet(text, 100)}`.slice(0, 140), createdAt: now }))).catch((error) => console.error("chat notification failed", error));
      }
      // Conversa direta: a outra pessoa recebe aviso no sino (com som, aviso na tela e no celular).
      // Várias mensagens seguidas da mesma pessoa viram um aviso só, com o texto da última.
      if (channel.kind === "dm") {
        const preview = (text ? snippet(text, 110) : attachments.length > 1 ? `📷 ${attachments.length} imagens` : "📷 Imagem").slice(0, 140);
        const since = new Date(Date.parse(now) - DM_NOTIFY_GROUP_MS).toISOString();
        for (const id of dmMembers(channel.dmKey).filter((person) => person !== member!.id && !mentioned.includes(person))) {
          try {
            const [open] = await db.select({ id: notifications.id }).from(notifications)
              .where(and(eq(notifications.memberId, id), eq(notifications.kind, "chat_message"), eq(notifications.actorName, member!.name), isNull(notifications.readAt), gt(notifications.createdAt, since))).limit(1);
            if (open) await db.update(notifications).set({ body: preview }).where(eq(notifications.id, open.id));
            else await db.insert(notifications).values({ memberId: id, kind: "chat_message", actorName: member!.name, body: preview, createdAt: now });
          } catch (error) {
            console.error("chat dm notification failed", error);
          }
        }
      }
      return message.id;
    }

    if (action === "send") {
      const found = await topicFor(body.topicId);
      if (!found) return json({ error: "Conversa não encontrada." }, 404);
      if (found.channel.archived) return json({ error: "Este canal foi arquivado." }, 400);
      const text = cleanMultiline(body.body, MAX_MESSAGE);
      const attachments = parseChatAttachments(body.attachments);
      if (!text && !attachments.length) return json({ error: "Escreva a mensagem ou envie uma imagem." }, 400);
      const id = await post(found.topic, found.channel, text, attachments, Number(body.replyToId) || null);
      return json({ id }, 201);
    }

    // Enquete na conversa: vira uma mensagem com os botões de voto.
    if (action === "createPoll") {
      const found = await topicFor(body.topicId);
      if (!found) return json({ error: "Conversa não encontrada." }, 404);
      if (found.channel.archived) return json({ error: "Este canal foi arquivado." }, 400);
      if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
      const question = String(body.question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_POLL_QUESTION);
      const options = cleanPollOptions(body.options);
      const pollProblem = pollError(question, options);
      if (pollProblem) return json({ error: pollProblem }, 400);
      const closesAt = pollClosesAt(body.duration, new Date(now));
      if (closesAt === undefined) return json({ error: "Escolha até quando a enquete fica aberta." }, 400);
      const [poll] = await db.insert(polls).values({ question, options: JSON.stringify(options), multiple: body.multiple === true, anonymous: body.anonymous === true, channelId: found.channel.id, createdById: member.id, createdByName: member.name, closesAt, createdAt: now }).returning({ id: polls.id });
      const id = await post(found.topic, found.channel, `📊 Enquete: ${question}`, [], null, false);
      await db.update(chatMessages).set({ pollId: poll.id }).where(eq(chatMessages.id, id));
      return json({ id }, 201);
    }

    // Mensagem agendada: escreve agora, sai na hora marcada.
    if (action === "schedule") {
      const found = await topicFor(body.topicId);
      if (!found) return json({ error: "Conversa não encontrada." }, 404);
      if (found.channel.archived) return json({ error: "Este canal foi arquivado." }, 400);
      const text = cleanMultiline(body.body, MAX_MESSAGE);
      if (!text) return json({ error: "Escreva a mensagem antes de agendar." }, 400);
      const problem = scheduleError(body.at, new Date(now));
      if (problem) return json({ error: problem }, 400);
      const mine = await db.select({ id: chatScheduled.id }).from(chatScheduled).where(and(eq(chatScheduled.memberId, member.id), sql`${chatScheduled.sentAt} is null`));
      if (mine.length >= MAX_SCHEDULED_PER_MEMBER) return json({ error: `Você já tem ${MAX_SCHEDULED_PER_MEMBER} mensagens agendadas. Envie ou cancele alguma antes.` }, 400);
      const [created] = await db.insert(chatScheduled).values({ memberId: member.id, channelId: found.channel.id, topicId: found.topic.id, body: text, sendAt: new Date(String(body.at)).toISOString(), createdAt: now }).returning({ id: chatScheduled.id });
      return json({ id: created.id }, 201);
    }

    if (action === "cancelScheduled") {
      const removed = await db.delete(chatScheduled).where(and(eq(chatScheduled.id, Number(body.scheduledId)), eq(chatScheduled.memberId, member.id), sql`${chatScheduled.sentAt} is null`)).returning({ id: chatScheduled.id });
      return removed.length ? json({ ok: true }) : json({ error: "Esta mensagem já foi enviada ou não existe mais." }, 404);
    }

    // "Fulano está digitando…": vale por alguns segundos (a tela manda de novo enquanto a pessoa digita).
    if (action === "typing") {
      const found = await topicFor(body.topicId);
      if (!found) return json({ error: "Conversa não encontrada." }, 404);
      await db.insert(chatPresence).values({ memberId: member.id, lastSeenAt: now, typingChannelId: found.channel.id, typingTopicId: found.topic.id, typingAt: now })
        .onConflictDoUpdate({ target: chatPresence.memberId, set: { lastSeenAt: now, typingChannelId: found.channel.id, typingTopicId: found.topic.id, typingAt: now } });
      return json({ ok: true });
    }

    // Fixar no topo da conversa (qualquer pessoa da conversa; até 25 por conversa).
    if (action === "pin") {
      const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(body.messageId))).limit(1);
      const channel = message ? await channelFor(message.channelId) : null;
      if (!message || !channel || message.deleted) return json({ error: "Mensagem não encontrada." }, 404);
      if (channel.archived) return json({ error: "Este canal foi arquivado." }, 400);
      const pin = body.pinned !== false;
      if (pin && !message.pinnedAt) {
        const [count] = await db.select({ count: sql<number>`count(*)` }).from(chatMessages).where(and(eq(chatMessages.topicId, message.topicId ?? 0), isNotNull(chatMessages.pinnedAt), eq(chatMessages.deleted, false)));
        if (Number(count?.count ?? 0) >= MAX_PINS) return json({ error: `Dá para fixar até ${MAX_PINS} mensagens por conversa. Desafixe alguma antes.` }, 400);
      }
      await db.update(chatMessages).set(pin ? { pinnedAt: message.pinnedAt ?? now, pinnedByName: message.pinnedByName ?? member.name } : { pinnedAt: null, pinnedByName: null }).where(eq(chatMessages.id, message.id));
      return json({ ok: true });
    }

    if (action === "edit" || action === "delete" || action === "react") {
      const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(body.messageId))).limit(1);
      const channel = message ? await channelFor(message.channelId) : null;
      if (!message || !channel || message.deleted) return json({ error: "Mensagem não encontrada." }, 404);
      if (action === "react") {
        if (!isReaction(body.emoji)) return json({ error: "Reação inválida." }, 400);
        const removed = await db.delete(chatReactions).where(and(eq(chatReactions.messageId, message.id), eq(chatReactions.memberId, member.id), eq(chatReactions.emoji, body.emoji))).returning({ emoji: chatReactions.emoji });
        if (!removed.length) await db.insert(chatReactions).values({ messageId: message.id, memberId: member.id, emoji: body.emoji }).onConflictDoNothing();
        return json({ ok: true });
      }
      if (action === "edit") {
        if (message.memberId !== member.id) return json({ error: "Só quem escreveu pode editar." }, 403);
        const text = cleanMultiline(body.body, MAX_MESSAGE);
        if (!text && parseAttachments(message.attachments).length === 0) return json({ error: "Escreva a mensagem." }, 400);
        await db.update(chatMessages).set({ body: text, editedAt: now }).where(eq(chatMessages.id, message.id));
        return json({ ok: true });
      }
      // Apagar: quem escreveu; num canal, também administradores (moderação). A conversa direta continua só dos dois.
      if (message.memberId !== member.id && !(isAdmin && channel.kind === "channel")) return json({ error: "Só quem escreveu pode apagar." }, 403);
      await db.update(chatMessages).set({ deleted: true, body: "", attachments: "[]", editedAt: now }).where(eq(chatMessages.id, message.id));
      await db.delete(chatReactions).where(eq(chatReactions.messageId, message.id));
      return json({ ok: true });
    }

    // Status que aparece na foto ("Em reunião", "Almoço"...). kind vazio tira o status.
    if (action === "setStatus") {
      const kind = body.kind === null || body.kind === "" ? null : body.kind;
      if (kind !== null && !isStatusKind(kind)) return json({ error: "Status inválido." }, 400);
      const until = kind ? statusUntil(body.duration, new Date(now)) : null;
      if (until === undefined) return json({ error: "Escolha por quanto tempo." }, 400);
      await db.insert(chatPresence).values({ memberId: member.id, lastSeenAt: now, statusKind: kind, statusUntil: until })
        .onConflictDoUpdate({ target: chatPresence.memberId, set: { lastSeenAt: now, statusKind: kind, statusUntil: until } });
      return json({ ok: true });
    }

    // "Me lembre": um lembrete por mensagem e pessoa (marcar de novo troca o horário).
    if (action === "remind" || action === "cancelReminder" || action === "linkTask") {
      const [message] = await db.select().from(chatMessages).where(eq(chatMessages.id, Number(body.messageId))).limit(1);
      const channel = message ? await channelFor(message.channelId) : null;
      if (!message || !channel || message.deleted) return json({ error: "Mensagem não encontrada." }, 404);
      if (action === "cancelReminder") {
        await db.delete(chatReminders).where(and(eq(chatReminders.memberId, member.id), eq(chatReminders.messageId, message.id)));
        return json({ ok: true });
      }
      if (action === "remind") {
        const problem = reminderError(body.at, new Date(now));
        if (problem) return json({ error: problem }, 400);
        const at = new Date(String(body.at)).toISOString();
        await db.insert(chatReminders).values({ memberId: member.id, messageId: message.id, remindAt: at, createdAt: now })
          .onConflictDoUpdate({ target: [chatReminders.memberId, chatReminders.messageId], set: { remindAt: at, firedAt: null, createdAt: now } });
        return json({ ok: true, remindAt: at });
      }
      // Virar demanda: a demanda é criada pela rota de demandas; aqui só fica o vínculo para todos verem.
      if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar as demandas." }, 403);
      const [task] = await db.select({ id: tasks.id, createdById: tasks.createdById }).from(tasks).where(eq(tasks.id, Number(body.taskId))).limit(1);
      if (!task) return json({ error: "Demanda não encontrada." }, 404);
      if (task.createdById !== member.id) return json({ error: "Só quem criou a demanda pode ligá-la à mensagem." }, 403);
      await db.update(chatMessages).set({ taskId: task.id }).where(eq(chatMessages.id, message.id));
      return json({ ok: true });
    }

    if (action === "createChannel") {
      const name = channelSlug(body.name);
      if (name.length < 2) return json({ error: "Dê um nome ao canal (letras, números e hífen)." }, 400);
      const [exists] = await db.select({ id: chatChannels.id }).from(chatChannels).where(and(eq(chatChannels.kind, "channel"), eq(chatChannels.name, name))).limit(1);
      if (exists) return json({ error: `Já existe o canal #${name}.` }, 409);
      const [channel] = await db.insert(chatChannels).values({ kind: "channel", name, topic: cleanMultiline(body.topic, 200).replace(/\n/g, " "), createdById: member.id, createdByName: member.name, createdAt: now }).returning({ id: chatChannels.id });
      return json({ id: channel.id, name }, 201);
    }

    if (action === "updateChannel" || action === "archiveChannel" || action === "restoreChannel") {
      const channel = await channelFor(body.channelId);
      if (!channel || channel.kind !== "channel") return json({ error: "Canal não encontrado." }, 404);
      if (!isAdmin && channel.createdById !== member.id) return json({ error: "Só quem criou o canal ou um administrador pode mudar." }, 403);
      if (action === "updateChannel") {
        const name = channelSlug(body.name);
        if (name.length < 2) return json({ error: "Dê um nome ao canal (letras, números e hífen)." }, 400);
        const [exists] = await db.select({ id: chatChannels.id }).from(chatChannels).where(and(eq(chatChannels.kind, "channel"), eq(chatChannels.name, name), ne(chatChannels.id, channel.id))).limit(1);
        if (exists) return json({ error: `Já existe o canal #${name}.` }, 409);
        await db.update(chatChannels).set({ name, topic: cleanMultiline(body.topic, 200).replace(/\n/g, " ") }).where(eq(chatChannels.id, channel.id));
      } else {
        await db.update(chatChannels).set({ archived: action === "archiveChannel" }).where(eq(chatChannels.id, channel.id));
      }
      return json({ ok: true });
    }

    if (action === "openDm") {
      const otherId = Number(body.memberId);
      const [other] = await db.select({ id: members.id, active: members.active }).from(members).where(eq(members.id, otherId)).limit(1);
      if (!other?.active || other.id === member.id) return json({ error: "Escolha outra pessoa." }, 400);
      const key = dmKey(member.id, other.id);
      await db.insert(chatChannels).values({ kind: "dm", name: key, dmKey: key, createdById: member.id, createdByName: member.name, createdAt: now }).onConflictDoNothing();
      const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.dmKey, key)).limit(1);
      const topic = await channelTopic(db, channel, now);
      return json({ id: channel.id, topicId: topic.id });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
