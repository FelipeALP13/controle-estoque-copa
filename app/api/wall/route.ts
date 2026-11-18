import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatChannels, chatMessages, kudos, members, notifications, polls } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline } from "../../tasks";
import { snippet } from "../../notifications";
import { castVote, loadPolls } from "../../poll-store";
import { dmMembers } from "../../social-tools";
import { cleanPollOptions, isKudosValue, kudosError, kudosRanking, kudosValue, MAX_KUDOS_MESSAGE, MAX_KUDOS_PER_DAY, MAX_POLL_QUESTION, pollClosesAt, pollError } from "../../wall-tools";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("wall request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem o mural da equipe. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const DAY = 86400000;

async function kudosView(db: Db, rows: (typeof kudos.$inferSelect)[], meId: number, isAdmin: boolean) {
  const people = await db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members);
  const person = (id: number | null) => people.find((entry) => entry.id === id) ?? null;
  return rows.map((row) => ({
    id: row.id, fromId: row.fromId, fromName: row.fromName, toId: row.toId, toName: person(row.toId)?.name ?? "Pessoa removida",
    to: person(row.toId), from: person(row.fromId),
    value: kudosValue(row.value), message: row.message, createdAt: row.createdAt,
    canDelete: isAdmin || row.fromId === meId,
  }));
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const params = new URL(request.url).searchParams;

    // Quantos elogios cada pessoa já recebeu (cartões de Pessoas).
    if (params.get("counts")) {
      const rows = await db.select({ toId: kudos.toId }).from(kudos);
      return json({ counts: Object.fromEntries(kudosRanking(rows).map((entry) => [entry.memberId, entry.count])) });
    }

    // Elogios recebidos por uma pessoa (perfil e avaliação), opcionalmente num período (AAAA-MM-DD).
    const personId = Number(params.get("memberId"));
    if (personId) {
      const from = params.get("from");
      const to = params.get("to");
      const valid = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value);
      const rows = await db.select().from(kudos).where(and(eq(kudos.toId, personId),
        valid(from) ? gte(kudos.createdAt, `${from}T03:00:00.000Z`) : undefined,
        valid(to) ? lte(kudos.createdAt, new Date(Date.parse(`${to}T03:00:00.000Z`) + DAY).toISOString()) : undefined,
      )).orderBy(desc(kudos.createdAt)).limit(100);
      return json({ kudos: await kudosView(db, rows, member.id, isAdmin) });
    }

    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY).toISOString();
    const [recent, wallPolls, people] = await Promise.all([
      db.select().from(kudos).where(gte(kudos.createdAt, since)).orderBy(desc(kudos.createdAt)).limit(60),
      db.select({ id: polls.id, createdAt: polls.createdAt }).from(polls).where(and(isNull(polls.channelId), gte(polls.createdAt, new Date(now.getTime() - 14 * DAY).toISOString()))).orderBy(desc(polls.createdAt)).limit(10),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)),
    ]);
    const monthStart = `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now).slice(0, 7)}-01T03:00:00.000Z`;
    const ranking = kudosRanking(recent.filter((row) => row.createdAt >= monthStart)).slice(0, 3)
      .map((entry) => ({ ...entry, name: people.find((person) => person.id === entry.memberId)?.name ?? "Pessoa removida" }));
    return json({
      kudos: await kudosView(db, recent, member.id, isAdmin),
      ranking,
      polls: (await loadPolls(db, wallPolls.map((row) => row.id), member.id, isAdmin, now)).sort((a, b) => Number(b.open) - Number(a.open) || b.createdAt.localeCompare(a.createdAt)),
      people: people.filter((person) => person.id !== member.id).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      me: { id: member.id, canPost: member.role !== "viewer" },
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
    const now = new Date();
    const stamp = now.toISOString();

    if (action === "vote") {
      // Enquete de conversa direta: só as duas pessoas votam.
      const [poll] = await db.select({ channelId: polls.channelId }).from(polls).where(eq(polls.id, Number(body.pollId))).limit(1);
      if (poll?.channelId) {
        const [channel] = await db.select({ kind: chatChannels.kind, dmKey: chatChannels.dmKey }).from(chatChannels).where(eq(chatChannels.id, poll.channelId)).limit(1);
        if (!channel || (channel.kind === "dm" && !dmMembers(channel.dmKey).includes(member.id))) return json({ error: "Enquete não encontrada." }, 404);
      }
      const error = await castVote(db, Number(body.pollId), member.id, body.options, now);
      return error ? json({ error }, 400) : json({ ok: true });
    }

    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);

    if (action === "giveKudos") {
      const toId = Number(body.toId);
      const message = cleanMultiline(body.message, MAX_KUDOS_MESSAGE);
      const value = String(body.value ?? "");
      const error = kudosError({ fromId: member.id, toId, message, value });
      if (error) return json({ error }, 400);
      const [target] = await db.select({ id: members.id, name: members.name, active: members.active }).from(members).where(eq(members.id, toId)).limit(1);
      if (!target?.active) return json({ error: "Pessoa não encontrada." }, 404);
      const today = await db.select({ id: kudos.id }).from(kudos).where(and(eq(kudos.fromId, member.id), gte(kudos.createdAt, new Date(now.getTime() - DAY).toISOString())));
      if (today.length >= MAX_KUDOS_PER_DAY) return json({ error: `Você já mandou ${MAX_KUDOS_PER_DAY} elogios nas últimas 24 horas. Guarde alguns para amanhã. 🙂` }, 429);
      const [created] = await db.insert(kudos).values({ fromId: member.id, fromName: member.name, toId, value: isKudosValue(value) ? value : "", message, createdAt: stamp }).returning();
      await db.insert(notifications).values({ memberId: toId, kind: "kudos", actorName: member.name, body: snippet(message, 120), createdAt: stamp }).catch((err) => console.error("kudos notification failed", err));
      return json({ kudos: created }, 201);
    }

    if (action === "deleteKudos") {
      const [row] = await db.select().from(kudos).where(eq(kudos.id, Number(body.kudosId))).limit(1);
      if (!row) return json({ error: "Elogio não encontrado." }, 404);
      if (!isAdmin && row.fromId !== member.id) return json({ error: "Só quem elogiou ou um administrador pode apagar." }, 403);
      await db.delete(kudos).where(eq(kudos.id, row.id));
      if (row.fromId !== member.id) await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "kudos_deleted", targetType: "kudos", targetId: row.id, details: snippet(row.message, 80) }).catch((err) => console.error("audit log failed", err));
      return json({ ok: true });
    }

    if (action === "createPoll") {
      const question = String(body.question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_POLL_QUESTION);
      const options = cleanPollOptions(body.options);
      const error = pollError(question, options);
      if (error) return json({ error }, 400);
      const closesAt = pollClosesAt(body.duration, now);
      if (closesAt === undefined) return json({ error: "Escolha até quando a enquete fica aberta." }, 400);
      const [poll] = await db.insert(polls).values({ question, options: JSON.stringify(options), multiple: body.multiple === true, anonymous: body.anonymous === true, channelId: null, createdById: member.id, createdByName: member.name, closesAt, createdAt: stamp }).returning();
      // Aviso no sino para a equipe (enquete do mural).
      const people = await db.select({ id: members.id }).from(members).where(eq(members.active, true));
      const rows = people.filter((person) => person.id !== member.id).map((person) => ({ memberId: person.id, kind: "poll" as const, actorName: member.name, body: question.slice(0, 140), createdAt: stamp }));
      for (let index = 0; index < rows.length; index += 20) await db.insert(notifications).values(rows.slice(index, index + 20)).catch((err) => console.error("poll notification failed", err));
      return json({ poll }, 201);
    }

    if (action === "closePoll" || action === "deletePoll") {
      const [poll] = await db.select().from(polls).where(eq(polls.id, Number(body.pollId))).limit(1);
      if (!poll) return json({ error: "Enquete não encontrada." }, 404);
      if (!isAdmin && poll.createdById !== member.id) return json({ error: "Só quem criou ou um administrador pode mexer nesta enquete." }, 403);
      if (action === "closePoll") {
        await db.update(polls).set({ closedAt: stamp }).where(and(eq(polls.id, poll.id), isNull(polls.closedAt)));
        return json({ ok: true });
      }
      // Enquete do chat: a mensagem vira "apagada" (some a enquete, fica o registro na conversa).
      if (poll.channelId) await db.update(chatMessages).set({ deleted: true }).where(eq(chatMessages.pollId, poll.id));
      await db.delete(polls).where(eq(polls.id, poll.id));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
