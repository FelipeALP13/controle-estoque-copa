// Leitura e validação das planilhas "Demandas Diárias" (Suporte e Desenvolvimento)
// e da aba "Projetos Grandes" (Liderança). Tudo aqui é puro: recebe as células como texto
// e devolve linhas normalizadas + problemas encontrados. Quem grava no banco é a API.

import type { TaskPriority, TaskStatus } from "./tasks";

export type WorkbookKind = "support" | "development" | "leadership";
export type RawSheet = { name: string; rows: string[][] };
export type Issue = { level: "error" | "warning"; sheet: string; row: number; message: string };

export type DemandRow = {
  workbook: WorkbookKind;
  sheet: string;
  row: number;
  code: string;
  tabOwner: string;
  openedOn: string | null;
  client: string;
  title: string;
  category: string;
  owners: string[];
  support: string[];
  priority: TaskPriority;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  completedOn: string | null;
  estimatedHours: number | null;
  workedHours: number | null;
  origin: string;
  notes: string;
};

export type ProjectRow = {
  sheet: string;
  row: number;
  client: string;
  name: string;
  description: string;
  people: string[];
  deadlineLabel: string;
  startDate: string | null;
  endForecast: string;
  status: TaskStatus;
  farol: "red" | "yellow" | "blue" | "green";
  phase: "planning" | "execution" | "validation" | "paused" | "closing";
  notes: string;
};

export type ParsedWorkbook = {
  kind: WorkbookKind;
  rosters: { support: string[]; development: string[] };
  demands: DemandRow[];
  projects: ProjectRow[];
  issues: Issue[];
};

/** Texto comparável: sem acento, minúsculo, espaços únicos. */
export function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

/** Chave de pessoa: ignora acento, caixa, pontos e espaços ("Allex T." = "allex t"). */
export function personKey(name: string) {
  return fold(name).replace(/[.\s]+/g, " ").trim();
}

/** Nomes diferentes que representam a mesma pessoa (decidido com a liderança). */
export const personAliases: Record<string, string> = { "miguel a": "Miguel R." };

export function canonicalPerson(name: string) {
  const clean = name.replace(/\s+/g, " ").trim();
  return personAliases[personKey(clean)] ?? clean;
}

/** "Allex T., Miguel R." ou "Allex T.; Miguel R." → ["Allex T.", "Miguel R."] (sem repetir). */
export function splitPeople(value: string) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(/[;,\n]/)) {
    const name = canonicalPerson(part);
    if (!name || seen.has(personKey(name))) continue;
    seen.add(personKey(name));
    result.push(name);
  }
  return result;
}

const pad = (value: number) => String(value).padStart(2, "0");

function isoIfValid(year: number, month: number, day: number) {
  if (year < 100) year += 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/**
 * Data da planilha → AAAA-MM-DD. Aceita dd/mm/aaaa, dd/mm/aa, AAAA-MM-DD e número de série do Excel.
 * Vazio ou textos como "A definir" → null sem erro (empty: true). Valor inválido → ok: false.
 */
export function parseSheetDate(value: string): { ok: boolean; value: string | null; empty: boolean } {
  const text = value.trim();
  if (!text || /^(a definir|sem data|-|—)$/i.test(text)) return { ok: true, value: null, empty: true };
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) { const iso = isoIfValid(Number(match[3]), Number(match[2]), Number(match[1])); return { ok: Boolean(iso), value: iso, empty: false }; }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (match) { const iso = isoIfValid(Number(match[1]), Number(match[2]), Number(match[3])); return { ok: Boolean(iso), value: iso, empty: false }; }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const date = new Date(Math.round((Number(text) - 25569) * 86400000));
    const iso = isoIfValid(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    return { ok: Boolean(iso), value: iso, empty: false };
  }
  return { ok: false, value: null, empty: false };
}

/** Horas: "88", "8,5", "8.5h". Vazio → null. Inválido ou negativo → ok: false. */
export function parseHours(value: string): { ok: boolean; value: number | null } {
  const text = value.trim().replace(/h$/i, "").replace(",", ".");
  if (!text) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, value: null };
  return { ok: true, value: Math.round(Number(text) * 100) / 100 };
}

