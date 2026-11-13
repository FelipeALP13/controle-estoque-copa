import { test } from "node:test";
import assert from "node:assert/strict";
import { averageScores, durationLabel, expiryStage, expiryText, incidentStats, isIsoDay, monthLabel, moodOf, nextIncidentStatus, parseQuestions, pulseMonth, weakestCriteria } from "../app/people-tools.ts";

test("pesquisa de clima: mês, perguntas e médias anônimas", () => {
  assert.equal(pulseMonth("2026-11-13"), "2026-11");
  assert.equal(monthLabel("2026-03"), "março de 2026");
  assert.deepEqual(parseQuestions("  Como está?\n\ncomo está?\nCarga ok?"), ["Como está?", "Carga ok?"], "sem vazias e sem repetidas");
  assert.equal(parseQuestions(Array.from({ length: 8 }, (_, index) => `P${index}`)).length, 5, "no máximo 5");
  const questions = ["Humor", "Carga"];
  assert.deepEqual(averageScores([{ scores: [5, 4] }, { scores: [3, 2] }], questions), { count: 2, hidden: true, averages: [], overall: null }, "menos de 3 fica escondido");
  const shown = averageScores([{ scores: [5, 4] }, { scores: [3, 2] }, { scores: [4, 4] }], questions);
  assert.deepEqual(shown.averages, [{ question: "Humor", average: 4 }, { question: "Carga", average: 3.3 }]);
  assert.equal(shown.overall, 3.7);
  assert.equal(moodOf(4.2), "good");
  assert.equal(moodOf(3.1), "ok");
  assert.equal(moodOf(2.9), "bad");
  assert.equal(moodOf(null), "none");
});

test("plano de desenvolvimento: critérios mais fracos", () => {
  const averages = [{ criterion: "Comunicação", average: 3.2 }, { criterion: "Prazos", average: 4.5 }, { criterion: "Proatividade", average: 2.8 }, { criterion: "Qualidade", average: 3.9 }];
  assert.deepEqual(weakestCriteria(averages).map((item) => item.criterion), ["Proatividade", "Comunicação"]);
  assert.deepEqual(weakestCriteria([{ criterion: "A", average: 4.1 }]), [], "tudo acima de 4: nada a sugerir");
  assert.equal(isIsoDay("2026-02-31"), false);
  assert.equal(isIsoDay("2026-02-28"), true);
});

test("licenças: avisos de vencimento", () => {
  assert.equal(expiryStage(null, "2026-11-13"), null);
  assert.equal(expiryStage("2027-01-30", "2026-11-13"), null);
  assert.equal(expiryStage("2026-12-10", "2026-11-13"), 30);
  assert.equal(expiryStage("2026-11-20", "2026-11-13"), 7);
  assert.equal(expiryStage("2026-11-13", "2026-11-13"), 0);
  assert.equal(expiryStage("2026-11-01", "2026-11-13"), 0);
  assert.equal(expiryText("Office", "2026-11-14", "2026-11-13"), "Office vence em 1 dia");
  assert.equal(expiryText("Office", "2026-11-12", "2026-11-13"), "Office venceu há 1 dia");
});

test("incidentes: situação, duração e números", () => {
  assert.deepEqual(nextIncidentStatus({ status: "open", resolvedAt: "2026-11-13T12:00:00Z", cause: "", prevention: "" }), { status: "resolved", error: null }, "com fim vira resolvido");
  assert.equal(nextIncidentStatus({ status: "analyzed", resolvedAt: "2026-11-13T12:00:00Z", cause: "Disco cheio", prevention: "" }).error !== null, true, "análise exige o que muda");
  assert.deepEqual(nextIncidentStatus({ status: "analyzed", resolvedAt: "2026-11-13T12:00:00Z", cause: "Disco cheio", prevention: "Alerta de disco" }), { status: "analyzed", error: null });
  assert.equal(nextIncidentStatus({ status: "resolved", resolvedAt: null, cause: "", prevention: "" }).status, "open", "sem fim continua aberto");
  assert.equal(durationLabel(35), "35 min");
  assert.equal(durationLabel(135), "2 h 15 min");
  assert.equal(durationLabel(120), "2 h");
  assert.equal(durationLabel(3 * 1440 + 240), "3 d 4 h");
  const stats = incidentStats([
    { startedAt: "2026-11-13T10:00:00Z", resolvedAt: "2026-11-13T11:00:00Z", status: "analyzed" },
    { startedAt: "2026-11-13T10:00:00Z", resolvedAt: "2026-11-13T10:30:00Z", status: "resolved" },
    { startedAt: "2026-11-13T11:30:00Z", resolvedAt: null, status: "open" },
  ], "2026-11-13T12:00:00Z");
  assert.deepEqual(stats, { count: 3, open: 1, pendingAnalysis: 1, totalMinutes: 120, averageMinutes: 45 });
});
