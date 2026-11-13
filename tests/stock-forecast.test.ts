import { test } from "node:test";
import assert from "node:assert/strict";
import { comingUp, daysLeftLabel, forecastItem, shoppingList, shoppingMessage, suggestedPurchase, type ForecastInput } from "../app/stock-forecast.ts";

const base: ForecastInput = { id: 1, name: "Café", unit: "pct", category: "Bebidas", unopenedQty: 3, openedQty: 0, minimumQty: 1, averageDurationDays: 4 };
const today = "2026-11-12";

test("previsão: quando o saldo acaba", () => {
  assert.deepEqual(forecastItem(base, today), { available: 3, daysLeft: 12, endsOn: "2026-11-24", urgency: "later" });
  assert.equal(forecastItem({ ...base, unopenedQty: 1, openedQty: 0.5 }, today).urgency, "soon"); // 6 dias
  assert.equal(forecastItem({ ...base, unopenedQty: 0, openedQty: 0.5 }, today).urgency, "now"); // 2 dias
  assert.equal(forecastItem({ ...base, unopenedQty: 0, openedQty: 0 }, today).urgency, "now");
  assert.equal(forecastItem({ ...base, unopenedQty: 10 }, today).urgency, "ok");
  // Sem medição: só o mínimo decide.
  const unmeasured = { ...base, averageDurationDays: null };
  assert.deepEqual(forecastItem(unmeasured, today), { available: 3, daysLeft: null, endsOn: null, urgency: "ok" });
  assert.equal(forecastItem({ ...unmeasured, unopenedQty: 1 }, today).urgency, "soon");
});

test("quanto comprar", () => {
  // 30 dias ÷ 4 dias por pacote = 7,5 + mínimo 1 = 8,5; tem 3 → comprar 6.
  assert.equal(suggestedPurchase(base, 30), 6);
  assert.equal(suggestedPurchase(base, 15), 2); // 3,75 + 1 − 3 = 1,75 → arredonda para cima
  // Sem medição: completa até o mínimo, pelo menos 1.
  assert.equal(suggestedPurchase({ ...base, averageDurationDays: null, unopenedQty: 0, minimumQty: 3 }), 3);
  assert.equal(suggestedPurchase({ ...base, averageDurationDays: null, unopenedQty: 2, minimumQty: 2 }), 1);
  assert.equal(suggestedPurchase({ ...base, averageDurationDays: null, unopenedQty: 5, minimumQty: 2 }), 0);
});

test("lista de compras em ordem de urgência", () => {
  const items: ForecastInput[] = [
    { ...base, id: 1, name: "Café", unopenedQty: 1, openedQty: 0.5 }, // 6 dias → soon
    { ...base, id: 2, name: "Açúcar", unopenedQty: 0, openedQty: 0, averageDurationDays: null, minimumQty: 2 }, // acabou → now
    { ...base, id: 3, name: "Chá", unopenedQty: 10 }, // ok
    { ...base, id: 4, name: "Leite", unopenedQty: 3 }, // 12 dias → later
    { ...base, id: 5, name: "Biscoito", unopenedQty: 0, openedQty: 0.5, averageDurationDays: 2 }, // 1 dia → now
  ];
  const list = shoppingList(items, today, 30);
  assert.deepEqual(list.map((line) => [line.name, line.urgency, line.reason]), [["Açúcar", "now", "Acabou"], ["Biscoito", "now", "Acaba em ~1 dia"], ["Café", "soon", "Acaba em ~6 dias"]]);
  assert.equal(list[0].buy, 2);
  assert.deepEqual(comingUp(items, today).map((line) => line.name), ["Leite"]);
  const message = shoppingMessage(list, "Portal", 30, "12/11/2026");
  assert.match(message, /\*Açúcar\*: comprar 2 pct \(tem 0 · acabou\)/);
  assert.match(message, /cerca de 30 dias/);
});

test("rótulo de dias", () => {
  assert.equal(daysLeftLabel(null), "");
  assert.equal(daysLeftLabel(0.4), "acaba hoje");
  assert.equal(daysLeftLabel(1), "acaba em ~1 dia");
  assert.equal(daysLeftLabel(12.4), "acaba em ~12 dias");
  assert.equal(daysLeftLabel(95), "dura ~3 meses");
});
