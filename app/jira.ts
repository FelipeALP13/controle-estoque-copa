// Integração com o Jira Cloud: regras puras (sem banco e sem rede), usadas pela sincronização e pelos testes.
// Sem imports de outros arquivos do app em tempo de execução (os testes rodam direto no Node).

import type { TicketStatus, TicketType, TicketUrgency } from "./tickets";

/** Intervalo mínimo entre duas buscas automáticas na mesma conta. */
export const SYNC_INTERVAL_MS = 2 * 60 * 1000;
/** Na primeira busca: tudo que está aberto e o que mudou nos últimos 7 dias. */
export const FIRST_SYNC_DAYS = 7;
/** Folga ao buscar "o que mudou desde a última vez", para cobrir diferença de relógio. */
export const OVERLAP_MINUTES = 10;
export const MAX_PAGES_PER_SYNC = 5;
export const PAGE_SIZE = 50;

/**
 * Endereço da conta: só https://<nome>.atlassian.net (sem caminho).
 * Em ambiente local aceita http://127.0.0.1:<porta> para testes com um Jira simulado.
 */
export function normalizeJiraUrl(value: string, allowLocal = false) {
  let url: URL;
  try {
    url = new URL(value.trim().startsWith("http") ? value.trim() : `https://${value.trim()}`);
  } catch {
    return null;
  }
  const local = allowLocal && url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!local && (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(url.hostname))) return null;
  return `${url.protocol}//${url.host}`.toLowerCase();
}

export function basicAuth(email: string, token: string) {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

const quoteKey = (key: string) => `"${key.replace(/["\\]/g, "")}"`;

/** JQL da busca. Com `sinceMinutes`, só o que mudou; sem, a primeira carga. */
export function buildJql(projectKeys: readonly string[], sinceMinutes: number | null) {
  const projects = `project in (${projectKeys.map(quoteKey).join(", ")})`;
  if (sinceMinutes === null) return `${projects} AND (statusCategory != Done OR updated >= -${FIRST_SYNC_DAYS}d) ORDER BY updated ASC`;
  return `${projects} AND updated >= -${Math.max(1, Math.ceil(sinceMinutes))}m ORDER BY updated ASC`;
}

/** Minutos a buscar desde o último ponto sincronizado, com a folga. */
export function minutesSince(cursorAt: string | null, now: Date) {
  if (!cursorAt) return null;
  const last = Date.parse(cursorAt);
  if (Number.isNaN(last)) return null;
  return Math.max(0, (now.getTime() - last) / 60000) + OVERLAP_MINUTES;
}

type AdfNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: AdfNode[] };

