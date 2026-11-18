import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, hotp, isNewPlace, loginPlace, looksLikeRecoveryCode, newRecoveryCodes, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../app/totp.ts";
import { cleanPollOptions, cleanVote, isPollOpen, kudosError, kudosRanking, pollClosesAt, pollError, pollResults, pollWinners } from "../app/wall-tools.ts";
import { canChangeStatus, openFor, sortMaintenance } from "../app/maintenance-tools.ts";
import { dependencyConflict, dragDates, wouldCreateCycle } from "../app/project-timeline.ts";
import { exportPeriod, hoursBetween, inPeriod, toCsv } from "../app/export-data.ts";
import { messagesBody, readAiResponse, replyRequest, resolutionOf, summaryRequest, ticketTranscript } from "../app/ai-assist.ts";
import { qrMatrix, qrSvg } from "../app/qr-code.ts";
import { isSurveyToken, newSurveyToken, satisfactionSummary, surveyState } from "../app/ticket-rating.ts";

// ---------- Verificação em duas etapas ----------

test("TOTP segue os vetores oficiais da RFC 6238 (SHA-1)", async () => {
  const secret = new TextEncoder().encode("12345678901234567890");
  const cases: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"]];
  for (const [time, code] of cases) assert.equal(await hotp(secret, Math.floor(time / 30), 8), code);
});

test("base32 vai e volta e o código de 6 dígitos vale com 1 passo de folga", async () => {
  const bytes = new TextEncoder().encode("12345678901234567890");
  const secret = base32Encode(bytes);
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual([...base32Decode(secret)], [...bytes]);
  const now = 1_700_000_000_000;
  const code = await hotp(bytes, Math.floor(now / 30000));
  assert.notEqual(await verifyTotp(secret, code, now), null);
  assert.notEqual(await verifyTotp(secret, code, now + 30000), null, "um passo depois ainda vale");
  assert.equal(await verifyTotp(secret, code, now + 90000), null, "três passos depois não vale");
  assert.equal(await verifyTotp(secret, "12345", now), null);
});

test("códigos de recuperação e endereço do autenticador", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  assert.ok(codes.every((code) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)));
  assert.equal(normalizeRecoveryCode("abcd-2345"), "ABCD2345");
  assert.ok(looksLikeRecoveryCode("abcd-2345"));
  assert.ok(!looksLikeRecoveryCode("123456"));
  const uri = otpauthUri("ABC", "ana", "Portal da Equipe");
  assert.ok(uri.startsWith("otpauth://totp/Portal%20da%20Equipe%3Aana?secret=ABC&issuer=Portal%20da%20Equipe"));
});

test("alerta de lugar novo não dispara no primeiro acesso", () => {
  const place = loginPlace("BR", "São Paulo", "Chrome no Windows");
  assert.equal(place, "São Paulo, BR · Chrome no Windows");
  assert.equal(loginPlace(null, null, ""), "local desconhecido · aparelho desconhecido");
  assert.equal(isNewPlace([], place), false);
  assert.equal(isNewPlace([place], place), false);
  assert.equal(isNewPlace(["Lisboa, PT · Safari no iPhone"], place), true);
});

// ---------- QR code ----------

