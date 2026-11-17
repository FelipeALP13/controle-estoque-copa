import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedArticles, bearerKey, externalTicketDescription, generateIntegrationKey, hashIntegrationKey, KEY_PREFIX, keyPrefix, normalizeKbTag, parseExternalTicket, searchForAgent } from "../app/integration-tools.ts";

test("chave nova, hash e cabeçalho", async () => {
  const key = generateIntegrationKey();
  assert.ok(key.startsWith(KEY_PREFIX) && key.length > 40);
  assert.notEqual(generateIntegrationKey(), key, "cada chave é única");
  const hash = await hashIntegrationKey(key);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await hashIntegrationKey(key), hash, "mesmo hash para a mesma chave");
  assert.equal(bearerKey(`Bearer ${key}`), key);
  assert.equal(bearerKey(key), null, "sem Bearer");
  assert.equal(bearerKey("Bearer abc"), null, "formato errado");
  assert.equal(bearerKey(null), null);
  assert.equal(keyPrefix(key), `${key.slice(0, 10)}…`);
});

const articles = [
  { id: 1, title: "Como emitir segunda via do boleto", body: "Acesse Financeiro > Boletos e clique em segunda via.", tags: "n1, boleto", client: "", updatedAt: "2026-11-01" },
  { id: 2, title: "Senha do servidor de produção", body: "interno", tags: "infra", client: "", updatedAt: "2026-11-02" },
  { id: 3, title: "Trocar e-mail de acesso", body: "Peça ao administrador da sua empresa.", tags: "N1", client: "", updatedAt: "2026-11-03" },
];

test("só artigos com a etiqueta liberada", () => {
  assert.deepEqual(allowedArticles(articles, "n1").map((a) => a.id), [1, 3], "sem diferenciar maiúsculas");
  assert.deepEqual(allowedArticles(articles, "atendimento").map((a) => a.id), []);
  assert.equal(normalizeKbTag("  "), "n1");
  assert.equal(normalizeKbTag(" Atendimento N1 "), "Atendimento N1");
});

test("busca do agente aceita frases do cliente", () => {
  const visible = allowedArticles(articles, "n1");
  assert.deepEqual(searchForAgent(visible, "boleto").map((a) => a.id), [1]);
  assert.deepEqual(searchForAgent(visible, "preciso da segunda via do meu boleto por favor").map((a) => a.id), [1], "frase longa cai na busca por semelhança");
  assert.deepEqual(searchForAgent(visible, "senha do servidor").map((a) => a.id), [], "artigo interno nunca aparece");
  assert.deepEqual(searchForAgent(visible, " "), []);
});

test("chamado pedido pela integração", () => {
  assert.ok(parseExternalTicket({ title: "x", externalId: "1" }).error, "título curto");
  assert.ok(parseExternalTicket({ title: "Cliente sem acesso", externalId: "" }).error, "sem externalId");
  const { ticket } = parseExternalTicket({ title: "  Cliente   sem acesso ", description: "Resumo\r\nlinha 2", urgency: "high", externalId: "4521", customerName: "Ana", customerPhone: "+55 11 9999", company: "Loja", conversationUrl: "javascript:alert(1)" });
  assert.equal(ticket?.title, "Cliente sem acesso");
  assert.equal(ticket?.description, "Resumo\nlinha 2");
  assert.equal(ticket?.urgency, "high");
  assert.equal(ticket?.conversationUrl, null, "link perigoso fica de fora");
  assert.equal(parseExternalTicket({ title: "abc", externalId: "1", urgency: "urgentissimo" }).ticket?.urgency, "normal");
  assert.equal(parseExternalTicket({ title: "abc", externalId: "1", conversationUrl: "https://chat.exemplo.com/tickets/9" }).ticket?.conversationUrl, "https://chat.exemplo.com/tickets/9");
  const description = externalTicketDescription(ticket!);
  assert.match(description, /^Resumo\nlinha 2/);
  assert.match(description, /atendimento 4521/);
  assert.match(description, /Cliente: Ana · \+55 11 9999/);
});
