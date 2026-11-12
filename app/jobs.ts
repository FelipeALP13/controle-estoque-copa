// Rotinas automáticas: busca no Jira, alerta diário de estoque baixo e aviso de chamados atrasados.
// Rodam pelo agendador externo (/api/cron) e também enquanto alguém está com o Portal aberto.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { getDb } from "../db";
import { appSettings, items, members, notifications, teamMembers, teams, tickets } from "../db/schema";
import { dailyDue, lateTicketsCard, saoPaulo, stockAlertCard, type LateTicket } from "./alerts";
import { syncDue } from "./jira-sync";
import { openSecret } from "./secret-key";
import { isTicketLate, slaStatus, resolutionStatus, ticketCode } from "./tickets";

type Db = ReturnType<typeof getDb>;

export const SETTINGS = {
  cronKeyHash: "cron_key_hash",
  cronLastRun: "cron_last_run",
  cronLastResult: "cron_last_result",
  teamsWebhook: "teams_webhook",
  stockAlert: "teams_stock_alert",
  lateAlert: "teams_late_alert",
  alertHour: "stock_alert_hour",
  stockLastDay: "stock_alert_last_day",
  portalUrl: "portal_url",
} as const;

export async function getSettings(db: Db) {
  try {
    const rows = await db.select().from(appSettings);
    return new Map(rows.map((row) => [row.key, row.value]));
  } catch {
    return new Map<string, string>();
  }
}

export async function setSetting(db: Db, key: string, value: string) {
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}

/** Envia uma mensagem ao canal do Teams (link do Workflow guardado criptografado). */
export async function postToTeams(sealedWebhook: string, payload: unknown) {
  const url = await openSecret(sealedWebhook);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Não foi possível falar com o Teams (sem internet ou link errado).");
  }
  if (!response.ok) throw new Error(`O Teams recusou a mensagem (erro ${response.status}). Confira se o Workflow do canal está ativo.`);
}

const dayLabel = (day: string) => day.split("-").reverse().join("/");
const stockLink = (portalUrl: string | null) => (portalUrl ? `${portalUrl.replace(/\/$/, "")}/painel` : null);

/** Alerta diário de estoque baixo no Teams (uma vez por dia, a partir da hora escolhida). */
export async function stockAlert(db: Db, now: Date, settings: Map<string, string>, force = false) {
  const webhook = settings.get(SETTINGS.teamsWebhook);
  if (!webhook) return { sent: false, reason: "Teams não configurado" };
  if (!force && settings.get(SETTINGS.stockAlert) === "0") return { sent: false, reason: "alerta desligado" };
  const hour = Number(settings.get(SETTINGS.alertHour) ?? 9);
  const lastDay = settings.get(SETTINGS.stockLastDay) ?? null;
  if (!force && !dailyDue(lastDay, now, Number.isFinite(hour) ? hour : 9)) return { sent: false, reason: "fora do horário ou já enviado hoje" };
  const rows = await db.select({ name: items.name, unopened: items.unopenedQty, opened: items.openedQty, minimum: items.minimumQty, unit: items.unit }).from(items);
  const low = rows.filter((row) => row.unopened + row.opened <= row.minimum).map((row) => ({ name: row.name, available: row.unopened + row.opened, minimum: row.minimum, unit: row.unit }));
  if (!low.length && !force) return { sent: false, reason: "nada para repor" };
  const { day } = saoPaulo(now);
  // Reserva o dia antes de enviar: se o agendador e o Portal rodarem juntos, só um envia.
  if (!force) {
    await db.insert(appSettings).values({ key: SETTINGS.stockLastDay, value: "", updatedAt: now.toISOString() }).onConflictDoNothing();
    const claimed = await db.update(appSettings).set({ value: day, updatedAt: now.toISOString() })
      .where(and(eq(appSettings.key, SETTINGS.stockLastDay), sql`${appSettings.value} <> ${day}`)).returning({ key: appSettings.key });
    if (!claimed.length) return { sent: false, reason: "já enviado hoje" };
  }
  try {
    await postToTeams(webhook, stockAlertCard(low, stockLink(settings.get(SETTINGS.portalUrl) ?? null), dayLabel(day)));
  } catch (error) {
    // Falhou: libera o dia para tentar de novo na próxima rodada.
    if (!force) await setSetting(db, SETTINGS.stockLastDay, lastDay ?? "");
    throw error;
  }
  return { sent: true, items: low.length };
}

