import { test } from "node:test";
import assert from "node:assert/strict";
import { cellLevel, nextBusinessDays, workloadCalendar } from "../app/workload-calendar.ts";

test("próximos dias úteis pulam sábado e domingo", () => {
  // 20/11/2026 é sexta-feira.
  assert.deepEqual(nextBusinessDays("2026-11-20", 3), ["2026-11-20", "2026-11-23", "2026-11-24"]);
});

test("grade: entregas por dia, atrasadas, ausências e ordem por carga", () => {
  const tasks = [
    { id: 1, title: "A", status: "todo", dueDate: "2026-11-20", owners: [10] },
    { id: 2, title: "B", status: "in_progress", dueDate: "2026-11-20", owners: [10, 11] },
    { id: 3, title: "C", status: "todo", dueDate: "2026-11-18", owners: [11] },
    { id: 4, title: "D", status: "done", dueDate: "2026-11-20", owners: [12] },
    { id: 5, title: "E", status: "todo", dueDate: null, owners: [12] },
  ];
  const { days, rows } = workloadCalendar(tasks, [{ memberId: 11, startDate: "2026-11-23", endDate: "2026-11-24" }], "2026-11-20", 3);
  assert.deepEqual(days, ["2026-11-20", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(rows.map((row) => row.memberId), [11, 10, 12]);
  const ana = rows.find((row) => row.memberId === 10)!;
  assert.equal(ana.cells[0].tasks.length, 2);
  assert.equal(cellLevel(ana.cells[0]), 2);
  const bruno = rows.find((row) => row.memberId === 11)!;
  assert.deepEqual(bruno.overdue, [{ id: 3, title: "C" }]);
  assert.deepEqual(bruno.cells.map((cell) => cell.away), [false, true, true]);
  const carla = rows.find((row) => row.memberId === 12)!;
  assert.equal(carla.open, 1);
});
