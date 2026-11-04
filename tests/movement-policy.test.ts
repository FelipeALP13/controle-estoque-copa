import assert from "node:assert/strict";
import test from "node:test";
import { movementOccursBeforeOpening, parseMovementDate } from "../app/movement-policy.ts";

const now = Date.parse("2026-11-04T15:00:00.000Z");

test("aceita movimentação retroativa e normaliza para ISO", () => {
  assert.deepEqual(parseMovementDate("2026-11-03T12:30:00-03:00", now), {
    iso: "2026-11-03T15:30:00.000Z",
    error: null,
  });
});

test("rejeita data de movimentação inválida", () => {
  assert.match(parseMovementDate("ontem", now).error || "", /data e hora válidas/);
});

test("rejeita movimentação no futuro", () => {
  assert.match(parseMovementDate("2026-11-05T15:00:00.000Z", now).error || "", /não pode estar no futuro/);
});

test("identifica consumo anterior à abertura", () => {
  assert.equal(movementOccursBeforeOpening("2026-11-03T10:00:00.000Z", "2026-11-03T11:00:00.000Z"), true);
  assert.equal(movementOccursBeforeOpening("2026-11-03T12:00:00.000Z", "2026-11-03T11:00:00.000Z"), false);
});
