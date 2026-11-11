import assert from "node:assert/strict";
import test from "node:test";
import { isClosedProject, isProjectFarol, isProjectPhase, projectCode, projectProgress } from "../app/projects.ts";

test("código e validações do projeto", () => {
  assert.equal(projectCode(7), "PRJ-7");
  assert.equal(isProjectFarol("yellow"), true);
  assert.equal(isProjectFarol("pink"), false);
  assert.equal(isProjectPhase("execution"), true);
  assert.equal(isProjectPhase("Execução"), false);
});

test("andamento pelas demandas ligadas, sem contar canceladas", () => {
  assert.deepEqual(projectProgress(["done", "done", "in_progress", "canceled"]), { total: 3, done: 2, percent: 67 });
  assert.deepEqual(projectProgress([]), { total: 0, done: 0, percent: null });
});

test("projeto encerrado pela fase ou pelo status", () => {
  assert.equal(isClosedProject({ status: "in_progress", phase: "closing" }), true);
  assert.equal(isClosedProject({ status: "done", phase: "execution" }), true);
  assert.equal(isClosedProject({ status: "todo", phase: "paused" }), false);
});
