import { test } from "node:test";
import assert from "node:assert/strict";
import { isSupportTeamName, matchScheduleNames, pickAssignee } from "../app/ticket-routing.ts";

const people = [
  { id: 1, name: "Allex T." },
  { id: 2, name: "Ana Souza" },
  { id: 3, name: "Ana Silva" },
  { id: 4, name: "José Pereira" },
  { id: 5, name: "Taís" },
];

test("liga nomes da escala às pessoas", () => {
  assert.deepEqual(matchScheduleNames(["Allex T.", "Jose Pereira", "tais"], people).map((p) => p.id), [1, 4, 5]);
  assert.deepEqual(matchScheduleNames(["Allex"], people).map((p) => p.id), [1]);
  assert.deepEqual(matchScheduleNames(["Ana S."], people).map((p) => p.id), [], "ambíguo fica de fora");
  assert.deepEqual(matchScheduleNames(["Ana So"], people).map((p) => p.id), [2]);
  assert.deepEqual(matchScheduleNames(["Fulano", ""], people), []);
  assert.deepEqual(matchScheduleNames(["Taís", "Tais"], people).map((p) => p.id), [5], "sem repetir");
  // Escala com nome completo e Portal com o abreviado.
  const short = [{ id: 7, name: "Lucas P." }, { id: 8, name: "Lucas B." }, { id: 9, name: "Gabriel M." }];
  assert.deepEqual(matchScheduleNames(["Lucas Pevarello", "Lucas Boroto", "Gabriel Moraes"], short).map((p) => p.id), [7, 8, 9]);
  assert.deepEqual(matchScheduleNames(["Lucas"], short).map((p) => p.id), [], "só o primeiro nome com dois Lucas é ambíguo");
});

test("escolhe quem tem menos chamados e pula quem está fora", () => {
  assert.equal(pickAssignee([{ id: 1, open: 3, away: false }, { id: 4, open: 1, away: false }, { id: 5, open: 1, away: false }]), 4);
  assert.equal(pickAssignee([{ id: 1, open: 3, away: false }, { id: 4, open: 0, away: true }]), 1);
  assert.equal(pickAssignee([{ id: 4, open: 0, away: true }]), null);
  assert.equal(pickAssignee([]), null);
});

test("time do suporte", () => {
  assert.equal(isSupportTeamName("Suporte"), true);
  assert.equal(isSupportTeamName("SUPORTE N1"), true);
  assert.equal(isSupportTeamName("Desenvolvimento"), false);
});
