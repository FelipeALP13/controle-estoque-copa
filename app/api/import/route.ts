import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, members, projectPeople, projects, taskEvents, taskLegacyCodes, taskPeople, tasks, teamMembers, teams } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { writeAudit } from "../../audit";
import { fold, mergeDemands, parseWorkbook, personKey, suspiciousHours, type Issue, type MergedDemand, type RawSheet, type WorkbookKind } from "../../demand-import";
import { hasTrustedOrigin } from "../../request-security";
import { taskCategories, type TaskStatus } from "../../tasks";

type Db = ReturnType<typeof getDb>;
type Upload = { kind: WorkbookKind; fileName: string; sheets: RawSheet[] };

const kindLabels: Record<WorkbookKind, string> = { support: "Suporte", development: "Desenvolvimento", leadership: "Liderança" };
const teamNames: Record<"support" | "development", string> = { support: "Suporte", development: "Desenvolvimento" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function slug(name: string) {
  return fold(name).replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") || "pessoa";
}

/** Código guardado para não importar a mesma linha duas vezes (linhas sem ID ganham um código sintético). */
function rowKeys(demand: MergedDemand) {
  return demand.codes.length ? demand.codes : [`SEM-ID:${fold(demand.sheet)}:${fold(demand.title)}:${demand.openedOn ?? ""}`.slice(0, 200)];
}

/** Confere se o arquivo enviado é da planilha certa (título "DEMANDAS DIÁRIAS | SUPORTE" etc.). */
function wrongFile(upload: Upload) {
  if (upload.kind === "leadership") return null;
  const titles = upload.sheets.map((sheet) => fold(sheet.rows[0]?.[0] ?? "")).filter((title) => title.startsWith("demandas diarias |"));
  const expected = fold(`demandas diarias | ${kindLabels[upload.kind]}`);
  if (titles.length && !titles.includes(expected)) return `O arquivo "${upload.fileName}" parece ser de outra planilha (${titles[0].split("|")[1]?.trim() ?? "?"}), mas foi enviado como ${kindLabels[upload.kind]}.`;
  return null;
}

type Plan = Awaited<ReturnType<typeof buildPlan>>;

async function buildPlan(db: Db, uploads: Upload[]) {
  const today = todayInSaoPaulo();
  const issues: Issue[] = [];
  const rosters = new Map<string, { name: string; team: "support" | "development" }>();
  const demandRows: Parameters<typeof mergeDemands>[0] = [];
  const projectRows: ReturnType<typeof parseWorkbook>["projects"] = [];

  for (const upload of uploads) {
    const mismatch = wrongFile(upload);
    if (mismatch) { issues.push({ level: "error", sheet: upload.fileName, row: 0, message: mismatch }); continue; }
    const parsed = parseWorkbook(upload.kind, upload.sheets, taskCategories);
    issues.push(...parsed.issues.map((issue) => ({ ...issue, sheet: `${kindLabels[upload.kind]} › ${issue.sheet}` })));
    for (const [team, names] of [["support", parsed.rosters.support], ["development", parsed.rosters.development]] as const) {
      for (const name of names) if (!rosters.has(personKey(name))) rosters.set(personKey(name), { name, team });
    }
    demandRows.push(...parsed.demands);
    projectRows.push(...parsed.projects);
  }

  const mergeIssues: Issue[] = [];
  const merged = mergeDemands(demandRows, mergeIssues);
  // Os avisos de junção indicam a aba; acrescenta de qual planilha ela é.
  for (const issue of mergeIssues) {
    const source = demandRows.find((row) => row.sheet === issue.sheet && row.row === issue.row);
    issues.push({ ...issue, sheet: source ? `${kindLabels[source.workbook]} › ${issue.sheet}` : issue.sheet });
  }

  // Pessoas: listas de Configurações + qualquer nome citado nas demandas e projetos.
  const mentioned = new Map<string, { name: string; team: "support" | "development" | null }>();
  const remember = (name: string, team: "support" | "development" | null) => { if (!mentioned.has(personKey(name))) mentioned.set(personKey(name), { name, team }); };
  for (const roster of rosters.values()) remember(roster.name, roster.team);
  for (const demand of merged) {
    demand.owners.forEach((name) => remember(name, demand.workbook === "leadership" ? null : demand.workbook));
    demand.support.forEach((name) => remember(name, "support"));
  }
  for (const project of projectRows) project.people.forEach((name) => remember(name, null));

  const existingMembers = await db.select({ id: members.id, name: members.name, email: members.email }).from(members);
  const memberByKey = new Map(existingMembers.map((member) => [personKey(member.name), member]));
  const newPeople = [...mentioned.values()].filter((person) => !memberByKey.has(personKey(person.name)));
  for (const person of newPeople) {
    if (!rosters.has(personKey(person.name))) issues.push({ level: "warning", sheet: "Pessoas", row: 0, message: `"${person.name}" aparece nas demandas mas não está nas listas de Configurações; será cadastrada${person.team ? ` no time ${teamNames[person.team]}` : " sem time"}.` });
  }

  // Clientes: os que não existem serão criados.
  const existingClients = await db.select({ id: clients.id, name: clients.name }).from(clients);
  const clientByKey = new Map(existingClients.map((client) => [fold(client.name), client]));
  const newClients = new Map<string, string>();
  for (const name of [...merged.map((demand) => demand.client), ...projectRows.map((project) => project.client)]) {
    if (name && !clientByKey.has(fold(name)) && !newClients.has(fold(name))) newClients.set(fold(name), name);
  }
  for (const demand of merged) if (!demand.client) issues.push({ level: "warning", sheet: `${kindLabels[demand.workbook]} › ${demand.sheet}`, row: demand.row, message: `${demand.code || "sem ID"}: sem Cliente / Projeto.` });

  // Demandas já importadas (pelos códigos antigos) não entram de novo.
  const existingCodes = new Set((await db.select({ code: taskLegacyCodes.code }).from(taskLegacyCodes)).map((row) => row.code));
  const toImport = merged.filter((demand) => !rowKeys(demand).some((code) => existingCodes.has(code)));
  const alreadyImported = merged.length - toImport.length;

  const existingProjects = new Set((await db.select({ key: projects.legacyKey }).from(projects)).map((row) => row.key));
  const projectsToImport = projectRows.filter((project) => !existingProjects.has(`${fold(project.client)}|${fold(project.name)}`));

  const flagged = toImport.map((demand) => ({ demand, reasons: suspiciousHours(demand, today) })).filter((entry) => entry.reasons.length);
  for (const { demand, reasons } of flagged) issues.push({ level: "warning", sheet: `${kindLabels[demand.workbook]} › ${demand.sheet}`, row: demand.row, message: `${demand.codes.join(" + ") || "sem ID"}: horas suspeitas (${reasons.join("; ")}). Importada e marcada para revisão.` });

  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const byStatus: Partial<Record<TaskStatus, number>> = {};
  for (const demand of toImport) byStatus[demand.status] = (byStatus[demand.status] ?? 0) + 1;

  return {
    today, toImport, projectsToImport, newPeople, rosters, memberByKey, newClients, clientByKey, flaggedKeys: new Set(flagged.map((entry) => entry.demand)),
    report: {
      rowsRead: demandRows.length,
      demandsToImport: toImport.length,
      mergedGroups: merged.filter((demand) => demand.merged > 1).length,
      mergedRows: merged.filter((demand) => demand.merged > 1).reduce((total, demand) => total + demand.merged, 0),
      alreadyImported,
      byStatus,
      projectsRead: projectRows.length,
      projectsToImport: projectsToImport.length,
      projectsAlreadyImported: projectRows.length - projectsToImport.length,
      newPeople: newPeople.map((person) => ({ name: person.name, team: person.team ? teamNames[person.team] : null })),
      newClients: [...newClients.values()].sort((a, b) => a.localeCompare(b, "pt-BR")),
      hoursFlagged: flagged.length,
      errors: errors.slice(0, 300),
      warnings: warnings.slice(0, 500),
      totalErrors: errors.length,
      totalWarnings: warnings.length,
    },
  };
}

/** Executa os comandos em lotes, para respeitar os limites do banco. */
async function inBatches<T>(db: Db, items: T[], size: number, build: (item: T) => Parameters<Db["batch"]>[0][number]) {
  const results: unknown[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size).map(build);
    if (chunk.length) results.push(...(await db.batch(chunk as unknown as Parameters<Db["batch"]>[0])));
  }
  return results;
}

