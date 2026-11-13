import { and, asc, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { agendaAttendees, agendaEvents, agendaReminders, members, notifications } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { isoToLocal, isRealEmail, isRepeat, isTeamsJoinLink, localToIso, REMIND_OPTIONS } from "../../agenda";
import { agendaRemindersJob } from "../../jobs";
import { sha256Hex } from "../../secret-box";
import { z } from "zod";
import { check, readJsonBody } from "../../api-input";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("agenda request failed", error);
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a agenda. Publique novamente para aplicar as migrações." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** Campos de um compromisso (as regras que dependem de outros campos ficam logo abaixo, no saveEvent). */
const trimmed = (max: number) => z.string().catch("").transform((value) => value.trim().slice(0, max));
const eventInput = z.object({
  eventId: z.coerce.number().int().positive().catch(0),
  kind: z.enum(["note", "meeting"]).catch("note"),
  title: z.string().catch("").transform((value) => value.replace(/\s+/g, " ").trim().slice(0, 140)),
  notes: z.string().catch("").transform((value) => value.replace(/\r\n/g, "\n").trim().slice(0, 2000)),
  day: z.string({ message: "Informe um dia e um horário válidos." }),
  time: z.string({ message: "Informe um dia e um horário válidos." }),
  endTime: trimmed(5),
  // Vazio ou ausente = sem aviso; número fora das opções é recusado logo abaixo.
  remindBefore: z.number().nullable().catch(null),
  teamsUrl: trimmed(500),
  attendees: z.array(z.coerce.number().int().positive(), { message: "Escolha convidados ativos da equipe." }).max(200, "Convidados demais.").catch([]),
  repeat: z.string().catch("").refine(isRepeat, "Escolha como repetir."),
  repeatUntil: z.string().catch("").transform((value) => value.trim()),
});

const shift = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 86400000;

/** Compromissos em que a pessoa é dona ou convidada, num intervalo. */
async function eventsFor(db: Db, memberId: number, from: string, to: string) {
  const invited = db.select({ id: agendaAttendees.eventId }).from(agendaAttendees).where(eq(agendaAttendees.memberId, memberId));
  const rows = await db.select().from(agendaEvents)
    .where(and(or(eq(agendaEvents.ownerId, memberId), inArray(agendaEvents.id, invited)), or(
      and(gte(agendaEvents.startsAt, from), lte(agendaEvents.startsAt, to)),
      // Quem se repete aparece enquanto a série estiver valendo (a tela calcula cada ocorrência).
      and(ne(agendaEvents.repeat, ""), lte(agendaEvents.startsAt, to), or(isNull(agendaEvents.repeatUntil), gte(agendaEvents.repeatUntil, isoToLocal(from).day))),
    )))
    .orderBy(asc(agendaEvents.startsAt)).limit(500);
  const attendees = rows.length ? await db.select().from(agendaAttendees).where(inArray(agendaAttendees.eventId, rows.map((row) => row.id))) : [];
  return rows.map((row) => ({ ...row, attendees: attendees.filter((entry) => entry.eventId === row.id).map((entry) => entry.memberId), isOwner: row.ownerId === memberId }));
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const params = new URL(request.url).searchParams;
    // "upcoming": só o que vem nas próximas 24 h (usado pelo aviso na tela).
    if (params.get("upcoming")) return json({ events: await eventsFor(db, member.id, shift(-2 * 3600000), shift(DAY)) });
    const iso = (value: string | null, fallback: string) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback);
    const from = iso(params.get("from"), shift(-7 * DAY));
    const to = iso(params.get("to"), shift(90 * DAY));
    const people = await db.select({ id: members.id, name: members.name, email: members.email, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
    return json({
      events: await eventsFor(db, member.id, from, to),
      // Para os convidados: o e-mail só serve para o convite do Teams (e só os de verdade).
      members: people.map((person) => ({ id: person.id, name: person.name, avatarIcon: person.avatarIcon, avatarKey: person.avatarKey, email: isRealEmail(person.email) ? person.email : null })),
      me: { id: member.id, hasCalendarLink: Boolean(member.calendarTokenHash) },
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
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    // Link secreto para assinar a agenda no Outlook/Teams. Aparece só agora: o banco guarda o resumo.
    if (action === "calendarLink" || action === "removeCalendarLink") {
      if (action === "removeCalendarLink") {
        await db.update(members).set({ calendarTokenHash: null }).where(eq(members.id, member.id));
        return json({ ok: true });
      }
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await db.update(members).set({ calendarTokenHash: await sha256Hex(token) }).where(eq(members.id, member.id));
      return json({ url: `${new URL(request.url).origin}/api/agenda/ics?token=${member.id}.${token}` });
    }

    // Entrega os lembretes desta pessoa que já venceram (a tela chama na hora exata do aviso).
    if (action === "fireReminders") {
      return json(await agendaRemindersJob(db, new Date(), member.id));
    }

    if (action === "saveEvent") {
      const input = check(eventInput, body);
      if (!input.ok) return json({ error: input.error }, 400);
      const { eventId, kind, title, notes, endTime, teamsUrl, remindBefore: remind, repeat } = input.data;
      const repeatUntil = repeat && input.data.repeatUntil ? input.data.repeatUntil : null;
      if (repeatUntil && (!localToIso(repeatUntil, "00:00") || repeatUntil < input.data.day)) return json({ error: "A data final da repetição precisa ser depois do primeiro dia." }, 400);
      const startsAt = localToIso(input.data.day, input.data.time);
      const endsAt = endTime ? localToIso(input.data.day, endTime) : null;
      if (!title) return json({ error: kind === "meeting" ? "Dê um assunto para a reunião." : "Escreva a anotação." }, 400);
      if (!startsAt) return json({ error: "Informe um dia e um horário válidos." }, 400);
      if (endTime && (!endsAt || endsAt <= startsAt)) return json({ error: "O horário de fim precisa ser depois do início." }, 400);
      if (remind !== null && !REMIND_OPTIONS.some((option) => option.value === remind)) return json({ error: "Escolha quando avisar." }, 400);
      if (teamsUrl && !isTeamsJoinLink(teamsUrl)) return json({ error: "Cole o link de entrada da reunião do Teams (começa com https://teams.microsoft.com/...)." }, 400);
      const requested = [...new Set(input.data.attendees.filter((id) => id !== member.id))].slice(0, 50);
      const valid = requested.length ? (await db.select({ id: members.id }).from(members).where(and(inArray(members.id, requested), eq(members.active, true)))).map((row) => row.id) : [];
      if (valid.length !== requested.length) return json({ error: "Escolha convidados ativos da equipe." }, 400);

      const values = { kind, title, notes, startsAt, endsAt, remindBefore: remind, teamsUrl, repeat, repeatUntil, updatedAt: now, ...(repeat ? { done: false } : {}) };
      let id = eventId;
      let previousAttendees: number[] = [];
      if (eventId) {
        const [current] = await db.select().from(agendaEvents).where(eq(agendaEvents.id, eventId)).limit(1);
        if (!current) return json({ error: "Compromisso não encontrado." }, 404);
        if (current.ownerId !== member.id) return json({ error: "Só quem criou pode editar este compromisso." }, 403);
        previousAttendees = (await db.select({ id: agendaAttendees.memberId }).from(agendaAttendees).where(eq(agendaAttendees.eventId, eventId))).map((row) => row.id);
        await db.update(agendaEvents).set(values).where(eq(agendaEvents.id, eventId));
        // Mudou o horário ou o aviso: os lembretes voltam a valer para o novo horário.
        if (current.startsAt !== startsAt || current.remindBefore !== remind || current.repeat !== repeat) await db.delete(agendaReminders).where(eq(agendaReminders.eventId, eventId));
        await db.delete(agendaAttendees).where(eq(agendaAttendees.eventId, eventId));
      } else {
        const [created] = await db.insert(agendaEvents).values({ ...values, ownerId: member.id, createdAt: now }).returning({ id: agendaEvents.id });
        id = created.id;
      }
      if (valid.length) await db.insert(agendaAttendees).values(valid.map((memberId) => ({ eventId: id, memberId })));
      // Convidados novos recebem um aviso no sino.
      const fresh = valid.filter((memberId) => !previousAttendees.includes(memberId));
      if (fresh.length) {
        const { day, time } = isoToLocal(startsAt);
        await db.insert(notifications).values(fresh.map((memberId) => ({ memberId, kind: "agenda_invite" as const, eventId: id, body: `${title} · ${day.split("-").reverse().join("/")} às ${time}`.slice(0, 140), actorName: member.name, createdAt: now })));
      }
      const [saved] = await eventsFor(db, member.id, startsAt, startsAt).then((list) => list.filter((event) => event.id === id));
      return json({ event: saved }, eventId ? 200 : 201);
    }

    const eventId = Number(body.eventId);
    const [current] = eventId ? await db.select().from(agendaEvents).where(eq(agendaEvents.id, eventId)).limit(1) : [];
    if (!current) return json({ error: "Compromisso não encontrado." }, 404);

    if (action === "toggleDone") {
      if (current.ownerId !== member.id) return json({ error: "Só quem criou pode marcar como feito." }, 403);
      if (current.repeat) return json({ error: "Compromissos que se repetem não são marcados como feitos. Para parar, edite e defina até quando repetir." }, 400);
      await db.update(agendaEvents).set({ done: body.done === true, updatedAt: now }).where(eq(agendaEvents.id, eventId));
      return json({ ok: true });
    }

    if (action === "deleteEvent") {
      if (current.ownerId !== member.id) return json({ error: "Só quem criou pode excluir. Convidados podem sair do compromisso." }, 403);
      await db.delete(agendaEvents).where(eq(agendaEvents.id, eventId));
      return json({ ok: true });
    }

    if (action === "leaveEvent") {
      await db.delete(agendaAttendees).where(and(eq(agendaAttendees.eventId, eventId), eq(agendaAttendees.memberId, member.id)));
      await db.delete(agendaReminders).where(and(eq(agendaReminders.eventId, eventId), eq(agendaReminders.memberId, member.id)));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
