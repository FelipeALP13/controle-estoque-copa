import { test } from "node:test";
import assert from "node:assert/strict";
import { importKey, isSealed, newRawKey, open, sameText, seal, sha256Hex } from "../app/secret-box.ts";

test("criptografa e abre de volta", async () => {
  const key = await importKey(newRawKey());
  const sealed = await seal(key, "ATATT-chave-do-jira");
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes("ATATT"));
  assert.equal(await open(key, sealed), "ATATT-chave-do-jira");
  // IV novo a cada vez: mesmo texto, resultados diferentes.
  assert.notEqual(await seal(key, "x"), await seal(key, "x"));
});

test("valor antigo sem criptografia continua funcionando", async () => {
  const key = await importKey(newRawKey());
  assert.equal(await open(key, "token-antigo-em-texto"), "token-antigo-em-texto");
  assert.equal(isSealed("token-antigo-em-texto"), false);
});

test("chave errada ou dado alterado não abre", async () => {
  const sealed = await seal(await importKey(newRawKey()), "segredo");
  await assert.rejects(async () => open(await importKey(newRawKey()), sealed), /chave de criptografia mudou/);
  const key = await importKey(newRawKey());
  const tampered = (await seal(key, "segredo")).replace(/.$/, (char) => (char === "A" ? "B" : "A"));
  await assert.rejects(() => open(key, tampered));
  await assert.rejects(() => importKey("curta"), /inválida/);
});

test("resumo e comparação", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sameText("abc", "abc"), true);
  assert.equal(sameText("abc", "abd"), false);
  assert.equal(sameText("abc", "abcd"), false);
});
