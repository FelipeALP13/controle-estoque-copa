import assert from "node:assert/strict";
import test from "node:test";
import { cleanMultiline, cleanTitle, describeTaskEvent, dueState, isTaskPriority, isTaskStatus, parseDueDate, sortOrderBetween, taskCode } from "../app/tasks.ts";

test("gera o código da tarefa", () => {
  assert.equal(taskCode(12), "DEM-12");
});

test("valida status e prioridade", () => {
  assert.equal(isTaskStatus("in_review"), true);
  assert.equal(isTaskStatus("doing"), false);
  assert.equal(isTaskPriority(1), true);
  assert.equal(isTaskPriority(5), false);
  assert.equal(isTaskPriority("1"), false);
});

test("limpa título e descrição", () => {
  assert.equal(cleanTitle("  Corrigir   login \n do portal "), "Corrigir login do portal");
  assert.equal(cleanMultiline("a\r\n\r\n\r\n\r\nb  ", 100), "a\n\nb");
});

test("aceita prazo válido, vazio ou recusa inválido", () => {
  assert.equal(parseDueDate("2026-11-20"), "2026-11-20");
  assert.equal(parseDueDate(""), null);
  assert.equal(parseDueDate(null), null);
  assert.equal(parseDueDate("2026-02-30"), undefined);
  assert.equal(parseDueDate("20/11/2026"), undefined);
});

test("calcula a posição entre cartões", () => {
  assert.equal(sortOrderBetween(null, null), 1000);
  assert.equal(sortOrderBetween(null, 500), -500);
  assert.equal(sortOrderBetween(2000, null), 3000);
  assert.equal(sortOrderBetween(1000, 2000), 1500);
});

test("classifica o prazo em relação a hoje", () => {
  assert.equal(dueState("2026-11-09", "2026-11-10"), "overdue");
  assert.equal(dueState("2026-11-10", "2026-11-10"), "today");
  assert.equal(dueState("2026-11-13", "2026-11-10"), "soon");
  assert.equal(dueState("2026-11-20", "2026-11-10"), "later");
});

test("descreve as mudanças no histórico", () => {
  assert.equal(describeTaskEvent("status", "in_progress"), "mudou o status para Fazendo");
  assert.equal(describeTaskEvent("priority", "1"), "definiu a prioridade como Crítica");
  assert.equal(describeTaskEvent("priority", "0"), "removeu a prioridade");
  assert.equal(describeTaskEvent("assignee", "Caio Viana"), "atribuiu a Caio Viana");
  assert.equal(describeTaskEvent("assignee", ""), "removeu o responsável");
  assert.equal(describeTaskEvent("due_date", "2026-11-20"), "definiu o prazo para 20/11");
  assert.equal(describeTaskEvent("team", "Suporte"), "moveu para o time Suporte");
  assert.equal(describeTaskEvent("team", ""), "removeu o time");
});
