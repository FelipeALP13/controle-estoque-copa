import { test } from "node:test";
import assert from "node:assert/strict";
import { celebrationText, fillReply, handoffWeeks, isBirthday, isStartDate, onTicketBoard, openBlockers, releasedBy, repliesFor, timerClock, timerMinutes, timerSuggestion, upcomingCelebrations, wouldCreateCycle } from "../app/team-tools.ts";

test("resposta pronta preenche os campos do chamado", () => {
  const context = { cliente: "Clínica São Lucas", solicitante: "Ana Souza", codigo: "CH-0012", titulo: "Erro na nota", eu: "Felipe" };
  assert.equal(fillReply("Olá {solicitante}, sobre o {codigo} da {cliente}: já estamos vendo. {eu}", context), "Olá Ana Souza, sobre o CH-0012 da Clínica São Lucas: já estamos vendo. Felipe");
  assert.equal(fillReply("Chamado {Código} ({título})", context), "Chamado CH-0012 (Erro na nota)", "aceita acento e maiúscula");
  assert.equal(fillReply("Oi {cliente}, tudo bem?", { ...context, cliente: "" }), "Oi, tudo bem?", "campo vazio não deixa espaço sobrando");
  assert.equal(fillReply("Texto {outro}", context), "Texto {outro}", "campo desconhecido fica como está");
});

test("respostas do time vêm antes das gerais", () => {
  const replies = [{ id: 1, teamId: null, title: "Boas-vindas" }, { id: 2, teamId: 5, title: "Reinício" }, { id: 3, teamId: 7, title: "Outro time" }, { id: 4, teamId: 5, title: "Acesso" }];
  assert.deepEqual(repliesFor(replies, 5).map((reply) => reply.id), [4, 2, 1]);
  assert.deepEqual(repliesFor(replies, null).map((reply) => reply.id), [1]);
});

test("quadro de chamados mostra resolvidos só por 7 dias", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(onTicketBoard({ status: "open", resolvedAt: null }, now), true);
  assert.equal(onTicketBoard({ status: "canceled", resolvedAt: null }, now), false);
  assert.equal(onTicketBoard({ status: "resolved", resolvedAt: "2026-11-10T09:00:00.000Z" }, now), true);
  assert.equal(onTicketBoard({ status: "resolved", resolvedAt: "2026-11-01T09:00:00.000Z" }, now), false);
  assert.equal(onTicketBoard({ status: "resolved", resolvedAt: "2026-11-12 09:00:00" }, now), true, "formato do SQLite");
});

test("cronômetro: minutos, mostrador e sugestão", () => {
  const start = "2026-11-13T12:00:00.000Z";
  const at = (minutes: number, seconds = 0) => Date.parse(start) + minutes * 60000 + seconds * 1000;
  assert.equal(timerMinutes(start, at(0, 10)), 1, "no mínimo 1 minuto");
  assert.equal(timerMinutes(start, at(65, 20)), 65);
  assert.equal(timerClock(start, at(65, 7)), "1:05:07");
  assert.equal(timerSuggestion(start, at(90)), "1:30");
  assert.equal(timerSuggestion(start, at(30 * 60)), "24:00", "nunca passa de 24 h");
});

test("dependências: ciclo, pendências abertas e liberação", () => {
  const edges = [{ taskId: 2, blockedById: 1 }, { taskId: 3, blockedById: 2 }, { taskId: 4, blockedById: 1 }, { taskId: 4, blockedById: 5 }];
  assert.equal(wouldCreateCycle(edges, 1, 3), true, "1 esperaria 3, que espera 2, que espera 1");
  assert.equal(wouldCreateCycle(edges, 1, 1), true);
  assert.equal(wouldCreateCycle(edges, 5, 3), false);
  const status = new Map([[1, "in_progress"], [2, "todo"], [3, "todo"], [4, "todo"], [5, "done"]]);
  const counts = openBlockers(edges, status);
  assert.equal(counts.get(2), 1);
  assert.equal(counts.get(4), 1, "a 5 já terminou");
  assert.equal(counts.get(1), undefined);
  status.set(1, "done");
  assert.deepEqual(releasedBy(edges, 1, status).sort(), [2, 4]);
  status.set(5, "todo");
  assert.deepEqual(releasedBy(edges, 1, status), [2], "a 4 ainda espera a 5");
});

test("passagem de plantão vai da semana atual para a próxima", () => {
  const weeks = [{ id: 1, start: "2026-11-02", end: "2026-11-06", teamId: 1 }, { id: 2, start: "2026-11-09", end: "2026-11-13", teamId: 2 }, { id: 3, start: "2026-11-16", end: "2026-11-20", teamId: 1 }];
  assert.deepEqual(handoffWeeks(weeks, "2026-11-13"), { from: weeks[1], to: weeks[2] });
  assert.deepEqual(handoffWeeks(weeks, "2026-11-14"), { from: weeks[1], to: weeks[2] }, "no fim de semana ainda é a última que terminou");
  assert.deepEqual(handoffWeeks(weeks.slice(0, 2), "2026-11-13"), { from: weeks[1], to: null });
});

test("aniversários e tempo de casa", () => {
  assert.equal(isBirthday("02-29"), true);
  assert.equal(isBirthday("02-30"), false);
  assert.equal(isBirthday("13-01"), false);
  assert.equal(isStartDate("2020-03-01", "2026-11-13"), true);
  assert.equal(isStartDate("2027-01-01", "2026-11-13"), false, "não pode ser no futuro");
  const people = [
    { id: 1, name: "Ana Souza", birthday: "11-13", startedOn: null },
    { id: 2, name: "Bruno Lima", birthday: "11-20", startedOn: "2021-11-15" },
    { id: 3, name: "Caio Reis", birthday: "01-02", startedOn: "2026-11-14" },
    { id: 4, name: "Dani", birthday: "02-29", startedOn: null },
  ];
  const list = upcomingCelebrations(people, "2026-11-13", 14);
  assert.deepEqual(list.map((entry) => [entry.memberId, entry.kind, entry.daysAway, entry.years]), [[1, "birthday", 0, 0], [2, "anniversary", 2, 5], [2, "birthday", 7, 0]]);
  assert.equal(celebrationText(list[0]), "Hoje é aniversário de Ana Souza! 🎂");
  assert.equal(celebrationText(list[1]), "Bruno completa 5 anos de casa em 2 dias");
  const leap = upcomingCelebrations(people, "2027-02-27", 3);
  assert.deepEqual(leap.map((entry) => [entry.memberId, entry.date]), [[4, "2027-02-28"]], "29/02 vira 28/02 fora do ano bissexto");
  const turn = upcomingCelebrations(people, "2026-12-30", 5);
  assert.deepEqual(turn.map((entry) => [entry.memberId, entry.date]), [[3, "2027-01-02"]], "vira o ano");
});