/**
 * Chamados que passaram do prazo (resposta ou solução): avisa os líderes do time no sino
 * (e no Teams, se ligado). Cada chamado é avisado uma vez só.
 */
export async function lateTicketsAlert(db: Db, now: Date, settings: Map<string, string>) {
  const active = await db.select().from(tickets).where(and(inArray(tickets.status, ["open", "in_progress", "waiting"]), isNull(tickets.lateAlertedAt))).limit(200);
  const late = active.filter((ticket) => isTicketLate(ticket, now)).slice(0, 50);
  if (!late.length) return { alerted: 0 };
  const stamp = now.toISOString();
  const [teamRows, leads, admins] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams),
    db.select({ teamId: teamMembers.teamId, memberId: teamMembers.memberId }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.isLead, true), eq(members.active, true))),
    db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true))),
  ]);
  const teamName = new Map(teamRows.map((team) => [team.id, team.name]));
  const fresh: LateTicket[] = [];
  for (const ticket of late) {
    // Reserva o aviso deste chamado (se outra rodada já reservou, pula).
    const claimed = await db.update(tickets).set({ lateAlertedAt: stamp }).where(and(eq(tickets.id, ticket.id), isNull(tickets.lateAlertedAt))).returning({ id: tickets.id });
    if (!claimed.length) continue;
    const response = slaStatus(ticket, now);
    const solve = resolutionStatus(ticket, now);
    const reason: LateTicket["reason"] = response.state === "breached" ? "resposta" : "solução";
    const overdue = reason === "resposta" ? -response.minutesLeft : -(solve?.minutesLeft ?? 0);
    fresh.push({ code: ticketCode(ticket.id), title: ticket.title, client: ticket.client, team: ticket.teamId ? teamName.get(ticket.teamId) ?? "" : "", reason, overdueMinutes: overdue });
    // Líderes do time do chamado; sem líder, os administradores.
    const recipients = [...new Set([...leads.filter((lead) => lead.teamId === ticket.teamId).map((lead) => lead.memberId), ...(ticket.assigneeId ? [ticket.assigneeId] : [])])];
    const targets = recipients.length ? recipients : admins.map((admin) => admin.id);
    if (targets.length) {
      try {
        await db.insert(notifications).values(targets.map((memberId) => ({ memberId, kind: "ticket_late" as const, ticketId: ticket.id, body: `${ticketCode(ticket.id)} · ${ticket.title}`.slice(0, 140), actorName: "Portal", createdAt: stamp })));
      } catch (error) {
        console.error("late notification failed", error);
      }
    }
  }
  let teamsSent = false;
  const webhook = settings.get(SETTINGS.teamsWebhook);
  if (fresh.length && webhook && settings.get(SETTINGS.lateAlert) === "1") {
    const portal = settings.get(SETTINGS.portalUrl);
    await postToTeams(webhook, lateTicketsCard(fresh, portal ? `${portal.replace(/\/$/, "")}/painel` : null));
    teamsSent = true;
  }
  return { alerted: fresh.length, teamsSent };
}

/** Uma rodada completa. Cada parte é independente: o erro de uma não impede as outras. */
export async function runJobs(db: Db, options: { now?: Date; includeJira?: boolean; recordRun?: boolean } = {}) {
  const now = options.now ?? new Date();
  const settings = await getSettings(db);
  const result: { jira: { name: string; created: number; updated: number; comments: number; error: string | null }[]; stock: unknown; late: unknown; errors: string[] } = { jira: [], stock: null, late: null, errors: [] };
  if (options.includeJira !== false) {
    try {
      result.jira = (await syncDue(db, false, now)).map((entry) => ({ name: entry.name, created: entry.created, updated: entry.updated, comments: entry.comments, error: entry.error }));
    } catch (error) {
      result.errors.push(`Jira: ${error instanceof Error ? error.message : "erro"}`);
    }
  }
  try { result.stock = await stockAlert(db, now, settings); } catch (error) { result.errors.push(`Estoque: ${error instanceof Error ? error.message : "erro"}`); }
  try { result.late = await lateTicketsAlert(db, now, settings); } catch (error) { result.errors.push(`Atrasos: ${error instanceof Error ? error.message : "erro"}`); }
  if (options.recordRun) {
    try {
      await setSetting(db, SETTINGS.cronLastRun, now.toISOString());
      await setSetting(db, SETTINGS.cronLastResult, JSON.stringify(result).slice(0, 2000));
    } catch (error) {
      console.error("cron record failed", error);
    }
  }
  return result;
}
