// Monitor de sistemas no ar: verifica as URLs marcadas para monitorar e avisa quando caem ou voltam.
// Roda junto com as rotinas automáticas, enquanto alguém da equipe está com o Portal aberto.
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { getDb } from "../db";
import { clients, clientSystems, incidents, incidentUpdates, members, notifications, systemEvents, teamMembers } from "../db/schema";
import { CHECK_EVERY_MS, isUpStatus, monitorTransition, systemUrlError } from "./office-tools";

type Db = ReturnType<typeof getDb>;
type SystemRow = typeof clientSystems.$inferSelect;

const TIMEOUT_MS = 8000;

/** Uma requisição ao endereço: no ar se responder abaixo de 500 dentro do tempo limite. */
export async function probe(url: string) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, headers: { "User-Agent": "PortalDaEquipe-Monitor/1.0", Accept: "text/html,*/*" } });
    try { await response.body?.cancel(); } catch { /* corpo não interessa */ }
    const ms = Date.now() - started;
    return isUpStatus(response.status) ? { ok: true, ms, error: null } : { ok: false, ms, error: `Respondeu com erro ${response.status}` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, ms: Date.now() - started, error: aborted ? `Sem resposta em ${TIMEOUT_MS / 1000} s` : "Não foi possível conectar" };
  } finally {
    clearTimeout(timer);
  }
}

/** Quem recebe o aviso: o time dono do sistema (ou, sem time, os administradores). */
async function recipients(db: Db, teamId: number | null) {
  if (teamId) {
    const rows = await db.select({ id: members.id }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.teamId, teamId), eq(members.active, true)));
    if (rows.length) return rows.map((row) => row.id);
  }
  return (await db.select({ id: members.id }).from(members).where(and(eq(members.role, "admin"), eq(members.active, true)))).map((row) => row.id);
}

/** Caiu: abre um incidente (se não houver um aberto). Voltou: marca o incidente aberto como resolvido. */
async function recordIncident(db: Db, system: SystemRow, change: "down" | "up", error: string | null, stamp: string) {
  const [open] = await db.select({ id: incidents.id }).from(incidents).where(and(eq(incidents.systemId, system.id), eq(incidents.status, "open"))).limit(1);
  if (change === "down") {
    if (open) return;
    const [created] = await db.insert(incidents).values({ clientId: system.clientId, systemId: system.id, title: `${system.name} fora do ar`.slice(0, 140), severity: "high", status: "open", startedAt: stamp, auto: true, createdByName: "Monitor", createdAt: stamp, updatedAt: stamp }).returning({ id: incidents.id });
    await db.insert(incidentUpdates).values({ incidentId: created.id, body: `Detectado pelo monitor: ${error ?? "sem resposta"}.`, byName: "Monitor", at: stamp });
    return;
  }
  if (!open) return;
  await db.update(incidents).set({ status: "resolved", resolvedAt: stamp, updatedAt: stamp }).where(eq(incidents.id, open.id));
  await db.insert(incidentUpdates).values({ incidentId: open.id, body: "Voltou ao ar (monitor). Falta registrar a causa e o que muda para não repetir.", byName: "Monitor", at: stamp });
}

/** Verifica um sistema agora, grava o resultado e avisa se caiu ou voltou. */
export async function checkSystem(db: Db, system: SystemRow, now = new Date()) {
  if (!system.url || systemUrlError(system.url)) return null;
  const result = await probe(system.url);
  const next = monitorTransition({ status: system.status, failCount: system.failCount }, result.ok);
  const stamp = now.toISOString();
  await db.update(clientSystems).set({
    status: next.status, failCount: next.failCount, lastCheckedAt: stamp, lastMs: result.ms, lastError: result.error,
    ...(next.changed || (system.status === "unknown" && next.status !== "unknown") ? { lastChangeAt: stamp } : {}),
  }).where(eq(clientSystems.id, system.id));
  if (next.changed) {
    await db.insert(systemEvents).values({ systemId: system.id, kind: next.changed, detail: result.error ?? `${result.ms} ms`, at: stamp });
    await recordIncident(db, system, next.changed, result.error, stamp).catch((error) => console.error("monitor incident failed", error));
    const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, system.clientId)).limit(1);
    const label = `${client?.name ?? "Cliente"} · ${system.name}`.slice(0, 140);
    const ids = await recipients(db, system.teamId);
    if (ids.length) {
      try {
        await db.insert(notifications).values(ids.map((memberId) => ({ memberId, kind: next.changed === "down" ? "system_down" as const : "system_up" as const, actorName: "Monitor", body: label, createdAt: stamp })));
      } catch (error) {
        console.error("monitor notification failed", error);
      }
    }
  }
  return { ...result, status: next.status, changed: next.changed };
}

/** Rodada do monitor: até 10 sistemas cuja última verificação tem mais de 5 minutos. */
export async function monitorJob(db: Db, now = new Date()) {
  const limit = new Date(now.getTime() - CHECK_EVERY_MS).toISOString();
  const due = await db.select().from(clientSystems).where(and(eq(clientSystems.monitor, true), or(isNull(clientSystems.lastCheckedAt), lt(clientSystems.lastCheckedAt, limit)))).limit(10);
  if (!due.length) return { checked: 0 };
  const stamp = now.toISOString();
  // Reserva cada verificação (outra aba ou pessoa pode estar rodando a mesma rodada).
  const claimed: SystemRow[] = [];
  for (const system of due) {
    const condition = system.lastCheckedAt ? eq(clientSystems.lastCheckedAt, system.lastCheckedAt) : isNull(clientSystems.lastCheckedAt);
    const rows = await db.update(clientSystems).set({ lastCheckedAt: stamp }).where(and(eq(clientSystems.id, system.id), condition)).returning({ id: clientSystems.id });
    if (rows.length) claimed.push(system);
  }
  const results = await Promise.all(claimed.map((system) => checkSystem(db, system, now).catch((error) => { console.error("monitor check failed", system.id, error); return null; })));
  return { checked: results.filter(Boolean).length, down: results.filter((result) => result?.status === "down").length };
}

/** Sistemas monitorados fora do ar agora (para a lista de clientes). */
export async function downSystems(db: Db) {
  return db.select({ id: clientSystems.id, name: clientSystems.name, clientId: clientSystems.clientId, clientName: clients.name, since: clientSystems.lastChangeAt, error: clientSystems.lastError })
    .from(clientSystems).innerJoin(clients, eq(clientSystems.clientId, clients.id))
    .where(and(eq(clientSystems.monitor, true), inArray(clientSystems.status, ["down"])));
}
