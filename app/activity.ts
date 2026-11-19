// Mapa de calor da atividade (regras puras, testáveis): período, semanas e intensidade de cada dia.
// Sem imports de outros arquivos do app em tempo de execução (os testes rodam direto no Node).

export type ActivityDay = { tasks: number; tickets: number; hours: number };

const DAY_MS = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Hoje em Brasília (sem horário de verão). */
export function todayBrasilia(now: Date) {
  return iso(now.getTime() - 3 * 3600000);
}

/** Último ano em semanas completas: começa num domingo, 52 semanas antes da semana atual, e vai até hoje. */
export function activityRange(now: Date) {
  const to = todayBrasilia(now);
  const today = Date.parse(`${to}T12:00:00Z`);
  const weekday = new Date(today).getUTCDay();
  const from = iso(today - (weekday + 52 * 7) * DAY_MS);
  return { from, to };
}

/** Colunas do mapa: cada semana (domingo a sábado) com as datas; dias depois de `to` ficam null. */
export function activityWeeks(from: string, to: string) {
  const weeks: (string | null)[][] = [];
  const end = Date.parse(`${to}T12:00:00Z`);
  for (let start = Date.parse(`${from}T12:00:00Z`); start <= end; start += 7 * DAY_MS) {
    weeks.push(Array.from({ length: 7 }, (_, index) => {
      const ms = start + index * DAY_MS;
      return ms <= end ? iso(ms) : null;
    }));
  }
  return weeks;
}

/** Pontos do dia: cada demanda ou chamado vale 1; cada 2 horas lançadas valem 1. */
export function activityScore(day: ActivityDay | undefined) {
  if (!day) return 0;
  return day.tasks + day.tickets + day.hours / 2;
}

/** Intensidade de 0 (nada) a 4 (dia mais cheio), relativa ao maior dia do período. */
export function activityLevel(score: number, max: number) {
  if (score <= 0 || max <= 0) return 0;
  const ratio = score / max;
  return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
}

const formatHours = (hours: number) => (Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".", ","));

/** Texto do dia: "2 demandas, 1 chamado e 3,5 h". */
export function activityText(day: ActivityDay | undefined) {
  if (!day || activityScore(day) === 0) return "Sem atividade";
  const parts: string[] = [];
  if (day.tasks) parts.push(`${day.tasks} ${day.tasks === 1 ? "demanda concluída" : "demandas concluídas"}`);
  if (day.tickets) parts.push(`${day.tickets} ${day.tickets === 1 ? "chamado resolvido" : "chamados resolvidos"}`);
  if (day.hours) parts.push(`${formatHours(day.hours)} h lançadas`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : parts[0];
}

export function activityTotals(days: Record<string, ActivityDay>) {
  const total = { tasks: 0, tickets: 0, hours: 0, activeDays: 0 };
  for (const day of Object.values(days)) {
    total.tasks += day.tasks;
    total.tickets += day.tickets;
    total.hours += day.hours;
    if (activityScore(day) > 0) total.activeDays += 1;
  }
  total.hours = Math.round(total.hours * 10) / 10;
  return total;
}
