import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { absences, handoffs, members, supportTeams, supportWeeks, teams, tickets } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { isSupportTeamName } from "../../ticket-routing";
import { upcomingCelebrations } from "../../team-tools";
import { snippet } from "../../notifications";
import { downSystems } from "../../system-monitor";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function names(value: string) {
  try { const list = JSON.parse(value) as unknown; return Array.isArray(list) ? list.map(String) : []; } catch { return []; }
}

/** Tudo o que a tela da TV mostra, numa chamada só (atualizada a cada 30 s). Só para quem está logado. */
export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
    const dayStart = new Date(`${today}T00:00:00-03:00`).toISOString();

    const teamRows = await db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name));
    const param = new URL(request.url).searchParams.get("team");
    // Sem escolha: o time do Suporte (ou todos, se não houver).
    const teamId = param === "all" ? null : Number(param) || teamRows.find((team) => isSupportTeamName(team.name))?.id || null;
    const teamFilter = teamId ? eq(tickets.teamId, teamId) : undefined;

    const [active, recent, people, weekRows, scheduleTeams, awayRows, [lastHandoff]] = await Promise.all([
      db.select({ id: tickets.id, title: tickets.title, urgency: tickets.urgency, status: tickets.status, client: tickets.client, teamId: tickets.teamId, assigneeId: tickets.assigneeId, externalKey: tickets.externalKey, createdAt: tickets.createdAt, firstResponseAt: tickets.firstResponseAt, resolvedAt: tickets.resolvedAt })
        .from(tickets).where(and(inArray(tickets.status, ["open", "in_progress", "waiting"]), teamFilter)).limit(500),
      db.select({ status: tickets.status, createdAt: tickets.createdAt, resolvedAt: tickets.resolvedAt }).from(tickets).where(and(or(gte(tickets.createdAt, dayStart), gte(tickets.resolvedAt, dayStart)), teamFilter)).limit(1000),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, birthday: members.birthday, startedOn: members.startedOn }).from(members).where(eq(members.active, true)),
      db.select({ id: supportWeeks.id, start: supportWeeks.startDate, end: supportWeeks.endDate, teamId: supportWeeks.teamId, note: supportWeeks.note }).from(supportWeeks).where(gte(supportWeeks.endDate, today)).orderBy(asc(supportWeeks.startDate)).limit(2),
      db.select().from(supportTeams),
      db.select({ memberId: absences.memberId, kind: absences.kind, endDate: absences.endDate }).from(absences).where(and(lte(absences.startDate, today), gte(absences.endDate, today))),
      db.select({ teamName: handoffs.teamName, body: handoffs.body, createdByName: handoffs.createdByName, createdAt: handoffs.createdAt }).from(handoffs).orderBy(desc(handoffs.createdAt)).limit(1).catch(() => []),
    ]);

    const down = await downSystems(db).catch(() => []);
    const nameOf = new Map(people.map((person) => [person.id, person.name]));
    const week = (row: (typeof weekRows)[number] | undefined) => {
      if (!row) return null;
      const team = scheduleTeams.find((entry) => entry.id === row.teamId);
      return { start: row.start, end: row.end, note: row.note, teamName: team?.name ?? "Equipe", color: team?.color ?? "purple", members: names(team?.members ?? "[]") };
    };
    const current = weekRows.find((row) => row.start <= today && row.end >= today);
    const next = weekRows.find((row) => row.start > today);

    return json({
      now: now.toISOString(),
      today,
      teamId,
      teams: teamRows,
      tickets: active.map((ticket) => ({ ...ticket, assigneeName: ticket.assigneeId ? nameOf.get(ticket.assigneeId) ?? null : null })),
      openedToday: recent.filter((ticket) => ticket.createdAt >= dayStart).length,
      resolvedToday: recent.filter((ticket) => ticket.status === "resolved" && ticket.resolvedAt && ticket.resolvedAt >= dayStart).length,
      onCall: week(current),
      nextOnCall: week(next),
      away: [...new Set(awayRows.map((row) => nameOf.get(row.memberId)).filter((name): name is string => Boolean(name)))],
      celebrations: upcomingCelebrations(people, today, 7),
      systemsDown: down.map((system) => ({ name: system.name, clientName: system.clientName, since: system.since })),
      handoff: lastHandoff ? { ...lastHandoff, body: snippet(lastHandoff.body, 280) } : null,
    });
  } catch (error) {
    console.error("tv request failed", error);
    return json({ error: "Não foi possível carregar a tela agora." }, 500);
  }
}
