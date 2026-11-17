import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatChannels, copaRequests, copaRequestVotes, items, members } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { hasPermission } from "../../member-permissions";
import { findSameRequest, MAX_REQUEST_NOTE, parseCopaAlerts, requestTitleError, sortRequests } from "../../copa-tools";
import { buyerIds, loadCopaAlerts, notifyCopa, saveCopaAlerts } from "../../copa-alerts";

type Db = ReturnType<typeof getDb>;

/** Pedidos abertos por pessoa ao mesmo tempo (evita encher a lista). */
const MAX_OPEN_PER_PERSON = 15;
/** Pedidos decididos que continuam aparecendo (histórico recente). */
const DECIDED_SHOWN = 30;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  console.error("copa request failed", error);
  if (message.includes("no such table")) return json({ error: "O banco ainda não tem os pedidos da Copa. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
/** Decide pedidos e configura os avisos: quem pode cadastrar itens no estoque. */
const canManage = (member: SessionMember) => hasPermission(member, "manageItems");

async function audit(db: Db, member: SessionMember, action: string, targetId: number | undefined, details: string) {
  await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action, targetType: "copa_request", targetId, details }).catch((error) => console.error("audit log failed", error));
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    const manager = canManage(member);
    const [open, decided] = await Promise.all([
      db.select().from(copaRequests).where(eq(copaRequests.status, "open")),
      db.select().from(copaRequests).where(sql`${copaRequests.status} <> 'open'`).orderBy(desc(copaRequests.decidedAt)).limit(DECIDED_SHOWN),
    ]);
    const rows = [...open, ...decided];
    const ids = rows.map((row) => row.id);
    const itemIds = [...new Set(rows.map((row) => row.itemId).filter((id): id is number => Boolean(id)))];
    const [votes, linked, alerts] = await Promise.all([
      ids.length ? db.select().from(copaRequestVotes).where(inArray(copaRequestVotes.requestId, ids)) : Promise.resolve([]),
      itemIds.length ? db.select({ id: items.id, name: items.name }).from(items).where(inArray(items.id, itemIds)) : Promise.resolve([]),
      manager ? loadCopaAlerts(db) : Promise.resolve(null),
    ]);
    const people = await db.select({ id: members.id, name: members.name, active: members.active }).from(members);
    const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Alguém";
    const list = sortRequests(rows.map((row) => {
      const voters = votes.filter((vote) => vote.requestId === row.id).map((vote) => vote.memberId);
      return {
        id: row.id, title: row.title, note: row.note, status: row.status,
        createdByName: row.createdByName, createdAt: row.createdAt, mine: row.createdById === member.id,
        votes: voters.length, voted: voters.includes(member.id),
        voters: voters.map(nameOf).sort((a, b) => a.localeCompare(b, "pt-BR")),
        decidedByName: row.decidedByName, decidedAt: row.decidedAt, decisionNote: row.decisionNote,
        item: row.itemId ? linked.find((item) => item.id === row.itemId) ?? null : null,
        canDelete: row.status === "open" && (manager || row.createdById === member.id),
      };
    }));
    let settings = null;
    if (manager && alerts) {
      const [channels, buyers] = await Promise.all([
        db.select({ id: chatChannels.id, name: chatChannels.name }).from(chatChannels).where(and(eq(chatChannels.kind, "channel"), eq(chatChannels.archived, false))).orderBy(chatChannels.name),
        buyerIds(db, alerts),
      ]);
      settings = {
        memberIds: alerts.memberIds, channelId: alerts.channelId, channels,
        people: people.filter((person) => person.active).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        // Quem recebe agora (sem escolha, os administradores).
        receivers: buyers.map(nameOf),
      };
    }
    return json({ requests: list, me: { id: member.id, canRequest: member.role !== "viewer", canDecide: manager }, settings });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (!member.active) return json({ error: "Seu acesso ao sistema está desativado." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const manager = canManage(member);

    const requestFor = async (id: unknown) => {
      const [row] = await db.select().from(copaRequests).where(eq(copaRequests.id, Number(id))).limit(1);
      return row ?? null;
    };

    if (action === "saveAlerts") {
      if (!manager) return json({ error: "Só quem cadastra itens da Copa configura os avisos." }, 403);
      const alerts = parseCopaAlerts({ memberIds: body.memberIds, channelId: body.channelId });
      if (alerts.memberIds.length) {
        const found = await db.select({ id: members.id }).from(members).where(and(inArray(members.id, alerts.memberIds), eq(members.active, true)));
        alerts.memberIds = found.map((row) => row.id);
      }
      if (alerts.channelId) {
        const [channel] = await db.select().from(chatChannels).where(eq(chatChannels.id, alerts.channelId)).limit(1);
        if (!channel || channel.kind !== "channel" || channel.archived) return json({ error: "Escolha um canal do chat que esteja ativo." }, 400);
      }
      await saveCopaAlerts(db, alerts);
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "copa_alerts_saved", targetType: "settings", details: `${alerts.memberIds.length} pessoas${alerts.channelId ? " e canal do chat" : ""}` }).catch(() => undefined);
      return json({ ok: true });
    }

    if (action === "createRequest") {
      if (member.role === "viewer") return json({ error: "Seu acesso é só de leitura." }, 403);
      const titleError = requestTitleError(String(body.title ?? ""));
      if (titleError) return json({ error: titleError }, 400);
      const title = clean(body.title, 80);
      const note = String(body.note ?? "").replace(/\r\n/g, "\n").trim().slice(0, MAX_REQUEST_NOTE);
      const open = await db.select({ id: copaRequests.id, title: copaRequests.title, status: copaRequests.status, createdById: copaRequests.createdById }).from(copaRequests).where(eq(copaRequests.status, "open"));
      const same = findSameRequest(open, title);
      if (same) return json({ error: "Alguém já pediu isso. Apoie o pedido que está na lista.", requestId: same.id }, 409);
      if (open.filter((row) => row.createdById === member.id).length >= MAX_OPEN_PER_PERSON) return json({ error: `Você já tem ${MAX_OPEN_PER_PERSON} pedidos aguardando. Espere alguns serem decididos.` }, 429);
      const [created] = await db.insert(copaRequests).values({ title, note, createdById: member.id, createdByName: member.name, createdAt: now }).returning();
      await db.insert(copaRequestVotes).values({ requestId: created.id, memberId: member.id }).onConflictDoNothing();
      const buyers = (await buyerIds(db, await loadCopaAlerts(db))).filter((id) => id !== member.id);
      await notifyCopa(db, buyers, member.name, `${member.name} pediu para a Copa: ${title}`);
      await audit(db, member, "copa_request_created", created.id, title);
      return json({ request: created }, 201);
    }

    if (action === "vote") {
      if (member.role === "viewer") return json({ error: "Seu acesso é só de leitura." }, 403);
      const row = await requestFor(body.requestId);
      if (!row) return json({ error: "Pedido não encontrado." }, 404);
      if (row.status !== "open") return json({ error: "Este pedido já foi decidido." }, 409);
      if (row.createdById === member.id) return json({ error: "Quem pediu já conta como apoio." }, 400);
      if (body.on === false) await db.delete(copaRequestVotes).where(and(eq(copaRequestVotes.requestId, row.id), eq(copaRequestVotes.memberId, member.id)));
      else await db.insert(copaRequestVotes).values({ requestId: row.id, memberId: member.id }).onConflictDoNothing();
      return json({ ok: true });
    }

    if (action === "decide") {
      if (!manager) return json({ error: "Só quem cadastra itens da Copa aprova ou recusa pedidos." }, 403);
      const row = await requestFor(body.requestId);
      if (!row) return json({ error: "Pedido não encontrado." }, 404);
      if (row.status !== "open") return json({ error: "Este pedido já foi decidido." }, 409);
      const approve = body.decision === "approve";
      if (!approve && body.decision !== "decline") return json({ error: "Decisão inválida." }, 400);
      const decisionNote = clean(body.note, 200);
      let itemId: number | null = null;
      let itemName = "";
      if (approve) {
        if (body.itemId) {
          const [item] = await db.select({ id: items.id, name: items.name }).from(items).where(eq(items.id, Number(body.itemId))).limit(1);
          if (!item) return json({ error: "Item do estoque não encontrado." }, 404);
          itemId = item.id;
          itemName = item.name;
        } else {
          const name = clean(body.name, 80) || row.title;
          const category = clean(body.category, 40) || "Outros";
          const unit = clean(body.unit, 20) || "un.";
          const minimumQty = Math.max(0, Math.min(10000, Number(body.minimumQty) || 1));
          const [existing] = await db.select({ id: items.id }).from(items).where(sql`lower(${items.name}) = lower(${name})`).limit(1);
          if (existing) return json({ error: `Já existe "${name}" no estoque. Escolha ligar ao item existente.` }, 409);
          const [item] = await db.insert(items).values({ name, category, unit, minimumQty, icon: "📦" }).returning();
          itemId = item.id;
          itemName = item.name;
          await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "item_created", targetType: "item", targetId: item.id, details: `${item.name} (pedido da equipe)` }).catch(() => undefined);
        }
      }
      // Só decide se continua aberto (duas pessoas decidindo ao mesmo tempo).
      const [updated] = await db.update(copaRequests).set({ status: approve ? "approved" : "declined", itemId, decidedByName: member.name, decisionNote, decidedAt: now })
        .where(and(eq(copaRequests.id, row.id), eq(copaRequests.status, "open"))).returning({ id: copaRequests.id });
      if (!updated) return json({ error: "Este pedido já foi decidido." }, 409);
      const voters = (await db.select({ memberId: copaRequestVotes.memberId }).from(copaRequestVotes).where(eq(copaRequestVotes.requestId, row.id))).map((vote) => vote.memberId);
      const audience = [row.createdById, ...voters].filter((id): id is number => typeof id === "number" && id !== member.id);
      const text = approve ? `Pedido aprovado: ${row.title}${itemName && itemName !== row.title ? ` (entra no estoque como ${itemName})` : ""}` : `Pedido recusado: ${row.title}${decisionNote ? ` · ${decisionNote}` : ""}`;
      await notifyCopa(db, audience, member.name, text);
      await audit(db, member, approve ? "copa_request_approved" : "copa_request_declined", row.id, row.title);
      return json({ ok: true, itemId });
    }

    if (action === "deleteRequest") {
      const row = await requestFor(body.requestId);
      if (!row) return json({ error: "Pedido não encontrado." }, 404);
      if (row.status !== "open") return json({ error: "Pedidos decididos ficam no histórico." }, 409);
      if (!manager && row.createdById !== member.id) return json({ error: "Só quem pediu pode tirar o pedido." }, 403);
      await db.delete(copaRequests).where(eq(copaRequests.id, row.id));
      await audit(db, member, "copa_request_deleted", row.id, row.title);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
