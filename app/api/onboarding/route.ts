import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, notifications, onboardingItems, onboardings } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { DEFAULT_ONBOARDING_STEPS, parseSteps } from "../../office-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("onboarding request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a integração de quem chega. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/** Administradores veem todas; as outras pessoas, só a própria integração e as que apadrinham. */
export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const rows = (await db.select().from(onboardings).orderBy(desc(onboardings.startDate), desc(onboardings.id)).limit(100))
      .filter((row) => isAdmin || row.memberId === member.id || row.buddyId === member.id);
    const items = rows.length ? await db.select().from(onboardingItems).where(inArray(onboardingItems.onboardingId, rows.map((row) => row.id))).orderBy(asc(onboardingItems.sortOrder), asc(onboardingItems.id)) : [];
    const people = await db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey, active: members.active }).from(members).orderBy(asc(members.name));
    return json({
      onboardings: rows.map((row) => ({ ...row, canEdit: isAdmin || row.buddyId === member.id, canCheck: member.role !== "viewer" && (isAdmin || row.buddyId === member.id || row.memberId === member.id), items: items.filter((item) => item.onboardingId === row.id) })),
      people: people.filter((person) => person.active),
      defaultSteps: DEFAULT_ONBOARDING_STEPS,
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
    if (member.role === "viewer") return json({ error: "Seu perfil pode apenas visualizar." }, 403);
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const isAdmin = member.role === "admin";

    if (action === "createOnboarding") {
      if (!isAdmin) return json({ error: "Somente administradores começam uma integração." }, 403);
      const memberId = Number(body.memberId);
      const buddyId = Number(body.buddyId) || null;
      if (!isDate(body.startDate)) return json({ error: "Informe o primeiro dia." }, 400);
      const steps = parseSteps(body.steps);
      if (!steps.length) return json({ error: "Escreva pelo menos um passo." }, 400);
      if (buddyId === memberId) return json({ error: "O padrinho precisa ser outra pessoa." }, 400);
      const ids = [memberId, ...(buddyId ? [buddyId] : [])];
      const found = await db.select({ id: members.id, name: members.name }).from(members).where(and(inArray(members.id, ids), eq(members.active, true)));
      const newcomer = found.find((person) => person.id === memberId);
      if (!newcomer || (buddyId && !found.some((person) => person.id === buddyId))) return json({ error: "Escolha pessoas ativas." }, 400);
      const [existing] = await db.select({ id: onboardings.id }).from(onboardings).where(and(eq(onboardings.memberId, memberId), eq(onboardings.status, "active"))).limit(1);
      if (existing) return json({ error: `${newcomer.name} já tem uma integração em andamento.` }, 409);
      const [row] = await db.insert(onboardings).values({ memberId, buddyId, startDate: body.startDate, createdByName: member.name, createdAt: now }).returning({ id: onboardings.id });
      await db.insert(onboardingItems).values(steps.map((text, index) => ({ onboardingId: row.id, text, sortOrder: index + 1 })));
      const first = newcomer.name.split(/\s+/)[0];
      const alerts = [
        { memberId, body: `Bem-vindo(a), ${first}! Sua lista de primeiros passos está em Pessoas → Integração.` },
        ...(buddyId ? [{ memberId: buddyId, body: `Você é padrinho(a) de ${newcomer.name} na integração.` }] : []),
      ].filter((alert) => alert.memberId !== member.id);
      if (alerts.length) await db.insert(notifications).values(alerts.map((alert) => ({ ...alert, kind: "onboarding" as const, actorName: member.name, createdAt: now }))).catch((error) => console.error("onboarding notification failed", error));
      return json({ id: row.id }, 201);
    }

    const itemId = Number(body.itemId);
    const [item] = itemId ? await db.select().from(onboardingItems).where(eq(onboardingItems.id, itemId)).limit(1) : [];
    const onboardingId = Number(body.onboardingId) || item?.onboardingId || 0;
    const [row] = onboardingId ? await db.select().from(onboardings).where(eq(onboardings.id, onboardingId)).limit(1) : [];
    if (!row) return json({ error: "Integração não encontrada." }, 404);
    const canEdit = isAdmin || row.buddyId === member.id;
    const canCheck = canEdit || row.memberId === member.id;

    if (action === "toggleItem") {
      if (!item) return json({ error: "Passo não encontrado." }, 404);
      if (!canCheck) return json({ error: "Só quem está chegando, o padrinho e administradores marcam os passos." }, 403);
      const done = body.done === true;
      await db.update(onboardingItems).set({ done, doneByName: done ? member.name : null, doneAt: done ? now : null }).where(eq(onboardingItems.id, item.id));
      return json({ ok: true });
    }

    if (!canEdit) return json({ error: "Só o padrinho e administradores alteram a integração." }, 403);

    if (action === "addItem") {
      const [text] = parseSteps(body.text);
      if (!text) return json({ error: "Escreva o passo." }, 400);
      const [last] = await db.select({ value: max(onboardingItems.sortOrder) }).from(onboardingItems).where(eq(onboardingItems.onboardingId, onboardingId));
      await db.insert(onboardingItems).values({ onboardingId, text, sortOrder: (last?.value ?? 0) + 1 });
      return json({ ok: true }, 201);
    }

    if (action === "deleteItem") {
      if (!item) return json({ error: "Passo não encontrado." }, 404);
      await db.delete(onboardingItems).where(eq(onboardingItems.id, item.id));
      return json({ ok: true });
    }

    if (action === "finish" || action === "reopen") {
      await db.update(onboardings).set(action === "finish" ? { status: "done", completedAt: now } : { status: "active", completedAt: null }).where(eq(onboardings.id, onboardingId));
      return json({ ok: true });
    }

    if (action === "deleteOnboarding") {
      if (!isAdmin) return json({ error: "Somente administradores excluem." }, 403);
      await db.delete(onboardings).where(eq(onboardings.id, onboardingId));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
