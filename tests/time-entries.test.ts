import { test } from "node:test";
import assert from "node:assert/strict";
import { clientReport, entryDateError, formatHours, monthLabel, monthRange, parseEntryHours, shiftMonth, totalHours } from "../app/time-entries.ts";

test("horas digitadas de vários jeitos", () => {
  assert.equal(parseEntryHours("1,5"), 1.5);
  assert.equal(parseEntryHours("1.5"), 1.5);
  assert.equal(parseEntryHours("1:30"), 1.5);
  assert.equal(parseEntryHours("1h30"), 1.5);
  assert.equal(parseEntryHours("2h"), 2);
  assert.equal(parseEntryHours("0:15"), 0.25);
  assert.equal(parseEntryHours(" 8 "), 8);
  assert.equal(parseEntryHours("0"), null);
  assert.equal(parseEntryHours("25"), null);
  assert.equal(parseEntryHours("1:75"), null);
  assert.equal(parseEntryHours("-2"), null);
  assert.equal(parseEntryHours("abc"), null);
  assert.equal(parseEntryHours(""), null);
});

test("data do lançamento", () => {
  const today = "2026-11-11";
  assert.equal(entryDateError("2026-11-11", today), null);
  assert.equal(entryDateError("2026-08-13", today), null);
  assert.match(entryDateError("2026-08-12", today)!, /90 dias/);
  assert.match(entryDateError("2026-11-12", today)!, /ainda não chegou/);
  assert.match(entryDateError("2026-02-30", today)!, /válida/);
  assert.match(entryDateError("", today)!, /data/);
});

test("total da demanda soma anteriores e lançamentos", () => {
  assert.equal(totalHours(null, []), null);
  assert.equal(totalHours(10, []), 10);
  assert.equal(totalHours(null, [1.5, 0.25]), 1.75);
  assert.equal(totalHours(10.1, [0.2]), 10.3);
});

test("formatação e meses", () => {
  assert.equal(formatHours(1.5), "1h30");
  assert.equal(formatHours(2), "2h");
  assert.equal(formatHours(0.25), "15min");
  assert.equal(monthLabel("2026-11"), "novembro de 2026");
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

const tasks = [
  { id: 1, clientId: 10, status: "done", openedOn: "2026-10-05", completedOn: "2026-11-03", workedHours: 12, dueDate: "2026-11-01" },
  { id: 2, clientId: 10, status: "in_progress", openedOn: "2026-11-02", completedOn: null, workedHours: 3, dueDate: "2026-11-05" },
  { id: 3, clientId: 20, status: "todo", openedOn: "2026-09-01", completedOn: null, workedHours: null, dueDate: null },
  { id: 4, clientId: null, status: "canceled", openedOn: "2026-11-01", completedOn: null, workedHours: 5, dueDate: null },
  { id: 5, clientId: 20, status: "done", openedOn: "2026-08-01", completedOn: "2026-08-20", workedHours: 7, dueDate: null },
];
const entries = [
  { taskId: 1, hours: 2, workDate: "2026-11-02" },
  { taskId: 2, hours: 3, workDate: "2026-11-04" },
  { taskId: 1, hours: 4, workDate: "2026-10-30" },
  { taskId: 4, hours: 1, workDate: "2026-11-01" },
];

test("relatório por cliente no mês", () => {
  const rows = clientReport(tasks, entries, "2026-11", "2026-11-11");
  const a = rows.find((row) => row.clientId === 10)!;
  assert.deepEqual([a.opened, a.completed, a.open, a.overdue, a.hours, a.total], [1, 1, 1, 1, 5, 2]);
  const b = rows.find((row) => row.clientId === 20)!;
  // Aberta desde setembro: conta em "em aberto", sem horas no mês; a concluída em agosto não entra.
  assert.deepEqual([b.opened, b.completed, b.open, b.hours, b.total], [0, 0, 1, 0, 1]);
  // Cancelada fica de fora, mas a hora lançada nela ainda conta para o cliente (sem cliente).
  assert.equal(rows.find((row) => row.clientId === null)?.hours, 1);
});

test("relatório por cliente em todo o período", () => {
  const rows = clientReport(tasks, entries, null, "2026-11-11");
  const a = rows.find((row) => row.clientId === 10)!;
  assert.deepEqual([a.total, a.hours, a.open], [2, 15, 1]);
  const b = rows.find((row) => row.clientId === 20)!;
  assert.deepEqual([b.total, b.hours, b.completed], [2, 7, 1]);
  assert.equal(rows.some((row) => row.clientId === null), false);
});
