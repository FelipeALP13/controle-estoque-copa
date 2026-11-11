import { test } from "node:test";
import assert from "node:assert/strict";
import { adfToText, basicAuth, buildJql, jiraErrorMessage, minutesSince, nextStatus, normalizeJiraUrl, parseIssue, statusFrom, typeFrom, urgencyFrom } from "../app/jira.ts";

test("endereço da conta do Jira", () => {
  assert.equal(normalizeJiraUrl("https://drhoje.atlassian.net/jira/servicedesk/projects"), "https://drhoje.atlassian.net");
  assert.equal(normalizeJiraUrl("empresa.atlassian.net"), "https://empresa.atlassian.net");
  assert.equal(normalizeJiraUrl("http://empresa.atlassian.net"), null);
  assert.equal(normalizeJiraUrl("https://atlassian.net.golpe.com"), null);
  assert.equal(normalizeJiraUrl("http://127.0.0.1:4010"), null);
  assert.equal(normalizeJiraUrl("http://127.0.0.1:4010", true), "http://127.0.0.1:4010");
});

test("autenticação básica", () => {
  assert.equal(basicAuth("a@b.com", "tok"), `Basic ${Buffer.from("a@b.com:tok").toString("base64")}`);
  assert.equal(basicAuth("joão@b.com", "x"), `Basic ${Buffer.from("joão@b.com:x").toString("base64")}`);
});

test("busca no Jira", () => {
  assert.equal(buildJql(["DRH", "ADC"], null), 'project in ("DRH", "ADC") AND (statusCategory != Done OR updated >= -7d) ORDER BY updated ASC');
  assert.equal(buildJql(['X"Y'], 12.2), 'project in ("XY") AND updated >= -13m ORDER BY updated ASC');
  const now = new Date("2026-11-11T12:00:00Z");
  assert.equal(minutesSince(null, now), null);
  assert.equal(minutesSince("2026-11-11T11:55:00Z", now), 15);
});

test("texto do Jira (ADF) vira texto simples", () => {
  const doc = {
    type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Olá, " }, { type: "mention", attrs: { text: "@Suporte" } }, { type: "hardBreak" }, { type: "text", text: "boleto sumiu." }] },
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item 1" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item 2" }] }] },
      ] },
      { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "passo" }] }] }] },
      { type: "mediaSingle", content: [{ type: "media" }] },
      { type: "paragraph", content: [{ type: "inlineCard", attrs: { url: "https://x.com" } }] },
    ],
  };
  assert.equal(adfToText(doc), "Olá, @Suporte\nboleto sumiu.\n\n- item 1\n- item 2\n\n1. passo\n\n[anexo]\n\nhttps://x.com");
  assert.equal(adfToText(null), "");
  assert.equal(adfToText("texto antigo"), "texto antigo");
});

test("prioridade, tipo e status", () => {
  assert.deepEqual(["Highest", "Mais alta", "Alta", "High", "Medium", "Média", "Baixa", "Lowest", undefined].map(urgencyFrom), ["critical", "critical", "high", "high", "normal", "normal", "low", "low", "normal"]);
  assert.deepEqual(["Bug", "Incidente", "Melhoria", "Story", "Acesso", "Dúvida", "Service Request", "Tarefa", "Epic"].map(typeFrom), ["bug", "bug", "improvement", "improvement", "access", "question", "question", "question", "other"]);
  assert.deepEqual(["new", "indeterminate", "done", undefined].map(statusFrom), ["open", "in_progress", "resolved", "open"]);
});

