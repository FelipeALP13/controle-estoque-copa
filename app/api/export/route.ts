import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, integrationKeys, maintenanceRequests, members, projects, tasks, teams, tickets, timeEntries } from "../../../db/schema";
import { getSessionMember } from "../../auth-session";
import { bearerKey, hashIntegrationKey } from "../../integration-tools";
import { exportPeriod, hoursBetween, inPeriod, isExportDataset, isExportFormat, localDay, MAX_EXPORT_ROWS, toCsv, toRecords, type ExportDataset, type Table } from "../../export-data";
import { buildXlsx } from "../../xlsx-writer";
import { ticketCode, ticketStatusLabels, ticketTypeLabels, ticketUrgencyLabels } from "../../tickets";
import { taskCode, taskStatusLabels } from "../../tasks";
import { projectCode, projectFarolLabels, projectPhaseLabels } from "../../projects";
import { maintenanceCategory, maintenancePriorityLabels, maintenanceStatusLabels } from "../../maintenance-tools";

/**
 * Dados para análise fora do Portal. Acesso: administrador logado (baixa Excel/CSV pela tela)
 * ou chave de leitura de dados ("Bearer pk_ac_...", do tipo export) para o Power BI/Excel atualizarem sozinhos.
 */
type Db = ReturnType<typeof getDb>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorized(request: Request, db: Db) {
  const key = bearerKey(request.headers.get("authorization"));
  if (key) {
    const [row] = await db.select({ id: integrationKeys.id }).from(integrationKeys)
      .where(and(eq(integrationKeys.keyHash, await hashIntegrationKey(key)), eq(integrationKeys.kind, "export"), isNull(integrationKeys.revokedAt))).limit(1);
    if (!row) return false;
    await db.update(integrationKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(integrationKeys.id, row.id)).catch(() => undefined);
    return true;
  }
  const member = await getSessionMember(db);
  return Boolean(member?.active && member.role === "admin");
}

const LABEL_URGENCY = ticketUrgencyLabels as Record<string, string>;
const LABEL_TICKET_STATUS = ticketStatusLabels as Record<string, string>;
const LABEL_TICKET_TYPE = ticketTypeLabels as Record<string, string>;
const LABEL_TASK_STATUS = taskStatusLabels as Record<string, string>;
const PRIORITY = ["Sem prioridade", "Crítica", "Alta", "Média", "Baixa"];

