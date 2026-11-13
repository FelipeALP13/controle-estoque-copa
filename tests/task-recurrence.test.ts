import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRecurrence, dueFor, isoWeekday, plan, runAfter, runOnOrAfter, validRecurrence } from "../app/task-recurrence.ts";

test("dia da semana", () => {
  assert.equal(isoWeekday("2026-11-16"), 1); // segunda
  assert.equal(isoWeekday("2026-11-15"), 7); // domingo
});

test("próximas datas", () => {
  // Quinta 12/11/2026
  assert.equal(runOnOrAfter("weekly", 4, "2026-11-12"), "2026-11-12");
  assert.equal(runOnOrAfter("weekly", 1, "2026-11-12"), "2026-11-16");
  assert.equal(runAfter("weekly", 4, "2026-11-12"), "2026-11-19");
  assert.equal(runOnOrAfter("monthly", 5, "2026-11-12"), "2026-12-05");
  assert.equal(runOnOrAfter("monthly", 12, "2026-11-12"), "2026-11-12");
  assert.equal(runAfter("monthly", 12, "2026-11-12"), "2026-12-12");
  assert.equal(runOnOrAfter("monthly", 5, "2026-12-20"), "2027-01-05");
});

test("rotina: cria uma vez e pula para depois de hoje", () => {
  assert.deepEqual(plan("weekly", 1, "2026-11-16", "2026-11-12"), { create: false, nextOn: "2026-11-16" });
  assert.deepEqual(plan("weekly", 1, "2026-11-16", "2026-11-16"), { create: true, nextOn: "2026-11-23" });
  // Portal fechado por três semanas: só uma cópia, e a próxima é depois de hoje.
  assert.deepEqual(plan("weekly", 1, "2026-10-19", "2026-11-12"), { create: true, nextOn: "2026-11-16" });
});

test("prazo, validação e texto", () => {
  assert.equal(dueFor("2026-11-16", null), null);
  assert.equal(dueFor("2026-11-16", 3), "2026-11-19");
  assert.equal(validRecurrence("weekly", 7), true);
  assert.equal(validRecurrence("weekly", 8), false);
  assert.equal(validRecurrence("monthly", 28), true);
  assert.equal(validRecurrence("monthly", 31), false);
  assert.equal(validRecurrence("daily", 1), false);
  assert.equal(describeRecurrence("weekly", 1), "Toda segunda-feira");
  assert.equal(describeRecurrence("weekly", 6), "Todo sábado");
  assert.equal(describeRecurrence("monthly", 5), "Todo dia 5 do mês");
});
