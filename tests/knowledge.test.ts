import { test } from "node:test";
import assert from "node:assert/strict";
import { isNoticeActive, keywords, parseTags, relatedArticles, searchArticles, sortNotices } from "../app/knowledge.ts";

test("etiquetas sem repetir e com limite", () => {
  assert.deepEqual(parseTags("Boleto, API , boleto;  segunda via"), ["Boleto", "API", "segunda via"]);
  assert.deepEqual(parseTags(""), []);
  assert.equal(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(",")).length, 8);
  assert.equal(parseTags("x".repeat(40))[0].length, 24);
});

test("palavras-chave ignoram palavras comuns e acentos", () => {
  assert.deepEqual(keywords("Erro ao gerar o Boleto da Operadora"), ["gerar", "boleto", "operadora"]);
});

const articles = [
  { id: 1, title: "Boleto não aparece no site", body: "Reprocessar a remessa no sistema financeiro.", tags: "boleto, financeiro", client: "Operadora", updatedAt: "2026-11-01" },
  { id: 2, title: "Senha do autorizador", body: "Resetar a senha pelo painel. Não confundir com boleto.", tags: "acesso", client: "Dr. Online", updatedAt: "2026-11-05" },
  { id: 3, title: "Remessa bancária travada", body: "Verificar o arquivo de remessa do boleto.", tags: "financeiro", client: "", updatedAt: "2026-10-01" },
];

test("busca exige todas as palavras e prioriza o título", () => {
  // Título e etiqueta primeiro; só no texto, o mais recente antes.
  assert.deepEqual(searchArticles(articles, "boleto").map((a) => a.id), [1, 2, 3]);
  assert.deepEqual(searchArticles(articles, "boleto remessa").map((a) => a.id), [1, 3]);
  assert.deepEqual(searchArticles(articles, "operadora").map((a) => a.id), [1]);
  assert.deepEqual(searchArticles(articles, "nada disso").map((a) => a.id), []);
  assert.deepEqual(searchArticles(articles, "").map((a) => a.id), [2, 1, 3]);
});

test("artigos parecidos com o chamado", () => {
  assert.deepEqual(relatedArticles(articles, "Boleto não aparecendo no site do cliente").map((a) => a.id), [1]);
  assert.deepEqual(relatedArticles(articles, "Remessa do boleto com erro").map((a) => a.id), [1, 3]);
  // Só uma palavra em comum, e só no texto: não é parecido.
  assert.deepEqual(relatedArticles(articles, "Resetar painel antigo").map((a) => a.id), []);
  assert.deepEqual(relatedArticles(articles, "Ajuda").map((a) => a.id), []);
  assert.deepEqual(relatedArticles(articles, "senha").map((a) => a.id), [2]);
});

test("avisos ativos e ordem do mural", () => {
  assert.equal(isNoticeActive({ expiresOn: null }, "2026-11-11"), true);
  assert.equal(isNoticeActive({ expiresOn: "2026-11-11" }, "2026-11-11"), true);
  assert.equal(isNoticeActive({ expiresOn: "2026-11-10" }, "2026-11-11"), false);
  const list = sortNotices([
    { id: 1, important: false, expiresOn: null, createdAt: "2026-11-10" },
    { id: 2, important: true, expiresOn: null, createdAt: "2026-11-01" },
    { id: 3, important: false, expiresOn: null, createdAt: "2026-11-11" },
  ]);
  assert.deepEqual(list.map((n) => n.id), [2, 3, 1]);
});
