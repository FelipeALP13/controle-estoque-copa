import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, clientSystems, members, systemEvents, tasks, teamMembers, teams, tickets, timeEntries } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { openSecret, sealSecret } from "../../secret-key";
import { clientMonthSummary, isEnvironment, sameClientName, systemUrlError } from "../../office-tools";
import { parseStoredDate, slaStatus, ticketCode } from "../../tickets";
import { checkSystem, downSystems } from "../../system-monitor";

type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("clients request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a ficha dos clientes. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const isMonth = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

async function viewerOf(db: Db, member: SessionMember) {
  const rows = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, member.id));
  return { id: member.id, isAdmin: member.role === "admin", canEdit: member.role !== "viewer", teamIds: rows.map((row) => row.teamId) };
}
type Viewer = Awaited<ReturnType<typeof viewerOf>>;

/** Usuário e senha: só o time dono do acesso e administradores; "Somente leitura" nunca. */
const canSeeLogin = (viewer: Viewer, teamId: number | null) => viewer.canEdit && (viewer.isAdmin || (teamId !== null && viewer.teamIds.includes(teamId)));

function publicSystem(system: typeof clientSystems.$inferSelect, viewer: Viewer) {
  const allowed = canSeeLogin(viewer, system.teamId);
  return {
    id: system.id, clientId: system.clientId, teamId: system.teamId, name: system.name, environment: system.environment, url: system.url, notes: system.notes,
    monitor: system.monitor, status: system.status, lastCheckedAt: system.lastCheckedAt, lastChangeAt: system.lastChangeAt, lastMs: system.lastMs, lastError: system.lastError,
    username: allowed ? system.username : null, hasPassword: Boolean(system.passwordEnc), canSeeLogin: allowed,
  };
}

