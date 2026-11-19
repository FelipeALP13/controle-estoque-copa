import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLevel, activityRange, activityScore, activityText, activityTotals, activityWeeks } from "../app/activity.ts";

test("período começa num domingo e termina hoje em Brasília", () => {
  // 19/11/2026 01:00 UTC ainda é 18/11 em Brasília (quarta-feira).
  const { from, to } = activityRange(new Date("2026-11-19T01:00:00Z"));
  assert.equal(to, "2026-11-18");
  assert.equal(new Date(`${from}T12:00:00Z`).getUTCDay(), 0);
  assert.equal(from, "2025-11-16");
});

test("semanas de domingo a sábado, sem dias depois de hoje", () => {
  const weeks = activityWeeks("2025-11-16", "2026-11-18");
  assert.equal(weeks.length, 53);
  assert.deepEqual(weeks[0].slice(0, 2), ["2025-11-16", "2025-11-17"]);
  const last = weeks[weeks.length - 1];
  assert.equal(last[3], "2026-11-18");
  assert.equal(last[4], null);
});

test("intensidade relativa ao dia mais cheio", () => {
  assert.equal(activityScore({ tasks: 1, tickets: 1, hours: 4 }), 4);
  assert.equal(activityLevel(0, 8), 0);
  assert.equal(activityLevel(1, 8), 1);
  assert.equal(activityLevel(3, 8), 2);
  assert.equal(activityLevel(5, 8), 3);
  assert.equal(activityLevel(8, 8), 4);
  assert.equal(activityLevel(3, 0), 0);
});

test("texto do dia e totais", () => {
  assert.equal(activityText(undefined), "Sem atividade");
  assert.equal(activityText({ tasks: 2, tickets: 1, hours: 3.5 }), "2 demandas concluídas, 1 chamado resolvido e 3,5 h lançadas");
  assert.equal(activityText({ tasks: 0, tickets: 0, hours: 8 }), "8 h lançadas");
  assert.deepEqual(activityTotals({ a: { tasks: 1, tickets: 0, hours: 2.25 }, b: { tasks: 0, tickets: 0, hours: 0 }, c: { tasks: 0, tickets: 2, hours: 1 } }), { tasks: 1, tickets: 2, hours: 3.3, activeDays: 2 });
});