const issue = {
  key: "DRH-12",
  fields: {
    summary: "  Boleto não aparece  ",
    description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Desde ontem." }] }] },
    issuetype: { name: "Bug" }, priority: { name: "High" },
    status: { name: "Em andamento", statusCategory: { key: "indeterminate" } },
    reporter: { displayName: "Ana (Dr. Hoje)", accountId: "cli-1" },
    created: "2026-11-10T09:00:00.000-0300", updated: "2026-11-10T11:00:00.000-0300", resolutiondate: null,
    project: { key: "DRH" },
    comment: { comments: [
      { id: "30", author: { displayName: "Taís", accountId: "nos-1" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Olhando." }] }] }, created: "2026-11-10T10:00:00.000-0300" },
      { id: "20", author: { displayName: "Ana (Dr. Hoje)", accountId: "cli-1" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Urgente!" }] }] }, created: "2026-11-10T09:30:00.000-0300" },
    ] },
  },
};

test("lê um item do Jira", () => {
  const data = parseIssue(issue, "https://drhoje.atlassian.net")!;
  assert.equal(data.title, "Boleto não aparece");
  assert.equal(data.url, "https://drhoje.atlassian.net/browse/DRH-12");
  assert.equal(data.description, "Desde ontem.");
  assert.deepEqual([data.type, data.urgency, data.status, data.statusName, data.projectKey], ["bug", "high", "in_progress", "Em andamento", "DRH"]);
  assert.equal(data.created, "2026-11-10T12:00:00.000Z");
  assert.equal(data.resolved, null);
  assert.deepEqual(data.comments.map((comment) => comment.id), ["20", "30"]);
  // A primeira resposta é o comentário da Taís, não o da própria cliente.
  assert.equal(data.firstResponse, "2026-11-10T13:00:00.000Z");
  assert.equal(parseIssue({}, "x"), null);
  const done = parseIssue({ ...issue, fields: { ...issue.fields, status: { name: "Concluído", statusCategory: { key: "done" } }, resolutiondate: "2026-11-10T15:00:00.000-0300" } }, "https://x.atlassian.net")!;
  assert.deepEqual([done.status, done.resolved], ["resolved", "2026-11-10T18:00:00.000Z"]);
});

test("status só muda quando a categoria muda no Jira", () => {
  assert.equal(nextStatus("waiting", "indeterminate", { category: "indeterminate", status: "in_progress" }), "waiting");
  assert.equal(nextStatus("waiting", "indeterminate", { category: "done", status: "resolved" }), "resolved");
  assert.equal(nextStatus("resolved", "done", { category: "new", status: "open" }), "open");
  assert.equal(nextStatus("canceled", "new", { category: "indeterminate", status: "in_progress" }), "canceled");
  assert.equal(nextStatus("open", null, { category: "new", status: "open" }), "open");
});

test("mensagens de erro do Jira", () => {
  assert.match(jiraErrorMessage(401, ""), /chave de API/);
  assert.match(jiraErrorMessage(400, '{"errorMessages":["O projeto XYZ não existe."]}'), /XYZ/);
  assert.match(jiraErrorMessage(503, ""), /503/);
});

test("texto vira documento do Jira", async () => {
  const { textToAdf, adfToText } = await import("../app/jira.ts");
  const doc = textToAdf("Olá!\nJá corrigimos.\n\nQualquer coisa, avise.");
  assert.equal(doc.content.length, 2);
  assert.deepEqual(doc.content[0].content.map((node) => node.type), ["text", "hardBreak", "text"]);
  // Ida e volta: o que vai para o Jira volta igual.
  assert.equal(adfToText(doc), "Olá!\nJá corrigimos.\n\nQualquer coisa, avise.");});

test("escolhe a transição de status no fluxo do Jira", async () => {
  const { pickTransition, needsTransition } = await import("../app/jira.ts");
  const flow = [
    { id: "11", name: "Iniciar atendimento", to: { name: "Em andamento", statusCategory: { key: "indeterminate" } } },
    { id: "21", name: "Aguardar cliente", to: { name: "Aguardando cliente", statusCategory: { key: "indeterminate" } } },
    { id: "31", name: "Resolver", to: { name: "Resolvido", statusCategory: { key: "done" } } },
    { id: "41", name: "Cancelar", to: { name: "Cancelado", statusCategory: { key: "done" } } },
    { id: "51", name: "Reabrir", to: { name: "Aberto", statusCategory: { key: "new" } } },
  ];
  assert.equal(pickTransition(flow, "in_progress")?.id, "11");
  assert.equal(pickTransition(flow, "waiting")?.id, "21");
  assert.equal(pickTransition(flow, "resolved")?.id, "31");
  assert.equal(pickTransition(flow, "canceled")?.id, "41");
  assert.equal(pickTransition(flow, "open")?.id, "51");
  // Fluxo simples (sem espera nem cancelamento): não inventa.
  const simple = [{ id: "1", name: "Fazer", to: { name: "Fazendo", statusCategory: { key: "indeterminate" } } }, { id: "2", name: "Pronto", to: { name: "Done", statusCategory: { key: "done" } } }];
  assert.equal(pickTransition(simple, "waiting"), null);
  assert.equal(pickTransition(simple, "canceled"), null);
  assert.equal(pickTransition(simple, "resolved")?.id, "2");
  assert.equal(pickTransition(simple, "in_progress")?.id, "1");
  assert.equal(pickTransition([], "resolved"), null);
  assert.equal(needsTransition("done", "resolved"), false);
  assert.equal(needsTransition("indeterminate", "resolved"), true);
  assert.equal(needsTransition("indeterminate", "waiting"), true);
});
