import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, clientSystems, incidents, incidentUpdates, members, notifications } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { writeAudit } from "../../audit";
import { localToIso } from "../../agenda";
import { incidentStats, isIncidentStatus, isSeverity, nextIncidentStatus, severityLabels } from "../../people-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("incidents request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem os incidentes. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

/** "AAAA-MM-DDTHH:MM" no horário de Brasília → ISO. */
function parseLocal(value: unknown) {
  const text = String(value ?? "");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text);
  return match ? localToIso(match[1], match[2]) : null;
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const [rows, clientRows, systemRows] = await Promise.all([
      db.select().from(incidents).orderBy(desc(incidents.startedAt)).limit(200),
      db.select({ id: clients.id, name: clients.name, active: clients.active }).from(clients).orderBy(clients.name),
      db.select({ id: clientSystems.id, clientId: clientSystems.clientId, name: clientSystems.name }).from(clientSystems).orderBy(clientSystems.name),
    ]);
    const updates = rows.length ? await db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, rows.map((row) => row.id))).orderBy(desc(incidentUpdates.at)) : [];
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86400000).toISOString();
    return json({
      incidents: rows.map((row) => ({ ...row, updates: updates.filter((update) => update.incidentId === row.id) })),
      clients: clientRows,
      systems: systemRows,
      stats: incidentStats(rows.filter((row) => row.startedAt >= since || row.status !== "analyzed"), now.toISOString()),
      me: { id: member.id, isAdmin: member.role === "admin", canEdit: member.role !== "viewer" },
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
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "saveIncident") {
      const incidentId = Number(body.incidentId) || 0;
      const title = cleanTitle(body.title).slice(0, 140);
      const startedAt = parseLocal(body.startedAt);
      const resolvedAt = body.resolvedAt ? parseLocal(body.resolvedAt) : null;
      const clientId = Number(body.clientId) || null;
      const systemId = Number(body.systemId) || null;
      if (!title) return json({ error: "Descreva o incidente em poucas palavras." }, 400);
      if (!startedAt) return json({ error: "Informe quando começou." }, 400);
      if (body.resolvedAt && !resolvedAt) return json({ error: "Data de término inválida." }, 400);
      if (resolvedAt && resolvedAt < startedAt) return json({ error: "O término precisa ser depois do início." }, 400);
      if (systemId) {
        const [system] = await db.select({ clientId: clientSystems.clientId }).from(clientSystems).where(eq(clientSystems.id, systemId)).limit(1);
        if (!system || (clientId && system.clientId !== clientId)) return json({ error: "Este sistema não é do cliente escolhido." }, 400);
      }
      const texts = { impact: cleanMultiline(body.impact, 2000), cause: cleanMultiline(body.cause, 3000), resolution: cleanMultiline(body.resolution, 3000), prevention: cleanMultiline(body.prevention, 3000) };
      const next = nextIncidentStatus({ status: isIncidentStatus(body.status) ? body.status : "open", resolvedAt, cause: texts.cause, prevention: texts.prevention });
      if (next.error) return json({ error: next.error }, 400);
      const severity = isSeverity(body.severity) ? body.severity : "medium";
      const values = { title, clientId, systemId, severity, status: next.status, startedAt, resolvedAt, ...texts, updatedAt: now };
      if (incidentId) {
        const [current] = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
        if (!current) return json({ error: "Incidente não encontrado." }, 404);
        await db.update(incidents).set(values).where(eq(incidents.id, incidentId));
        if (current.status !== next.status) await db.insert(incidentUpdates).values({ incidentId, body: next.status === "analyzed" ? "Análise concluída" : next.status === "resolved" ? "Marcado como resolvido" : "Reaberto", byName: member.name, at: now });
        return json({ id: incidentId });
      }
      const [created] = await db.insert(incidents).values({ ...values, createdByName: member.name, createdAt: now }).returning({ id: incidents.id });
      // Incidente alto ou crítico aberto à mão: os administradores ficam sabendo.
      if ((severity === "high" || severity === "critical") && next.status === "open") {
        const admins = await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)));
        const targets = admins.filter((admin) => admin.id !== member.id);
        if (targets.length) await db.insert(notifications).values(targets.map((admin) => ({ memberId: admin.id, kind: "incident" as const, actorName: member.name, body: `Incidente ${severityLabels[severity].toLowerCase()}: ${title}`.slice(0, 140), createdAt: now }))).catch((error) => console.error("incident notification failed", error));
      }
      return json({ id: created.id }, 201);
    }

    if (action === "addUpdate") {
      const text = cleanMultiline(body.body, 2000);
      if (!text) return json({ error: "Escreva a atualização." }, 400);
      const [current] = await db.select({ id: incidents.id }).from(incidents).where(eq(incidents.id, Number(body.incidentId))).limit(1);
      if (!current) return json({ error: "Incidente não encontrado." }, 404);
      await db.insert(incidentUpdates).values({ incidentId: current.id, body: text, byName: member.name, at: now });
      await db.update(incidents).set({ updatedAt: now }).where(eq(incidents.id, current.id));
      return json({ ok: true }, 201);
    }

    if (action === "deleteIncident") {
      if (member.role !== "admin") return json({ error: "Somente administradores excluem incidentes." }, 403);
      const [current] = await db.select().from(incidents).where(eq(incidents.id, Number(body.incidentId))).limit(1);
      if (!current) return json({ error: "Incidente não encontrado." }, 404);
      await db.delete(incidents).where(eq(incidents.id, current.id));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "incident_deleted", targetType: "incident", targetId: current.id, details: current.title }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