async function commit(db: Db, plan: Plan, actor: { userId: string; name: string }) {
  const now = new Date().toISOString();

  // 1. Times Suporte e Desenvolvimento (cria se não existirem).
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamIds: Record<"support" | "development", number> = { support: 0, development: 0 };
  for (const key of ["support", "development"] as const) {
    const found = teamRows.find((team) => fold(team.name) === fold(teamNames[key]));
    teamIds[key] = found ? found.id : (await db.insert(teams).values({ name: teamNames[key], color: key === "support" ? "purple" : "blue" }).returning())[0].id;
  }

  // 2. Pessoas novas, sem senha (o administrador libera o acesso depois em Usuários).
  const usedEmails = new Set((await db.select({ email: members.email }).from(members)).map((row) => row.email));
  const memberIds = new Map([...plan.memberByKey].map(([key, member]) => [key, member.id]));
  for (const person of plan.newPeople) {
    let email = `${slug(person.name)}@pendente.local`;
    for (let n = 2; usedEmails.has(email); n += 1) email = `${slug(person.name)}${n}@pendente.local`;
    usedEmails.add(email);
    const [created] = await db.insert(members).values({ userId: `member:${crypto.randomUUID()}`, name: person.name, email, role: "member", permissions: "{}", active: true, avatarIcon: "👤" }).returning({ id: members.id });
    memberIds.set(personKey(person.name), created.id);
  }
  // Vínculo com os times, conforme as listas de Configurações (sem duplicar quem já está).
  const currentLinks = new Set((await db.select().from(teamMembers)).map((row) => `${row.teamId}:${row.memberId}`));
  const links = [...plan.rosters.values()].map((roster) => ({ teamId: teamIds[roster.team], memberId: memberIds.get(personKey(roster.name))! }))
    .filter((link) => link.memberId && !currentLinks.has(`${link.teamId}:${link.memberId}`));
  for (const person of plan.newPeople) {
    const id = memberIds.get(personKey(person.name))!;
    if (person.team && !plan.rosters.has(personKey(person.name)) && !currentLinks.has(`${teamIds[person.team]}:${id}`)) links.push({ teamId: teamIds[person.team], memberId: id });
  }
  await inBatches(db, links, 30, (link) => db.insert(teamMembers).values({ ...link, isLead: false }).onConflictDoNothing());

  // 3. Clientes novos.
  const clientIds = new Map([...plan.clientByKey].map(([key, client]) => [key, client.id]));
  for (const [key, name] of plan.newClients) {
    const [created] = await db.insert(clients).values({ name }).returning({ id: clients.id });
    clientIds.set(key, created.id);
  }

  // Cada lote do D1 é uma transação: a demanda e tudo que depende dela entram juntos ou nada entra.
  // O id recém-criado é lido com max(id) dentro da mesma transação.
  const lastProject = sql`(select max("id") from "projects")`;
  const lastTask = sql`(select max("id") from "tasks")`;

  // 4. Projetos grandes, com os responsáveis.
  for (let i = 0; i < plan.projectsToImport.length; i += 15) {
    const statements = plan.projectsToImport.slice(i, i + 15).flatMap((project) => [
      db.insert(projects).values({
        name: project.name, description: project.description, clientId: project.client ? clientIds.get(fold(project.client)) ?? null : null,
        status: project.status, farol: project.farol, phase: project.phase, deadlineLabel: project.deadlineLabel, startDate: project.startDate,
        endForecast: project.endForecast, notes: project.notes, legacyKey: `${fold(project.client)}|${fold(project.name)}`, createdAt: now, updatedAt: now,
      }),
      ...[...new Set(project.people.map((name) => memberIds.get(personKey(name))).filter((id): id is number => Boolean(id)))]
        .map((memberId) => db.insert(projectPeople).values({ projectId: lastProject, memberId })),
    ]);
    await db.batch(statements as unknown as Parameters<Db["batch"]>[0]);
  }

  // 5. Demandas, na ordem da planilha, com responsáveis, códigos antigos e o registro de importação.
  const order = new Map<string, number>();
  for (let i = 0; i < plan.toImport.length; i += 20) {
    const statements = plan.toImport.slice(i, i + 20).flatMap((demand) => {
      const position = (order.get(demand.status) ?? 0) + 1000;
      order.set(demand.status, position);
      const owners = [...new Set(demand.owners.map((name) => memberIds.get(personKey(name))).filter((id): id is number => Boolean(id)))];
      const support = [...new Set(demand.support.map((name) => memberIds.get(personKey(name))).filter((id): id is number => Boolean(id) && !owners.includes(id!)))];
      return [
        db.insert(tasks).values({
          title: demand.title, description: "", status: demand.status, priority: demand.priority,
          assigneeId: owners[0] ?? null, teamId: demand.workbook === "leadership" ? null : teamIds[demand.workbook],
          clientId: demand.client ? clientIds.get(fold(demand.client)) ?? null : null, category: demand.category,
          openedOn: demand.openedOn, startDate: demand.startDate, dueDate: demand.dueDate, completedOn: demand.completedOn,
          estimatedHours: demand.estimatedHours, workedHours: demand.workedHours, baseHours: demand.workedHours, hoursFlag: plan.flaggedKeys.has(demand),
          origin: demand.origin.slice(0, 300), notes: demand.notes, sortOrder: position,
          createdById: null, createdByName: "Planilha",
          completedAt: demand.status === "done" ? (demand.completedOn ? `${demand.completedOn}T12:00:00.000Z` : now) : null,
          createdAt: demand.openedOn ? `${demand.openedOn}T12:00:00.000Z` : now, updatedAt: now,
        }),
        ...owners.map((memberId) => db.insert(taskPeople).values({ taskId: lastTask, memberId, role: "owner" })),
        ...support.map((memberId) => db.insert(taskPeople).values({ taskId: lastTask, memberId, role: "support" })),
        ...rowKeys(demand).map((code) => db.insert(taskLegacyCodes).values({ code, taskId: lastTask })),
        db.insert(taskEvents).values({ taskId: lastTask, kind: "imported", body: `${demand.codes.join(", ") || "sem ID"} · ${demand.sources.join("; ")}`.slice(0, 500), actorName: actor.name, createdAt: now }),
      ];
    });
    await db.batch(statements as unknown as Parameters<Db["batch"]>[0]);
  }

  await writeAudit(db, { actorUserId: actor.userId, actorName: actor.name, action: "spreadsheets_imported", targetType: "task", details: `${plan.toImport.length} demandas, ${plan.projectsToImport.length} projetos, ${plan.newPeople.length} pessoas, ${plan.newClients.size} clientes` }).catch((error) => console.error("audit log failed", error));
  return { demands: plan.toImport.length, projects: plan.projectsToImport.length, people: plan.newPeople.length, clients: plan.newClients.size };
}

