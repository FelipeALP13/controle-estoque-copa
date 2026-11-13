import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { devActions, members, notifications, oneOnOnes, reviewAnswers, reviewCycles } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { leaderScope } from "../../team-scope";
import { summarize } from "../../review-tools";
import { isDevStatus, isIsoDay } from "../../people-tools";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("one-on-ones request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem o 1:1. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const shortDate = (day: string) => day.split("-").reverse().join("/");

export async function GET() {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const scope = await leaderScope(db, member.id, isAdmin);
    const people = await db.select({ id: members.id, name: members.name, jobTitle: members.jobTitle, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true));
    const reports = people.filter((person) => person.id !== member.id && scope.canManagePerson(person.id));
    const visibleIds = [member.id, ...reports.map((person) => person.id)];

    const [meetings, actions] = await Promise.all([
      db.select().from(oneOnOnes).where(or(eq(oneOnOnes.leaderId, member.id), inArray(oneOnOnes.memberId, visibleIds))).orderBy(desc(oneOnOnes.date)).limit(300),
      db.select().from(devActions).where(inArray(devActions.memberId, visibleIds)).orderBy(desc(devActions.updatedAt)),
    ]);

    // Médias do último ciclo encerrado (sem comentários): a pessoa vê as dela; o líder, as de quem lidera.
    const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.status, "closed")).orderBy(desc(reviewCycles.endDate)).limit(1);
    let insights: { memberId: number; cycleTitle: string; count: number; hidden: boolean; averages: { criterion: string; average: number }[]; overall: number | null }[] = [];
    if (cycle) {
      let criteria: string[] = [];
      try { criteria = JSON.parse(cycle.peerCriteria) as string[]; } catch { criteria = []; }
      const answers = await db.select({ target: reviewAnswers.target, scores: reviewAnswers.scores }).from(reviewAnswers).where(and(eq(reviewAnswers.cycleId, cycle.id), inArray(reviewAnswers.target, visibleIds.map((id) => `member:${id}`))));
      insights = visibleIds.map((id) => {
        const mine = answers.filter((answer) => answer.target === `member:${id}`).map((answer) => { try { return { scores: JSON.parse(answer.scores) as number[], comment: "" }; } catch { return { scores: [], comment: "" }; } });
        const result = summarize(mine, criteria);
        return { memberId: id, cycleTitle: cycle.title, count: result.count, hidden: result.hidden, averages: result.averages, overall: result.overall };
      });
    }

    return json({
      meetings: meetings.filter((row) => row.leaderId === member.id || row.memberId === member.id || scope.canManagePerson(row.memberId)).map((row) => ({
        ...row,
        privateNotes: row.leaderId === member.id ? row.privateNotes : undefined,
        canEdit: row.leaderId === member.id || scope.canManagePerson(row.memberId) || row.memberId === member.id,
        isLeader: row.leaderId === member.id || scope.canManagePerson(row.memberId),
      })),
      actions,
      people: people.map((person) => ({ id: person.id, name: person.name, jobTitle: person.jobTitle, avatarIcon: person.avatarIcon, avatarKey: person.avatarKey })),
      reports: reports.map((person) => person.id),
      insights,
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
    const isAdmin = member.role === "admin";
    const body = await readJsonBody(request);
    if (body instanceof Response) return body;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();
    const scope = await leaderScope(db, member.id, isAdmin);
    const notify = (memberId: number, kind: "one_on_one" | "dev_action", text: string) => db.insert(notifications).values({ memberId, kind, actorName: member.name, body: text.slice(0, 140), createdAt: now }).catch((error) => console.error("1:1 notification failed", error));

    if (action === "saveMeeting") {
      const meetingId = Number(body.meetingId) || 0;
      const date = String(body.date ?? "");
      if (!isIsoDay(date)) return json({ error: "Escolha a data da reunião." }, 400);
      const agenda = cleanMultiline(body.agenda, 4000);
      const notes = cleanMultiline(body.notes, 8000);
      const status = body.status === "done" ? "done" as const : "planned" as const;
      if (!meetingId) {
        const memberId = Number(body.memberId);
        if (!scope.canManagePerson(memberId) || memberId === member.id) return json({ error: "Você marca 1:1 com quem está nos times que lidera." }, 403);
        const [created] = await db.insert(oneOnOnes).values({ leaderId: member.id, memberId, date, status, agenda, notes, privateNotes: cleanMultiline(body.privateNotes, 4000), createdAt: now, updatedAt: now }).returning({ id: oneOnOnes.id });
        await notify(memberId, "one_on_one", `1:1 marcado para ${shortDate(date)}. Você pode incluir assuntos na pauta.`);
        return json({ id: created.id }, 201);
      }
      const [meeting] = await db.select().from(oneOnOnes).where(eq(oneOnOnes.id, meetingId)).limit(1);
      if (!meeting) return json({ error: "Reunião não encontrada." }, 404);
      const asLeader = meeting.leaderId === member.id || scope.canManagePerson(meeting.memberId);
      if (!asLeader && meeting.memberId !== member.id) return json({ error: "Esta reunião não é sua." }, 403);
      // O liderado edita a pauta e as anotações; data, situação e a nota privada ficam com o líder.
      await db.update(oneOnOnes).set({
        agenda, notes, updatedAt: now,
        ...(asLeader ? { date, status } : {}),
        ...(meeting.leaderId === member.id ? { privateNotes: cleanMultiline(body.privateNotes, 4000) } : {}),
      }).where(eq(oneOnOnes.id, meetingId));
      return json({ ok: true });
    }

    if (action === "deleteMeeting") {
      const [meeting] = await db.select().from(oneOnOnes).where(eq(oneOnOnes.id, Number(body.meetingId))).limit(1);
      if (!meeting) return json({ error: "Reunião não encontrada." }, 404);
      if (meeting.leaderId !== member.id && !isAdmin) return json({ error: "Só quem marcou a reunião ou um administrador pode excluí-la." }, 403);
      await db.delete(oneOnOnes).where(eq(oneOnOnes.id, meeting.id));
      return json({ ok: true });
    }

    // Plano de desenvolvimento: a própria pessoa, os líderes dos times dela e administradores.
    const canEditPlan = (memberId: number) => memberId === member.id || scope.canManagePerson(memberId);

    if (action === "saveAction") {
      const actionId = Number(body.actionId) || 0;
      const title = cleanTitle(body.title).slice(0, 140);
      const dueDate = body.dueDate ? String(body.dueDate) : null;
      if (!title) return json({ error: "Descreva a ação de desenvolvimento." }, 400);
      if (dueDate && !isIsoDay(dueDate)) return json({ error: "Data inválida." }, 400);
      const values = { title, criterion: cleanTitle(body.criterion).slice(0, 60), description: cleanMultiline(body.description, 2000), dueDate, updatedAt: now };
      if (!actionId) {
        const memberId = Number(body.memberId);
        if (!memberId || !canEditPlan(memberId)) return json({ error: "Só a pessoa, os líderes do time dela e administradores mexem neste plano." }, 403);
        const [created] = await db.insert(devActions).values({ ...values, memberId, createdByName: member.name, createdAt: now }).returning({ id: devActions.id });
        if (memberId !== member.id) await notify(memberId, "dev_action", `Nova ação no seu plano de desenvolvimento: ${title}`);
        return json({ id: created.id }, 201);
      }
      const [current] = await db.select().from(devActions).where(eq(devActions.id, actionId)).limit(1);
      if (!current) return json({ error: "Ação não encontrada." }, 404);
      if (!canEditPlan(current.memberId)) return json({ error: "Só a pessoa, os líderes do time dela e administradores mexem neste plano." }, 403);
      await db.update(devActions).set(values).where(eq(devActions.id, actionId));
      return json({ ok: true });
    }

    if (action === "setActionStatus" || action === "deleteAction") {
      const [current] = await db.select().from(devActions).where(eq(devActions.id, Number(body.actionId))).limit(1);
      if (!current) return json({ error: "Ação não encontrada." }, 404);
      if (!canEditPlan(current.memberId)) return json({ error: "Só a pessoa, os líderes do time dela e administradores mexem neste plano." }, 403);
      if (action === "deleteAction") {
        await db.delete(devActions).where(eq(devActions.id, current.id));
        return json({ ok: true });
      }
      if (!isDevStatus(body.status)) return json({ error: "Situação inválida." }, 400);
      await db.update(devActions).set({ status: body.status, updatedAt: now, doneAt: body.status === "done" ? now : null }).where(eq(devActions.id, current.id));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