/** Converte o texto do Jira (formato ADF) em texto simples, mantendo parágrafos e listas. */
export function adfToText(doc: unknown): string {
  if (typeof doc === "string") return doc.trim();
  if (!doc || typeof doc !== "object") return "";
  const walk = (node: AdfNode, prefix = ""): string => {
    const children = (list: AdfNode[] | undefined, childPrefix = prefix) => (list ?? []).map((child) => walk(child, childPrefix)).join("");
    switch (node.type) {
      case "text": return node.text ?? "";
      case "hardBreak": return "\n";
      case "mention": return String(node.attrs?.text ?? "@alguém");
      case "emoji": return String(node.attrs?.text ?? node.attrs?.shortName ?? "");
      case "inlineCard": case "blockCard": return String(node.attrs?.url ?? "");
      case "date": return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : "";
      case "status": return `[${String(node.attrs?.text ?? "")}]`;
      case "mediaSingle": case "mediaGroup": case "media": return "[anexo]\n\n";
      case "paragraph": case "heading": return `${children(node.content)}\n\n`;
      case "codeBlock": return `${children(node.content)}\n\n`;
      case "blockquote": return children(node.content).split("\n").map((line) => (line ? `> ${line}` : line)).join("\n");
      case "rule": return "---\n\n";
      case "bulletList": return `${(node.content ?? []).map((item) => `- ${walk(item).trim()}`).join("\n")}\n\n`;
      case "orderedList": return `${(node.content ?? []).map((item, index) => `${index + 1}. ${walk(item).trim()}`).join("\n")}\n\n`;
      case "listItem": return children(node.content);
      case "table": return `${(node.content ?? []).map((row) => (row.content ?? []).map((cell) => walk(cell).trim().replace(/\s*\n+\s*/g, " ")).join(" | ")).join("\n")}\n\n`;
      default: return children(node.content);
    }
  };
  return walk(doc as AdfNode).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Prioridade do Jira → urgência do chamado. */
export function urgencyFrom(priority: string | null | undefined): TicketUrgency {
  const name = fold(priority ?? "");
  if (/highest|blocker|critic|urgent|mais alta|altissima|maxima/.test(name)) return "critical";
  if (/high|alta|major|importante/.test(name)) return "high";
  if (/lowest|low|baixa|minor|trivial|mais baixa/.test(name)) return "low";
  return "normal";
}

/** Tipo do item no Jira → tipo do chamado. */
export function typeFrom(issueType: string | null | undefined): TicketType {
  const name = fold(issueType ?? "");
  if (/bug|erro|defeito|incidente|incident|falha|problem/.test(name)) return "bug";
  if (/melhoria|improvement|story|historia|feature|nova funcionalidade|change|mudanca/.test(name)) return "improvement";
  if (/acesso|access|permiss|senha|password/.test(name)) return "access";
  if (/duvida|question|pergunta|suporte|support|service request|solicitacao|requisicao|task|tarefa/.test(name)) return "question";
  return "other";
}

/** Categoria do status no Jira (new / indeterminate / done) → status do chamado. */
export function statusFrom(category: string | null | undefined): TicketStatus {
  if (category === "done") return "resolved";
  if (category === "indeterminate") return "in_progress";
  return "open";
}

export type JiraComment = { id: string; author: string; authorId: string | null; body: string; created: string };
export type JiraIssueData = {
  key: string; url: string; projectKey: string; title: string; description: string;
  type: TicketType; urgency: TicketUrgency; statusName: string; category: string; status: TicketStatus;
  reporter: string; reporterId: string | null; created: string; updated: string; resolved: string | null;
  firstResponse: string | null; comments: JiraComment[];
};

const iso = (value: unknown) => {
  const time = Date.parse(String(value ?? ""));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

/** Lê um item da busca do Jira (/rest/api/3/search/jql) no formato usado pelo Portal. */
export function parseIssue(issue: unknown, baseUrl: string): JiraIssueData | null {
  const raw = issue as { key?: string; fields?: Record<string, unknown> };
  const fields = raw?.fields;
  if (!raw?.key || !fields) return null;
  const pick = <T>(value: unknown) => (value && typeof value === "object" ? value as T : null);
  const status = pick<{ name?: string; statusCategory?: { key?: string } }>(fields.status);
  const reporter = pick<{ displayName?: string; accountId?: string }>(fields.reporter);
  const created = iso(fields.created) ?? new Date().toISOString();
  const commentList = pick<{ comments?: unknown[] }>(fields.comment)?.comments ?? [];
  const comments: JiraComment[] = commentList.flatMap((entry) => {
    const comment = entry as { id?: string; author?: { displayName?: string; accountId?: string }; body?: unknown; created?: string };
    const when = iso(comment.created);
    if (!comment.id || !when) return [];
    return [{ id: String(comment.id), author: comment.author?.displayName ?? "Jira", authorId: comment.author?.accountId ?? null, body: adfToText(comment.body), created: when }];
  }).sort((a, b) => a.created.localeCompare(b.created));
  const reporterId = reporter?.accountId ?? null;
  // Primeira resposta: o primeiro comentário de alguém que não é quem abriu.
  const firstResponse = comments.find((comment) => !reporterId || comment.authorId !== reporterId)?.created ?? null;
  const category = status?.statusCategory?.key ?? "new";
  return {
    key: raw.key,
    url: `${baseUrl}/browse/${raw.key}`,
    projectKey: String(pick<{ key?: string }>(fields.project)?.key ?? raw.key.split("-")[0]),
    title: String(fields.summary ?? raw.key).replace(/\s+/g, " ").trim().slice(0, 160) || raw.key,
    description: adfToText(fields.description).slice(0, 5000),
    type: typeFrom(pick<{ name?: string }>(fields.issuetype)?.name),
    urgency: urgencyFrom(pick<{ name?: string }>(fields.priority)?.name),
    statusName: status?.name ?? "",
    category,
    status: statusFrom(category),
    reporter: reporter?.displayName ?? "Cliente",
    reporterId,
    created,
    updated: iso(fields.updated) ?? created,
    resolved: category === "done" ? iso(fields.resolutiondate) ?? iso(fields.updated) : null,
    firstResponse,
    comments,
  };
}

/**
 * Status do chamado depois de uma atualização do Jira. Só muda quando a categoria mudou lá:
 * assim o Portal pode marcar "aguardando" sem a próxima busca desfazer.
 */
export function nextStatus(current: TicketStatus, previousCategory: string | null, issue: Pick<JiraIssueData, "category" | "status">) {
  if (previousCategory === issue.category) return current;
  if (current === "canceled" && issue.status !== "resolved") return current;
  return issue.status;
}

export const JIRA_FIELDS = ["summary", "description", "issuetype", "priority", "status", "reporter", "created", "updated", "resolutiondate", "comment", "project"];

/** Mensagem curta para erros da API do Jira. */
export function jiraErrorMessage(status: number, body: string) {
  if (status === 401) return "O Jira recusou o e-mail ou a chave de API. Gere uma chave nova em id.atlassian.com e salve de novo.";
  if (status === 403) return "Este usuário do Jira não tem permissão para ver esses projetos.";
  if (status === 404) return "Endereço do Jira não encontrado. Confira se é https://suaempresa.atlassian.net.";
  if (status === 429) return "O Jira pediu para esperar (muitas consultas). A próxima busca tenta de novo.";
  if (status === 400) {
    try {
      const parsed = JSON.parse(body) as { errorMessages?: string[] };
      if (parsed.errorMessages?.length) return `O Jira não aceitou a busca: ${parsed.errorMessages[0]}`;
    } catch { /* corpo não é JSON */ }
    return "O Jira não aceitou a busca. Confira se os projetos marcados ainda existem.";
  }
  return `O Jira respondeu com erro ${status}. A próxima busca tenta de novo.`;
}
