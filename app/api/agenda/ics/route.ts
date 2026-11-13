// Agenda da pessoa em formato .ics, para assinar no Outlook/Teams/Google ("Adicionar calendário pela internet").
// Não usa a sessão do Portal: o acesso é pelo link secreto (só o resumo do token fica no banco).
import { and, asc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { agendaAttendees, agendaEvents, members } from "../../../../db/schema";
import { buildCalendar, parseCalendarToken } from "../../../ics";
import { sameText, sha256Hex } from "../../../secret-box";

const notFound = () => new Response("Calendário não encontrado. Gere um link novo na Agenda do Portal.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  try {
    const parsed = parseCalendarToken(new URL(request.url).searchParams.get("token"));
    if (!parsed) return notFound();
    const db = getDb();
    const [member] = await db.select({ id: members.id, name: members.name, active: members.active, hash: members.calendarTokenHash }).from(members).where(eq(members.id, parsed.memberId)).limit(1);
    if (!member?.active || !member.hash || !sameText(await sha256Hex(parsed.token), member.hash)) return notFound();

    // Últimos 60 dias e tudo o que vem pela frente (os que se repetem entram como série).
    const from = new Date(Date.now() - 60 * 86400000).toISOString();
    const invited = db.select({ id: agendaAttendees.eventId }).from(agendaAttendees).where(eq(agendaAttendees.memberId, member.id));
    const rows = await db.select().from(agendaEvents)
      .where(and(or(eq(agendaEvents.ownerId, member.id), inArray(agendaEvents.id, invited)), or(gte(agendaEvents.startsAt, from), and(ne(agendaEvents.repeat, ""), or(isNull(agendaEvents.repeatUntil), gte(agendaEvents.repeatUntil, from.slice(0, 10)))))))
      .orderBy(asc(agendaEvents.startsAt)).limit(1000);
    const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
    const owners = ownerIds.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ownerIds)) : [];
    const ownerName = new Map(owners.map((owner) => [owner.id, owner.name]));
    const body = buildCalendar(`Portal · ${member.name}`, rows.map((row) => ({
      id: row.id, title: row.title, notes: row.notes, startsAt: row.startsAt, endsAt: row.endsAt, kind: row.kind,
      teamsUrl: row.teamsUrl, repeat: row.repeat, repeatUntil: row.repeatUntil, updatedAt: row.updatedAt,
      organizer: row.ownerId === member.id ? "" : ownerName.get(row.ownerId) ?? "",
    })));
    return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="agenda-portal.ics"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("calendar feed failed", error);
    return new Response("Não foi possível gerar o calendário agora.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