const statusMap: Record<string, TaskStatus> = {
  "a fazer": "todo", fazendo: "in_progress", "em andamento": "in_progress", "em validacao": "in_review",
  concluido: "done", concluida: "done", pausado: "paused", bloqueado: "blocked", backlog: "backlog",
  "aguardando resposta": "waiting", aguardando: "waiting", cancelado: "canceled", cancelada: "canceled",
};

export function mapStatus(value: string): TaskStatus | null {
  return statusMap[fold(value)] ?? null;
}

const priorityMap: Record<string, TaskPriority> = { critica: 1, urgente: 1, alta: 2, media: 3, baixa: 4 };

export function mapPriority(value: string): TaskPriority | null {
  if (!value.trim()) return 0;
  return priorityMap[fold(value)] ?? null;
}

export function mapCategory(value: string, categories: readonly string[]) {
  const found = categories.find((category) => fold(category) === fold(value));
  return found ?? null;
}

const farolMap: Record<string, ProjectRow["farol"]> = { "🔴": "red", "🟡": "yellow", "🔵": "blue", "🟢": "green", vermelho: "red", amarelo: "yellow", azul: "blue", verde: "green" };
const phaseMap: Record<string, ProjectRow["phase"]> = { planejamento: "planning", "execucao / monitoramento": "execution", execucao: "execution", validacao: "validation", pausado: "paused", encerramento: "closing" };

export function mapFarol(value: string) {
  return farolMap[value.trim()] ?? farolMap[fold(value)] ?? null;
}

export function mapPhase(value: string) {
  return phaseMap[fold(value)] ?? null;
}

/** Cabeçalhos das abas pessoais → campo. Comparação sem acento e sem caixa. */
const headerFields: Record<string, keyof DemandRow | "skip"> = {
  id: "code", data: "openedOn", "cliente / projeto": "client", "demanda / atividade": "title", categoria: "category",
  responsaveis: "owners", "resp. suporte": "support", prioridade: "priority", status: "status",
  "data de inicio": "startDate", prazo: "dueDate", "data de conclusao": "completedOn",
  "horas estimadas": "estimatedHours", "horas trabalhadas": "workedHours", "origem / ticket": "origin", "obs / impedimentos": "notes",
};

/** Ordem das colunas logo depois de "Status" quando o cabeçalho vem em branco. */
const afterStatus: (keyof DemandRow)[] = ["startDate", "dueDate", "completedOn", "estimatedHours", "workedHours", "origin", "notes"];

function columnMap(header: string[]) {
  const map = new Map<keyof DemandRow | "skip", number>();
  header.forEach((cell, index) => {
    const field = headerFields[fold(cell)];
    if (field && !map.has(field)) map.set(field, index);
  });
  const statusIndex = map.get("status");
  if (statusIndex !== undefined) {
    afterStatus.forEach((field, offset) => {
      if (!map.has(field) && !header[statusIndex + 1 + offset]?.trim()) map.set(field, statusIndex + 1 + offset);
    });
  }
  return map;
}

function readRoster(sheet: RawSheet, title: string) {
  for (let r = 0; r < Math.min(sheet.rows.length, 10); r += 1) {
    const col = sheet.rows[r].findIndex((cell) => fold(cell) === fold(title));
    if (col < 0) continue;
    const names: string[] = [];
    for (let i = r + 1; i < sheet.rows.length; i += 1) {
      const cell = (sheet.rows[i][col] ?? "").trim();
      if (!cell) continue;
      if (cell.length > 40) break; // nota de rodapé da lista
      const name = canonicalPerson(cell);
      if (!names.some((existing) => personKey(existing) === personKey(name))) names.push(name);
    }
    return names;
  }
  return [];
}

const isPersonTab = (sheet: RawSheet) => fold(sheet.rows[0]?.[0] ?? "").startsWith("minhas demandas");

