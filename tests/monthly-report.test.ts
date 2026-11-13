import { test } from "node:test";
import assert from "node:assert/strict";
import { monthBounds, monthlyNumbers } from "../app/monthly-report.ts";

test("limites do mês", () => {
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2026-11"), { from: "2026-11-01", to: "2026-11-30" });
});

test("números do mês", () => {
  const task = (id: number, extra: object) => ({ id, title: `T${id}`, status: "todo", clientId: 1, openedOn: "2026-11-02", completedOn: null, dueDate: null, owners: [], ...extra });
  const numbers = monthlyNumbers({
    month: "2026-11",
    today: "2026-11-12",
    clientName: (id) => (id === 1 ? "Salus" : ""),
    tasks: [
      task(1, { status: "done", completedOn: "2026-11-05", dueDate: "2026-11-06" }), // no prazo
      task(2, { status: "done", completedOn: "2026-11-09", dueDate: "2026-11-06" }), // atrasada
      task(3, { dueDate: "2026-11-10" }), // vencida
      task(4, { dueDate: "2026-11-20" }), // ainda no prazo
      task(5, { openedOn: "2026-10-20", status: "done", completedOn: "2026-10-25", clientId: null }), // outro mês
    ],
    tickets: [
      { id: 1, title: "a", status: "resolved", client: "Salus", createdAt: "2026-11-03T12:00:00.000Z", resolvedAt: "2026-11-04T12:00:00.000Z" },
      { id: 2, title: "b", status: "open", client: "", createdAt: "2026-11-01 02:00:00", resolvedAt: null }, // 31/10 23h em Brasília
      { id: 3, title: "c", status: "canceled", client: "Salus", createdAt: "2026-11-05T12:00:00.000Z", resolvedAt: null },
    ],
    projects: [
      { id: 1, name: "P1", status: "active", phase: "build", endForecast: "2026-11-01" },
      { id: 2, name: "P2", status: "active", phase: "build", endForecast: "2026-12-01" },
      { id: 3, name: "P3", status: "done", phase: "closing", endForecast: "2026-10-01" },
    ],
  });
  assert.equal(numbers.tasksOpened, 4);
  assert.equal(numbers.tasksDelivered, 2);
  assert.equal(numbers.onTimeRate, 0.5);
  assert.deepEqual(numbers.overdue.map((task) => task.id), [3]);
  assert.equal(numbers.ticketsOpened, 1);
  assert.equal(numbers.ticketsResolved, 1);
  assert.deepEqual(numbers.byClient, [{ client: "Salus", tasksOpened: 4, tasksDelivered: 2, ticketsOpened: 1, ticketsResolved: 1 }]);
  assert.equal(numbers.activeProjects, 2);
  assert.deepEqual(numbers.lateProjects.map((project) => project.id), [1]);
});
