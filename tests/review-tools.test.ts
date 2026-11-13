import { test } from "node:test";
import assert from "node:assert/strict";
import { goalProgress, goalStatus, parseCriteria, parseGoalNumber, parseTarget, peersFor, quarterTitle, reviewDue, summarize, targetsFor, validScores, parseNotes } from "../app/review-tools.ts";

// Times: 1 = Desenvolvimento (5 líder), 2 = Suporte (8 líder).
const memberships = [
  { memberId: 1, teamId: 1, isLead: false }, { memberId: 2, teamId: 1, isLead: false }, { memberId: 5, teamId: 1, isLead: true },
  { memberId: 3, teamId: 2, isLead: false }, { memberId: 4, teamId: 2, isLead: false }, { memberId: 8, teamId: 2, isLead: true },
  { memberId: 9, teamId: 1, isLead: false },
];
const active = new Set([1, 2, 3, 4, 5, 8]);

test("quem avalia quem", () => {
  assert.deepEqual(peersFor(1, memberships, active).sort(), [2, 5], "desenvolvedor avalia desenvolvedores e o líder do Desenvolvimento (9 está inativo)");
  assert.deepEqual(peersFor(3, memberships, active).sort(), [4, 8], "suporte avalia suporte e o líder do Suporte");
  assert.deepEqual(peersFor(5, memberships, active).sort(), [1, 2], "o líder avalia o próprio time");
  assert.deepEqual(peersFor(99, memberships, active), [], "sem time não avalia colegas");
  assert.deepEqual(targetsFor(3, memberships, active, [1, 2]), ["member:4", "member:8", "company", "manager:1", "manager:2"]);
  assert.deepEqual(parseTarget("member:12"), { kind: "member", id: 12 });
  assert.deepEqual(parseTarget("company"), { kind: "company", id: null });
  assert.equal(parseTarget("member:x"), null);
});

test("notas e médias", () => {
  assert.deepEqual(validScores([5, 4, "3"], 3), [5, 4, 3]);
  assert.equal(validScores([5, 6, 3], 3), null);
  assert.equal(validScores([5, 4], 3), null);
  assert.equal(validScores([4.5, 4, 3], 3), null);
  const criteria = ["Comunicação", "Prazos"];
  assert.deepEqual(summarize([{ scores: [5, 4], comment: "" }, { scores: [3, 4], comment: "ok" }], criteria), { count: 2, hidden: true, averages: [], overall: null, comments: [], notes: [] }, "menos de 3: escondido");
  const shown = summarize([{ scores: [5, 4], comment: "Zeloso", notes: ["Explica bem", ""] }, { scores: [3, 4], comment: "" }, { scores: [4, 5], comment: "Ajuda muito", notes: ["Avisa antes", ""] }], criteria);
  assert.equal(shown.hidden, false);
  assert.deepEqual(shown.averages, [{ criterion: "Comunicação", average: 4 }, { criterion: "Prazos", average: 4.3 }]);
  assert.equal(shown.overall, 4.2);
  assert.deepEqual(shown.comments, ["Ajuda muito", "Zeloso"], "comentários fora da ordem de chegada");
  assert.deepEqual(shown.notes, [{ criterion: "Comunicação", comments: ["Avisa antes", "Explica bem"] }], "justificativas por critério, sem os vazios");
  assert.deepEqual(parseNotes(["  boa  \n nota ", 3, "x".repeat(400)], 3), ["boa nota", "", "x".repeat(300)]);
  assert.deepEqual(parseNotes(["", " "], 2), [], "sem nada escrito não guarda");
  assert.deepEqual(parseNotes("abc", 2), []);
});

test("critérios e ciclo", () => {
  assert.deepEqual(parseCriteria("- Comunicação\n\n2. Prazos\ncomunicação"), ["Comunicação", "Prazos"]);
  assert.deepEqual(parseCriteria('["A","B"]'), ["A", "B"]);
  assert.equal(reviewDue(null, "2026-11-13"), true);
  assert.equal(reviewDue("2026-09-01", "2026-11-13"), false);
  assert.equal(reviewDue("2026-08-15", "2026-11-13"), true);
  assert.equal(quarterTitle("2026-11-13"), "Avaliação 4º trimestre 2026");
});

test("progresso das metas", () => {
  assert.equal(goalProgress({ direction: "up", startValue: 0, target: 12, current: 6 }), 50);
  assert.equal(goalProgress({ direction: "up", startValue: 80, target: 95, current: 92 }), 80);
  assert.equal(goalProgress({ direction: "down", startValue: 40, target: 10, current: 25 }), 50, "reduzir de 40 para 10");
  assert.equal(goalProgress({ direction: "up", startValue: 0, target: 10, current: 15 }), 150);
  assert.equal(goalProgress({ direction: "up", startValue: 10, target: 10, current: 10 }), 100);
  assert.equal(goalStatus({ direction: "up", startValue: 0, target: 100, current: 50 }, 2026, "2026-07-02").status, "on_track");
  assert.equal(goalStatus({ direction: "up", startValue: 0, target: 100, current: 35 }, 2026, "2026-07-02").status, "attention");
  assert.equal(goalStatus({ direction: "up", startValue: 0, target: 100, current: 10 }, 2026, "2026-07-02").status, "behind");
  assert.equal(goalStatus({ direction: "up", startValue: 0, target: 100, current: 100 }, 2026, "2026-03-01").status, "done");
  assert.equal(parseGoalNumber("1.234,5"), 1234.5);
  assert.equal(parseGoalNumber("95%"), 95);
  assert.equal(parseGoalNumber("abc"), null);
});
