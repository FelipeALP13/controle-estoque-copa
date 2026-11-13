// Regras puras (sem banco) de 1:1, plano de desenvolvimento, pesquisa de clima, equipamentos e incidentes.
// Não importa outros arquivos do app: os testes usam este módulo direto.

// ---------------- Pesquisa de clima ----------------

export const PULSE_MIN = 3;
export const MAX_PULSE_COMMENT = 500;
export const DEFAULT_PULSE_QUESTIONS = [
  "Como você está se sentindo no trabalho este mês?",
  "Sua carga de trabalho está adequada?",
  "Você se sente apoiado pelo time e pela liderança?",
];

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Mês da pesquisa (AAAA-MM) a partir do dia (AAAA-MM-DD). */
export const pulseMonth = (today: string) => today.slice(0, 7);

export function monthLabel(month: string) {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTHS[index] ? `${MONTHS[index]} de ${month.slice(0, 4)}` : month;
}

/** Perguntas, uma por linha: de 1 a 5 perguntas, sem repetidas, até 120 caracteres cada. */
export function parseQuestions(value: unknown) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const seen = new Set<string>();
  return list.map((entry) => String(entry ?? "").replace(/\s+/g, " ").trim().slice(0, 120)).filter((entry) => {
    const key = entry.toLocaleLowerCase("pt-BR");
    if (!entry || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

/** Médias por pergunta e geral; com menos de PULSE_MIN respostas, nada aparece (só a quantidade). */
export function averageScores(answers: readonly { scores: number[] }[], questions: readonly string[], minimum = PULSE_MIN) {
  const count = answers.length;
  if (count < minimum) return { count, hidden: true as const, averages: [] as { question: string; average: number }[], overall: null as number | null };
  const round = (value: number) => Math.round(value * 10) / 10;
  const averages = questions.map((question, index) => {
    const values = answers.map((answer) => answer.scores[index]).filter((score): score is number => typeof score === "number");
    return { question, average: values.length ? round(values.reduce((sum, score) => sum + score, 0) / values.length) : 0 };
  });
  const all = answers.flatMap((answer) => answer.scores);
  return { count, hidden: false as const, averages, overall: round(all.reduce((sum, score) => sum + score, 0) / all.length) };
}

export function moodOf(average: number | null) {
  if (average === null) return "none" as const;
  return average >= 4 ? "good" as const : average >= 3 ? "ok" as const : "bad" as const;
}

// ---------------- 1:1 e plano de desenvolvimento ----------------

export const devStatusLabels = { todo: "A fazer", doing: "Em andamento", done: "Concluída" } as const;
export type DevStatus = keyof typeof devStatusLabels;
export const isDevStatus = (value: unknown): value is DevStatus => typeof value === "string" && value in devStatusLabels;

/** Critérios com nota mais baixa (abaixo de 4), para sugerir onde focar o plano de desenvolvimento. */
export function weakestCriteria(averages: readonly { criterion: string; average: number }[], count = 2) {
  return [...averages].filter((item) => item.average > 0 && item.average < 4).sort((a, b) => a.average - b.average || a.criterion.localeCompare(b.criterion, "pt-BR")).slice(0, count);
}

export const isIsoDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

// ---------------- Equipamentos e licenças ----------------

export const assetKindLabels = { equipment: "Equipamento", license: "Licença" } as const;
export const assetStatusLabels = { in_use: "Em uso", available: "Disponível", maintenance: "Em manutenção", retired: "Baixado" } as const;
export type AssetStatus = keyof typeof assetStatusLabels;
export const isAssetStatus = (value: unknown): value is AssetStatus => typeof value === "string" && value in assetStatusLabels;

/** Aviso de vencimento: 30 e 7 dias antes, e no dia (ou já vencido). Fora disso, nenhum. */
export function expiryStage(expiresOn: string | null, today: string): 30 | 7 | 0 | null {
  if (!expiresOn || !isIsoDay(expiresOn)) return null;
  const left = daysBetween(today, expiresOn);
  if (left <= 0) return 0;
  if (left <= 7) return 7;
  if (left <= 30) return 30;
  return null;
}

export function expiryText(name: string, expiresOn: string, today: string) {
  const left = daysBetween(today, expiresOn);
  if (left < 0) return `${name} venceu há ${-left} dia${left === -1 ? "" : "s"}`;
  if (left === 0) return `${name} vence hoje`;
  return `${name} vence em ${left} dia${left === 1 ? "" : "s"}`;
}

// ---------------- Incidentes ----------------

export const incidentStatusLabels = { open: "Em andamento", resolved: "Resolvido, falta análise", analyzed: "Analisado" } as const;
export const severityLabels = { low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica" } as const;
export type IncidentStatus = keyof typeof incidentStatusLabels;
export type Severity = keyof typeof severityLabels;
export const isSeverity = (value: unknown): value is Severity => typeof value === "string" && value in severityLabels;
export const isIncidentStatus = (value: unknown): value is IncidentStatus => typeof value === "string" && value in incidentStatusLabels;

export function minutesBetween(startIso: string, endIso: string) {
  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000));
}

/** "35 min", "2 h 15 min", "3 d 4 h". */
export function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) { const rest = minutes % 60; return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`; }
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return `${Math.floor(minutes / (24 * 60))} d${hours ? ` ${hours} h` : ""}`;
}

/**
 * Situação depois de salvar: com fim, "aberto" vira "resolvido"; "analisado" exige causa e o que muda para não repetir.
 * Retorna o erro para a tela quando a análise está incompleta.
 */
export function nextIncidentStatus(input: { status: IncidentStatus; resolvedAt: string | null; cause: string; prevention: string }): { status: IncidentStatus; error: string | null } {
  if (input.status === "analyzed") {
    if (!input.resolvedAt) return { status: "open", error: "Informe quando o incidente terminou antes de concluir a análise." };
    if (!input.cause.trim() || !input.prevention.trim()) return { status: "resolved", error: "Para concluir a análise, preencha a causa e o que muda para não repetir." };
    return { status: "analyzed", error: null };
  }
  if (input.resolvedAt) return { status: "resolved", error: null };
  return { status: "open", error: null };
}

/** Números do período: quantos, abertos, sem análise, tempo total fora e tempo médio até resolver. */
export function incidentStats(rows: readonly { startedAt: string; resolvedAt: string | null; status: IncidentStatus }[], nowIso: string) {
  const resolved = rows.filter((row) => row.resolvedAt);
  const minutes = rows.map((row) => minutesBetween(row.startedAt, row.resolvedAt ?? nowIso));
  return {
    count: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    pendingAnalysis: rows.filter((row) => row.status === "resolved").length,
    totalMinutes: minutes.reduce((sum, value) => sum + value, 0),
    averageMinutes: resolved.length ? Math.round(resolved.reduce((sum, row) => sum + minutesBetween(row.startedAt, row.resolvedAt!), 0) / resolved.length) : null,
  };
}
