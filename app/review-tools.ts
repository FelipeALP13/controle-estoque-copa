// Regras puras (sem banco) da avaliação trimestral e das metas anuais. Usadas pela API, telas e testes.

export const DEFAULT_PEER_CRITERIA = ["Comunicação", "Colaboração com o time", "Qualidade do trabalho", "Cumprimento de prazos", "Proatividade"];
export const DEFAULT_COMPANY_CRITERIA = ["Ambiente de trabalho", "Ferramentas e estrutura", "Clareza de objetivos", "Reconhecimento", "Oportunidades de crescimento"];
export const DEFAULT_MANAGER_CRITERIA = ["Comunicação com a equipe", "Clareza nas decisões", "Apoio no dia a dia", "Feedback e reconhecimento", "Disponibilidade"];

/** Mínimo de respostas para mostrar a média (abaixo disso daria para adivinhar quem avaliou). */
export const MIN_ANSWERS = 3;
export const MAX_REVIEW_COMMENT = 1000;
export const MAX_CRITERION_NOTE = 300;
/** A cada quantos dias o Portal lembra os administradores de abrir um novo ciclo. */
export const REVIEW_EVERY_DAYS = 90;

/** Lista de critérios (JSON ou um por linha): sem vazios nem repetidos, de 1 a 10. */
export function parseCriteria(value: unknown) {
  let list: unknown[] = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string") {
    try { const parsed = JSON.parse(value) as unknown; list = Array.isArray(parsed) ? parsed : value.split(/\r?\n/); } catch { list = value.split(/\r?\n/); }
  }
  const seen = new Set<string>();
  return list.map((entry) => String(entry ?? "").replace(/^[-*•\d.)\s]+/, "").trim().slice(0, 60)).filter((entry) => {
    const key = entry.toLocaleLowerCase("pt-BR");
    if (!entry || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

export type Membership = { memberId: number; teamId: number; isLead: boolean };

/**
 * Colegas que a pessoa avalia: quem divide algum time com ela (no time ficam os colegas e os líderes do time),
 * sem ela mesma e só pessoas ativas. Ex.: desenvolvedor avalia desenvolvedores e líderes do Desenvolvimento.
 */
export function peersFor(memberId: number, memberships: readonly Membership[], activeIds: ReadonlySet<number>) {
  const myTeams = new Set(memberships.filter((row) => row.memberId === memberId).map((row) => row.teamId));
  return [...new Set(memberships.filter((row) => myTeams.has(row.teamId) && row.memberId !== memberId && activeIds.has(row.memberId)).map((row) => row.memberId))];
}

export type TargetKind = "member" | "company" | "manager";
export const memberTarget = (id: number) => `member:${id}`;
export const managerTarget = (id: number) => `manager:${id}`;
export const COMPANY_TARGET = "company";
export function parseTarget(value: unknown): { kind: TargetKind; id: number | null } | null {
  if (value === COMPANY_TARGET) return { kind: "company", id: null };
  const match = typeof value === "string" ? value.match(/^(member|manager):(\d+)$/) : null;
  return match ? { kind: match[1] as TargetKind, id: Number(match[2]) } : null;
}

/** Tudo o que a pessoa avalia no ciclo: colegas, a empresa e a gestão. */
export function targetsFor(memberId: number, memberships: readonly Membership[], activeIds: ReadonlySet<number>, managerIds: readonly number[]) {
  return [...peersFor(memberId, memberships, activeIds).map(memberTarget), COMPANY_TARGET, ...managerIds.map(managerTarget)];
}

/** Uma nota inteira de 1 a 5 por critério. */
export function validScores(value: unknown, count: number): number[] | null {
  if (!Array.isArray(value) || value.length !== count || !count) return null;
  const scores = value.map(Number);
  return scores.every((score) => Number.isInteger(score) && score >= 1 && score <= 5) ? scores : null;
}

/** Justificativas por critério: uma por nota, cortadas no limite; vazio quando ninguém escreveu nada. */
export function parseNotes(value: unknown, count: number, max = MAX_CRITERION_NOTE): string[] {
  if (!Array.isArray(value)) return [];
  const notes = Array.from({ length: count }, (_, index) => typeof value[index] === "string" ? value[index].replace(/\s+/g, " ").trim().slice(0, max) : "");
  return notes.some(Boolean) ? notes : [];
}

/** Médias por critério e geral. Com menos de MIN_ANSWERS respostas, nada é mostrado (só a quantidade). */
export function summarize(answers: readonly { scores: number[]; comment: string; notes?: string[] }[], criteria: readonly string[], minimum = MIN_ANSWERS) {
  const count = answers.length;
  if (count < minimum) return { count, hidden: true as const, averages: [] as { criterion: string; average: number }[], overall: null, comments: [] as string[], notes: [] as { criterion: string; comments: string[] }[] };
  const averages = criteria.map((criterion, index) => {
    const values = answers.map((answer) => answer.scores[index]).filter((score): score is number => typeof score === "number");
    return { criterion, average: values.length ? Math.round((values.reduce((sum, score) => sum + score, 0) / values.length) * 10) / 10 : 0 };
  });
  const all = answers.flatMap((answer) => answer.scores);
  // Comentários embaralhados por ordem alfabética, para não seguir a ordem em que chegaram.
  const comments = answers.map((answer) => answer.comment.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR"));
  // Justificativas agrupadas por critério, também em ordem alfabética.
  const notes = criteria.map((criterion, index) => ({ criterion, comments: answers.map((answer) => (answer.notes?.[index] ?? "").trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")) })).filter((group) => group.comments.length > 0);
  return { count, hidden: false as const, averages, overall: Math.round((all.reduce((sum, score) => sum + score, 0) / all.length) * 10) / 10, comments, notes };
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

/** Está na hora de abrir um novo ciclo? (nenhum ainda, ou o último começou há 90 dias ou mais) */
export function reviewDue(lastStart: string | null, today: string) {
  return !lastStart || dayNumber(today) - dayNumber(lastStart.slice(0, 10)) >= REVIEW_EVERY_DAYS;
}

/** Título sugerido: "Avaliação 4º trimestre 2026". */
export function quarterTitle(today: string) {
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  return `Avaliação ${quarter}º trimestre ${today.slice(0, 4)}`;
}

// ---------- Metas ----------

export type GoalValues = { direction: "up" | "down"; startValue: number; target: number; current: number };

/** Percentual atingido (0 a 100+). "up": do valor inicial até o alvo; "down": reduzir do inicial até o alvo. */
export function goalProgress(goal: GoalValues) {
  const span = goal.direction === "up" ? goal.target - goal.startValue : goal.startValue - goal.target;
  const done = goal.direction === "up" ? goal.current - goal.startValue : goal.startValue - goal.current;
  if (span <= 0) return (goal.direction === "up" ? goal.current >= goal.target : goal.current <= goal.target) ? 100 : 0;
  return Math.max(0, Math.round((done / span) * 100));
}

/** Situação comparando com o quanto do ano já passou: atingida, no ritmo, atenção ou atrasada. */
export function goalStatus(goal: GoalValues, year: number, today: string) {
  const progress = goalProgress(goal);
  if (progress >= 100) return { progress, status: "done" as const, expected: 100 };
  const start = dayNumber(`${year}-01-01`);
  const end = dayNumber(`${year}-12-31`);
  const elapsed = Math.min(1, Math.max(0, (dayNumber(today) - start) / (end - start)));
  const expected = Math.round(elapsed * 100);
  const status = progress >= expected - 5 ? ("on_track" as const) : progress >= expected - 20 ? ("attention" as const) : ("behind" as const);
  return { progress, status, expected };
}

export const goalStatusLabels = { done: "Atingida", on_track: "No ritmo", attention: "Atenção", behind: "Atrasada" } as const;

/** Número digitado ("1.234,5", "95%") → número; inválido → null. */
export function parseGoalNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/%$/, "").replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const number = Number(normalized);
  return Number.isFinite(number) && Math.abs(number) < 1e9 ? Math.round(number * 100) / 100 : null;
}
