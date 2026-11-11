import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, rankSearch, scoreEntry, type SearchEntry } from "../app/search.ts";
import { actionsInGroup, describeAction } from "../app/audit-labels.ts";

const entries: SearchEntry[] = [
  { kind: "task", id: 12, title: "Boleto não aparece no site", subtitle: "Operadora", codes: ["DEM-12", "AS-0019"] },
  { kind: "task", id: 13, title: "Relatório de boletos", subtitle: "Plenus", codes: ["DEM-13"], closed: true },
  { kind: "ticket", id: 3, title: "Cliente sem boleto", subtitle: "Dr. Hoje", codes: ["CH-3", "DRH-45"] },
  { kind: "article", id: 1, title: "Senha do autorizador", subtitle: "Base", codes: [], extra: "resetar a senha pelo painel" },
  { kind: "person", id: 5, title: "José", subtitle: "Analista de Suporte", codes: [] },
];

test("códigos em vários formatos", () => {
  assert.equal(normalizeCode("DEM 12"), "dem-12");
  assert.equal(normalizeCode("dem12"), "dem-12");
  assert.equal(normalizeCode("drh-45"), "drh-45");
  assert.equal(scoreEntry(entries[0], "dem12"), 1000);
  assert.equal(scoreEntry(entries[0], "as-0019"), 1000);
  assert.equal(scoreEntry(entries[2], "DRH 45"), 1000);
});

test("busca por palavras, sem acento e com prioridade no título", () => {
  const hits = rankSearch(entries, "boleto");
  // A demanda concluída (13) fica depois do chamado em aberto com a mesma relevância.
  assert.deepEqual(hits.map((hit) => `${hit.kind}:${hit.id}`), ["task:12", "ticket:3", "task:13"]);
  assert.deepEqual(rankSearch(entries, "jose").map((hit) => hit.id), [5]);
  assert.deepEqual(rankSearch(entries, "resetar senha").map((hit) => hit.id), [1]);
  assert.deepEqual(rankSearch(entries, "boleto plenus").map((hit) => hit.id), [13]);
  assert.deepEqual(rankSearch(entries, "nada disso"), []);
  assert.deepEqual(rankSearch(entries, "  "), []);
});

test("limite de resultados por tipo", () => {
  const many = Array.from({ length: 10 }, (_, i): SearchEntry => ({ kind: "task", id: i, title: `Teste ${i}`, subtitle: "", codes: [] }));
  assert.equal(rankSearch(many, "teste", 6).length, 6);
});

test("nomes das ações do histórico", () => {
  assert.equal(describeAction("member_role_updated").label, "Mudou a permissão de um usuário");
  assert.equal(describeAction("login_failed").sensitive, true);
  assert.equal(describeAction("acao_nova").label, "acao nova");
  assert.ok(actionsInGroup("access").includes("login"));
});
