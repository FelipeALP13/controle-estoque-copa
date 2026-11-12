import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, isIsoDay, monthGrid, spanDays } from "../app/calendar.ts";

test("grade do mês começa na segunda e fecha semanas inteiras", () => {
  const nov = monthGrid("2026-11"); // 1º de novembro de 2026 é domingo
  assert.equal(nov.from, "2026-10-26");
  assert.equal(nov.days.length % 7, 0);
  assert.equal(nov.days.filter((day) => day.inMonth).length, 30);
  assert.equal(nov.to, "2026-12-06");
  const feb = monthGrid("2027-02"); // começa numa segunda e tem 28 dias: 4 semanas exatas
  assert.equal(feb.from, "2027-02-01");
  assert.equal(feb.days.length, 28);
});

test("períodos cortados ao intervalo visível", () => {
  assert.deepEqual(spanDays("2026-10-30", "2026-11-02", "2026-11-01", "2026-11-30"), ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(spanDays("2026-12-01", "2026-12-03", "2026-11-01", "2026-11-30"), []);
  assert.equal(isIsoDay("2026-02-30"), false);
  assert.equal(isIsoDay("2028-02-29"), true);
  assert.equal(isIsoDay("Dezembro"), false);
});

test("eventos distribuídos e ordenados por dia", () => {
  const calendar = buildCalendar({
    from: "2026-11-01", to: "2026-11-30", today: "2026-11-11",
    tasks: [
      { id: 1, title: "Boleto", code: "DEM-1", dueDate: "2026-11-10", closed: false, owners: "José" },
      { id: 2, title: "Pronta", code: "DEM-2", dueDate: "2026-11-10", closed: true, owners: "" },
      { id: 3, title: "Relatório", code: "DEM-3", dueDate: "2026-11-12", closed: false, owners: "" },
      { id: 4, title: "Fora", code: "DEM-4", dueDate: "2026-12-20", closed: false, owners: "" },
    ],
    absences: [{ id: 1, person: "Taís", label: "Férias", startDate: "2026-11-09", endDate: "2026-11-10" }],
    weeks: [{ id: 7, start: "2026-11-09", end: "2026-11-13", team: "Equipe Roxa", color: "purple", members: "Lucas, Gabriel" }],
    projects: [{ id: 5, name: "Allcare", code: "PRJ-5", startDate: "2026-11-10", endForecast: "Dezembro" }],
  });
  const day10 = calendar.get("2026-11-10")!;
  assert.deepEqual(day10.map((event) => event.kind), ["due", "absence", "project", "schedule"]);
  assert.equal(day10[0].late, true);
  assert.equal(day10[1].label, "Taís: férias");
  assert.equal(calendar.get("2026-11-12")![0].late, false);
  assert.equal(calendar.get("2026-11-13")!.length, 1);
  assert.equal(calendar.has("2026-12-20"), false);
  assert.equal([...calendar.values()].flat().some((event) => event.refId === 2 && event.kind === "due"), false);
});

test("minha agenda aparece primeiro no dia, pelo horário", () => {
  const map = buildCalendar({ from: "2026-11-01", to: "2026-11-30", today: "2026-11-12", tasks: [{ id: 1, title: "Boleto", code: "DEM-1", dueDate: "2026-11-12", closed: false, owners: "Ana" }], agenda: [{ id: 2, title: "Reunião", day: "2026-11-12", time: "14:00", meeting: true, done: false }, { id: 3, title: "Ligar", day: "2026-11-12", time: "09:30", meeting: false, done: true }, { id: 4, title: "Fora", day: "2026-12-01", time: "10:00", meeting: false, done: false }] });
  assert.deepEqual(map.get("2026-11-12")?.map((event) => event.label), ["09:30 Ligar", "14:00 Reunião", "DEM-1 Boleto"]);
  assert.equal(map.get("2026-11-12")?.[0].detail, "Anotação · feito");
  assert.equal(map.get("2026-12-01"), undefined);
});