/** Horas lançadas por cliente num intervalo de datas. */
async function hoursByClient(db: Db, from: string, to: string, clientId?: number) {
  const rows = await db.select({ clientId: tasks.clientId, hours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)` }).from(timeEntries).innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
    .where(and(gte(timeEntries.workDate, from), lte(timeEntries.workDate, to), clientId ? eq(tasks.clientId, clientId) : undefined)).groupBy(tasks.clientId);
  return new Map(rows.map((row) => [row.clientId, Number(row.hours)]));
}

function firstResponse(ticket: { createdAt: string; firstResponseAt: string | null; urgency: "low" | "normal" | "high" | "critical" }) {
  if (!ticket.firstResponseAt) return { minutes: null, onTime: null };
  const minutes = Math.round((parseStoredDate(ticket.firstResponseAt).getTime() - parseStoredDate(ticket.createdAt).getTime()) / 60000);
  return { minutes, onTime: slaStatus(ticket).state === "met" };
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const viewer = await viewerOf(db, member);
    const params = new URL(request.url).searchParams;
    const today = todayInSaoPaulo();
    const month = today.slice(0, 7);

    // Relatório mensal do cliente (dados para o Excel).
    const reportId = Number(params.get("report"));
    if (reportId) {
      const reportMonth = params.get("month");
      if (!isMonth(reportMonth)) return json({ error: "Escolha o mês do relatório." }, 400);
      const [client] = await db.select().from(clients).where(eq(clients.id, reportId)).limit(1);
      if (!client) return json({ error: "Cliente não encontrado." }, 404);
      const range = monthRange(reportMonth);
      const fromIso = new Date(`${range.from}T00:00:00-03:00`).toISOString();
      const toIso = new Date(`${range.to}T23:59:59-03:00`).toISOString();
      const [ticketRows, doneTasks, entries, memberRows] = await Promise.all([
        db.select().from(tickets).where(sql`(${tickets.createdAt} >= ${fromIso} and ${tickets.createdAt} <= ${toIso}) or (${tickets.resolvedAt} >= ${fromIso} and ${tickets.resolvedAt} <= ${toIso})`).limit(3000),
        db.select({ id: tasks.id, title: tasks.title, category: tasks.category, completedOn: tasks.completedOn, workedHours: tasks.workedHours }).from(tasks).where(and(eq(tasks.clientId, reportId), eq(tasks.status, "done"), gte(tasks.completedOn, range.from), lte(tasks.completedOn, range.to))).orderBy(asc(tasks.completedOn)),
        db.select({ workDate: timeEntries.workDate, memberName: timeEntries.memberName, hours: timeEntries.hours, note: timeEntries.note, taskId: tasks.id, taskTitle: tasks.title }).from(timeEntries).innerJoin(tasks, eq(timeEntries.taskId, tasks.id)).where(and(eq(tasks.clientId, reportId), gte(timeEntries.workDate, range.from), lte(timeEntries.workDate, range.to))).orderBy(asc(timeEntries.workDate)),
        db.select({ id: members.id, name: members.name }).from(members),
      ]);
      const mine = ticketRows.filter((ticket) => sameClientName(ticket.client, client.name));
      const hours = entries.reduce((sum, entry) => sum + entry.hours, 0);
      const summary = clientMonthSummary({ month: reportMonth, tickets: mine.map((ticket) => { const first = firstResponse(ticket); return { createdAt: ticket.createdAt, resolvedAt: ticket.resolvedAt, status: ticket.status, firstResponseMinutes: first.minutes, firstResponseOnTime: first.onTime }; }), tasksDone: doneTasks.length, hours, monthlyHours: client.monthlyHours });
      return json({
        client: { id: client.id, name: client.name, monthlyHours: client.monthlyHours },
        month: reportMonth,
        summary,
        tickets: mine.map((ticket) => ({ code: ticketCode(ticket.id), externalKey: ticket.externalKey, title: ticket.title, status: ticket.status, urgency: ticket.urgency, createdAt: ticket.createdAt, resolvedAt: ticket.resolvedAt, assignee: memberRows.find((person) => person.id === ticket.assigneeId)?.name ?? "", firstResponseMinutes: firstResponse(ticket).minutes })),
        tasks: doneTasks,
        entries,
      });
    }

    // Ficha de um cliente.
    const clientId = Number(params.get("clientId"));
    if (clientId) {
      const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!client || (!client.active && !viewer.isAdmin)) return json({ error: "Cliente não encontrado." }, 404);
      const sixMonthsAgo = `${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 6, 1)).toISOString().slice(0, 7)}-01`;
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [systems, ticketRows, taskRows, hourRows, memberRows, teamRows] = await Promise.all([
        db.select().from(clientSystems).where(eq(clientSystems.clientId, clientId)).orderBy(asc(clientSystems.name)),
        db.select({ id: tickets.id, title: tickets.title, client: tickets.client, status: tickets.status, urgency: tickets.urgency, createdAt: tickets.createdAt, resolvedAt: tickets.resolvedAt, assigneeId: tickets.assigneeId, externalKey: tickets.externalKey }).from(tickets).orderBy(desc(tickets.createdAt)).limit(3000),
        db.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, completedOn: tasks.completedOn }).from(tasks).where(eq(tasks.clientId, clientId)).orderBy(desc(tasks.id)).limit(400),
        db.select({ month: sql<string>`substr(${timeEntries.workDate}, 1, 7)`, hours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)` }).from(timeEntries).innerJoin(tasks, eq(timeEntries.taskId, tasks.id)).where(and(eq(tasks.clientId, clientId), gte(timeEntries.workDate, sixMonthsAgo))).groupBy(sql`substr(${timeEntries.workDate}, 1, 7)`),
        db.select({ id: members.id, name: members.name }).from(members),
        db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
      ]);
      const events = systems.length ? await db.select().from(systemEvents).where(and(inArray(systemEvents.systemId, systems.map((system) => system.id)), gte(systemEvents.at, since))).orderBy(asc(systemEvents.at)) : [];
      const mine = ticketRows.filter((ticket) => sameClientName(ticket.client, client.name));
      const nameOf = (id: number | null) => (id ? memberRows.find((person) => person.id === id)?.name ?? "" : "");
      return json({
        client,
        systems: systems.map((system) => ({ ...publicSystem(system, viewer), events: events.filter((event) => event.systemId === system.id).map((event) => ({ kind: event.kind, at: event.at, detail: event.detail })) })),
        tickets: mine.slice(0, 15).map((ticket) => ({ ...ticket, assigneeName: nameOf(ticket.assigneeId) })),
        ticketCounts: { open: mine.filter((ticket) => ["open", "in_progress", "waiting"].includes(ticket.status)).length, total: mine.length },
        tasks: taskRows.filter((task) => task.status !== "done" && task.status !== "canceled").slice(0, 30),
        doneTasks: taskRows.filter((task) => task.status === "done").sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? "")).slice(0, 10),
        hoursByMonth: hourRows.map((row) => ({ month: row.month, hours: Math.round(Number(row.hours) * 100) / 100 })).sort((a, b) => a.month.localeCompare(b.month)),
        teams: teamRows,
        me: viewer,
      });
    }

    // Lista de clientes com os números principais.
    const { from } = monthRange(month);
    const [clientRows, openTasks, activeTickets, hours, systemRows, down] = await Promise.all([
      db.select({ id: clients.id, name: clients.name, active: clients.active, monthlyHours: clients.monthlyHours, contactName: clients.contactName }).from(clients).orderBy(asc(clients.name)),
      db.select({ clientId: tasks.clientId, count: sql<number>`count(*)` }).from(tasks).where(sql`${tasks.status} not in ('done', 'canceled')`).groupBy(tasks.clientId),
      db.select({ client: tickets.client }).from(tickets).where(inArray(tickets.status, ["open", "in_progress", "waiting"])),
      hoursByClient(db, from, today),
      db.select({ clientId: clientSystems.clientId, monitor: clientSystems.monitor, status: clientSystems.status }).from(clientSystems),
      downSystems(db),
    ]);
    return json({
      month,
      clients: clientRows.filter((client) => client.active || viewer.isAdmin).map((client) => ({
        ...client,
        openTasks: Number(openTasks.find((row) => row.clientId === client.id)?.count ?? 0),
        openTickets: activeTickets.filter((ticket) => sameClientName(ticket.client, client.name)).length,
        hoursThisMonth: Math.round((hours.get(client.id) ?? 0) * 100) / 100,
        systems: systemRows.filter((row) => row.clientId === client.id).length,
        systemsDown: systemRows.filter((row) => row.clientId === client.id && row.monitor && row.status === "down").length,
      })),
      monitored: systemRows.filter((row) => row.monitor).length,
      down,
      me: viewer,
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
    const viewer = await viewerOf(db, member);
    if (!viewer.canEdit) return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const audit = (name: string, targetId: number, details: string) => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: name, targetType: "client_system", targetId, details }).catch((error) => console.error("audit log failed", error));

    // Ver ou copiar a senha: só quem pode, e fica registrado no histórico.
    if (action === "revealPassword") {
      const [system] = await db.select().from(clientSystems).where(eq(clientSystems.id, Number(body.systemId))).limit(1);
      if (!system) return json({ error: "Acesso não encontrado." }, 404);
      if (!canSeeLogin(viewer, system.teamId)) return json({ error: "Só o time dono deste acesso e os administradores veem a senha." }, 403);
      if (!system.passwordEnc) return json({ error: "Este acesso não tem senha cadastrada." }, 404);
      const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, system.clientId)).limit(1);
      const password = await openSecret(system.passwordEnc);
      await audit(body.purpose === "copy" ? "system_password_copied" : "system_password_viewed", system.id, `${client?.name ?? "Cliente"} · ${system.name}`);
      return json({ password });
    }

    // Verificar agora (qualquer membro).
    if (action === "checkNow") {
      const [system] = await db.select().from(clientSystems).where(eq(clientSystems.id, Number(body.systemId))).limit(1);
      if (!system) return json({ error: "Acesso não encontrado." }, 404);
      if (!system.url) return json({ error: "Cadastre o endereço do sistema para verificar." }, 400);
      const result = await checkSystem(db, system);
      if (!result) return json({ error: "Endereço inválido para verificar." }, 400);
      return json({ result });
    }

    if (!viewer.isAdmin) return json({ error: "Somente administradores cadastram e editam os clientes e acessos." }, 403);

    if (action === "saveProfile") {
      const clientId = Number(body.clientId);
      const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!client) return json({ error: "Cliente não encontrado." }, 404);
      const hours = body.monthlyHours === null || body.monthlyHours === "" || body.monthlyHours === undefined ? null : Number(String(body.monthlyHours).replace(",", "."));
      if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 10000)) return json({ error: "Informe o pacote de horas em número (ou deixe vazio)." }, 400);
      const email = cleanTitle(body.contactEmail).slice(0, 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Informe um e-mail válido para o contato." }, 400);
      await db.update(clients).set({ contactName: cleanTitle(body.contactName).slice(0, 80), contactEmail: email, contactPhone: cleanTitle(body.contactPhone).slice(0, 40), monthlyHours: hours === null ? null : Math.round(hours * 100) / 100, notes: cleanMultiline(body.notes, 4000) }).where(eq(clients.id, clientId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "client_profile_updated", targetType: "client", targetId: clientId, details: client.name }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    if (action === "saveSystem") {
      const systemId = Number(body.systemId) || 0;
      const clientId = Number(body.clientId);
      const name = cleanTitle(body.name).slice(0, 80);
      const url = cleanTitle(body.url).slice(0, 500);
      const teamId = Number(body.teamId) || null;
      if (!name) return json({ error: "Dê um nome ao sistema (ex.: SGE)." }, 400);
      if (!isEnvironment(body.environment)) return json({ error: "Escolha o ambiente." }, 400);
      const urlError = systemUrlError(url);
      if (urlError) return json({ error: urlError }, 400);
      if (body.monitor === true && !url) return json({ error: "Para monitorar, informe o endereço." }, 400);
      const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!client) return json({ error: "Cliente não encontrado." }, 404);
      if (teamId && !(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1)).length) return json({ error: "Escolha um time válido." }, 400);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length > 200) return json({ error: "Senha longa demais." }, 400);
      const values: Partial<typeof clientSystems.$inferInsert> = {
        name, url, teamId, environment: body.environment, username: cleanTitle(body.username).slice(0, 120), notes: cleanMultiline(body.notes, 1000), monitor: body.monitor === true, updatedAt: now,
        ...(password ? { passwordEnc: await sealSecret(password) } : body.clearPassword === true ? { passwordEnc: null } : {}),
      };
      let saved;
      if (systemId) {
        const [current] = await db.select().from(clientSystems).where(and(eq(clientSystems.id, systemId), eq(clientSystems.clientId, clientId))).limit(1);
        if (!current) return json({ error: "Acesso não encontrado." }, 404);
        // Endereço novo ou monitor ligado de novo: recomeça a contagem.
        if (current.url !== url || (!current.monitor && values.monitor)) Object.assign(values, { status: "unknown", failCount: 0, lastCheckedAt: null, lastError: null });
        [saved] = await db.update(clientSystems).set(values).where(eq(clientSystems.id, systemId)).returning();
      } else {
        [saved] = await db.insert(clientSystems).values({ ...values, name, clientId, createdByName: member.name, createdAt: now } as typeof clientSystems.$inferInsert).returning();
      }
      await audit("system_saved", saved.id, `${client.name} · ${name}${password ? " (senha nova)" : ""}`);
      return json({ system: publicSystem(saved, viewer) }, systemId ? 200 : 201);
    }

    if (action === "deleteSystem") {
      const [system] = await db.select().from(clientSystems).where(eq(clientSystems.id, Number(body.systemId))).limit(1);
      if (!system) return json({ error: "Acesso não encontrado." }, 404);
      await db.delete(clientSystems).where(eq(clientSystems.id, system.id));
      await audit("system_deleted", system.id, system.name);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