function readDemandTab(kind: WorkbookKind, sheet: RawSheet, categories: readonly string[], issues: Issue[]) {
  const demands: DemandRow[] = [];
  const headerIndex = sheet.rows.findIndex((row) => fold(row[0] ?? "") === "id");
  const tabOwner = canonicalPerson((sheet.rows[0]?.[0] ?? "").split("|")[1] ?? sheet.name);
  if (headerIndex < 0) {
    issues.push({ level: "error", sheet: sheet.name, row: 1, message: "Não encontrei a linha de cabeçalho (coluna \"ID\")." });
    return demands;
  }
  const map = columnMap(sheet.rows[headerIndex]);
  for (const required of ["title", "status"] as const) {
    if (!map.has(required)) issues.push({ level: "error", sheet: sheet.name, row: headerIndex + 1, message: `Coluna obrigatória não encontrada: ${required === "title" ? "Demanda / Atividade" : "Status"}.` });
  }
  if (!map.has("title") || !map.has("status")) return demands;
  const cell = (row: string[], field: keyof DemandRow) => { const index = map.get(field); return index === undefined ? "" : String(row[index] ?? "").trim(); };

  for (let r = headerIndex + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const line = r + 1;
    const title = cell(row, "title").replace(/\s+/g, " ");
    const code = cell(row, "code").toUpperCase();
    if (!title && !code && !row.some((value) => String(value ?? "").trim())) continue;
    const warn = (message: string) => issues.push({ level: "warning", sheet: sheet.name, row: line, message: `${code || "sem ID"}: ${message}` });
    const fail = (message: string) => issues.push({ level: "error", sheet: sheet.name, row: line, message: `${code || "sem ID"}: ${message}` });
    if (!title) { fail("linha sem \"Demanda / Atividade\"."); continue; }
    if (!code) warn("linha sem ID; será importada sem código antigo.");

    const statusText = cell(row, "status");
    const status = mapStatus(statusText);
    if (!status) { fail(statusText ? `status desconhecido "${statusText}".` : "status vazio."); continue; }

    const priorityText = cell(row, "priority");
    let priority = mapPriority(priorityText);
    if (priority === null) { warn(`prioridade desconhecida "${priorityText}"; ficará sem prioridade.`); priority = 0; }

    const categoryText = cell(row, "category");
    let category = categoryText;
    if (categoryText) {
      const known = mapCategory(categoryText, categories);
      if (known) category = known; else warn(`categoria fora da lista "${categoryText}"; mantida como está.`);
    }

    const dates = {} as Record<"openedOn" | "startDate" | "dueDate" | "completedOn", string | null>;
    for (const field of ["openedOn", "startDate", "dueDate", "completedOn"] as const) {
      const raw = cell(row, field);
      const parsed = parseSheetDate(raw);
      if (!parsed.ok) warn(`data inválida em ${{ openedOn: "Data", startDate: "Data de Início", dueDate: "Prazo", completedOn: "Data de Conclusão" }[field]}: "${raw}"; ficará em branco.`);
      dates[field] = parsed.value;
    }
    const hours = {} as Record<"estimatedHours" | "workedHours", number | null>;
    for (const field of ["estimatedHours", "workedHours"] as const) {
      const raw = cell(row, field);
      const parsed = parseHours(raw);
      if (!parsed.ok) warn(`horas inválidas em ${field === "estimatedHours" ? "Horas Estimadas" : "Horas Trabalhadas"}: "${raw}"; ficará em branco.`);
      hours[field] = parsed.value;
    }

    let owners = splitPeople(cell(row, "owners"));
    if (!owners.length) { owners = [tabOwner]; warn(`sem responsável; usei o dono da aba (${tabOwner}).`); }
    const support = splitPeople(cell(row, "support")).filter((name) => !owners.some((owner) => personKey(owner) === personKey(name)));
    if (status === "done" && !dates.completedOn) warn("concluída sem Data de Conclusão.");

    demands.push({
      workbook: kind, sheet: sheet.name, row: line, code, tabOwner,
      client: cell(row, "client").replace(/\s+/g, " "), title, category, owners, support, priority, status,
      origin: cell(row, "origin"), notes: cell(row, "notes"),
      ...dates, ...hours,
    });
  }
  return demands;
}

