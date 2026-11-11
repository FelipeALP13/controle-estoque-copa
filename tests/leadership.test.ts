import assert from "node:assert/strict";
import test from "node:test";
import { inPeriod, summarize, workload, type PanelTask } from "../app/leadership.ts";

const base: Omit<PanelTask, "id" | "status" | "owners"> = { teamId: 1, openedOn: "2026-11-01", dueDate: null, workedHours: null, hoursFlag: false };
const tasks: PanelTask[] = [
  { ...base, id: 1, status: "done", owners: [10, 11], workedHours: 40 },
  { ...base, id: 2, status: "in_progress", owners: [10], dueDate: "2026-11-05" },
  { ...base, id: 3, status: "todo", owners: [11] },
  { ...base, id: 4, status: "blocked", owners: [12], dueDate: "2026-12-01" },
  { ...base, id: 5, status: "canceled", owners: [12] },
];

test("indicadores gerais como no Dashboard da planilha", () => {
  const summary = summarize(tasks, "2026-11-10");
  assert.deepEqual([summary.total, summary.open, summary.toDo, summary.doing, summary.done, summary.stalled, summary.overdue, summary.people], [5, 3, 1, 1, 1, 1, 1, 3]);
  assert.equal(summary.completion, 0.25); // 1 concluída de 4 (cancelada não conta)
});

test("carga por pessoa conta a compartilhada para cada responsável e divide as horas", () => {
  const rows = workload(tasks, "2026-11-10");
  const byId = Object.fromEntries(rows.map((row) => [row.memberId, row]));
  assert.deepEqual([byId[10].total, byId[10].open, byId[10].done, byId[10].overdue, byId[10].hours], [2, 1, 1, 1, 20]);
  assert.deepEqual([byId[11].total, byId[11].open, byId[11].hours], [2, 1, 20]);
  assert.deepEqual([byId[12].total, byId[12].open], [1, 1]);
});

test("filtra pelo período de abertura", () => {
  assert.equal(inPeriod({ openedOn: "2026-10-12" }, "30", "2026-11-10"), true);
  assert.equal(inPeriod({ openedOn: "2026-10-11" }, "30", "2026-11-10"), false);
  assert.equal(inPeriod({ openedOn: null }, "90", "2026-11-10"), false);
  assert.equal(inPeriod({ openedOn: null }, "all", "2026-11-10"), true);
  assert.equal(inPeriod({ openedOn: "2026-01-02" }, "year", "2026-11-10"), true);
});
