import assert from "node:assert/strict";
import test from "node:test";
import { nextSupportWeek, supportTeam, supportWeekForDate } from "../app/support-schedule.ts";

test("preserva as equipes importadas da planilha", () => {
  assert.deepEqual(supportTeam("purple").members, ["Lucas Pevarello", "Lucas Boroto", "Gabriel Moraes"]);
  assert.deepEqual(supportTeam("orange").members, ["Caio Viana", "Angelo Salvatti", "Luiz Miguel"]);
});

test("identifica a equipe em atendimento no dia", () => {
  assert.equal(supportWeekForDate("2026-11-05")?.teamId, "orange");
  assert.equal(supportWeekForDate("2026-11-10")?.teamId, "purple");
});

test("mantém dias sem atendimento fora da escala", () => {
  assert.equal(supportWeekForDate("2026-11-02"), null);
  assert.equal(supportWeekForDate("2026-11-20"), null);
  assert.equal(nextSupportWeek("2026-11-20")?.start, "2026-11-23");
});
