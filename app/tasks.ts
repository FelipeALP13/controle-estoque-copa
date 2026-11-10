// Mesmos status das planilhas de demandas, na ordem do fluxo, mais "Cancelado".
export const taskStatuses = ["backlog", "todo", "in_progress", "in_review", "waiting", "blocked", "paused", "done", "canceled"] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskStatusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A Fazer",
  in_progress: "Fazendo",
  in_review: "Em Validação",
  waiting: "Aguardando Resposta",
  blocked: "Bloqueado",
  paused: "Pausado",
  done: "Concluído",
  canceled: "Cancelado",
};

/** Ordem de exibição: 1 crítica … 4 baixa, e 0 (sem prioridade) por último. */
export const taskPriorities = [1, 2, 3, 4, 0] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskPriorityLabels: Record<TaskPriority, string> = {
  0: "Sem prioridade",
  1: "Crítica",
  2: "Alta",
  3: "Média",
  4: "Baixa",
};

/** Categorias das planilhas de Suporte e Desenvolvimento (lista unificada). */
export const taskCategories = ["Atendimento", "Incidente", "Solicitação", "Bug", "Desenvolvimento", "Melhoria", "Análise", "Homologação", "Deploy", "Reunião", "Rotina interna", "Suporte", "Treinamento"] as const;

export const TASK_CODE_PREFIX = "DEM";
export const MAX_TITLE_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 8000;
export const MAX_COMMENT_LENGTH = 4000;

export type TaskEventKind = "comment" | "created" | "status" | "priority" | "assignee" | "due_date" | "title" | "team" | "people" | "client" | "category" | "imported";

export function taskCode(id: number) {
  return `${TASK_CODE_PREFIX}-${id}`;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (taskStatuses as readonly string[]).includes(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "number" && (taskPriorities as readonly number[]).includes(value);
}

export function isClosedStatus(status: TaskStatus) {
  return status === "done" || status === "canceled";
}

export function cleanTitle(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}

export function cleanMultiline(value: unknown, max: number) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** Aceita AAAA-MM-DD válido, vazio (sem prazo) ou devolve undefined para valor inválido. */
export function parseDueDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * Posição para inserir um cartão entre dois vizinhos (ordem crescente).
 * Sem vizinho acima, vai para antes do primeiro; sem vizinho abaixo, depois do último.
 */
export function sortOrderBetween(before: number | null, after: number | null) {
  if (before === null && after === null) return 1000;
  if (before === null) return after! - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** Situação do prazo em relação a hoje (datas AAAA-MM-DD). */
export function dueState(dueDate: string, today: string): DueState {
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  const diff = (new Date(`${dueDate}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86400000;
  return diff <= 3 ? "soon" : "later";
}

function shortDate(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/** Texto do histórico para uma mudança registrada em task_events. */
export function describeTaskEvent(kind: TaskEventKind, body: string) {
  if (kind === "created") return "criou a demanda";
  if (kind === "imported") return `importou da planilha (${body})`;
  if (kind === "people") return body ? `definiu os responsáveis: ${body}` : "removeu os responsáveis";
  if (kind === "client") return body ? `mudou o cliente/projeto para ${body}` : "removeu o cliente/projeto";
  if (kind === "category") return body ? `mudou a categoria para ${body}` : "removeu a categoria";
  if (kind === "status") return `mudou o status para ${isTaskStatus(body) ? taskStatusLabels[body] : body}`;
  if (kind === "priority") {
    const priority = Number(body);
    return isTaskPriority(priority) ? (priority === 0 ? "removeu a prioridade" : `definiu a prioridade como ${taskPriorityLabels[priority]}`) : "mudou a prioridade";
  }
  if (kind === "assignee") return body ? `atribuiu a ${body}` : "removeu o responsável";
  if (kind === "due_date") return body ? `definiu o prazo para ${shortDate(body)}` : "removeu o prazo";
  if (kind === "title") return `renomeou para “${body}”`;
  if (kind === "team") return body ? `moveu para o time ${body}` : "removeu o time";
  return body;
}
