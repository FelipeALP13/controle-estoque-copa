// Troca de semana na escala de atendimento: alguém da equipe pede para trocar duas semanas (de equipes diferentes),
// quem gerencia a escala aprova ou recusa. Aprovado, as duas semanas trocam de equipe na hora.
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, notifications, shiftSwaps, supportTeams, supportWeeks } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { hasPermission } from "../../member-permissions";

type Db = ReturnType<typeof getDb>;
const MAX_REASON = 300;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const canManage = (member: SessionMember) => member.role === "admin" || hasPermission(member, "manageSchedule");
const shortDate = (value: string) => value.split("-").reverse().slice(0, 2).join("/");
const weekLabel = (week: { startDate: string; endDate: string }, teamName: string) => `${teamName} (${shortDate(week.startDate)} a ${shortDate(week.endDate)})`;

async function notify(db: Db, memberIds: number[], actorName: string, body: string) {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return;
  const createdAt = new Date().toISOString();
  for (let index = 0; index < ids.length; index += 20) await db.insert(notifications).values(ids.slice(index, index + 20).map((memberId) => ({ memberId, kind: "shift_swap" as const, actorName, body: body.slice(0, 300), createdAt })));
}

/** Quem gerencia a escala (permissão "Editar a escala") e os administradores. */
async function managers(db: Db) {
  const rows = await db.select().from(members).where(eq(members.active, true));
  return rows.filter((row) => row.role === "admin" || hasPermission(row, "manageSchedule")).map((row) => row.id);
}

