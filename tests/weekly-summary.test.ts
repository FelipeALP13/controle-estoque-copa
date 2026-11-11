import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklySummary, workWeek, type SummaryTask } from "../app/weekly-summary.ts";
import { describeAbsence, type Absence } from "../app/absences.ts";

test("semana útil de segunda a sexta", () => {
  assert.deepEqual(workWeek("2026-11-11"), { start: "2026-11-09", end: "2026-11-13" });
  assert.deepEqual(workWeek("2026-11-15"), { start: "2026-11-09", end: "2026-11-13" }); // domingo
  assert.deepEqual(workWeek("2026-11-09"), { start: "2026-11-09", end: "2026-11-13" });
});

const today = "2026-11-11";
const task = (id: number, changes: Partial<SummaryTask>): SummaryTask => ({ id, title: `Demanda ${id}`, status: "todo", teamId: 1, owners: [7], dueDate: null, completedOn: null, ...changes });
const tasks = [
  task(1, { dueDate: "2026-11-01" }),
  task(2, { dueDate: "2026-10-20", status: "blocked", owners: [] }),
  task(3, { dueDate: "2026-11-13", teamId: 2 }),
  task(4, { status: "done", completedOn: "2026-11-06" }),
  task(5, { status: "done", completedOn: "2026-11-01" }),
  task(6, { status: "waiting", teamId: 2, title: "x".repeat(90) }),
  task(7, { status: "canceled", dueDate: "2026-11-01" }),
];
const absences: Absence[] = [
  { id: 1, memberId: 7, kind: "vacation", startDate: "2026-11-12", endDate: "2026-11-20", note: "" },
  { id: 2, memberId: 8, kind: "day_off", startDate: "2026-11-20", endDate: "2026-11-20", note: "" },
];

test("resumo semanal com números, listas e ausências", () => {
  const text = weeklySummary({
    today, tasks, absences, teamLabel: "Todos os times", link: "https://portal.exemplo",
    teams: [{ id: 1, name: "Desenvolvimento" }, { id: 2, name: "Suporte" }],
    people: [{ id: 7, name: "José" }, { id: 8, name: "Taís" }],
    format: { code: (id) => `DEM-${id}`, absence: (absence) => describeAbsence(absence, today) },
  });
  assert.match(text, /^\*Resumo semanal · Todos os times\*\nSemana de 09\/11 a 13\/11/);
  assert.match(text, /• 4 demandas em aberto/);
  assert.match(text, /• 2 com prazo vencido/);
  assert.match(text, /• 2 paradas/);
  assert.match(text, /• 1 vence até sexta/);
  assert.match(text, /• 1 concluída nos últimos 7 dias/);
  assert.match(text, /• Desenvolvimento: 2 em aberto · 2 vencidas · 1 parada/);
  assert.match(text, /• Suporte: 2 em aberto · 0 vencidas · 1 parada/);
  // Vencidas do prazo mais antigo para o mais novo; cancelada não entra.
  assert.match(text, /\*Prazos vencidos\*\n• DEM-2 Demanda 2 \(venceu 20\/10 · sem responsável\)\n• DEM-1 Demanda 1 \(venceu 01\/11 · José\)/);
  assert.match(text, /• DEM-6 x{69}… \(aguardando · José\)/);
  assert.match(text, /\*Vencem esta semana\*\n• DEM-3 Demanda 3 \(13\/11 · José\)/);
  assert.match(text, /\*Fora esta semana\*\n• José: férias de 12\/11 a 20\/11/);
  assert.doesNotMatch(text, /Taís/);
  assert.match(text, /Detalhes no Portal: https:\/\/portal\.exemplo$/);
});

test("listas longas são cortadas", () => {
  const many = Array.from({ length: 11 }, (_, index) => task(index + 1, { dueDate: "2026-11-02" }));
  const text = weeklySummary({ today, tasks: many, absences: [], teamLabel: "Suporte", teams: [{ id: 1, name: "Suporte" }], people: [], format: { code: (id) => `DEM-${id}`, absence: () => "" } });
  assert.match(text, /…e mais 3/);
  assert.doesNotMatch(text, /\*Por time\*/);
});
