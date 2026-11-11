import { test } from "node:test";
import assert from "node:assert/strict";
import { absenceOn, absenceRangeError, absentInSchedule, daysBetween, describeAbsence, rangesOverlap, splitAbsences, type Absence } from "../app/absences.ts";

const today = "2026-11-11";

test("valida o período da ausência", () => {
  assert.equal(absenceRangeError("2026-11-15", "2026-11-20", today), null);
  assert.equal(absenceRangeError("2026-11-15", "2026-11-15", today), null);
  assert.match(absenceRangeError("2026-11-20", "2026-11-15", today)!, /antes da inicial/);
  assert.match(absenceRangeError("2026-11-01", "2027-01-05", today)!, /60 dias/);
  assert.match(absenceRangeError("2026-09-01", "2026-09-05", today)!, /30 dias/);
  assert.match(absenceRangeError("2027-12-01", "2027-12-05", today)!, /um ano/);
  assert.match(absenceRangeError("2026-02-30", "2026-03-01", today)!, /datas/);
  assert.equal(daysBetween("2026-11-01", "2026-11-30"), 30);
});

const list: Absence[] = [
  { id: 1, memberId: 7, kind: "vacation", startDate: "2026-11-03", endDate: "2026-11-20", note: "" },
  { id: 2, memberId: 8, kind: "day_off", startDate: "2026-11-14", endDate: "2026-11-14", note: "" },
  { id: 3, memberId: 9, kind: "course", startDate: "2026-12-01", endDate: "2026-12-03", note: "" },
  { id: 4, memberId: 9, kind: "sick", startDate: "2026-10-20", endDate: "2026-10-21", note: "" },
  { id: 5, memberId: 10, kind: "vacation", startDate: "2027-01-10", endDate: "2027-01-30", note: "" },
];

test("encontra quem está fora", () => {
  assert.equal(absenceOn(list, 7, today)?.id, 1);
  assert.equal(absenceOn(list, 8, today), null);
  assert.equal(absenceOn(list, 8, "2026-11-09", "2026-11-15")?.id, 2);
  assert.equal(rangesOverlap({ startDate: "2026-11-01", endDate: "2026-11-02" }, { startDate: "2026-11-02", endDate: "2026-11-05" }), true);
  assert.equal(rangesOverlap({ startDate: "2026-11-01", endDate: "2026-11-02" }, { startDate: "2026-11-03", endDate: "2026-11-05" }), false);
});

test("descreve a ausência", () => {
  assert.equal(describeAbsence(list[0], today), "Férias até 20/11");
  assert.equal(describeAbsence(list[1], today), "Folga em 14/11");
  assert.equal(describeAbsence(list[2], today), "Curso / evento de 01/12 a 03/12");
  assert.equal(describeAbsence(list[4], today), "Férias de 10/01/2027 a 30/01/2027");
});

test("separa fora hoje, próximas e passadas", () => {
  const groups = splitAbsences(list, today, 30);
  assert.deepEqual(groups.now.map((entry) => entry.id), [1]);
  assert.deepEqual(groups.upcoming.map((entry) => entry.id), [2, 3]);
  assert.deepEqual(groups.past.map((entry) => entry.id), [4]);
});

test("reconhece o mesmo nome escrito de jeitos diferentes", async () => {
  const { sameName } = await import("../app/absences.ts");
  assert.equal(sameName("Lucas Pevarello", "Lucas P."), true);
  assert.equal(sameName("Lucas Boroto", "Lucas P."), false);
  assert.equal(sameName("Luiz Miguel", "L. Miguel"), true);
  assert.equal(sameName("Angelo Salvatti", "Angelo S."), true);
  assert.equal(sameName("José", "jose"), true);
  assert.equal(sameName("Jessica Lima", "Jessica"), true);
  assert.equal(sameName("Caio Viana", "Gabriel M."), false);
});

test("nome da escala que casa com duas pessoas é ignorado", () => {
  const people = [{ id: 7, name: "Lucas P." }, { id: 8, name: "Lucas" }];
  const result = absentInSchedule(["Lucas Pevarello"], people, [{ id: 1, memberId: 7, kind: "vacation", startDate: "2026-11-09", endDate: "2026-11-13", note: "" }], "2026-11-09", "2026-11-13");
  assert.equal(result.length, 0);
});

test("avisa quem da escala estará fora, casando pelo nome", () => {
  const people = [{ id: 7, name: "José" }, { id: 8, name: "Taís" }, { id: 11, name: "Jean" }];
  const result = absentInSchedule(["jose", "Taís", "Jean", "Sem cadastro"], people, list, "2026-11-09", "2026-11-13");
  assert.deepEqual(result.map((entry) => [entry.name, entry.absence.id]), [["jose", 1]]);
});