test("QR code: tamanho pela versão e os três localizadores nos cantos", () => {
  const small = qrMatrix("HELLO");
  assert.equal(small.length, 21, "texto curto cabe na versão 1 (21x21)");
  const uri = otpauthUri("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "administrador", "Portal da Equipe");
  const matrix = qrMatrix(uri);
  const size = matrix.length;
  assert.equal((size - 17) % 4, 0);
  assert.ok(size >= 41 && size <= 57, `versão razoável para ${uri.length} caracteres (tamanho ${size})`);
  const finder = (x: number, y: number) => {
    for (let dy = 0; dy < 7; dy += 1) for (let dx = 0; dx < 7; dx += 1) {
      const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
      const center = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      assert.equal(matrix[y + dy][x + dx], edge || center, `localizador em ${x},${y}`);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  assert.equal(matrix[size - 8][8], true, "módulo escuro fixo");
  for (let i = 8; i < size - 8; i += 1) assert.equal(matrix[6][i], i % 2 === 0, "linha de tempo");
  assert.ok(qrSvg("oi").startsWith("<svg"));
  assert.throws(() => qrMatrix("x".repeat(400)));
});

// ---------- Elogios e enquetes ----------

test("elogio: precisa de alguém, de mensagem e não pode ser para si", () => {
  assert.match(kudosError({ fromId: 1, toId: 1, message: "valeu", value: "" })!, /colega/);
  assert.match(kudosError({ fromId: 1, toId: 0, message: "valeu", value: "" })!, /quem/);
  assert.match(kudosError({ fromId: 1, toId: 2, message: "ok", value: "" })!, /poucas palavras/);
  assert.match(kudosError({ fromId: 1, toId: 2, message: "valeu demais", value: "xyz" })!, /tipos/);
  assert.equal(kudosError({ fromId: 1, toId: 2, message: "valeu demais", value: "team" }), null);
  assert.deepEqual(kudosRanking([{ toId: 3 }, { toId: 2 }, { toId: 3 }]), [{ memberId: 3, count: 2 }, { memberId: 2, count: 1 }]);
});

test("enquete: opções limpas, prazo, votos e resultado", () => {
  assert.deepEqual(cleanPollOptions(["Pizza", " pizza ", "", "Japonês"]), ["Pizza", "Japonês"]);
  assert.equal(cleanPollOptions(Array.from({ length: 12 }, (_, i) => `op ${i}`)).length, 8);
  assert.match(pollError("Pizza?", ["só uma"])!, /duas/);
  assert.equal(pollError("Pizza ou japonês?", ["a", "b"]), null);
  const now = new Date("2026-11-18T15:00:00Z");
  assert.equal(pollClosesAt("1h", now), "2026-11-18T16:00:00.000Z");
  assert.equal(pollClosesAt("today", now), "2026-11-19T02:59:00.000Z", "23:59 de Brasília");
  assert.equal(pollClosesAt("none", now), null);
  assert.equal(pollClosesAt("2y", now), undefined);
  assert.equal(isPollOpen({ closedAt: null, closesAt: "2026-11-18T16:00:00.000Z" }, now), true);
  assert.equal(isPollOpen({ closedAt: null, closesAt: "2026-11-18T14:00:00.000Z" }, now), false);
  assert.deepEqual(cleanVote([1, 0, 1, 9], 2, false), [1]);
  assert.deepEqual(cleanVote([1, 0, 1, 9], 2, true), [1, 0]);
  const result = pollResults(["Pizza", "Japonês"], [{ memberId: 1, option: 0 }, { memberId: 2, option: 0 }, { memberId: 3, option: 1 }], 3, false, (id) => `P${id}`);
  assert.equal(result.voters, 3);
  assert.deepEqual(result.mine, [1]);
  assert.deepEqual(result.options.map((option) => option.percent), [67, 33]);
  assert.deepEqual(result.options[0].names, ["P1", "P2"]);
  assert.deepEqual(pollResults(["a"], [{ memberId: 1, option: 0 }], 1, true, String).options[0].names, [], "anônima não mostra nomes");
  assert.deepEqual(pollWinners([2, 2, 1]), [0, 1]);
  assert.deepEqual(pollWinners([0, 0]), []);
});

// ---------- Manutenção ----------

test("manutenção: quem pode mudar a situação e a ordem da fila", () => {
  assert.equal(canChangeStatus({ handler: true, isCreator: false, from: "open", to: "done" }), true);
  assert.equal(canChangeStatus({ handler: false, isCreator: true, from: "open", to: "canceled" }), true);
  assert.equal(canChangeStatus({ handler: false, isCreator: true, from: "open", to: "done" }), false);
  assert.equal(canChangeStatus({ handler: false, isCreator: true, from: "done", to: "open" }), true);
  assert.equal(canChangeStatus({ handler: false, isCreator: false, from: "open", to: "canceled" }), false);
  const sorted = sortMaintenance([
    { id: 1, status: "done", priority: "urgent", createdAt: "2026-11-01", resolvedAt: "2026-11-02" },
    { id: 2, status: "open", priority: "normal", createdAt: "2026-11-03", resolvedAt: null },
    { id: 3, status: "open", priority: "urgent", createdAt: "2026-11-05", resolvedAt: null },
    { id: 4, status: "open", priority: "normal", createdAt: "2026-11-02", resolvedAt: null },
  ]);
  assert.deepEqual(sorted.map((row) => row.id), [3, 4, 2, 1]);
  assert.equal(openFor("2026-11-18T10:00:00Z", Date.parse("2026-11-18T13:30:00Z")), "3 h");
  assert.equal(openFor("2026-11-15T10:00:00Z", Date.parse("2026-11-18T13:30:00Z")), "3 dias");
});

// ---------- Linha do tempo ----------

test("linha do tempo: arrastar a barra e dependências", () => {
  assert.deepEqual(dragDates("move", "2026-11-02", "2026-11-10", 3.4), { startDate: "2026-11-05", endDate: "2026-11-13" });
  assert.deepEqual(dragDates("end", "2026-11-02", "2026-11-10", -20), { startDate: "2026-11-02", endDate: "2026-11-02" }, "o fim não passa do início");
  assert.deepEqual(dragDates("start", "2026-11-02", "2026-11-10", 30), { startDate: "2026-11-10", endDate: "2026-11-10" });
  const edges = [{ projectId: 2, dependsOnId: 1 }, { projectId: 3, dependsOnId: 2 }];
  assert.equal(wouldCreateCycle(edges, 1, 3), true, "1 depender de 3 fecharia o ciclo 1→3→2→1");
  assert.equal(wouldCreateCycle(edges, 3, 1), false);
  assert.equal(wouldCreateCycle(edges, 4, 4), true);
  assert.equal(dependencyConflict({ startDate: "2026-12-01", endForecast: "2026-12-20" }, { endForecast: "2026-12-10" }), true);
  assert.equal(dependencyConflict({ startDate: "2026-12-11", endForecast: "2026-12-20" }, { endForecast: "2026-12-10" }), false);
  assert.equal(dependencyConflict({ startDate: "2026-12-01", endForecast: "2026-12-20" }, { endForecast: "A definir" }), false);
});

// ---------- Exportação ----------

test("exportação: período, horas e CSV seguro para o Excel", () => {
  assert.deepEqual(exportPeriod("2026-01-01", "lixo"), { from: "2026-01-01", to: null });
  assert.equal(inPeriod("2026-11-18 02:30:00", { from: "2026-11-18", to: null }), false, "02:30 UTC ainda é dia 17 em Brasília");
  assert.equal(inPeriod("2026-11-18T12:00:00Z", { from: "2026-11-18", to: "2026-11-18" }), true);
  assert.equal(hoursBetween("2026-11-18T10:00:00Z", "2026-11-18T13:30:00Z"), 3.5);
  assert.equal(hoursBetween("2026-11-18T10:00:00Z", null), null);
  const csv = toCsv({ columns: [{ header: "Título" }, { header: "Horas" }], rows: [["=HYPERLINK(\"x\")", 1.5], ["a;b", null]] });
  assert.ok(csv.startsWith("﻿Título;Horas\r\n"));
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"x\"\")\";1,5"), "fórmula vira texto e número usa vírgula");
  assert.ok(csv.includes("\"a;b\";\r\n"));
});

// ---------- Pesquisa de satisfação ----------

test("satisfação: link, situação e médias por time e por quem avaliou", () => {
  const token = newSurveyToken();
  assert.ok(isSurveyToken(token));
  assert.ok(!isSurveyToken("curto"));
  assert.equal(surveyState({ status: "open", rating: null }), "pending");
  assert.equal(surveyState({ status: "resolved", rating: null }), "open");
  assert.equal(surveyState({ status: "resolved", rating: 4 }), "done");
  const base = { title: "x", ratingComment: "", ratedAt: "2026-11-10T15:00:00Z" };
  const rows = [
    { ...base, id: 1, assigneeId: 1, teamId: 10, rating: 5, ratedBy: "client" },
    { ...base, id: 2, assigneeId: 1, teamId: 10, rating: 3, ratedBy: "" },
    { ...base, id: 3, assigneeId: 2, teamId: 20, rating: 4, ratedBy: "client" },
  ];
  const all = satisfactionSummary(rows, "2026-11-01", "2026-11-30");
  assert.equal(all.total, 3);
  assert.deepEqual(all.byTeam.map((row) => [row.teamId, row.average]), [[10, 4], [20, 4]]);
  assert.equal(satisfactionSummary(rows, "2026-11-01", "2026-11-30", "client").total, 2);
  assert.equal(satisfactionSummary(rows, "2026-11-01", "2026-11-30", "team").total, 1);
});

// ---------- Assistente (IA) ----------

test("assistente: pedido no formato da API e leitura da resposta", () => {
  const ticket = { code: "CH-1", title: "Impressora", description: "não imprime", client: "ACME", status: "Aberto", urgency: "Normal", requesterName: "Ana", createdAt: "2026-11-18T12:00:00Z" };
  const events = [{ kind: "comment", actorName: "Bia", body: "troquei o cabo", createdAt: "2026-11-18T13:00:00Z" }];
  assert.match(ticketTranscript(ticket, events), /CH-1: Impressora[\s\S]*Bia: troquei o cabo/);
  assert.match(summaryRequest(ticket, events).system, /3 linhas/);
  const reply = replyRequest(ticket, events, [{ title: "Driver", body: "reinstale" }], [{ code: "CH-9", title: "Igual", resolution: "trocou o toner" }]);
  assert.match(reply.user, /\[Artigo 1\] Driver[\s\S]*\[CH-9\] Igual/);
  const opus = messagesBody("claude-opus-5-5", { system: "s", user: "u" }, "medium");
  assert.deepEqual(opus.output_config, { effort: "medium" });
  assert.equal(opus.max_tokens, 16000);
  assert.equal("thinking" in opus, false, "no Opus 5.5 o raciocínio é sempre ligado: não manda thinking");
  assert.equal("output_config" in messagesBody("claude-haiku-5-5", { system: "s", user: "u" }), false);
  assert.deepEqual(readAiResponse(200, { content: [{ type: "thinking" }, { type: "text", text: " ok " }], stop_reason: "end_turn" }), { ok: true, text: "ok" });
  assert.equal(readAiResponse(200, { content: [], stop_reason: "refusal" }).ok, false);
  assert.match((readAiResponse(401, {}) as { error: string }).error, /chave/);
  assert.match((readAiResponse(429, {}) as { error: string }).error, /muitos pedidos/);
  assert.equal(resolutionOf([{ kind: "comment", actorId: 5, body: "pergunta" }, { kind: "comment", actorId: 2, body: "resolvido trocando o cabo" }], 5), "resolvido trocando o cabo");
});
