import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { check, fields, parseBody, readJsonBody } from "../app/api-input.ts";

test("aceita objeto JSON", () => {
  assert.deepEqual(parseBody('{"action":"saveEvent","title":"Reunião"}'), { ok: true, body: { action: "saveEvent", title: "Reunião" } });
  assert.deepEqual(parseBody(""), { ok: true, body: {} });
});

test("recusa o que não é objeto, JSON quebrado e ação estranha", () => {
  assert.equal(parseBody("[1,2]").ok, false);
  assert.equal(parseBody("null").ok, false);
  assert.equal(parseBody('"texto"').ok, false);
  const broken = parseBody("{action:");
  assert.deepEqual(broken, { ok: false, status: 400, error: "Os dados enviados não estão em um formato válido." });
  assert.deepEqual(parseBody('{"action":5}'), { ok: false, status: 400, error: "Ação inválida." });
  assert.equal(parseBody(JSON.stringify({ action: "x".repeat(61) })).ok, false);
});

test("limite de tamanho", () => {
  const big = JSON.stringify({ text: "a".repeat(300 * 1024) });
  assert.deepEqual(parseBody(big), { ok: false, status: 413, error: "Os dados enviados são grandes demais." });
  assert.equal(parseBody(big, 1024 * 1024).ok, true);
});

test("lê da requisição e responde 400 pronto", async () => {
  const ok = await readJsonBody(new Request("http://x/api", { method: "POST", body: '{"action":"a"}' }));
  assert.deepEqual(ok, { action: "a" });
  const bad = await readJsonBody(new Request("http://x/api", { method: "POST", body: "{" }));
  assert.ok(bad instanceof Response);
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, "Os dados enviados não estão em um formato válido.");
});

test("esquemas com mensagens em português", () => {
  const schema = z.object({ id: fields.id("Compromisso inválido."), title: fields.requiredText(140, "Escreva a anotação."), day: fields.day() });
  assert.deepEqual(check(schema, { id: "7", title: "  Café  ", day: "2026-11-12" }), { ok: true, data: { id: 7, title: "Café", day: "2026-11-12" } });
  assert.deepEqual(check(schema, { id: 0, title: "x", day: "2026-11-12" }), { ok: false, error: "Compromisso inválido." });
  assert.deepEqual(check(schema, { id: 1, title: "   ", day: "2026-11-12" }), { ok: false, error: "Escreva a anotação." });
  assert.deepEqual(check(schema, { id: 1, title: "x", day: "12/11/2026" }), { ok: false, error: "Data inválida." });
});