function validUploads(value: unknown): Upload[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 3) return null;
  const uploads: Upload[] = [];
  for (const entry of value as Record<string, unknown>[]) {
    if (!["support", "development", "leadership"].includes(String(entry.kind)) || !Array.isArray(entry.sheets)) return null;
    const sheets = (entry.sheets as Record<string, unknown>[]).slice(0, 60).map((sheet) => ({
      name: String(sheet.name ?? "").slice(0, 100),
      rows: Array.isArray(sheet.rows) ? (sheet.rows as unknown[]).slice(0, 5000).map((row) => (Array.isArray(row) ? row.slice(0, 40).map((cell) => String(cell ?? "").slice(0, 5000)) : [])) : [],
    }));
    uploads.push({ kind: entry.kind as WorkbookKind, fileName: String(entry.fileName ?? kindLabels[entry.kind as WorkbookKind]).slice(0, 120), sheets });
  }
  if (new Set(uploads.map((upload) => upload.kind)).size !== uploads.length) return null;
  return uploads;
}

export async function POST(request: Request) {
  try {
    if (!hasTrustedOrigin(request)) return json({ error: "Origem da solicitação não autorizada." }, 403);
    const db = getDb();
    const member = await getSessionMember(db);
    if (!member?.active) return json({ error: "Entre com seu usuário e senha para acessar o sistema." }, 401);
    if (member.role !== "admin") return json({ error: "Somente administradores podem importar planilhas." }, 403);

    const body = (await request.json()) as Record<string, unknown>;
    const uploads = validUploads(body.workbooks);
    if (!uploads) return json({ error: "Envie de 1 a 3 planilhas (Suporte, Desenvolvimento e/ou Liderança), uma de cada." }, 400);

    const plan = await buildPlan(db, uploads);
    if (body.confirm !== true) return json({ preview: plan.report });
    if (plan.report.totalErrors) return json({ error: `Há ${plan.report.totalErrors} erro(s) na prévia. Corrija nas planilhas e envie de novo antes de importar.`, preview: plan.report }, 409);
    if (!plan.toImport.length && !plan.projectsToImport.length) return json({ error: "Não há nada novo para importar: tudo já foi importado antes.", preview: plan.report }, 409);
    const imported = await commit(db, plan, { userId: member.userId, name: member.name });
    return json({ imported, preview: plan.report });
  } catch (error) {
    console.error("import failed", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table") || message.includes("no such column")) return json({ error: "O banco ainda não tem as tabelas de demandas. Publique novamente para aplicar as migrações." }, 500);
    return json({ error: "A importação parou no meio. O que já entrou ficou salvo e não será duplicado: gere a prévia de novo e importe para completar." }, 500);
  }
}

export async function GET() {
  return json({ error: "Use POST." }, 405);
}