async function weeksWithTeams(db: Db, ids: number[]) {
  if (!ids.length) return new Map<number, { id: number; startDate: string; endDate: string; teamId: number; teamName: string }>();
  const rows = await db.select({ id: supportWeeks.id, startDate: supportWeeks.startDate, endDate: supportWeeks.endDate, teamId: supportWeeks.teamId, teamName: supportTeams.name })
    .from(supportWeeks).innerJoin(supportTeams, eq(supportTeams.id, supportWeeks.teamId)).where(inArray(supportWeeks.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const rows = await db.select().from(shiftSwaps).where(or(eq(shiftSwaps.status, "pending"), gte(shiftSwaps.createdAt, since))).orderBy(desc(shiftSwaps.id)).limit(50);
    const weeks = await weeksWithTeams(db, rows.flatMap((row) => [row.fromWeekId, row.toWeekId]));
    const manager = canManage(member);
    return json({
      canManage: manager,
      canRequest: member.role !== "viewer",
      swaps: rows.filter((row) => weeks.has(row.fromWeekId) && weeks.has(row.toWeekId)).map((row) => ({
        id: row.id, status: row.status, reason: row.reason, requesterName: row.requesterName, createdAt: row.createdAt, decidedByName: row.decidedByName, decisionNote: row.decisionNote,
        from: weeks.get(row.fromWeekId), to: weeks.get(row.toWeekId),
        canDecide: row.status === "pending" && manager,
        canCancel: row.status === "pending" && row.requesterId === member.id,
      })),
    });
  } catch (error) {
    console.error("shift swaps request failed", error);
    return json({ error: "Não foi possível carregar as trocas agora." }, 500);
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

    if (action === "requestSwap") {
      const fromWeekId = Number(body.fromWeekId);
      const toWeekId = Number(body.toWeekId);
      const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
      if (!fromWeekId || !toWeekId || fromWeekId === toWeekId) return json({ error: "Escolha duas semanas diferentes." }, 400);
      const weeks = await weeksWithTeams(db, [fromWeekId, toWeekId]);
      const from = weeks.get(fromWeekId);
      const to = weeks.get(toWeekId);
      if (!from || !to) return json({ error: "Semana não encontrada." }, 404);
      if (from.teamId === to.teamId) return json({ error: "As duas semanas são da mesma equipe: escolha uma semana de outra equipe." }, 400);
      if (from.endDate < today() || to.endDate < today()) return json({ error: "Só dá para trocar semanas que ainda não passaram." }, 400);
      if (!reason) return json({ error: "Conte o motivo da troca (ajuda quem vai aprovar)." }, 400);
      const open = await db.select({ id: shiftSwaps.id }).from(shiftSwaps).where(and(eq(shiftSwaps.status, "pending"), or(inArray(shiftSwaps.fromWeekId, [fromWeekId, toWeekId]), inArray(shiftSwaps.toWeekId, [fromWeekId, toWeekId])))).limit(1);
      if (open.length) return json({ error: "Já existe um pedido de troca aguardando aprovação para uma dessas semanas." }, 409);
      const [created] = await db.insert(shiftSwaps).values({ fromWeekId, toWeekId, requesterId: member.id, requesterName: member.name, reason, createdAt: new Date().toISOString() }).returning();
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "shift_swap_requested", targetType: "schedule", targetId: created.id, details: `${weekLabel(from, from.teamName)} ⇄ ${weekLabel(to, to.teamName)}` }).catch((error) => console.error("audit log failed", error));
      await notify(db, (await managers(db)).filter((id) => id !== member.id), member.name, `${member.name} pediu para trocar ${weekLabel(from, from.teamName)} com ${weekLabel(to, to.teamName)}: "${reason}"`).catch((error) => console.error("swap notify failed", error));
      return json({ swap: created }, 201);
    }

    const swapId = Number(body.swapId);
    const [swap] = swapId ? await db.select().from(shiftSwaps).where(eq(shiftSwaps.id, swapId)).limit(1) : [];
    if (!swap) return json({ error: "Pedido de troca não encontrado." }, 404);
    if (swap.status !== "pending") return json({ error: "Este pedido já foi decidido." }, 409);

    if (action === "cancelSwap") {
      if (swap.requesterId !== member.id && !canManage(member)) return json({ error: "Só quem pediu cancela o pedido." }, 403);
      await db.update(shiftSwaps).set({ status: "canceled", decidedByName: member.name, decidedAt: new Date().toISOString() }).where(eq(shiftSwaps.id, swap.id));
      return json({ ok: true });
    }

    if (action === "decideSwap") {
      if (!canManage(member)) return json({ error: "Só quem gerencia a escala aprova trocas." }, 403);
      const approve = body.approve === true;
      const note = String(body.note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
      const weeks = await weeksWithTeams(db, [swap.fromWeekId, swap.toWeekId]);
      const from = weeks.get(swap.fromWeekId);
      const to = weeks.get(swap.toWeekId);
      if (!from || !to) return json({ error: "Uma das semanas foi apagada da escala." }, 409);
      const decided = { status: approve ? "approved" as const : "rejected" as const, decidedByName: member.name, decidedAt: new Date().toISOString(), decisionNote: note };
      if (approve) {
        // As duas semanas trocam de equipe e o pedido fecha juntos (tudo ou nada).
        await db.batch([
          db.update(supportWeeks).set({ teamId: to.teamId }).where(eq(supportWeeks.id, from.id)),
          db.update(supportWeeks).set({ teamId: from.teamId }).where(eq(supportWeeks.id, to.id)),
          db.update(shiftSwaps).set(decided).where(and(eq(shiftSwaps.id, swap.id), eq(shiftSwaps.status, "pending"))),
        ]);
      } else {
        await db.update(shiftSwaps).set(decided).where(and(eq(shiftSwaps.id, swap.id), eq(shiftSwaps.status, "pending")));
      }
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: approve ? "shift_swap_approved" : "shift_swap_rejected", targetType: "schedule", targetId: swap.id, details: `${weekLabel(from, from.teamName)} ⇄ ${weekLabel(to, to.teamName)}` }).catch((error) => console.error("audit log failed", error));
      if (swap.requesterId) await notify(db, [swap.requesterId], member.name, `${member.name} ${approve ? "aprovou" : "recusou"} a troca: ${from.teamName} e ${to.teamName} ${approve ? "trocaram as semanas de" : "continuam nas semanas de"} ${shortDate(from.startDate)} e ${shortDate(to.startDate)}${note ? `. "${note}"` : "."}`).catch((error) => console.error("swap notify failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    console.error("shift swaps request failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return json({ error: "O banco ainda não tem as trocas de escala. Publique novamente para aplicar as migrações." }, 500);
    return json({ error: "Não foi possível concluir esta operação agora." }, 500);
  }
}
