import assert from "node:assert/strict";
import test from "node:test";
import { findOverlappingWeek, generateRotation, isIsoDate, nextSupportWeek, normalizeTeamMembers, parseTeamMembers, supportWeekForDate, weekRangeError } from "../app/support-schedule.ts";

const weeks = [
  { id: 1, start: "2026-11-03", end: "2026-11-06", teamId: 2, note: "" },
  { id: 2, start: "2026-11-09", end: "2026-11-13", teamId: 1, note: "" },
  { id: 3, start: "2026-11-23", end: "2026-11-27", teamId: 1, note: "" },
];

test("identifica a equipe em atendimento no dia", () => {
  assert.equal(supportWeekForDate(weeks, "2026-11-05")?.teamId, 2);
  assert.equal(supportWeekForDate(weeks, "2026-11-10")?.teamId, 1);
});

test("mantém dias sem atendimento fora da escala", () => {
  assert.equal(supportWeekForDate(weeks, "2026-11-02"), null);
  assert.equal(supportWeekForDate(weeks, "2026-11-20"), null);
  assert.equal(nextSupportWeek(weeks, "2026-11-20")?.start, "2026-11-23");
});

test("valida datas e períodos", () => {
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-11-09"), true);
  assert.equal(weekRangeError("2026-11-10", "2026-11-09"), "A data final precisa ser igual ou posterior à data inicial.");
  assert.equal(weekRangeError("2026-11-09", "2026-11-13"), null);
});

test("detecta conflito entre semanas, exceto a própria", () => {
  assert.equal(findOverlappingWeek(weeks, { start: "2026-11-12", end: "2026-11-16" })?.id, 2);
  assert.equal(findOverlappingWeek(weeks, { start: "2026-11-09", end: "2026-11-13" }, 2), null);
  assert.equal(findOverlappingWeek(weeks, { start: "2026-11-16", end: "2026-11-20" }), null);
});

test("gera rodízio alternando as equipes", () => {
  const rotation = generateRotation("2026-12-21", 3, [1, 2]);
  assert.deepEqual(rotation, [
    { start: "2026-12-21", end: "2026-12-25", teamId: 1 },
    { start: "2026-12-28", end: "2027-01-01", teamId: 2 },
    { start: "2027-01-04", end: "2027-01-08", teamId: 1 },
  ]);
});

test("limpa a lista de integrantes", () => {
  assert.deepEqual(normalizeTeamMembers(["  Ana  Souza ", "", "ana souza", "Bruno"]), ["Ana Souza", "Bruno"]);
  assert.deepEqual(parseTeamMembers('["Caio","Luiz"]'), ["Caio", "Luiz"]);
  assert.deepEqual(parseTeamMembers("não é json"), []);
});
