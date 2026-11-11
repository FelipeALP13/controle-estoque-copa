import { and, asc, desc, eq, min, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, members, notifications, taskEvents, taskPeople, tasks, teamMembers, teams, ticketEvents, tickets } from "../../../db/schema";
import { getSessionMember, type SessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { asTicketKind, commentRecipients, findMentions, snippet, type NotificationKind } from "../../notifications";
import { hasTrustedOrigin } from "../../request-security";
import { cleanMultiline, cleanTitle, MAX_COMMENT_LENGTH, MAX_DESCRIPTION_LENGTH, sortOrderBetween, taskCode } from "../../tasks";
import { sendJiraComment, transitionJira } from "../../jira-sync";
import { canHandleTicket, isTicketStatus, isTicketType, isTicketUrgency, requesterCanSetStatus, ticketCode, ticketStatusLabels, type TicketUrgency } from "../../tickets";

type Db = ReturnType<typeof getDb>;
type EventKind = (typeof ticketEvents.$inferInsert)["kind"];

const urgencyToPriority: Record<TicketUrgency, 1 | 2 | 3 | 4> = { critical: 1, high: 2, normal: 3, low: 4 };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("tickets request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as tabelas de chamados. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

async function viewerOf(db: Db, member: SessionMember) {
  const rows = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.memberId, member.id));
  return { id: member.id, isAdmin: member.role === "admin", canEdit: member.active && member.role !== "viewer", teamIds: rows.map((row) => row.teamId) };
}

async function teamRecipients(db: Db, teamId: number | null) {
  if (!teamId) return [];
  const rows = await db.select({ id: members.id }).from(teamMembers).innerJoin(members, eq(teamMembers.memberId, members.id)).where(and(eq(teamMembers.teamId, teamId), eq(members.active, true)));
  return rows.map((row) => row.id);
}