function readProjects(sheet: RawSheet, issues: Issue[]) {
  const projects: ProjectRow[] = [];
  const headerIndex = sheet.rows.findIndex((row) => fold(row[0] ?? "") === "projeto / modulo");
  if (headerIndex < 0) { issues.push({ level: "error", sheet: sheet.name, row: 1, message: "Não encontrei o cabeçalho \"Projeto / Módulo\"." }); return projects; }
  const header = sheet.rows[headerIndex].map((cell) => fold(cell));
  const find = (prefix: string) => header.findIndex((cell) => cell.startsWith(prefix));
  const col = { client: 0, name: find("demanda"), description: find("descricao"), people: find("responsaveis"), deadline: find("prazo"), start: find("data de inicio"), end: find("previsao"), status: find("status"), farol: find("farol"), phase: find("fase"), notes: find("obs") };
  const get = (row: string[], index: number) => (index < 0 ? "" : String(row[index] ?? "").trim());
  for (let r = headerIndex + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const line = r + 1;
    const name = get(row, col.name).replace(/\s+/g, " ");
    if (!name) { if (row.some((value) => String(value ?? "").trim())) issues.push({ level: "warning", sheet: sheet.name, row: line, message: "linha sem nome de demanda/projeto; ignorada." }); continue; }
    const label = `${get(row, col.client)} · ${name}`;
    const status = mapStatus(get(row, col.status));
    if (!status) { issues.push({ level: "error", sheet: sheet.name, row: line, message: `${label}: status desconhecido "${get(row, col.status)}".` }); continue; }
    const farol = mapFarol(get(row, col.farol));
    if (!farol && get(row, col.farol)) issues.push({ level: "warning", sheet: sheet.name, row: line, message: `${label}: farol desconhecido "${get(row, col.farol)}"; ficará azul.` });
    const phase = mapPhase(get(row, col.phase));
    if (!phase && get(row, col.phase)) issues.push({ level: "warning", sheet: sheet.name, row: line, message: `${label}: fase desconhecida "${get(row, col.phase)}"; ficará Planejamento.` });
    const start = parseSheetDate(get(row, col.start));
    if (!start.ok) issues.push({ level: "warning", sheet: sheet.name, row: line, message: `${label}: data de início inválida "${get(row, col.start)}"; ficará em branco.` });
    const endText = get(row, col.end);
    const end = parseSheetDate(endText);
    projects.push({
      sheet: sheet.name, row: line, client: get(row, col.client), name, description: get(row, col.description),
      people: splitPeople(get(row, col.people)), deadlineLabel: get(row, col.deadline), startDate: start.value,
      endForecast: end.ok && end.value ? end.value : endText, status, farol: farol ?? "blue", phase: phase ?? "planning", notes: get(row, col.notes),
    });
  }
  return projects;
}

/** Lê uma pasta de trabalho inteira (todas as abas) já convertida para texto. */
export function parseWorkbook(kind: WorkbookKind, sheets: RawSheet[], categories: readonly string[]): ParsedWorkbook {
  const issues: Issue[] = [];
  const result: ParsedWorkbook = { kind, rosters: { support: [], development: [] }, demands: [], projects: [], issues };
  if (kind === "leadership") {
    const sheet = sheets.find((entry) => fold(entry.name) === "projetos grandes");
    if (!sheet) issues.push({ level: "error", sheet: "(arquivo)", row: 0, message: "Este arquivo não tem a aba \"Projetos Grandes\". Confira se é a planilha da Liderança." });
    else result.projects = readProjects(sheet, issues);
    return result;
  }
  const config = sheets.find((entry) => fold(entry.name) === "configuracoes");
  if (config) {
    result.rosters.support = readRoster(config, "Equipe de Suporte");
    result.rosters.development = readRoster(config, "Equipe de Desenvolvimento");
  } else {
    issues.push({ level: "warning", sheet: "(arquivo)", row: 0, message: "Aba \"Configurações\" não encontrada; os times das pessoas serão deduzidos pelas abas." });
  }
  const personTabs = sheets.filter(isPersonTab);
  if (!personTabs.length) issues.push({ level: "error", sheet: "(arquivo)", row: 0, message: `Nenhuma aba "Minhas Demandas" encontrada. Confira se é a planilha de ${kind === "support" ? "Suporte" : "Desenvolvimento"}.` });
  for (const sheet of personTabs) result.demands.push(...readDemandTab(kind, sheet, categories, issues));
  return result;
}

