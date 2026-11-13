import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { members, notifications, reviewAnswers, reviewCycles, reviewManagers, reviewSubmissions, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { hasTrustedOrigin } from "../../request-security";
import { readJsonBody } from "../../api-input";
import { cleanMultiline, cleanTitle } from "../../tasks";
import { writeAudit } from "../../audit";
import { COMPANY_TARGET, DEFAULT_COMPANY_CRITERIA, DEFAULT_MANAGER_CRITERIA, DEFAULT_PEER_CRITERIA, managerTarget, MAX_REVIEW_COMMENT, MIN_ANSWERS, parseCriteria, parseNotes, parseTarget, quarterTitle, summarize, targetsFor, validScores } from "../../review-tools";

type Db = ReturnType<typeof getDb>;
type Cycle = typeof reviewCycles.$inferSelect;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  console.error("reviews request failed", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem a avaliação. Publique novamente para aplicar a migração." }, 500);
  return json({ error: "Não foi possível concluir esta operação agora." }, 500);
}

const todayInSaoPaulo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

const criteriaOf = (cycle: Cycle) => ({ peer: parseCriteria(cycle.peerCriteria), company: parseCriteria(cycle.companyCriteria), manager: parseCriteria(cycle.managerCriteria) });
const criteriaFor = (cycle: Cycle, kind: "member" | "company" | "manager") => { const all = criteriaOf(cycle); return kind === "member" ? all.peer : kind === "company" ? all.company : all.manager; };

/** Pessoas, vínculos com times e gestão ativa: base para saber quem avalia quem. */
async function roster(db: Db) {
  const [people, memberships, teamRows, managers] = await Promise.all([
    db.select({ id: members.id, name: members.name, jobTitle: members.jobTitle, avatarIcon: members.avatarIcon, avatarKey: members.avatarKey }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
    db.select({ memberId: teamMembers.memberId, teamId: teamMembers.teamId, isLead: teamMembers.isLead }).from(teamMembers),
    db.select({ id: teams.id, name: teams.name }).from(teams),
    db.select().from(reviewManagers).orderBy(asc(reviewManagers.id)),
  ]);
  return { people, memberships, teamRows, managers, activeIds: new Set(people.map((person) => person.id)) };
}

async function openCycle(db: Db) {
  const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.status, "open")).orderBy(desc(reviewCycles.id)).limit(1);
  return cycle ?? null;
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    const isAdmin = member.role === "admin";
    const params = new URL(request.url).searchParams;
    const base = await roster(db);
    const activeManagers = base.managers.filter((manager) => manager.active);

    // Resultados de um ciclo: só depois de encerrado (para ninguém deduzir quem avaliou pela hora).
    const resultsId = Number(params.get("results"));
    if (resultsId) {
      const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.id, resultsId)).limit(1);
      if (!cycle) return json({ error: "Ciclo não encontrado." }, 404);
      if (cycle.status !== "closed") return json({ error: "Os resultados aparecem quando o ciclo for encerrado." }, 400);
      const answers = await db.select({ target: reviewAnswers.target, scores: reviewAnswers.scores, comment: reviewAnswers.comment, notes: reviewAnswers.notes }).from(reviewAnswers).where(eq(reviewAnswers.cycleId, cycle.id));
      const byTarget = new Map<string, { scores: number[]; comment: string; notes: string[] }[]>();
      const parse = (value: string) => { try { return JSON.parse(value) as unknown; } catch { return null; } };
      for (const answer of answers) {
        const scores = parse(answer.scores);
        const notes = parse(answer.notes);
        byTarget.set(answer.target, [...(byTarget.get(answer.target) ?? []), { scores: Array.isArray(scores) ? scores as number[] : [], comment: answer.comment, notes: Array.isArray(notes) ? notes.map(String) : [] }]);
      }
      const result = (target: string, kind: "member" | "company" | "manager") => summarize(byTarget.get(target) ?? [], criteriaFor(cycle, kind));
      const mine = { target: `member:${member.id}`, label: member.name, ...result(`member:${member.id}`, "member") };
      if (!isAdmin) return json({ cycle: { id: cycle.id, title: cycle.title }, results: [mine], minAnswers: MIN_ANSWERS });
      const teamOf = (id: number) => base.memberships.filter((row) => row.memberId === id).map((row) => base.teamRows.find((team) => team.id === row.teamId)?.name).filter(Boolean).join(", ");
      return json({
        cycle: { id: cycle.id, title: cycle.title },
        minAnswers: MIN_ANSWERS,
        results: [
          { target: COMPANY_TARGET, label: "Empresa", kind: "company", ...result(COMPANY_TARGET, "company") },
          ...base.managers.map((manager) => ({ target: managerTarget(manager.id), label: manager.name, subtitle: manager.title, kind: "manager", ...result(managerTarget(manager.id), "manager") })),
          ...base.people.map((person) => ({ target: `member:${person.id}`, label: person.name, subtitle: teamOf(person.id), kind: "member", ...result(`member:${person.id}`, "member") })).filter((row) => row.count > 0 || teamOf(Number(row.target.slice(7)))),
        ],
      });
    }

    const [cycles, cycle] = await Promise.all([
      db.select({ id: reviewCycles.id, title: reviewCycles.title, startDate: reviewCycles.startDate, endDate: reviewCycles.endDate, status: reviewCycles.status }).from(reviewCycles).orderBy(desc(reviewCycles.id)).limit(20),
      openCycle(db),
    ]);
    let pending: unknown[] = [];
    let participation: unknown = null;
    if (cycle) {
      const submitted = await db.select({ reviewerId: reviewSubmissions.reviewerId, target: reviewSubmissions.target }).from(reviewSubmissions).where(eq(reviewSubmissions.cycleId, cycle.id));
      const managerIds = activeManagers.map((manager) => manager.id);
      const mine = targetsFor(member.id, base.memberships, base.activeIds, managerIds);
      const done = new Set(submitted.filter((row) => row.reviewerId === member.id).map((row) => row.target));
      const teamNames = (id: number) => base.memberships.filter((row) => row.memberId === id).map((row) => `${base.teamRows.find((team) => team.id === row.teamId)?.name ?? ""}${row.isLead ? " (líder)" : ""}`).join(", ");
      pending = mine.map((target) => {
        const parsed = parseTarget(target)!;
        if (parsed.kind === "company") return { target, kind: "company", label: "A empresa", subtitle: "Como é trabalhar aqui", done: done.has(target) };
        if (parsed.kind === "manager") { const manager = base.managers.find((entry) => entry.id === parsed.id); return { target, kind: "manager", label: manager?.name ?? "Gestão", subtitle: manager?.title ?? "", done: done.has(target) }; }
        const person = base.people.find((entry) => entry.id === parsed.id);
        return { target, kind: "member", label: person?.name ?? "Pessoa", subtitle: [person?.jobTitle, teamNames(parsed.id!)].filter(Boolean).join(" · "), avatar: person ? { id: person.id, avatarIcon: person.avatarIcon, avatarKey: person.avatarKey, name: person.name } : null, done: done.has(target) };
      });
      // Administradores acompanham a participação (quantas avaliações cada pessoa já enviou, sem as notas).
      if (isAdmin) participation = base.people.map((person) => {
        const total = targetsFor(person.id, base.memberships, base.activeIds, managerIds).length;
        return { memberId: person.id, name: person.name, done: submitted.filter((row) => row.reviewerId === person.id).length, total };
      });
    }
    return json({
      cycle: cycle ? { ...cycle, criteria: criteriaOf(cycle) } : null,
      cycles,
      pending,
      participation,
      managers: isAdmin ? base.managers : activeManagers,
      defaults: { title: quarterTitle(todayInSaoPaulo()), peer: DEFAULT_PEER_CRITERIA, company: DEFAULT_COMPANY_CRITERIA, manager: DEFAULT_MANAGER_CRITERIA },
      minAnswers: MIN_ANSWERS,
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

    // Enviar uma avaliação (todo colaborador ativo participa, inclusive "Somente leitura").
    if (action === "submit") {
      const cycle = await openCycle(db);
      if (!cycle || cycle.id !== Number(body.cycleId)) return json({ error: "Este ciclo de avaliação não está aberto." }, 400);
      const target = parseTarget(body.target);
      if (!target) return json({ error: "Escolha quem avaliar." }, 400);
      const base = await roster(db);
      const allowed = targetsFor(member.id, base.memberships, base.activeIds, base.managers.filter((manager) => manager.active).map((manager) => manager.id));
      if (!allowed.includes(String(body.target))) return json({ error: "Você não avalia esta pessoa neste ciclo." }, 403);
      const criteriaCount = criteriaFor(cycle, target.kind).length;
      const scores = validScores(body.scores, criteriaCount);
      if (!scores) return json({ error: "Dê uma nota de 1 a 5 em cada critério." }, 400);
      const notes = parseNotes(body.notes, criteriaCount);
      const [already] = await db.select({ target: reviewSubmissions.target }).from(reviewSubmissions).where(and(eq(reviewSubmissions.cycleId, cycle.id), eq(reviewSubmissions.reviewerId, member.id), eq(reviewSubmissions.target, String(body.target)))).limit(1);
      if (already) return json({ error: "Você já avaliou neste ciclo." }, 409);
      // As duas gravações juntas: a resposta (sem quem respondeu) e o registro de que já respondeu.
      await db.batch([
        db.insert(reviewSubmissions).values({ cycleId: cycle.id, reviewerId: member.id, target: String(body.target) }),
        db.insert(reviewAnswers).values({ cycleId: cycle.id, target: String(body.target), scores: JSON.stringify(scores), comment: cleanMultiline(body.comment, MAX_REVIEW_COMMENT), notes: JSON.stringify(notes) }),
      ]);
      return json({ ok: true }, 201);
    }

    if (!isAdmin) return json({ error: "Somente administradores gerenciam os ciclos de avaliação." }, 403);
    const audit = (name: string, details: string) => writeAudit(db, { actorUserId: member.userId, actorName: member.name, action: name, targetType: "review_cycle", details }).catch((error) => console.error("audit log failed", error));

    if (action === "openCycle") {
      if (await openCycle(db)) return json({ error: "Já existe um ciclo aberto. Encerre-o antes de abrir outro." }, 409);
      const title = cleanTitle(body.title).slice(0, 80);
      const today = todayInSaoPaulo();
      const peer = parseCriteria(body.peerCriteria);
      const company = parseCriteria(body.companyCriteria);
      const manager = parseCriteria(body.managerCriteria);
      if (!title) return json({ error: "Dê um título ao ciclo." }, 400);
      if (!isDate(body.endDate) || body.endDate < today) return json({ error: "Escolha a data final (hoje ou depois)." }, 400);
      if (!peer.length || !company.length || !manager.length) return json({ error: "Informe pelo menos um critério para colegas, empresa e gestão." }, 400);
      const [cycle] = await db.insert(reviewCycles).values({ title, startDate: today, endDate: body.endDate, peerCriteria: JSON.stringify(peer), companyCriteria: JSON.stringify(company), managerCriteria: JSON.stringify(manager), createdByName: member.name, createdAt: now }).returning();
      const people = await db.select({ id: members.id }).from(members).where(eq(members.active, true));
      const until = new Date(`${body.endDate}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
      const rows = people.map((person) => ({ memberId: person.id, kind: "review_open" as const, actorName: member.name, body: `${title}: avalie até ${until}. É anônimo.`.slice(0, 140), createdAt: now }));
      for (let index = 0; index < rows.length; index += 20) await db.insert(notifications).values(rows.slice(index, index + 20)).catch((error) => console.error("review notification failed", error));
      await audit("review_cycle_opened", title);
      return json({ cycle }, 201);
    }

    if (action === "closeCycle" || action === "reopenCycle" || action === "deleteCycle") {
      const [cycle] = await db.select().from(reviewCycles).where(eq(reviewCycles.id, Number(body.cycleId))).limit(1);
      if (!cycle) return json({ error: "Ciclo não encontrado." }, 404);
      if (action === "deleteCycle") {
        await db.delete(reviewCycles).where(eq(reviewCycles.id, cycle.id));
        await audit("review_cycle_deleted", cycle.title);
        return json({ ok: true });
      }
      if (action === "reopenCycle" && (await openCycle(db))) return json({ error: "Já existe outro ciclo aberto." }, 409);
      await db.update(reviewCycles).set(action === "closeCycle" ? { status: "closed", closedAt: now } : { status: "open", closedAt: null }).where(eq(reviewCycles.id, cycle.id));
      await audit(action === "closeCycle" ? "review_cycle_closed" : "review_cycle_reopened", cycle.title);
      return json({ ok: true });
    }

    if (action === "saveManager") {
      const managerId = Number(body.managerId) || 0;
      const name = cleanTitle(body.name).slice(0, 80);
      if (!name) return json({ error: "Informe o nome." }, 400);
      const values = { name, title: cleanTitle(body.title).slice(0, 60), active: body.active !== false };
      if (managerId) await db.update(reviewManagers).set(values).where(eq(reviewManagers.id, managerId));
      else await db.insert(reviewManagers).values(values);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    return failure(error);
  }
}
