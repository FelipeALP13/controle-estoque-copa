// Qualidade do Suporte: prazos cumpridos, tempos de resposta e solução, por cliente, pessoa e mês.
// Regras puras: os prazos (horas por urgência) chegam como parâmetro, sem importar outros arquivos do app.

export type QualityTicket = {
  id: number; status: string; urgency: string; client: string; assigneeId: number | null; teamId: number | null;
  createdAt: string; firstResponseAt: string | null; resolvedAt: string | null;
};
export type Deadlines = { response: Record<string, number>; resolution: Record<string, number> };

/** Datas do banco: ISO ou "AAAA-MM-DD HH:MM:SS" (UTC sem fuso). */
export const toTime = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);

/** Dia (AAAA-MM-DD) no horário de Brasília (UTC-3, sem horário de verão). */
export const localDay = (value: string) => new Date(toTime(value) - 3 * 3600000).toISOString().slice(0, 10);

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const rate = (met: number, total: number) => (total ? met / total : null);

/**
 * Situação de um prazo: "met" (cumprido), "late" (cumprido com atraso ou vencido sem cumprir)
 * ou null (ainda dentro do prazo, sem resultado — não entra na conta).
 */
export function deadlineOutcome(createdAt: string, doneAt: string | null, hours: number, now: number): "met" | "late" | null {
  const due = toTime(createdAt) + hours * 3600000;
  if (doneAt) return toTime(doneAt) <= due ? "met" : "late";
  return now > due ? "late" : null;
}

type Group = { opened: number; resolved: number; responseMet: number; responseTotal: number; resolutionMet: number; resolutionTotal: number; responseMinutes: number[]; resolutionMinutes: number[] };
const emptyGroup = (): Group => ({ opened: 0, resolved: 0, responseMet: 0, responseTotal: 0, resolutionMet: 0, resolutionTotal: 0, responseMinutes: [], resolutionMinutes: [] });

function summarizeGroup(group: Group) {
  return {
    opened: group.opened,
    resolved: group.resolved,
    responseRate: rate(group.responseMet, group.responseTotal),
    resolutionRate: rate(group.resolutionMet, group.resolutionTotal),
    avgResponseMinutes: average(group.responseMinutes),
    medianResponseMinutes: median(group.responseMinutes),
    avgResolutionMinutes: average(group.resolutionMinutes),
    medianResolutionMinutes: median(group.resolutionMinutes),
  };
}

/**
 * Indicadores do período [from, to] (dias de Brasília):
 * prazos e tempo de resposta contam os chamados ABERTOS no período; "resolvidos" e o tempo de solução contam
 * os RESOLVIDOS no período. Cancelados ficam de fora. "Em aberto" e "atrasados" são a situação de agora.
 */
export function qualityReport(tickets: readonly QualityTicket[], options: { from: string; to: string; now: number; deadlines: Deadlines }) {
  const { from, to, now, deadlines } = options;
  const total = emptyGroup();
  const byClient = new Map<string, Group>();
  const byPerson = new Map<number | null, Group>();
  const byUrgency = new Map<string, Group>();
  let backlog = 0;
  let lateNow = 0;

  for (const ticket of tickets) {
    if (ticket.status === "canceled") continue;
    const active = ticket.status !== "resolved";
    if (active) {
      backlog += 1;
      const responseLate = !ticket.firstResponseAt && deadlineOutcome(ticket.createdAt, null, deadlines.response[ticket.urgency] ?? 24, now) === "late";
      const resolutionLate = deadlineOutcome(ticket.createdAt, null, deadlines.resolution[ticket.urgency] ?? 120, now) === "late";
      if (responseLate || resolutionLate) lateNow += 1;
    }
    const groups = [total, getGroup(byClient, ticket.client.trim() || "Sem cliente"), getGroup(byPerson, ticket.assigneeId), getGroup(byUrgency, ticket.urgency)];
    const openedDay = localDay(ticket.createdAt);
    if (openedDay >= from && openedDay <= to) {
      const response = deadlineOutcome(ticket.createdAt, ticket.firstResponseAt, deadlines.response[ticket.urgency] ?? 24, now);
      const resolution = deadlineOutcome(ticket.createdAt, ticket.status === "resolved" ? ticket.resolvedAt : null, deadlines.resolution[ticket.urgency] ?? 120, now);
      for (const group of groups) {
        group.opened += 1;
        if (response) { group.responseTotal += 1; if (response === "met") group.responseMet += 1; }
        if (resolution) { group.resolutionTotal += 1; if (resolution === "met") group.resolutionMet += 1; }
        if (ticket.firstResponseAt) group.responseMinutes.push(Math.max(0, (toTime(ticket.firstResponseAt) - toTime(ticket.createdAt)) / 60000));
      }
    }
    if (ticket.status === "resolved" && ticket.resolvedAt) {
      const resolvedDay = localDay(ticket.resolvedAt);
      if (resolvedDay >= from && resolvedDay <= to) {
        for (const group of groups) {
          group.resolved += 1;
          group.resolutionMinutes.push(Math.max(0, (toTime(ticket.resolvedAt) - toTime(ticket.createdAt)) / 60000));
        }
      }
    }
  }

  const rows = <K,>(map: Map<K, Group>) => [...map.entries()].map(([key, group]) => ({ key, ...summarizeGroup(group) })).filter((row) => row.opened || row.resolved).sort((a, b) => b.opened + b.resolved - (a.opened + a.resolved));
  return { ...summarizeGroup(total), backlog, lateNow, byClient: rows(byClient), byPerson: rows(byPerson), byUrgency: rows(byUrgency) };
}

function getGroup<K>(map: Map<K, Group>, key: K) {
  let group = map.get(key);
  if (!group) { group = emptyGroup(); map.set(key, group); }
  return group;
}

/** Últimos meses (do mais antigo ao atual) com abertos, resolvidos e % de solução no prazo. */
export function monthlyTrend(tickets: readonly QualityTicket[], lastMonth: string, count: number, now: number, deadlines: Deadlines) {
  const months: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const [year, month] = lastMonth.split("-").map(Number);
    months.push(new Date(Date.UTC(year, month - 1 - index, 1)).toISOString().slice(0, 7));
  }
  return months.map((month) => {
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const report = qualityReport(tickets, { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}`, now, deadlines });
    return { month, opened: report.opened, resolved: report.resolved, resolutionRate: report.resolutionRate, responseRate: report.responseRate };
  });
}

/** 95 min → "1 h 35 min"; 3000 min → "2 d 2 h". */
export function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return total % 60 ? `${hours} h ${total % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
