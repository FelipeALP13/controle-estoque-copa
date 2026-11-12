import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyDue, formatOverdue, isTeamsWebhook, lateTicketsCard, saoPaulo, stockAlertCard } from "../app/alerts.ts";

test("hora e dia em Brasília", () => {
  assert.deepEqual(saoPaulo(new Date("2026-11-12T02:30:00Z")), { day: "2026-11-11", hour: 23 });
  assert.deepEqual(saoPaulo(new Date("2026-11-12T12:00:00Z")), { day: "2026-11-12", hour: 9 });
});

test("alerta diário: uma vez por dia, a partir da hora escolhida", () => {
  assert.equal(dailyDue(null, new Date("2026-11-12T11:59:00Z"), 9), false); // 8h59 em Brasília
  assert.equal(dailyDue(null, new Date("2026-11-12T12:00:00Z"), 9), true); // 9h
  assert.equal(dailyDue("2026-11-12", new Date("2026-11-12T18:00:00Z"), 9), false); // já enviou hoje
  assert.equal(dailyDue("2026-11-11", new Date("2026-11-12T13:00:00Z"), 9), true);
});

test("link do Teams aceito", () => {
  assert.equal(isTeamsWebhook("https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x"), true);
  assert.equal(isTeamsWebhook("https://empresa.webhook.office.com/webhookb2/abc"), true);
  assert.equal(isTeamsWebhook("https://default123.4e.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc"), true);
  assert.equal(isTeamsWebhook("http://empresa.webhook.office.com/x"), false);
  assert.equal(isTeamsWebhook("https://golpe.com/logic.azure.com"), false);
  assert.equal(isTeamsWebhook("não é link"), false);
});

test("mensagem de estoque baixo", () => {
  const card = stockAlertCard([{ name: "Leite", available: 2, minimum: 6, unit: "caixas" }, { name: "Café", available: 0, minimum: 2, unit: "pacotes" }], "https://portal.exemplo/painel", "12/11/2026");
  const content = card.attachments[0].content as { body: { text?: string; columns?: { items: { text: string; color?: string }[] }[] }[]; actions: { url: string }[] };
  assert.equal(card.attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
  assert.equal(content.body[0].text, "Copa: 2 itens para repor");
  // O que acabou vem primeiro e destacado.
  assert.equal(content.body[2].columns![0].items[0].text, "Café");
  assert.equal(content.body[2].columns![0].items[0].color, "Attention");
  assert.equal(content.body[2].columns![1].items[0].text, "0 de 2 pacotes");
  assert.equal(content.actions[0].url, "https://portal.exemplo/painel");
});

test("mensagem de chamados atrasados", () => {
  const card = lateTicketsCard([{ code: "CH-3", title: "Boleto", client: "Dr. Hoje", team: "Suporte", reason: "resposta", overdueMinutes: 1500 }], null);
  const content = card.attachments[0].content as { body: { text?: string; columns?: { items: { text: string }[] }[] }[]; actions?: unknown };
  assert.equal(content.body[0].text, "1 chamado passou do prazo");
  assert.equal(content.body[2].columns![1].items[0].text, "Dr. Hoje · sem resposta há 1 d 1 h");
  assert.equal(content.actions, undefined);
  assert.equal(formatOverdue(45), "45 min");
  assert.equal(formatOverdue(130), "2 h");
});

test("estoque em dia (envio manual sem nada para repor)", () => {
  const card = stockAlertCard([], null, "12/11/2026");
  const content = card.attachments[0].content as { body: { text?: string }[] };
  assert.equal(content.body[0].text, "Copa: estoque em dia");
});
