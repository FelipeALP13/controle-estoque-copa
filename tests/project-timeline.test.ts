import { test } from "node:test";
import assert from "node:assert/strict";
import { barFor, timelineRange } from "../app/project-timeline.ts";

const today = "2026-11-12";

test("intervalo cobre do primeiro início à última previsão (e hoje)", () => {
  const range = timelineRange([
    { id: 1, startDate: "2026-09-15", endForecast: "2026-12-10", closed: false },
    { id: 2, startDate: null, endForecast: "2027-02-20", closed: false },
    { id: 3, startDate: "2026-01-01", endForecast: "Q1/2027", closed: false }, // previsão em texto: fora
  ], today);
  assert.equal(range.from, "2026-09-01");
  assert.equal(range.to, "2027-03-01");
  assert.deepEqual(range.months.map((month) => month.day), ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  assert.ok(range.todayLeft > 30 && range.todayLeft < 40);
});

test("sem projetos com data, mostra o mês atual", () => {
  const range = timelineRange([], today);
  assert.equal(range.from, "2026-11-01");
  assert.equal(range.to, "2026-12-01");
});

test("barras", () => {
  const range = { from: "2026-11-01", to: "2026-12-01" }; // 30 dias
  const full = barFor({ id: 1, startDate: "2026-11-01", endForecast: "2026-11-30", closed: false }, range, today);
  assert.deepEqual(full && [Math.round(full.left), Math.round(full.width), full.late, full.assumed], [0, 100, false, false]);
  const late = barFor({ id: 2, startDate: "2026-11-01", endForecast: "2026-11-10", closed: false }, range, today);
  assert.equal(late?.late, true);
  assert.equal(barFor({ id: 3, startDate: "2026-11-01", endForecast: "2026-11-10", closed: true }, range, today)?.late, false, "encerrado não é atrasado");
  const assumed = barFor({ id: 4, startDate: null, endForecast: "2026-11-30", closed: false }, range, today);
  assert.equal(assumed?.assumed, true);
  assert.equal(barFor({ id: 5, startDate: null, endForecast: "sem data", closed: false }, range, today), null);
  assert.equal(barFor({ id: 6, startDate: "2027-03-01", endForecast: "2027-04-01", closed: false }, range, today)?.outside, true);
});