export type MergedDemand = DemandRow & { codes: string[]; sources: string[]; merged: number };

// Posição no fluxo: na junção vale o status mais atrasado (decisão da liderança).
const statusProgress: Record<TaskStatus, number> = { backlog: 0, todo: 1, paused: 2, blocked: 2, waiting: 2, in_progress: 3, in_review: 4, done: 5, canceled: 6 };
const statusNames: Record<TaskStatus, string> = { backlog: "Backlog", todo: "A Fazer", in_progress: "Fazendo", in_review: "Em Validação", waiting: "Aguardando Resposta", blocked: "Bloqueado", paused: "Pausado", done: "Concluído", canceled: "Cancelado" };

/**
 * Regras da junção (decididas com a liderança):
 * status = o mais atrasado; horas trabalhadas = soma (cada pessoa lançou as suas); horas estimadas = maior valor;
 * datas e textos vazios na linha principal são completados com os das outras linhas.
 */
function combineRows(primary: DemandRow, others: DemandRow[], issues: Issue[]): DemandRow {
  const all = [primary, ...others];
  const first = <T>(pick: (row: DemandRow) => T | null | "") => { for (const row of all) { const value = pick(row); if (value !== null && value !== "") return value; } return null; };
  const earliest = (pick: (row: DemandRow) => string | null) => all.map(pick).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const latest = (pick: (row: DemandRow) => string | null) => all.map(pick).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const status = all.map((row) => row.status).sort((a, b) => statusProgress[a] - statusProgress[b])[0];
  const worked = all.map((row) => row.workedHours).filter((value): value is number => value !== null);
  const estimated = all.map((row) => row.estimatedHours).filter((value): value is number => value !== null);
  const notes = [...new Set(all.map((row) => row.notes.trim()).filter(Boolean))].join("\n");

  const notesForLeader: string[] = [];
  if (new Set(all.map((row) => row.status)).size > 1) notesForLeader.push(`status diferentes (${all.map((row) => `${row.code || "sem ID"}: ${statusNames[row.status]}`).join(", ")}) → ficou ${statusNames[status]}, o mais atrasado`);
  if (worked.length > 1) notesForLeader.push(`horas trabalhadas somadas (${worked.join(" + ")} = ${Math.round(worked.reduce((total, value) => total + value, 0) * 100) / 100} h)`);
  if (new Set(all.map((row) => fold(row.client)).filter(Boolean)).size > 1) notesForLeader.push(`clientes diferentes (${[...new Set(all.map((row) => row.client).filter(Boolean))].join(", ")}) → ficou ${primary.client || first((row) => row.client)}`);
  if (notesForLeader.length) issues.push({ level: "warning", sheet: primary.sheet, row: primary.row, message: `${all.map((row) => row.code || "sem ID").join(" + ")} foram unidas: ${notesForLeader.join("; ")}.` });

  return {
    ...primary,
    status,
    priority: primary.priority || (first((row) => row.priority || null) as TaskPriority | null) || 0,
    client: primary.client || (first((row) => row.client) as string | null) || "",
    category: primary.category || (first((row) => row.category) as string | null) || "",
    openedOn: earliest((row) => row.openedOn),
    startDate: earliest((row) => row.startDate),
    dueDate: primary.dueDate ?? latest((row) => row.dueDate),
    // Concluída: a data mais recente entre as linhas. Se não ficou concluída, mantém o que a planilha tinha.
    completedOn: status === "done" ? latest((row) => row.completedOn) : primary.completedOn ?? latest((row) => row.completedOn),
    estimatedHours: estimated.length ? Math.max(...estimated) : null,
    workedHours: worked.length ? Math.round(worked.reduce((total, value) => total + value, 0) * 100) / 100 : null,
    origin: primary.origin || (first((row) => row.origin) as string | null) || "",
    notes,
  };
}

