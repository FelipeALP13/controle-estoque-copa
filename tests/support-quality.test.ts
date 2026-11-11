import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineOutcome, formatDuration, localDay, monthlyTrend, qualityReport, type QualityTicket } from "../app/support-quality.ts";

const deadlines = { response: { critical: 2, high: 8, normal: 24, low: 72 }, resolution: { critical: 8, high: 48, normal: 120, low: 240 } };
const now = Date.parse("2026-11-11T15:00:00Z");
const base = { urgency: "high", client: "Dr. Hoje", assigneeId: 7, teamId: 1, firstResponseAt: null, resolvedAt: null };
const t = (id: number, changes: Partial<QualityTicket>): QualityTicket => ({ id, status: "open", createdAt: "2026-11-05T12:00:00.000Z", ...base, ...changes });

test("dia em Brasília e prazos", () => {
  assert.equal(localDay("2026-11-01T02:00:00.000Z"), "2026-10-31"); // 23h do dia 31 em Brasília
  assert.equal(localDay("2026-11-01 12:00:00"), "2026-11-01");
  assert.equal(deadlineOutcome("2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z", 2, now), "met");
  assert.equal(deadlineOutcome("2026-11-10T12:00:00Z", "2026-11-10T15:00:00Z", 2, now), "late");
  assert.equal(deadlineOutcome("2026-11-10T12:00:00Z", null, 2, now), "late"); // venceu sem resposta
  assert.equal(deadlineOutcome("2026-11-11T14:00:00Z", null, 8, now), null); // ainda no prazo
});

const tickets: QualityTicket[] = [
  // Respondido em 1 h (no prazo), resolvido em 1 dia (no prazo).
  t(1, { status: "resolved", firstResponseAt: "2026-11-05T13:00:00.000Z", resolvedAt: "2026-11-06T12:00:00.000Z" }),
  // Respondido em 10 h (atrasado), resolvido em 3 dias (atrasado: alta = 48 h).
  t(2, { status: "resolved", firstResponseAt: "2026-11-05T22:00:00.000Z", resolvedAt: "2026-11-08T12:00:00.000Z", client: "ADCPLASP", assigneeId: 8 }),
  // Aberto, sem resposta, prazo de resposta vencido: atrasado agora.
  t(3, { status: "open" }),
  // Aberto ontem com urgência baixa: ainda no prazo (não entra nas taxas).
  t(4, { status: "in_progress", urgency: "low", createdAt: "2026-11-10T15:00:00.000Z", firstResponseAt: "2026-11-10T16:00:00.000Z" }),
  // Cancelado: fora de tudo.
  t(5, { status: "canceled" }),
  // Aberto em outubro e resolvido em novembro: conta em "resolvidos" de novembro, não em "abertos".
  t(6, { status: "resolved", createdAt: "2026-10-20T12:00:00.000Z", firstResponseAt: "2026-10-20T13:00:00.000Z", resolvedAt: "2026-11-02T12:00:00.000Z" }),
];

test("indicadores do mês", () => {
  const report = qualityReport(tickets, { from: "2026-11-01", to: "2026-11-30", now, deadlines });
  assert.equal(report.opened, 4);
  assert.equal(report.resolved, 3);
  assert.equal(report.responseRate, 2 / 4); // 1 e 4 no prazo; 2 atrasado; 3 vencido sem resposta
  assert.equal(report.resolutionRate, 1 / 3); // 1 no prazo; 2 atrasado; 3 vencido; 4 ainda no prazo
  assert.equal(report.medianResponseMinutes, 60); // 60, 600, 60 → mediana 60
  assert.equal(report.backlog, 2);
  assert.equal(report.lateNow, 1);
  const drHoje = report.byClient.find((row) => row.key === "Dr. Hoje")!;
  assert.deepEqual([drHoje.opened, drHoje.resolved], [3, 2]);
  assert.equal(report.byPerson.find((row) => row.key === 8)!.resolutionRate, 0);
});

test("tendência mês a mês e formato de tempo", () => {
  const trend = monthlyTrend(tickets, "2026-11", 3, now, deadlines);
  assert.deepEqual(trend.map((row) => row.month), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(trend.map((row) => row.opened), [0, 1, 4]);
  assert.equal(trend[0].resolutionRate, null);
  assert.equal(formatDuration(95), "1 h 35 min");
  assert.equal(formatDuration(3000), "2 d 2 h");
  assert.equal(formatDuration(null), "—");
});
