import { test } from "node:test";
import assert from "node:assert/strict";
import { crossedLow, findSameRequest, lowStockText, MAX_TRIP_LINES, parseCopaAlerts, parseTripLines, requestTitleError, sortRequests } from "../app/copa-tools.ts";

test("linhas da ida ao mercado", () => {
  assert.deepEqual(parseTripLines([{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: "1.5" }]).lines, [{ itemId: 1, quantity: 2 }, { itemId: 2, quantity: 1.5 }]);
  assert.deepEqual(parseTripLines([{ itemId: 1, quantity: 2 }, { itemId: 1, quantity: 3 }]).lines, [{ itemId: 1, quantity: 5 }], "mesmo item soma");
  assert.ok(parseTripLines([]).error);
  assert.ok(parseTripLines("x").error);
  assert.ok(parseTripLines([{ itemId: 1, quantity: 0 }]).error, "quantidade zero");
  assert.ok(parseTripLines([{ itemId: 1, quantity: -1 }]).error);
  assert.ok(parseTripLines([{ itemId: 0, quantity: 1 }]).error, "item inválido");
  assert.ok(parseTripLines([{ itemId: 1.5, quantity: 1 }]).error);
  assert.ok(parseTripLines([{ itemId: 1, quantity: 20000 }]).error, "quantidade grande demais");
  assert.ok(parseTripLines(Array.from({ length: MAX_TRIP_LINES + 1 }, (_, index) => ({ itemId: index + 1, quantity: 1 }))).error);
});

test("aviso só quando cai para o mínimo", () => {
  assert.equal(crossedLow(3, 2, 2), true, "chegou no mínimo");
  assert.equal(crossedLow(3, 0, 2), true, "acabou");
  assert.equal(crossedLow(2, 1, 2), false, "já estava no mínimo: não repete");
  assert.equal(crossedLow(5, 4, 2), false, "ainda acima");
  assert.equal(crossedLow(1, 3, 2), false, "compra não avisa");
});

test("texto do aviso", () => {
  assert.equal(lowStockText({ name: "Café", unit: "pacote", minimumQty: 2 }, 0), "Café acabou.");
  assert.equal(lowStockText({ name: "Café", unit: "pacote", minimumQty: 2 }, 1), "Café está acabando: resta 1 pacote (mínimo 2).");
  assert.equal(lowStockText({ name: "Leite", unit: "caixa", minimumQty: 4 }, 2.5), "Leite está acabando: restam 2,5 caixa (mínimo 4).");
});

test("configuração dos avisos", () => {
  assert.deepEqual(parseCopaAlerts('{"memberIds":[3,3,"4",-1,"x"],"channelId":7}'), { memberIds: [3, 4], channelId: 7 });
  assert.deepEqual(parseCopaAlerts("lixo"), { memberIds: [], channelId: null });
  assert.deepEqual(parseCopaAlerts({ channelId: 0 }), { memberIds: [], channelId: null });
});

test("pedidos da equipe", () => {
  assert.ok(requestTitleError(" a "));
  assert.ok(requestTitleError("x".repeat(81)));
  assert.equal(requestTitleError("Adoçante"), null);
  const list = [{ id: 1, title: "Chá de Camomila", status: "open" }, { id: 2, title: "Adoçante", status: "declined" }];
  assert.equal(findSameRequest(list, "cha de camomila  ")?.id, 1, "sem acento e maiúsculas");
  assert.equal(findSameRequest(list, "Adocante"), null, "recusado não bloqueia pedir de novo");
  const rows = [
    { id: 1, status: "open", votes: 1, createdAt: "2026-11-01", decidedAt: null },
    { id: 2, status: "approved", votes: 9, createdAt: "2026-10-01", decidedAt: "2026-11-02" },
    { id: 3, status: "open", votes: 4, createdAt: "2026-11-03", decidedAt: null },
    { id: 4, status: "open", votes: 4, createdAt: "2026-11-02", decidedAt: null },
    { id: 5, status: "declined", votes: 0, createdAt: "2026-10-05", decidedAt: "2026-11-05" },
  ];
  assert.deepEqual(sortRequests(rows).map((row) => row.id), [4, 3, 1, 5, 2], "abertos mais apoiados primeiro; decididos do mais recente");
});