/**
 * Junta a mesma demanda repetida em abas diferentes: mesmo cliente, mesmo título,
 * vinda de outra aba e com pelo menos uma pessoa em comum. Linhas da mesma aba nunca se juntam.
 */
export function mergeDemands(rows: DemandRow[], issues: Issue[]): MergedDemand[] {
  const groups = new Map<string, DemandRow[]>();
  for (const row of rows) {
    const key = fold(row.title);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ownersKey = (row: DemandRow) => row.owners.map(personKey).sort().join("|");
  // Mesma demanda: mesmo cliente e alguém em comum, ou (cliente diferente) exatamente os mesmos 2+ responsáveis.
  const sameDemand = (a: DemandRow, b: DemandRow) => {
    if (fold(a.client) === fold(b.client)) {
      const people = new Set([a.tabOwner, ...a.owners, ...a.support].map(personKey));
      return [b.tabOwner, ...b.owners, ...b.support].some((name) => people.has(personKey(name)));
    }
    return a.owners.length >= 2 && ownersKey(a) === ownersKey(b);
  };
  const result: MergedDemand[] = [];
  for (const group of groups.values()) {
    const clusters: DemandRow[][] = [];
    for (const row of group) {
      const cluster = clusters.find((members) => members.every((member) => `${member.workbook}/${member.sheet}` !== `${row.workbook}/${row.sheet}`)
        && members.some((member) => sameDemand(member, row)));
      if (cluster) cluster.push(row); else clusters.push([row]);
    }
    for (const cluster of clusters) {
      // Se a demanda aparece no Suporte e no Desenvolvimento, quem executa é o Desenvolvimento:
      // a linha principal vem de lá e as pessoas do Suporte viram "Resp. Suporte".
      const executing = cluster.some((row) => row.workbook === "development") ? cluster.filter((row) => row.workbook === "development") : cluster;
      // Entre essas, a principal é a da aba do primeiro responsável; senão, a primeira encontrada.
      const primary = executing.find((row) => personKey(row.tabOwner) === personKey(row.owners[0] ?? "")) ?? executing[0];
      const owners: string[] = [];
      const support: string[] = [];
      const add = (list: string[], name: string) => { if (![...owners, ...support].some((existing) => personKey(existing) === personKey(name))) list.push(name); };
      for (const row of [primary, ...executing.filter((entry) => entry !== primary)]) row.owners.forEach((name) => add(owners, name));
      for (const row of cluster) row.support.forEach((name) => add(support, name));
      for (const row of cluster.filter((entry) => !executing.includes(entry))) row.owners.forEach((name) => add(support, name));
      const others = cluster.filter((row) => row !== primary);
      const combined = cluster.length > 1 ? combineRows(primary, others, issues) : primary;
      result.push({ ...combined, owners, support, codes: cluster.map((row) => row.code).filter(Boolean), sources: cluster.map((row) => `${row.sheet} (linha ${row.row})`), merged: cluster.length });
    }
  }
  return result;
}

const dayMs = 86400000;

/**
 * Horas suspeitas: mais horas do que cabem no período (24 h por dia) ou acima de 1.000 h.
 * O período vai do início (ou abertura) até a conclusão; concluída sem data usa o prazo; aberta usa hoje.
 */
export function suspiciousHours(demand: Pick<DemandRow, "status" | "openedOn" | "startDate" | "dueDate" | "completedOn" | "estimatedHours" | "workedHours">, today: string) {
  const reasons: string[] = [];
  const start = demand.startDate ?? demand.openedOn;
  const end = demand.completedOn ?? (demand.status === "done" ? demand.dueDate ?? today : today);
  const span = start && end >= start ? Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / dayMs) + 1 : null;
  for (const [field, label] of [["workedHours", "trabalhadas"], ["estimatedHours", "estimadas"]] as const) {
    const value = demand[field];
    if (value === null) continue;
    if (value > 1000) reasons.push(`${value} h ${label} (acima de 1.000 h)`);
    else if (field === "workedHours" && span !== null && value > span * 24) reasons.push(`${value} h ${label} em ${span} dia${span === 1 ? "" : "s"}`);
  }
  return reasons;
}