async function buildTable(db: Db, dataset: ExportDataset, period: { from: string | null; to: string | null }): Promise<Table> {
  const [people, teamRows, clientRows] = await Promise.all([
    db.select({ id: members.id, name: members.name }).from(members),
    db.select({ id: teams.id, name: teams.name }).from(teams),
    db.select({ id: clients.id, name: clients.name }).from(clients),
  ]);
  const person = (id: number | null) => (id ? people.find((row) => row.id === id)?.name ?? "" : "");
  const team = (id: number | null) => (id ? teamRows.find((row) => row.id === id)?.name ?? "" : "");
  const client = (id: number | null) => (id ? clientRows.find((row) => row.id === id)?.name ?? "" : "");

  if (dataset === "tickets") {
    const rows = (await db.select().from(tickets)).filter((row) => inPeriod(row.createdAt, period));
    return {
      columns: [{ header: "Código", width: 9 }, { header: "Título", width: 40 }, { header: "Tipo", width: 12 }, { header: "Urgência", width: 10 }, { header: "Status", width: 14 },
        { header: "Cliente", width: 20 }, { header: "Time", width: 16 }, { header: "Aberto por", width: 18 }, { header: "Responsável", width: 18 }, { header: "Origem", width: 10 },
        { header: "Aberto em", type: "date", width: 12 }, { header: "Resolvido em", type: "date", width: 12 }, { header: "Horas até a 1ª resposta", type: "number", width: 12 }, { header: "Horas até resolver", type: "number", width: 12 },
        { header: "Nota", type: "number", width: 7 }, { header: "Quem avaliou", width: 12 }, { header: "Comentário da avaliação", width: 40 }],
      rows: rows.map((row) => [ticketCode(row.id), row.title, LABEL_TICKET_TYPE[row.type] ?? row.type, LABEL_URGENCY[row.urgency] ?? row.urgency, LABEL_TICKET_STATUS[row.status] ?? row.status,
        row.client, team(row.teamId), row.requesterName, person(row.assigneeId), row.source === "jira" ? "Jira" : row.source === "atendechat" ? "AtendeChat" : "Portal",
        localDay(row.createdAt), localDay(row.resolvedAt), hoursBetween(row.createdAt, row.firstResponseAt), hoursBetween(row.createdAt, row.resolvedAt),
        row.rating, row.rating === null ? "" : row.ratedBy === "client" ? "Cliente" : "Equipe", row.ratingComment]),
    };
  }
  if (dataset === "tasks") {
    const [rows, projectRows] = await Promise.all([db.select().from(tasks), db.select({ id: projects.id, name: projects.name }).from(projects)]);
    return {
      columns: [{ header: "Código", width: 9 }, { header: "Título", width: 40 }, { header: "Status", width: 14 }, { header: "Prioridade", width: 12 }, { header: "Time", width: 16 }, { header: "Cliente", width: 20 },
        { header: "Projeto", width: 24 }, { header: "Responsável", width: 18 }, { header: "Categoria", width: 14 }, { header: "Aberta em", type: "date", width: 12 }, { header: "Início", type: "date", width: 12 },
        { header: "Prazo", type: "date", width: 12 }, { header: "Concluída em", type: "date", width: 12 }, { header: "Horas estimadas", type: "number", width: 10 }, { header: "Horas trabalhadas", type: "number", width: 10 }],
      rows: rows.filter((row) => inPeriod(row.openedOn ?? row.createdAt, period)).map((row) => [taskCode(row.id), row.title, LABEL_TASK_STATUS[row.status] ?? row.status, PRIORITY[row.priority] ?? "", team(row.teamId), client(row.clientId),
        projectRows.find((project) => project.id === row.projectId)?.name ?? "", person(row.assigneeId), row.category, localDay(row.openedOn ?? row.createdAt), row.startDate, row.dueDate, row.completedOn, row.estimatedHours, row.workedHours]),
    };
  }
  if (dataset === "hours") {
    const [rows, taskRows] = await Promise.all([db.select().from(timeEntries), db.select({ id: tasks.id, title: tasks.title, clientId: tasks.clientId, teamId: tasks.teamId }).from(tasks)]);
    return {
      columns: [{ header: "Dia", type: "date", width: 12 }, { header: "Pessoa", width: 18 }, { header: "Horas", type: "number", width: 8 }, { header: "Demanda", width: 9 }, { header: "Título da demanda", width: 40 }, { header: "Cliente", width: 20 }, { header: "Time", width: 16 }, { header: "Observação", width: 30 }],
      rows: rows.filter((row) => inPeriod(row.workDate, period)).map((row) => { const task = taskRows.find((entry) => entry.id === row.taskId); return [row.workDate, row.memberName, row.hours, taskCode(row.taskId), task?.title ?? "", client(task?.clientId ?? null), team(task?.teamId ?? null), row.note]; }),
    };
  }
  if (dataset === "projects") {
    const rows = await db.select().from(projects);
    return {
      columns: [{ header: "Código", width: 9 }, { header: "Projeto", width: 34 }, { header: "Cliente", width: 20 }, { header: "Farol", width: 10 }, { header: "Fase", width: 14 }, { header: "Status", width: 14 }, { header: "Início", type: "date", width: 12 }, { header: "Previsão de término", width: 16 }, { header: "Atualizado em", type: "date", width: 12 }],
      rows: rows.filter((row) => !period.from && !period.to ? true : inPeriod(row.startDate ?? row.createdAt, period)).map((row) => [projectCode(row.id), row.name, client(row.clientId), projectFarolLabels[row.farol], projectPhaseLabels[row.phase], LABEL_TASK_STATUS[row.status] ?? row.status, row.startDate, row.endForecast, localDay(row.updatedAt)]),
    };
  }
  const rows = (await db.select().from(maintenanceRequests)).filter((row) => inPeriod(row.createdAt, period));
  return {
    columns: [{ header: "Pedido", type: "number", width: 8 }, { header: "O que aconteceu", width: 36 }, { header: "Tipo", width: 20 }, { header: "Onde", width: 18 }, { header: "Urgência", width: 12 }, { header: "Situação", width: 18 }, { header: "Aberto por", width: 18 }, { header: "Responsável", width: 18 }, { header: "Aberto em", type: "date", width: 12 }, { header: "Resolvido em", type: "date", width: 12 }, { header: "Horas até resolver", type: "number", width: 10 }],
    rows: rows.map((row) => [row.id, row.title, maintenanceCategory(row.category).label, row.location, maintenancePriorityLabels[row.priority], maintenanceStatusLabels[row.status], row.createdByName, person(row.assigneeId), localDay(row.createdAt), localDay(row.resolvedAt), hoursBetween(row.createdAt, row.resolvedAt)]),
  };
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    if (!(await authorized(request, db))) return json({ error: "Acesso negado. Use uma chave de leitura de dados ou entre como administrador." }, 401);
    const params = new URL(request.url).searchParams;
    const dataset = params.get("dataset");
    const format = params.get("format") ?? "json";
    if (!isExportDataset(dataset)) return json({ error: "Conjunto de dados inválido. Use: tickets, tasks, hours, projects ou maintenance." }, 400);
    if (!isExportFormat(format)) return json({ error: "Formato inválido. Use xlsx, csv ou json." }, 400);
    const period = exportPeriod(params.get("from"), params.get("to"));
    const table = await buildTable(db, dataset, period);
    const truncated = table.rows.length > MAX_EXPORT_ROWS;
    if (truncated) table.rows = table.rows.slice(0, MAX_EXPORT_ROWS);
    const name = `${dataset}-${period.from ?? "inicio"}-a-${period.to ?? "hoje"}`;
    const headers = { "Cache-Control": "no-store", "X-Export-Truncated": truncated ? "1" : "0" };
    if (format === "json") return Response.json(toRecords(table), { headers });
    if (format === "csv") return new Response(toCsv(table), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
    return new Response(buildXlsx([{ name: dataset, ...table }]) as BodyInit, { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` } });
  } catch (error) {
    console.error("export failed", error);
    return json({ error: "Não foi possível gerar a exportação agora." }, 500);
  }
}
