import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { assetAssignments, assetEvents, assets, members } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { writeAudit } from "../../audit";
import { parseGoalNumber } from "../../review-tools";
import { assetStatusLabels, isAssetStatus, isIsoDay } from "../../people-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("assets request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem os equipamentos. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const [rows, assignments, people] = await Promise.all([
      db.select().from(assets).orderBy(assets.kind, assets.name),
      db.select().from(assetAssignments),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, active: members.active }).from(members),
    ]);
    const events = isAdmin && rows.length ? await db.select().from(assetEvents).where(inArray(assetEvents.assetId, rows.map((row) => row.id))).orderBy(desc(assetEvents.at)) : [];
    return json({
      // Valor e observações ficam só com os administradores.
      assets: rows.map((row) => ({
        ...row,
        cost: isAdmin ? row.cost : null,
        notes: isAdmin ? row.notes : "",
        memberIds: assignments.filter((entry) => entry.assetId === row.id).map((entry) => entry.memberId),
        events: events.filter((event) => event.assetId === row.id).slice(0, 15),
      })),
      people: people.filter((person) => person.active || assignments.some((entry) => entry.memberId === person.id)),
      me: { id: member.id, isAdmin },
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
    if (member.role !== "admin") return json({ error: "Somente administradores cadastram equipamentos e licenças." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const audit = (name: string, details: string, targetId?: number) => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: name, targetType: "asset", targetId, details }).catch((error) => console.error("audit log failed", error));

    if (action === "saveAsset") {
      const assetId = Number(body.assetId) || 0;
      const kind = body.kind === "license" ? "license" as const : "equipment" as const;
      const name = cleanTitle(body.name).slice(0, 120);
      const seats = kind === "license" ? Math.max(1, Math.min(9999, Math.round(Number(body.seats) || 1))) : 1;
      const purchaseDate = body.purchaseDate ? String(body.purchaseDate) : null;
      const expiresOn = body.expiresOn ? String(body.expiresOn) : null;
      const cost = body.cost === "" || body.cost === null || body.cost === undefined ? null : parseGoalNumber(body.cost);
      const memberIds = [...new Set((Array.isArray(body.memberIds) ? body.memberIds : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
      if (!name) return json({ error: "Dê um nome ao item." }, 400);
      if ((purchaseDate && !isIsoDay(purchaseDate)) || (expiresOn && !isIsoDay(expiresOn))) return json({ error: "Data inválida." }, 400);
      if (cost !== null && cost < 0) return json({ error: "Valor inválido." }, 400);
      if (kind === "equipment" && memberIds.length > 1) return json({ error: "Um equipamento fica com uma pessoa por vez." }, 400);
      if (kind === "license" && memberIds.length > seats) return json({ error: `A licença tem ${seats} ${seats === 1 ? "vaga" : "vagas"}; tire alguém ou aumente as vagas.` }, 400);
      if (memberIds.length) {
        const found = await db.select({ id: members.id }).from(members).where(inArray(members.id, memberIds));
        if (found.length !== memberIds.length) return json({ error: "Pessoa não encontrada." }, 400);
      }
      let status = isAssetStatus(body.status) ? body.status : "available";
      // Com alguém usando, um item disponível passa a "em uso"; sem ninguém, "em uso" volta a disponível.
      if (memberIds.length && status === "available") status = "in_use";
      if (!memberIds.length && status === "in_use") status = "available";
      const values = { kind, name, category: cleanTitle(body.category).slice(0, 60), identifier: cleanTitle(body.identifier).slice(0, 120), status, seats, purchaseDate, expiresOn, cost, notes: cleanMultiline(body.notes, 2000), updatedAt: now };

      const people = await db.select({ id: members.id, name: members.name }).from(members);
      const nameOf = (id: number) => people.find((person) => person.id === id)?.name ?? "Pessoa";
      let id = assetId;
      const log: string[] = [];
      if (assetId) {
        const [current] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
        if (!current) return json({ error: "Item não encontrado." }, 404);
        await db.update(assets).set(values).where(eq(assets.id, assetId));
        if (current.status !== status) log.push(`Situação: ${assetStatusLabels[current.status]} → ${assetStatusLabels[status]}`);
      } else {
        const [created] = await db.insert(assets).values({ ...values, createdAt: now }).returning({ id: assets.id });
        id = created.id;
        log.push("Cadastrado");
      }
      const before = (await db.select({ memberId: assetAssignments.memberId }).from(assetAssignments).where(eq(assetAssignments.assetId, id))).map((row) => row.memberId);
      const added = memberIds.filter((memberId) => !before.includes(memberId));
      const removed = before.filter((memberId) => !memberIds.includes(memberId));
      if (removed.length) await db.delete(assetAssignments).where(and(eq(assetAssignments.assetId, id), inArray(assetAssignments.memberId, removed)));
      if (added.length) await db.insert(assetAssignments).values(added.map((memberId) => ({ assetId: id, memberId, assignedAt: now }))).onConflictDoNothing();
      for (const memberId of added) log.push(`Entregue para ${nameOf(memberId)}`);
      for (const memberId of removed) log.push(`Devolvido por ${nameOf(memberId)}`);
      if (log.length) await db.insert(assetEvents).values(log.map((text) => ({ assetId: id, text, byName: member.name, at: now })));
      await audit("asset_saved", name, id);
      return json({ id }, assetId ? 200 : 201);
    }

    if (action === "deleteAsset") {
      const [current] = await db.select().from(assets).where(eq(assets.id, Number(body.assetId))).limit(1);
      if (!current) return json({ error: "Item não encontrado." }, 404);
      await db.delete(assets).where(eq(assets.id, current.id));
      await audit("asset_deleted", current.name, current.id);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