async function notify(db: Db, actorName: string, createdAt: string, ticketId: number, rows: { memberId: number; kind: NotificationKind; body: string }[], skip: number) {
  const unique = new Map<number, { memberId: number; kind: NotificationKind; body: string }>();
  for (const row of rows) if (row.memberId !== skip && !unique.has(row.memberId)) unique.set(row.memberId, row);
  if (!unique.size) return;
  try {
    await db.insert(notifications).values([...unique.values()].map((row) => ({ ...row, ticketId, actorName, createdAt })));
  } catch (error) {
    console.error("notification insert failed", error);
  }
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const viewer = await viewerOf(db, member);

    const ticketId = Number(new URL(request.url).searchParams.get("ticketId"));
    if (ticketId) {
      const events = await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId)).orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
      // Comentário que veio do Jira ou já foi enviado ao cliente não se apaga por aqui (continuaria lá).
      return json({ events: events.map((event) => ({ ...event, canDelete: event.kind === "comment" && !event.externalId && (event.actorId === member.id || viewer.isAdmin) })) });
    }

    const [ticketRows, memberRows, teamRows, commentRows] = await Promise.all([
      db.select().from(tickets).orderBy(desc(tickets.createdAt)).limit(3000),
      db.select({ id: members.id, name: members.name, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
      db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).orderBy(asc(teams.name)),
      db.select({ ticketId: ticketEvents.ticketId }).from(ticketEvents).where(eq(ticketEvents.kind, "comment")),
    ]);
    const commentCount = new Map<number, number>();
    for (const row of commentRows) commentCount.set(row.ticketId, (commentCount.get(row.ticketId) ?? 0) + 1);

    return json({ tickets: ticketRows.map((ticket) => ({ ...ticket, commentCount: commentCount.get(ticket.id) ?? 0 })), members: memberRows, teams: teamRows, me: viewer });
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
    if (!viewer.canEdit) return json({ error: "Seu perfil pode apenas visualizar os chamados." }, 403);

    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const actor = { actorId: member.id, actorName: member.name };
    const now = new Date().toISOString();

    if (action === "createTicket") {
      const title = cleanTitle(body.title);
      const teamId = Number(body.teamId) || null;
      if (!title) return json({ error: "Dê um título para o chamado." }, 400);
      if (teamId) {
        const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
        if (!team) return json({ error: "Escolha um time válido." }, 400);
      } else if ((await db.select({ id: teams.id }).from(teams).limit(1)).length) {
        return json({ error: "Escolha para qual time é o chamado." }, 400);
      }
      const [ticket] = await db.insert(tickets).values({
        title,
        description: cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH),
        type: isTicketType(body.type) ? body.type : "question",
        urgency: isTicketUrgency(body.urgency) ? body.urgency : "normal",
        client: cleanTitle(body.client).slice(0, 80),
        teamId,
        requesterId: member.id,
        requesterName: member.name,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await db.insert(ticketEvents).values({ ticketId: ticket.id, kind: "created", ...actor, createdAt: now });
      await notify(db, member.name, now, ticket.id, (await teamRecipients(db, teamId)).map((memberId) => ({ memberId, kind: "ticket_new", body: ticket.title })), member.id);
      return json({ ticket }, 201);
    }

    const ticketId = Number(body.ticketId);
    const [current] = ticketId ? await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1) : [];

    if (action === "updateTicket") {
      if (!current) return json({ error: "Chamado não encontrado." }, 404);
      const handler = canHandleTicket(viewer, current.teamId);
      const isRequester = current.requesterId === member.id;
      const changes: Partial<typeof tickets.$inferInsert> = {};
      const events: { kind: EventKind; body: string }[] = [];
      const alerts: { memberId: number; kind: NotificationKind; body: string }[] = [];

      if ("status" in body) {
        if (!isTicketStatus(body.status)) return json({ error: "Status inválido." }, 400);
        if (body.status !== current.status) {
          if (!handler && !(isRequester && requesterCanSetStatus(current.status, body.status))) return json({ error: "Somente o time responsável pode mudar este status." }, 403);
          changes.status = body.status;
          changes.resolvedAt = body.status === "resolved" ? now : null;
          events.push({ kind: "status", body: body.status });
          const label = ticketStatusLabels[body.status];
          if (current.requesterId) alerts.push({ memberId: current.requesterId, kind: "ticket_status", body: label });
          if (current.assigneeId) alerts.push({ memberId: current.assigneeId, kind: "ticket_status", body: label });
        }
      }

      const handlerOnly = ["assigneeId", "urgency", "teamId", "type", "client", "title", "description"].filter((key) => key in body);
      if (handlerOnly.length && !handler) return json({ error: "Somente o time responsável pode alterar o chamado." }, 403);

      if ("assigneeId" in body) {
        const assigneeId = body.assigneeId === null || body.assigneeId === "" ? null : Number(body.assigneeId);
        let assigneeName = "";
        if (assigneeId !== null) {
          const [person] = await db.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.id, assigneeId), eq(members.active, true))).limit(1);
          if (!person) return json({ error: "Escolha um responsável ativo." }, 400);
          assigneeName = person.name;
        }
        if (assigneeId !== current.assigneeId) {
          changes.assigneeId = assigneeId;
          events.push({ kind: "assignee", body: assigneeName });
          if (assigneeId) alerts.push({ memberId: assigneeId, kind: "ticket_assigned", body: current.title });
        }
      }
      if ("urgency" in body) {
        if (!isTicketUrgency(body.urgency)) return json({ error: "Urgência inválida." }, 400);
        if (body.urgency !== current.urgency) { changes.urgency = body.urgency; events.push({ kind: "urgency", body: body.urgency }); }
      }
      if ("teamId" in body) {
        const teamId = Number(body.teamId) || null;
        let teamName = "";
        if (teamId) {
          const [team] = await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
          if (!team) return json({ error: "Escolha um time válido." }, 400);
          teamName = team.name;
        }
        if (teamId !== current.teamId) {
          changes.teamId = teamId;
          events.push({ kind: "team", body: teamName });
          for (const memberId of await teamRecipients(db, teamId)) alerts.push({ memberId, kind: "ticket_new", body: current.title });
        }
      }
      if ("type" in body) {
        if (!isTicketType(body.type)) return json({ error: "Tipo inválido." }, 400);
        changes.type = body.type;
      }
      if ("client" in body) changes.client = cleanTitle(body.client).slice(0, 80);
      if ("title" in body) {
        const title = cleanTitle(body.title);
        if (!title) return json({ error: "O título não pode ficar vazio." }, 400);
        changes.title = title;
      }
      // Chamado do Jira: a descrição é a de lá (a próxima busca sobrescreveria).
      if ("description" in body && current.source !== "jira") changes.description = cleanMultiline(body.description, MAX_DESCRIPTION_LENGTH);

      // Chamado do Jira: o título é o de lá (a próxima busca sobrescreveria).
      if (current.source === "jira") delete changes.title;

      // Primeira ação do time (assumir, atribuir ou mudar status) conta como primeira resposta.
      if (handler && !isRequester && !current.firstResponseAt && (changes.assigneeId !== undefined || changes.status)) changes.firstResponseAt = now;

      if (!Object.keys(changes).length) return json({ ticket: current });
      let [ticket] = await db.update(tickets).set({ ...changes, updatedAt: now }).where(eq(tickets.id, ticketId)).returning();
      if (events.length) await db.insert(ticketEvents).values(events.map((event) => ({ ticketId, ...event, ...actor, createdAt: now })));
      await notify(db, member.name, now, ticketId, alerts, member.id);
      // Leva o novo status para o Jira; se não der, o Portal mantém e avisa.
      let jiraWarning: string | null = null;
      if (changes.status && current.source === "jira" && handler) {
        const result = await transitionJira(db, current, changes.status);
        jiraWarning = result.message;
        if (result.moved) {
          [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
          await db.insert(ticketEvents).values({ ticketId, kind: "status", body: changes.status, actorId: null, actorName: `Jira (${result.statusName})`, createdAt: now });
        }
      }
      return json({ ticket, jiraWarning });
    }

    if (action === "addComment") {
      if (!current) return json({ error: "Chamado não encontrado." }, 404);
      const text = cleanMultiline(body.body, MAX_COMMENT_LENGTH);
      if (!text) return json({ error: "Escreva o comentário antes de enviar." }, 400);
      const [participants, people] = await Promise.all([
        db.selectDistinct({ id: ticketEvents.actorId }).from(ticketEvents).where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.kind, "comment"))),
        db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)),
      ]);
      // Chamado do Jira com "enviar ao cliente": vai primeiro para o Jira; se falhar, nada é gravado aqui.
      const toJira = body.sendToJira === true && current.source === "jira";
      if (toJira && !canHandleTicket(viewer, current.teamId)) return json({ error: "Somente o time responsável responde ao cliente no Jira." }, 403);
      let externalId: string | null = null;
      if (toJira) {
        try {
          externalId = `comment:${await sendJiraComment(db, current, text)}`;
        } catch (error) {
          return json({ error: `Não foi enviado ao Jira: ${error instanceof Error ? error.message : "erro desconhecido"}` }, 502);
        }
      }
      const [event] = await db.insert(ticketEvents).values({ ticketId, kind: "comment", body: text, ...actor, createdAt: now, externalId }).returning();
      // Em chamado do Jira, só a resposta enviada ao cliente conta como primeira resposta (nota interna não).
      const firstResponse = !current.firstResponseAt && current.requesterId !== member.id && canHandleTicket(viewer, current.teamId) && (current.source !== "jira" || toJira);
      await db.update(tickets).set({ updatedAt: now, ...(firstResponse ? { firstResponseAt: now } : {}) }).where(eq(tickets.id, ticketId));
      const recipients = commentRecipients({
        actorId: member.id,
        assigneeId: current.assigneeId,
        creatorId: current.requesterId,
        participantIds: participants.map((row) => row.id).filter((id): id is number => id !== null),
        mentionedIds: findMentions(text, people),
      });
      const activeIds = new Set(people.map((person) => person.id));
      await notify(db, member.name, now, ticketId, [...recipients].filter(([id]) => activeIds.has(id)).map(([memberId, kind]) => ({ memberId, kind: asTicketKind(kind), body: snippet(text) })), member.id);
      return json({ event }, 201);
    }

    if (action === "deleteComment") {
      const eventId = Number(body.eventId);
      const [event] = await db.select().from(ticketEvents).where(eq(ticketEvents.id, eventId)).limit(1);
      if (!event || event.kind !== "comment") return json({ error: "Comentário não encontrado." }, 404);
      if (event.actorId !== member.id && !viewer.isAdmin) return json({ error: "Você só pode excluir os seus comentários." }, 403);
      if (event.externalId) return json({ error: "Este comentário está no Jira; apague lá se precisar." }, 400);
      await db.delete(ticketEvents).where(eq(ticketEvents.id, eventId));
      return json({ ok: true });
    }

    if (action === "createTask") {
      if (!current) return json({ error: "Chamado não encontrado." }, 404);
      if (!canHandleTicket(viewer, current.teamId)) return json({ error: "Somente o time responsável pode criar a demanda." }, 403);
      if (current.taskId) return json({ error: `Este chamado já virou a demanda ${taskCode(current.taskId)}.` }, 409);
      const [top] = await db.select({ value: min(tasks.sortOrder) }).from(tasks).where(eq(tasks.status, "todo"));
      const description = [current.description, `Origem: chamado ${ticketCode(current.id)}, aberto por ${current.requesterName}${current.client ? ` (cliente: ${current.client})` : ""}.`].filter(Boolean).join("\n\n");
      const [task] = await db.insert(tasks).values({
        title: cleanTitle(`${ticketCode(current.id)}: ${current.title}`),
        description: description.slice(0, MAX_DESCRIPTION_LENGTH),
        status: "todo",
        priority: urgencyToPriority[current.urgency],
        assigneeId: current.assigneeId,
        teamId: current.teamId,
        sortOrder: sortOrderBetween(null, top?.value ?? null),
        createdById: member.id,
        createdByName: member.name,
        createdAt: now,
        updatedAt: now,
      }).returning();
      if (task.assigneeId) await db.insert(taskPeople).values({ taskId: task.id, memberId: task.assigneeId, role: "owner" });
      // Cliente e categoria da demanda a partir do chamado, quando houver correspondência.
      const [client] = current.client ? await db.select({ id: clients.id }).from(clients).where(sql`lower(${clients.name}) = lower(${current.client})`).limit(1) : [];
      const category = { bug: "Bug", question: "Atendimento", improvement: "Melhoria", access: "Solicitação", other: "" }[current.type];
      await db.update(tasks).set({ clientId: client?.id ?? null, category, openedOn: now.slice(0, 10), origin: ticketCode(current.id) }).where(eq(tasks.id, task.id));
      await db.insert(taskEvents).values({ taskId: task.id, kind: "created", ...actor, createdAt: now });
      await db.update(tickets).set({ taskId: task.id, updatedAt: now, ...(current.firstResponseAt ? {} : { firstResponseAt: now }) }).where(eq(tickets.id, ticketId));
      await db.insert(ticketEvents).values({ ticketId, kind: "task", body: taskCode(task.id), ...actor, createdAt: now });
      if (task.assigneeId && task.assigneeId !== member.id) {
        try { await db.insert(notifications).values({ memberId: task.assigneeId, kind: "task_assigned", taskId: task.id, actorName: member.name, body: "", createdAt: now }); } catch (error) { console.error("notification insert failed", error); }
      }
      return json({ task }, 201);
    }

    if (action === "deleteTicket") {
      if (!viewer.isAdmin) return json({ error: "Somente administradores podem excluir chamados." }, 403);
      if (!current) return json({ error: "Chamado não encontrado." }, 404);
      await db.delete(tickets).where(eq(tickets.id, ticketId));
      await writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: "ticket_deleted", targetType: "ticket", targetId: current.id, details: `${ticketCode(current.id)} ${current.title}` }).catch((error) => console.error("audit log failed", error));
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
