import assert from "node:assert/strict";
import test from "node:test";
import { parseOpeningDate } from "../app/movement-policy.ts";

const now = Date.parse("2026-11-04T15:00:00.000Z");

test("aceita abertura retroativa e normaliza para ISO", () => {
  assert.deepEqual(parseOpeningDate("2026-11-03T12:30:00-03:00", now), {
    iso: "2026-11-03T15:30:00.000Z",
    error: null,
  });
});

test("rejeita data de abertura inválida", () => {
  assert.match(parseOpeningDate("ontem", now).error || "", /data de abertura válida/);
});

test("rejeita abertura no futuro", () => {
  assert.match(parseOpeningDate("2026-11-05T15:00:00.000Z", now).error || "", /não pode estar no futuro/);
});
