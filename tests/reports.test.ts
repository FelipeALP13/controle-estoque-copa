import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, lastMonthKeys, monthKeyInSaoPaulo, normalizePeriod, parseStoredDate } from "../app/reports.ts";

const items = [
  { id: 1, name: "Café", unit: "pacote", icon: "☕", imageKey: null },
  { id: 2, name: "Leite", unit: "caixa", icon: "🥛", imageKey: null },
];

test("lê datas nos dois formatos gravados pelo banco", () => {
  assert.equal(parseStoredDate("2026-11-05 14:00:00")?.toISOString(), "2026-11-05T14:00:00.000Z");
  assert.equal(parseStoredDate("2026-11-05T14:00:00.000Z")?.toISOString(), "2026-11-05T14:00:00.000Z");
  assert.equal(parseStoredDate("ontem"), null);
});

test("usa o horário de Brasília para decidir o mês", () => {
  // 1º de dezembro às 01h UTC ainda é 30 de novembro em Brasília.
  assert.equal(monthKeyInSaoPaulo(new Date("2026-12-01T01:00:00Z")), "2026-11");
});

test("lista os últimos meses, virando o ano", () => {
  assert.deepEqual(lastMonthKeys(new Date("2027-01-15T12:00:00Z"), 3), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(normalizePeriod("12"), 12);
  assert.equal(normalizePeriod("99"), 6);
});

test("soma movimentações por mês, item e pessoa", () => {
  const report = buildReport([
    { itemId: 1, type: "purchase", quantity: 4, createdAt: "2026-10-02 12:00:00", createdByName: "Ana" },
    { itemId: 1, type: "open", quantity: 1, createdAt: "2026-10-03T12:00:00.000Z", createdByName: "Ana" },
    { itemId: 1, type: "consume", quantity: 0.5, createdAt: "2026-11-04T12:00:00.000Z", createdByName: "Bruno" },
    { itemId: 2, type: "consume", quantity: 2, createdAt: "2026-11-05T12:00:00.000Z", createdByName: null },
    { itemId: 2, type: "consume", quantity: 1, createdAt: "2026-08-05T12:00:00.000Z", createdByName: "Ana" },
  ], items, ["2026-10", "2026-11"]);

  assert.equal(report.totals.all, 4);
  assert.deepEqual(report.monthly.map((month) => [month.month, month.purchase, month.open, month.consume]), [["2026-10", 1, 1, 0], ["2026-11", 0, 0, 2]]);
  assert.deepEqual(report.items.map((item) => [item.name, item.events, item.consumed, item.monthlyConsumed]), [["Café", 3, 0.5, [0, 0.5]], ["Leite", 1, 2, [0, 2]]]);
  assert.deepEqual(report.people.map((person) => [person.name, person.total]), [["Ana", 2], ["Bruno", 1], ["Equipe", 1]]);
});
